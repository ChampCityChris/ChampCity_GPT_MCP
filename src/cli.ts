import fs from "node:fs";
import path from "node:path";

import { ensureConfiguredRootsExist, loadConfig } from "./config.js";
import { getHttpAuthTokenConfig } from "./httpAuthConfig.js";
import { getOAuthPublicBaseUrl } from "./oauth.js";
import { createMcpServer } from "./server/createMcpServer.js";
import { runHttpTransport } from "./transports/httpTransport.js";
import { runStdioTransport } from "./transports/stdioTransport.js";

export type McpTransportMode = "stdio" | "http";

export interface CliOptions {
  transport: McpTransportMode;
  host: string;
  port: number;
  allowNonlocalHttp: boolean;
  allowUnauthLocalHttp: boolean;
  authToken?: string;
  authTokenSource: "env" | "local-file" | "none";
}

function getArgValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  throw new Error(`Expected boolean value but received "${value}".`);
}

function parseTransport(value: string | undefined): McpTransportMode {
  if (value === undefined || value.trim() === "") {
    return "stdio";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "stdio" || normalized === "http") {
    return normalized;
  }

  throw new Error(`Unsupported transport "${value}". Use "stdio" or "http".`);
}

function parsePort(value: string | undefined): number {
  const raw = value ?? "3333";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid HTTP port: ${raw}`);
  }

  return port;
}

export function parseCliOptions(args = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): CliOptions {
  const transport = parseTransport(getArgValue(args, "--transport") ?? env.CHAMPCITY_GPT_TRANSPORT);
  const authConfig = getHttpAuthTokenConfig(path.resolve(cwd), env);
  return {
    transport,
    host: getArgValue(args, "--host") ?? env.CHAMPCITY_GPT_HTTP_HOST ?? "127.0.0.1",
    port: parsePort(getArgValue(args, "--port") ?? env.CHAMPCITY_GPT_HTTP_PORT),
    allowNonlocalHttp: parseBoolean(env.CHAMPCITY_GPT_ALLOW_NONLOCAL_HTTP, false),
    allowUnauthLocalHttp: parseBoolean(env.CHAMPCITY_GPT_ALLOW_UNAUTH_LOCAL_HTTP, false),
    authToken: authConfig.token,
    authTokenSource: authConfig.source
  };
}

export function readPackageVersion(cwd = process.cwd()): string {
  try {
    const packageJsonPath = path.join(cwd, "package.json");
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export async function runCli(args = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): Promise<void> {
  const cliOptions = parseCliOptions(args, env, cwd);
  const config = loadConfig(env, cwd, {
    defaultWriteToolsEnabled: cliOptions.transport === "stdio"
  });
  ensureConfiguredRootsExist(config);

  const version = readPackageVersion(cwd);
  if (cliOptions.transport === "stdio") {
    const mcpServer = createMcpServer(config, version);
    await runStdioTransport(mcpServer);
    return;
  }

  const handle = await runHttpTransport(() => createMcpServer(config, version), config, {
    host: cliOptions.host,
    port: cliOptions.port,
    version,
    authToken: cliOptions.authToken,
    allowNonlocalHttp: cliOptions.allowNonlocalHttp,
    allowUnauthLocalHttp: cliOptions.allowUnauthLocalHttp
  });

  console.error(`ChampCity GPT MCP HTTP server listening on ${handle.url}`);
  console.error(`Health endpoint: ${handle.healthUrl}`);
  console.error(`Write mode: ${config.writeMode} (${config.writeModeSource})`);
  console.error(`HTTP auth token configured: ${cliOptions.authToken ? "yes" : "no"}`);
  console.error(`HTTP auth token source: ${cliOptions.authTokenSource}`);
  console.error(`OAuth public base URL: ${getOAuthPublicBaseUrl(env)}`);
  console.error(`Unauthenticated local HTTP allowed: ${cliOptions.allowUnauthLocalHttp ? "yes" : "no"}`);

  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      await handle.close();
      resolve();
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}
