import { ensureConfiguredRootsExist, loadConfig, type AppConfig } from "../config.js";
import { getOAuthPublicBaseUrl } from "../oauth.js";
import { type WriteMode } from "../writeAccess.js";
import { createMcpServer } from "./createMcpServer.js";
import { runHttpTransport, type HttpTransportHandle } from "../transports/httpTransport.js";

export interface StartHttpMcpServerOptions {
  repoRoot: string;
  host: string;
  port: number;
  version: string;
  configDir?: string;
  logDir?: string;
  generatedDir?: string;
  publicBaseUrl?: string;
  writeMode?: WriteMode;
  authToken?: string;
  allowNonlocalHttp?: boolean;
  allowUnauthLocalHttp?: boolean;
  env?: NodeJS.ProcessEnv;
  ensureRootsExist?: boolean;
  log?: LifecycleLogFn;
  gracefulShutdownMs?: number;
}

export interface ServerHandle {
  host: string;
  port: number;
  healthEndpoint: string;
  mcpEndpoint: string;
  startedAt: string;
  config: AppConfig;
  stop: () => Promise<void>;
  forceStop: () => Promise<void>;
}

type RestorableEnv = Record<string, string | undefined>;
type LifecycleLogFn = (message: string) => void;

export interface McpServerStatus {
  state: "running" | "stopping" | "stopped";
  pid: number | null;
  startedAt?: string;
  host?: string;
  port?: number;
  healthEndpoint?: string;
  mcpEndpoint?: string;
  detail: string;
}

export interface StopMcpServerOptions {
  log?: LifecycleLogFn;
  gracefulShutdownMs?: number;
}

const LIFECYCLE_ENV_KEYS = [
  "CHAMPCITY_GPT_CONFIG_DIR",
  "CHAMPCITY_GPT_LOG_DIR",
  "CHAMPCITY_GPT_GENERATED_DIR",
  "CHAMPCITY_GPT_PUBLIC_BASE_URL",
  "CHAMPCITY_GPT_WRITE_MODE",
  "CHAMPCITY_GPT_HTTP_AUTH_TOKEN",
  "CHAMPCITY_GPT_ALLOW_UNAUTH_LOCAL_HTTP",
  "CHAMPCITY_GPT_ALLOW_NONLOCAL_HTTP"
] as const;

const DEFAULT_GRACEFUL_SHUTDOWN_MS = 1500;

let ownedServerHandle: ServerHandle | null = null;
let stoppingPromise: Promise<void> | null = null;
let lifecycleLog: LifecycleLogFn | null = null;

class ShutdownTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`MCP server did not stop within ${timeoutMs}ms.`);
    this.name = "ShutdownTimeoutError";
  }
}

function logLifecycle(message: string): void {
  lifecycleLog?.(message);
}

function timeoutAfter(timeoutMs: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new ShutdownTimeoutError(timeoutMs)), timeoutMs);
  });
}

function restoreEnv(previous: RestorableEnv): void {
  for (const key of LIFECYCLE_ENV_KEYS) {
    const value = previous[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function applyLifecycleEnv(options: StartHttpMcpServerOptions): { env: NodeJS.ProcessEnv; previous: RestorableEnv } {
  const env: NodeJS.ProcessEnv = {
    ...(options.env ?? process.env)
  };
  const previous = Object.fromEntries(LIFECYCLE_ENV_KEYS.map((key) => [key, process.env[key]])) as RestorableEnv;

  if (options.configDir) {
    env.CHAMPCITY_GPT_CONFIG_DIR = options.configDir;
  }
  if (options.logDir) {
    env.CHAMPCITY_GPT_LOG_DIR = options.logDir;
  }
  if (options.generatedDir) {
    env.CHAMPCITY_GPT_GENERATED_DIR = options.generatedDir;
  }
  if (options.publicBaseUrl) {
    env.CHAMPCITY_GPT_PUBLIC_BASE_URL = options.publicBaseUrl;
  }
  if (options.writeMode) {
    env.CHAMPCITY_GPT_WRITE_MODE = options.writeMode;
  }
  if (options.authToken !== undefined) {
    env.CHAMPCITY_GPT_HTTP_AUTH_TOKEN = options.authToken;
  }
  if (options.allowUnauthLocalHttp !== undefined) {
    env.CHAMPCITY_GPT_ALLOW_UNAUTH_LOCAL_HTTP = String(options.allowUnauthLocalHttp);
  }
  if (options.allowNonlocalHttp !== undefined) {
    env.CHAMPCITY_GPT_ALLOW_NONLOCAL_HTTP = String(options.allowNonlocalHttp);
  }

  for (const key of LIFECYCLE_ENV_KEYS) {
    const value = env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return { env, previous };
}

function controlledStartError(error: unknown, host: string, port: number): Error {
  if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "EADDRINUSE") {
    return new Error(`Port ${port} is already in use on ${host}. Stop the other local MCP server or choose another port.`);
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

export async function startHttpMcpServer(options: StartHttpMcpServerOptions): Promise<ServerHandle> {
  const { env, previous } = applyLifecycleEnv(options);
  let transportHandle: HttpTransportHandle | null = null;
  let stopped = false;

  try {
    const config = loadConfig(env, options.repoRoot, { defaultWriteToolsEnabled: false });
    if (options.ensureRootsExist !== false) {
      ensureConfiguredRootsExist(config);
    }

    transportHandle = await runHttpTransport((auth) => createMcpServer(config, options.version, { scope: auth?.scope }), config, {
      host: options.host,
      port: options.port,
      version: options.version,
      authToken: options.authToken,
      allowNonlocalHttp: options.allowNonlocalHttp ?? false,
      allowUnauthLocalHttp: options.allowUnauthLocalHttp ?? false
    });

    const mcpEndpoint = transportHandle.url;
    const healthEndpoint = transportHandle.healthUrl;
    const actualPort = Number(new URL(healthEndpoint).port);
    const startedAt = new Date().toISOString();

    return {
      host: options.host,
      port: actualPort,
      healthEndpoint,
      mcpEndpoint,
      startedAt,
      config,
      stop: async () => {
        if (stopped) {
          throw new Error("MCP HTTP server is already stopped.");
        }
        stopped = true;
        try {
          await transportHandle?.close();
        } finally {
          restoreEnv(previous);
        }
      },
      forceStop: async () => {
        stopped = true;
        try {
          await transportHandle?.forceClose();
        } finally {
          restoreEnv(previous);
        }
      }
    };
  } catch (error) {
    if (transportHandle) {
      await transportHandle.close();
    }
    restoreEnv(previous);
    throw controlledStartError(error, options.host, options.port);
  }
}

export async function stopHttpMcpServer(handle: ServerHandle): Promise<void> {
  await handle.stop();
}

export async function startMcpServer(options: StartHttpMcpServerOptions): Promise<ServerHandle> {
  if (options.log) {
    lifecycleLog = options.log;
  }

  if (ownedServerHandle) {
    logLifecycle(`MCP server already running with PID ${process.pid}; duplicate start skipped.`);
    return ownedServerHandle;
  }

  if (stoppingPromise) {
    await stoppingPromise;
  }

  const handle = await startHttpMcpServer(options);
  ownedServerHandle = handle;
  logLifecycle(`MCP server started with PID ${process.pid} at ${handle.mcpEndpoint}.`);
  return handle;
}

export async function stopMcpServer(options: StopMcpServerOptions = {}): Promise<void> {
  if (options.log) {
    lifecycleLog = options.log;
  }

  if (stoppingPromise) {
    await stoppingPromise;
    return;
  }

  const handle = ownedServerHandle;
  if (!handle) {
    return;
  }

  const gracefulShutdownMs = options.gracefulShutdownMs ?? DEFAULT_GRACEFUL_SHUTDOWN_MS;
  stoppingPromise = (async () => {
    logLifecycle(`MCP server graceful shutdown requested for PID ${process.pid}.`);
    const gracefulStop = handle.stop();
    try {
      await Promise.race([gracefulStop, timeoutAfter(gracefulShutdownMs)]);
      logLifecycle(`MCP server graceful shutdown succeeded for PID ${process.pid}.`);
    } catch (error) {
      if (error instanceof ShutdownTimeoutError) {
        logLifecycle(`MCP server forced shutdown used for PID ${process.pid}.`);
        try {
          await handle.forceStop();
          await gracefulStop.catch(() => undefined);
        } catch (forceError) {
          logLifecycle(
            `MCP server shutdown failure for PID ${process.pid}: ${forceError instanceof Error ? forceError.message : String(forceError)}`
          );
          throw forceError;
        }
        return;
      }

      logLifecycle(`MCP server shutdown failure for PID ${process.pid}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      ownedServerHandle = null;
      stoppingPromise = null;
    }
  })();

  await stoppingPromise;
}

export function getMcpServerStatus(): McpServerStatus {
  if (ownedServerHandle) {
    return {
      state: stoppingPromise ? "stopping" : "running",
      pid: process.pid,
      startedAt: ownedServerHandle.startedAt,
      host: ownedServerHandle.host,
      port: ownedServerHandle.port,
      healthEndpoint: ownedServerHandle.healthEndpoint,
      mcpEndpoint: ownedServerHandle.mcpEndpoint,
      detail: stoppingPromise
        ? `Owned MCP server PID ${process.pid} is stopping.`
        : `Owned MCP server PID ${process.pid} is running on ${ownedServerHandle.mcpEndpoint}.`
    };
  }

  return {
    state: "stopped",
    pid: null,
    detail: "No MCP server owned by this app process is running."
  };
}

export function resolveLifecyclePublicBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return getOAuthPublicBaseUrl(env);
}
