import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertAllowedLauncherCommand,
  configureOAuthAdminPassword,
  createClientConfigPreviews,
  createDefaultLocalConfig,
  createOAuthMetadataPreview,
  createProtectedResourceMetadataPreview,
  DEFAULT_REPO_ROOT,
  findStaleEntrypointReferences,
  getAuditLogPath,
  getEntrypointPath,
  getGeneratedDir,
  getLauncherHttpAuthStatus,
  getLauncherOAuthStatus,
  getLauncherWriteAccessStatus,
  getLocalConfigPath,
  getLogsDir,
  getPublicHealthEndpoint,
  getPublicMcpEndpoint,
  getPublicOAuthAuthorizationServerMetadata,
  getPublicOAuthIssuer,
  getPublicOAuthProtectedResourceMetadata,
  getSetupStatePath,
  isPublicTunnelReady,
  isHttpWriteToolsEnabled,
  isUnauthenticatedLocalHttpAllowed,
  LOCAL_HTTP_HEALTH_ENDPOINT,
  LOCAL_HTTP_HOST,
  LOCAL_HTTP_MCP_ENDPOINT,
  LOCAL_HTTP_PORT,
  CLOUDFLARED_CONFIG_TEMPLATE_RELATIVE,
  CLOUDFLARE_TUNNEL_GUIDE_RELATIVE,
  resetLauncherOAuthClients,
  revokeLauncherChatGptOAuthTokens,
  revokeLauncherOAuthTokens,
  readSetupState,
  clearLauncherExpiredOAuthTokens,
  clearLauncherWriteApprovalToken,
  generateLauncherWriteApprovalToken,
  readLocalConfig,
  saveLauncherWriteApprovalToken,
  setLauncherHttpWriteToolsEnabled,
  setLauncherWriteMode,
  clearLauncherPendingPatchProposals,
  TUNNEL_READINESS_SCRIPT_RELATIVE,
  resetSetupState,
  validateLocalConfig,
  writeSetupState,
  writeClientConfigFiles,
  writeLocalConfig
} from "./launcherCore.js";
import { buildMcpServer, installDependencies, type OperationResult } from "./runtimeOperations.js";
import { detectRuntimes } from "./runtimeDetection.js";
import { ensureRuntimeDirectories, resolveElectronRuntimePaths } from "./runtimePaths.js";
import type { RuntimePathInfo } from "../src/runtimePaths.js";
import {
  clearLocalHttpAuthToken,
  generateHttpAuthToken,
  getHttpAuthStatus,
  getHttpAuthTokenConfig,
  saveLocalHttpAuthToken
} from "../src/httpAuthConfig.js";

type CheckStatus = "PASS" | "WARN" | "FAIL";
type ServerState = "running" | "stopped" | "stale" | "unknown";

interface DoctorCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

interface DoctorResult {
  status: CheckStatus;
  checks: DoctorCheck[];
  output: string;
  completedAt: string;
}

interface DiagnosticStatus {
  state: ServerState;
  pid: number | null;
  detail: string;
  statusFile: string;
  stdoutLog: string;
  stderrLog: string;
}

type TunnelReadinessStatus = "READY" | "NOT_READY" | "WARN";

interface SetupSavePayload {
  allowedRoots: string[];
  confirmedBroadRoots?: boolean;
  oauthAdminPassword: string;
  localOnly: boolean;
  publicBaseUrl?: string;
  cloudflareChoice: "guide" | "skip";
  writeMode: "off" | "docs" | "patch" | "elevated";
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let lastDoctorResult: DoctorResult | null = null;

function resolveRepoRoot(): string {
  const envRoot = process.env.CHAMPCITY_GPT_REPO_ROOT;
  if (envRoot && fs.existsSync(path.join(envRoot, "package.json"))) {
    return path.resolve(envRoot);
  }

  const candidates = [
    process.cwd(),
    DEFAULT_REPO_ROOT,
    path.resolve(__dirname, "..", ".."),
    path.dirname(app.getPath("exe")),
    path.resolve(path.dirname(app.getPath("exe")), "..")
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(candidate, "package.json"), "utf8")) as { name?: string };
        if (parsed.name === "champcity-gpt") {
          return path.resolve(candidate);
        }
      } catch {
        // Keep searching.
      }
    }
  }

  return DEFAULT_REPO_ROOT;
}

const repoRoot = resolveRepoRoot();
const runtimePaths = resolveElectronRuntimePaths(repoRoot);
ensureRuntimeDirectories(runtimePaths);
process.env.CHAMPCITY_GPT_CONFIG_DIR = runtimePaths.configDir;
process.env.CHAMPCITY_GPT_LOG_DIR = runtimePaths.logsDir;
process.env.CHAMPCITY_GPT_GENERATED_DIR = runtimePaths.generatedDir;

const initialSetupState = readSetupState(repoRoot);
if (initialSetupState.publicBaseUrl && !process.env.CHAMPCITY_GPT_PUBLIC_BASE_URL) {
  process.env.CHAMPCITY_GPT_PUBLIC_BASE_URL = initialSetupState.publicBaseUrl;
}

function appendOutput(channel: string, message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${channel}: ${message}`;
  mainWindow?.webContents.send("launcher:log", line);
}

function commandOutputToString(chunks: Buffer[]): string {
  return Buffer.concat(chunks).toString("utf8");
}

function getDiagnosticPaths() {
  const logsDir = getLogsDir(repoRoot);
  return {
    logsDir,
    pidFile: path.join(logsDir, "champcity-gpt-mcp-http.pid"),
    statusFile: path.join(logsDir, "champcity-gpt-mcp-http.status.json"),
    stdoutLog: path.join(logsDir, "champcity-gpt-mcp-http.out.log"),
    stderrLog: path.join(logsDir, "champcity-gpt-mcp-http.err.log")
  };
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function clearDiagnosticStatusFiles(): void {
  const { pidFile, statusFile } = getDiagnosticPaths();
  fs.rmSync(pidFile, { force: true });
  fs.rmSync(statusFile, { force: true });
}

function getDiagnosticServerStatus(): DiagnosticStatus {
  const { pidFile, statusFile, stdoutLog, stderrLog } = getDiagnosticPaths();
  if (!fs.existsSync(pidFile)) {
    return {
      state: "stopped",
      pid: null,
      detail: "No local HTTP MCP PID file is present.",
      statusFile,
      stdoutLog,
      stderrLog
    };
  }

  const rawPid = fs.readFileSync(pidFile, "utf8").trim();
  if (!/^\d+$/u.test(rawPid)) {
    return {
      state: "stale",
      pid: null,
      detail: "Local HTTP MCP PID file is invalid.",
      statusFile,
      stdoutLog,
      stderrLog
    };
  }

  const pid = Number(rawPid);
  if (!processExists(pid)) {
    return {
      state: "stale",
      pid,
      detail: `PID ${pid} is no longer running.`,
      statusFile,
      stdoutLog,
      stderrLog
    };
  }

  try {
    const status = JSON.parse(fs.readFileSync(statusFile, "utf8")) as { entrypoint?: string; repoRoot?: string };
    if (status.entrypoint !== getEntrypointPath(repoRoot) || status.repoRoot !== repoRoot) {
      return {
        state: "unknown",
        pid,
      detail: "Tracked HTTP PID exists, but status metadata does not match this repo and entrypoint.",
        statusFile,
        stdoutLog,
        stderrLog
      };
    }
  } catch {
    return {
      state: "unknown",
      pid,
      detail: "Tracked HTTP PID exists, but status metadata could not be read.",
      statusFile,
      stdoutLog,
      stderrLog
    };
  }

  return {
    state: "running",
    pid,
    detail: `Local HTTP MCP server PID ${pid} is running.`,
    statusFile,
    stdoutLog,
    stderrLog
  };
}

function runtimePathStatus(paths: RuntimePathInfo) {
  return {
    mode: paths.mode,
    configDir: paths.configDir,
    logsDir: paths.logsDir,
    generatedDir: paths.generatedDir,
    resourceRoot: paths.resourceRoot,
    serverEntrypoint: paths.serverEntrypoint
  };
}

function isBroadRoot(root: string): boolean {
  const resolved = path.resolve(root);
  const parsed = path.parse(resolved);
  const normalized = resolved.toLowerCase();
  const home = os.homedir().toLowerCase();
  return (
    normalized === parsed.root.toLowerCase() ||
    normalized === home ||
    normalized === path.join(os.homedir(), "Desktop").toLowerCase() ||
    normalized === path.join(os.homedir(), "Documents").toLowerCase()
  );
}

function applyPublicBaseUrl(publicBaseUrl?: string, localOnly = false): void {
  if (localOnly || !publicBaseUrl?.trim()) {
    delete process.env.CHAMPCITY_GPT_PUBLIC_BASE_URL;
    return;
  }

  process.env.CHAMPCITY_GPT_PUBLIC_BASE_URL = publicBaseUrl.trim().replace(/\/+$/u, "");
}

function isSetupComplete(): boolean {
  const setup = readSetupState(repoRoot);
  const oauthStatus = getLauncherOAuthStatus(repoRoot);
  const configExists = fs.existsSync(getLocalConfigPath(repoRoot));
  const localConfig = configExists ? readLocalConfig(repoRoot) : null;
  return setup.setupComplete && configExists && Boolean(localConfig?.allowedRoots.length) && oauthStatus.adminPasswordConfigured;
}

function saveInitialSetup(payload: SetupSavePayload) {
  const broadRoots = payload.allowedRoots.map((root) => path.resolve(root)).filter(isBroadRoot);
  if (broadRoots.length > 0 && !payload.confirmedBroadRoots) {
    return {
      ok: false,
      requiresConfirmation: true,
      broadRoots
    };
  }

  applyPublicBaseUrl(payload.publicBaseUrl, payload.localOnly);
  const allowedRoots = payload.allowedRoots.map((root) => path.resolve(root));
  const localConfig = {
    allowedRoots,
    requireGitRoot: true,
    auditLog: getAuditLogPath(repoRoot),
    allowedCommands: createDefaultLocalConfig(repoRoot).allowedCommands
  };
  const validation = writeLocalConfig(repoRoot, localConfig);
  configureOAuthAdminPassword(repoRoot, payload.oauthAdminPassword);
  setLauncherWriteMode(repoRoot, payload.writeMode);
  const setup = writeSetupState(repoRoot, {
    setupComplete: true,
    appVersion: app.getVersion(),
    publicBaseUrl: payload.localOnly ? undefined : process.env.CHAMPCITY_GPT_PUBLIC_BASE_URL,
    localOnly: payload.localOnly,
    cloudflareChoice: payload.cloudflareChoice
  });

  return {
    ok: true,
    path: getSetupStatePath(repoRoot),
    setup,
    config: validation.config,
    warnings: validation.warnings
  };
}

async function probeEntrypoint(nodeCommand: string | null): Promise<DoctorCheck> {
  const entrypoint = getEntrypointPath(repoRoot);
  if (!fs.existsSync(entrypoint)) {
    return {
      name: "MCP entrypoint can start without module-not-found",
      status: "FAIL",
      detail: `Entrypoint is missing: ${entrypoint}`
    };
  }

  const command = nodeCommand ?? "node";
  assertAllowedLauncherCommand(command, [entrypoint], repoRoot);

  return new Promise((resolve) => {
    const stderrChunks: Buffer[] = [];
    const child = spawn(command, [entrypoint], {
      cwd: repoRoot,
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
      shell: false
    });

    const timer = setTimeout(() => {
      if (!child.killed) {
        child.kill();
      }
      resolve({
        name: "MCP entrypoint can start without module-not-found",
        status: "PASS",
        detail: "Entrypoint startup probe did not hit a module-loading failure."
      });
    }, 750);

    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        name: "MCP entrypoint can start without module-not-found",
        status: "FAIL",
        detail: error.message
      });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      const stderr = commandOutputToString(stderrChunks);
      if (exitCode !== 0 && /Cannot find module|ERR_MODULE_NOT_FOUND|SyntaxError/u.test(stderr)) {
        resolve({
          name: "MCP entrypoint can start without module-not-found",
          status: "FAIL",
          detail: stderr.trim()
        });
        return;
      }

      resolve({
        name: "MCP entrypoint can start without module-not-found",
        status: "PASS",
        detail: "Entrypoint probe exited without a module-loading failure."
      });
    });
  });
}

async function runDoctor(): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];
  const packageJson = path.join(repoRoot, "package.json");
  const nodeModules = path.join(repoRoot, "node_modules");
  const entrypoint = getEntrypointPath(repoRoot);
  const configPath = getLocalConfigPath(repoRoot);
  const logsDir = getLogsDir(repoRoot);

  appendOutput("doctor", "Checking Node.js...");
  appendOutput("doctor", "Checking npm...");
  const runtime = await detectRuntimes();
  if (runtime.node.found && runtime.node.path) {
    appendOutput("doctor", `Found node: ${runtime.node.path}`);
  }
  if (runtime.npm.found && runtime.npm.path) {
    appendOutput("doctor", `Found npm: ${runtime.npm.path}`);
  }
  for (const error of runtime.errors) {
    appendOutput("doctor", error);
  }

  checks.push({
    name: "Node.js installed",
    status: runtime.node.found ? "PASS" : "FAIL",
    detail: runtime.node.found && runtime.node.path ? `${runtime.node.path}${runtime.node.version ? ` (${runtime.node.version})` : ""}` : "node is not installed or not on PATH."
  });

  checks.push({
    name: "npm installed",
    status: runtime.npm.found ? "PASS" : "FAIL",
    detail: runtime.npm.found && runtime.npm.path ? `${runtime.npm.path}${runtime.npm.version ? ` (${runtime.npm.version})` : ""}` : "npm is not installed or not on PATH."
  });

  checks.push({
    name: "package.json found",
    status: fs.existsSync(packageJson) ? "PASS" : "FAIL",
    detail: packageJson
  });

  checks.push({
    name: "Project dependencies installed",
    status: app.isPackaged || fs.existsSync(nodeModules) ? "PASS" : "WARN",
    detail: app.isPackaged ? "Packaged app uses bundled resources." : fs.existsSync(nodeModules) ? nodeModules : "node_modules is missing. Use Install Dependencies."
  });

  checks.push({
    name: "MCP server built",
    status: fs.existsSync(entrypoint) ? "PASS" : "FAIL",
    detail: entrypoint
  });

  if (fs.existsSync(configPath)) {
    try {
      const config = readLocalConfig(repoRoot);
      checks.push({ name: "config/allowed-roots.local.json exists", status: "PASS", detail: configPath });
      const missingRoots = config.allowedRoots.filter((root) => !fs.existsSync(root));
      checks.push({
        name: "allowed roots exist",
        status: missingRoots.length === 0 ? "PASS" : "FAIL",
        detail: missingRoots.length === 0 ? "All configured allowed roots exist." : `Missing: ${missingRoots.join(", ")}`
      });
    } catch (error) {
      checks.push({
        name: "config/allowed-roots.local.json exists",
        status: "FAIL",
        detail: error instanceof Error ? error.message : String(error)
      });
      checks.push({ name: "allowed roots exist", status: "FAIL", detail: "Could not validate allowed roots because config is invalid." });
    }
  } else {
    checks.push({ name: "config/allowed-roots.local.json exists", status: "WARN", detail: "Use Save Config to create the local config." });
    checks.push({ name: "allowed roots exist", status: "WARN", detail: "No local config exists yet." });
  }

  try {
    fs.mkdirSync(logsDir, { recursive: true });
    checks.push({ name: "logs folder exists", status: "PASS", detail: logsDir });
  } catch (error) {
    checks.push({
      name: "logs folder exists",
      status: "FAIL",
      detail: error instanceof Error ? error.message : String(error)
    });
  }

  const staleRefs = findStaleEntrypointReferences(repoRoot);
  checks.push({
    name: "stale dist/index.js references absent",
    status: staleRefs.length === 0 ? "PASS" : "FAIL",
    detail: staleRefs.length === 0 ? "No stale top-level dist/index.js references found." : staleRefs.join(", ")
  });

  checks.push(await probeEntrypoint(app.isPackaged ? process.execPath : runtime.node.path));

  const status: CheckStatus = checks.some((check) => check.status === "FAIL") ? "FAIL" : checks.some((check) => check.status === "WARN") ? "WARN" : "PASS";
  const completedAt = new Date().toISOString();
  const output = checks.map((check) => `${check.status} ${check.name}: ${check.detail}`).join(os.EOL);
  lastDoctorResult = { status, checks, output, completedAt };
  appendOutput("doctor", output);
  return lastDoctorResult;
}

async function getAppStatus() {
  const configPath = getLocalConfigPath(repoRoot);
  const entrypoint = getEntrypointPath(repoRoot);
  let configStatus = "Local config missing. Suggested defaults are loaded in the UI.";
  try {
    if (fs.existsSync(configPath)) {
      const validation = validateLocalConfig(JSON.parse(fs.readFileSync(configPath, "utf8")), repoRoot);
      configStatus = validation.warnings.length > 0 ? `Config has ${validation.warnings.length} warning(s).` : "Config is present and valid.";
    }
  } catch (error) {
    configStatus = error instanceof Error ? `Config error: ${error.message}` : "Config error.";
  }

  const httpAuthStatus = getLauncherHttpAuthStatus(repoRoot);
  const oauthStatus = getLauncherOAuthStatus(repoRoot);
  const writeAccessStatus = getLauncherWriteAccessStatus(repoRoot);
  const unauthenticatedLocalHttpAllowed = isUnauthenticatedLocalHttpAllowed();
  const writeToolsEnabled = isHttpWriteToolsEnabled(repoRoot);
  const localHealthPassing = await probeLocalHealth();
  const tunnelReadinessStatus = getTunnelReadinessStatus({
    oauthAdminPasswordConfigured: oauthStatus.adminPasswordConfigured,
    unauthenticatedLocalHttpAllowed,
    writeToolsEnabled,
    localHealthPassing
  });
  const publicTunnelReady = tunnelReadinessStatus === "READY";

  return {
    appName: "ChampCity GPT MCP Launcher",
    repoRoot,
    runtime: runtimePathStatus(runtimePaths),
    entrypoint,
    configPath,
    configExists: fs.existsSync(configPath),
    configStatus,
    setup: {
      ...readSetupState(repoRoot),
      path: getSetupStatePath(repoRoot),
      complete: isSetupComplete()
    },
    firstRunRequired: !isSetupComplete(),
    buildExists: fs.existsSync(entrypoint),
    diagnosticStatus: getDiagnosticServerStatus(),
    lastDoctorResult,
    generatedPreviews: createClientConfigPreviews(repoRoot),
    http: {
      localEndpoint: LOCAL_HTTP_MCP_ENDPOINT,
      localHealthEndpoint: LOCAL_HTTP_HEALTH_ENDPOINT,
      publicEndpoint: getPublicMcpEndpoint(),
      publicHealthEndpoint: getPublicHealthEndpoint(),
      oauthIssuer: getPublicOAuthIssuer(),
      oauthAuthorizationServerMetadata: getPublicOAuthAuthorizationServerMetadata(),
      oauthProtectedResourceMetadata: getPublicOAuthProtectedResourceMetadata(),
      oauthAdminPasswordConfigured: oauthStatus.adminPasswordConfigured,
      oauthRegisteredClientsCount: oauthStatus.registeredClientsCount,
      oauthActiveClientsCount: oauthStatus.activeOAuthClientsCount,
      oauthActiveTokensCount: oauthStatus.activeTokensCount,
      oauthActiveWriteTokensCount: oauthStatus.activeWriteTokensCount,
      oauthActiveRefreshSessionsCount: oauthStatus.activeRefreshSessionsCount,
      oauthExpiredSessionsCount: oauthStatus.expiredSessionsCount,
      oauthRevokedSessionsCount: oauthStatus.revokedSessionsCount,
      oauthAccessTokenTtlSeconds: oauthStatus.accessTokenTtlSeconds,
      oauthRefreshTokenTtlSeconds: oauthStatus.refreshTokenTtlSeconds,
      oauthAccessTokenTtlLabel: oauthStatus.accessTokenTtlLabel,
      oauthRefreshTokenTtlLabel: oauthStatus.refreshTokenTtlLabel,
      oauthLastAuthorizeError: oauthStatus.lastAuthorizeError,
      authTokenConfigured: httpAuthStatus.configured,
      authTokenSource: httpAuthStatus.source,
      unauthenticatedLocalHttpAllowed,
      writeToolsEnabled,
      localHealthPassing,
      tunnelReadinessStatus,
      publicTunnelReady
    },
    writeAccess: {
      configPath: writeAccessStatus.configPath,
      writeMode: writeAccessStatus.writeMode,
      writeModeSource: writeAccessStatus.writeModeSource,
      docsWritesAllowed: writeAccessStatus.docsWritesAllowed,
      patchWritesAllowed: writeAccessStatus.patchWritesAllowed,
      elevatedOperationsAllowed: writeAccessStatus.elevatedOperationsAllowed,
      legacyApprovalTokenConfigured: writeAccessStatus.legacyApprovalTokenConfigured,
      legacyApprovalTokenSource: writeAccessStatus.legacyApprovalTokenSource,
      legacyApprovalTokenCreatedAt: writeAccessStatus.legacyApprovalTokenCreatedAt,
      legacyApprovalTokenUpdatedAt: writeAccessStatus.legacyApprovalTokenUpdatedAt,
      pendingPatchProposalCount: writeAccessStatus.pendingPatchProposalCount,
      oauthFilesWriteGranted: writeAccessStatus.oauthFilesWriteGranted,
      publicWriteReadiness: writeAccessStatus.publicWriteReadiness,
      publicWriteReadinessReason: writeAccessStatus.publicWriteReadinessReason
    }
  };
}

async function startDiagnosticServer(): Promise<OperationResult & { status: DiagnosticStatus }> {
  const current = getDiagnosticServerStatus();
  if (current.state === "running") {
    return { ok: true, output: current.detail, status: current };
  }

  if (current.state === "stale") {
    clearDiagnosticStatusFiles();
  }

  const entrypoint = getEntrypointPath(repoRoot);
  if (!fs.existsSync(entrypoint)) {
    return { ok: false, output: `Entrypoint is missing: ${entrypoint}`, status: getDiagnosticServerStatus() };
  }

  const authConfig = getHttpAuthTokenConfig(repoRoot);
  const authTokenConfigured = authConfig.configured;
  const oauthStatus = getLauncherOAuthStatus(repoRoot);
  const unauthenticatedLocalHttpAllowed = isUnauthenticatedLocalHttpAllowed();
  if (!oauthStatus.adminPasswordConfigured && !authTokenConfigured && !unauthenticatedLocalHttpAllowed) {
    return {
      ok: false,
      output:
        "Refusing to start local HTTP MCP server before OAuth admin password is configured. Configure OAuth Admin Password, use legacy HTTP Auth Token, or explicitly enable Local Unauthenticated Test Mode.",
      status: getDiagnosticServerStatus()
    };
  }

  if (oauthStatus.adminPasswordConfigured) {
    appendOutput("http", "Starting OAuth-protected local HTTP MCP server.");
  } else if (authTokenConfigured) {
    appendOutput("http", "Starting legacy bearer-authenticated local HTTP MCP server.");
  } else if (unauthenticatedLocalHttpAllowed) {
    appendOutput("http", "LOCAL TEST ONLY - DO NOT TUNNEL.");
  }

  const httpArgs = [entrypoint, "--transport", "http", "--host", LOCAL_HTTP_HOST, "--port", String(LOCAL_HTTP_PORT)];
  let command = process.execPath;
  let serverEnv: NodeJS.ProcessEnv = {};
  if (app.isPackaged) {
    appendOutput("http", "Starting bundled server with Electron node runtime.");
    serverEnv = { ELECTRON_RUN_AS_NODE: "1" };
  } else {
    appendOutput("http", "Checking Node.js...");
    const runtime = await detectRuntimes();
    if (!runtime.node.found || !runtime.node.path) {
      const output = "node not found. Install Node.js LTS and restart the app.";
      appendOutput("http", output);
      return { ok: false, output, status: getDiagnosticServerStatus() };
    }
    command = runtime.node.path;
    appendOutput("http", `Found node: ${runtime.node.path}`);
  }
  assertAllowedLauncherCommand(command, httpArgs, repoRoot);
  const { logsDir, pidFile, statusFile, stdoutLog, stderrLog } = getDiagnosticPaths();
  fs.mkdirSync(logsDir, { recursive: true });
  const stdoutFd = fs.openSync(stdoutLog, "a");
  const stderrFd = fs.openSync(stderrLog, "a");

  const child = spawn(command, httpArgs, {
    cwd: repoRoot,
    detached: true,
    stdio: ["ignore", stdoutFd, stderrFd],
    windowsHide: true,
    shell: false,
    env: {
      ...process.env,
      ...serverEnv,
      CHAMPCITY_GPT_CONFIG_DIR: runtimePaths.configDir,
      CHAMPCITY_GPT_LOG_DIR: runtimePaths.logsDir,
      CHAMPCITY_GPT_GENERATED_DIR: runtimePaths.generatedDir,
      CHAMPCITY_GPT_TRANSPORT: "http",
      CHAMPCITY_GPT_HTTP_HOST: LOCAL_HTTP_HOST,
      CHAMPCITY_GPT_HTTP_PORT: String(LOCAL_HTTP_PORT),
      CHAMPCITY_GPT_PUBLIC_BASE_URL: getPublicOAuthIssuer(),
      CHAMPCITY_GPT_HTTP_AUTH_TOKEN: authConfig.token ?? "",
      CHAMPCITY_GPT_ALLOW_UNAUTH_LOCAL_HTTP: authTokenConfigured ? "false" : String(unauthenticatedLocalHttpAllowed),
      CHAMPCITY_GPT_WRITE_MODE: getLauncherWriteAccessStatus(repoRoot).writeMode
    }
  });

  fs.closeSync(stdoutFd);
  fs.closeSync(stderrFd);
  child.unref();

  fs.writeFileSync(pidFile, String(child.pid), "ascii");
  fs.writeFileSync(
    statusFile,
    `${JSON.stringify(
      {
        pid: child.pid,
        startedAt: new Date().toISOString(),
        entrypoint,
        repoRoot,
        runtimeMode: runtimePaths.mode,
        configDir: runtimePaths.configDir,
        logsDir: runtimePaths.logsDir,
        generatedDir: runtimePaths.generatedDir,
        mode: "http",
        localEndpoint: LOCAL_HTTP_MCP_ENDPOINT,
        healthEndpoint: LOCAL_HTTP_HEALTH_ENDPOINT,
        publicBaseUrl: getPublicOAuthIssuer(),
        authTokenConfigured,
        authTokenSource: authConfig.source,
        oauthAdminPasswordConfigured: oauthStatus.adminPasswordConfigured,
        unauthenticatedLocalHttpAllowed,
        publicTunnelReady: isPublicTunnelReady(repoRoot),
        writeMode: getLauncherWriteAccessStatus(repoRoot).writeMode,
        writeToolsEnabled: isHttpWriteToolsEnabled(repoRoot)
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const status = getDiagnosticServerStatus();
  appendOutput("http", `Started PID ${child.pid}`);
  return { ok: true, output: `Started local HTTP MCP server PID ${child.pid}.`, status };
}

function stopDiagnosticServer(): OperationResult & { status: DiagnosticStatus } {
  const status = getDiagnosticServerStatus();
  if (status.state === "stopped") {
    return { ok: true, output: status.detail, status };
  }

  if (status.state === "stale") {
    clearDiagnosticStatusFiles();
    return { ok: true, output: "Cleaned up stale diagnostic status files.", status: getDiagnosticServerStatus() };
  }

  if (status.state !== "running" || status.pid === null) {
    return { ok: false, output: `Refusing to stop process: ${status.detail}`, status };
  }

  try {
    process.kill(status.pid);
    clearDiagnosticStatusFiles();
    appendOutput("http", `Stopped PID ${status.pid}`);
    return { ok: true, output: `Stopped local HTTP MCP server PID ${status.pid}.`, status: getDiagnosticServerStatus() };
  } catch (error) {
    return {
      ok: false,
      output: error instanceof Error ? error.message : String(error),
      status: getDiagnosticServerStatus()
    };
  }
}

async function probeLocalHealth(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(LOCAL_HTTP_HEALTH_ENDPOINT, { signal: controller.signal });
    if (!response.ok) {
      return false;
    }

    const payload = (await response.json()) as { status?: unknown };
    return payload.status === "ok";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function getTunnelReadinessStatus(options: {
  oauthAdminPasswordConfigured: boolean;
  unauthenticatedLocalHttpAllowed: boolean;
  writeToolsEnabled: boolean;
  localHealthPassing: boolean;
}): TunnelReadinessStatus {
  if (!options.oauthAdminPasswordConfigured || options.unauthenticatedLocalHttpAllowed || !options.localHealthPassing) {
    return "NOT_READY";
  }

  if (options.writeToolsEnabled) {
    return "WARN";
  }

  return "READY";
}

async function runTunnelReadinessCheck(): Promise<OperationResult> {
  const scriptPath = path.join(repoRoot, TUNNEL_READINESS_SCRIPT_RELATIVE);
  if (!fs.existsSync(scriptPath)) {
    return { ok: false, output: `Tunnel readiness script is missing: ${scriptPath}` };
  }

  appendOutput("tunnel", "Running tunnel readiness check...");
  return new Promise((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false
    });

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", (error) => {
      const output = `Failed to start tunnel readiness check: ${error.message}`;
      appendOutput("tunnel", output);
      resolve({ ok: false, output });
    });
    child.on("close", (exitCode) => {
      const stdout = commandOutputToString(stdoutChunks).trim();
      const stderr = commandOutputToString(stderrChunks).trim();
      const output = [stdout, stderr].filter(Boolean).join(os.EOL);
      appendOutput("tunnel", output || `Tunnel readiness check exited with code ${exitCode}.`);
      resolve({ ok: exitCode === 0, output: output || `Tunnel readiness check exited with code ${exitCode}.` });
    });
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle("getAppStatus", () => getAppStatus());
  ipcMain.handle("saveInitialSetup", (_event, payload: SetupSavePayload) => saveInitialSetup(payload));
  ipcMain.handle("resetSetupWizard", () => {
    resetSetupState(repoRoot);
    return { ok: true, output: "Setup wizard reset. Existing local config, OAuth clients, tokens, and write settings were left in place." };
  });
  ipcMain.handle("runDoctor", () => runDoctor());
  ipcMain.handle("installDependencies", () => installDependencies({ repoRoot, appendOutput, rerunDoctor: runDoctor }));
  ipcMain.handle("buildMcpServer", () => buildMcpServer({ repoRoot, appendOutput, rerunDoctor: runDoctor }));
  ipcMain.handle("readLocalConfig", () => ({
    path: getLocalConfigPath(repoRoot),
    exists: fs.existsSync(getLocalConfigPath(repoRoot)),
    config: fs.existsSync(getLocalConfigPath(repoRoot)) ? readLocalConfig(repoRoot) : createDefaultLocalConfig(repoRoot)
  }));
  ipcMain.handle("saveLocalConfig", (_event, payload: { config: unknown; confirmedOutsideProjects?: boolean }) => {
    const validation = validateLocalConfig(payload.config, repoRoot);
    if (validation.outsideProjectsRoots.length > 0 && !payload.confirmedOutsideProjects) {
      return {
        ok: false,
        requiresConfirmation: true,
        warnings: validation.warnings,
        outsideProjectsRoots: validation.outsideProjectsRoots
      };
    }

    const result = writeLocalConfig(repoRoot, validation.config);
    return {
      ok: true,
      path: getLocalConfigPath(repoRoot),
      warnings: result.warnings,
      config: result.config
    };
  });
  ipcMain.handle("selectFolder", async () => {
    const options: Electron.OpenDialogOptions = {
      title: "Select allowed root",
      properties: ["openDirectory", "createDirectory"]
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("generateClientConfigs", () => writeClientConfigFiles(repoRoot));
  ipcMain.handle("configureOAuthAdminPassword", (_event, password: string) => {
    const status = configureOAuthAdminPassword(repoRoot, password);
    return { ok: true, output: "OAuth admin password configured locally.", status };
  });
  ipcMain.handle("resetOAuthClients", () => {
    const status = resetLauncherOAuthClients(repoRoot);
    return { ok: true, output: "OAuth clients reset.", status };
  });
  ipcMain.handle("revokeAllOAuthTokens", () => {
    const status = revokeLauncherOAuthTokens(repoRoot);
    return { ok: true, output: "All OAuth sessions revoked.", status };
  });
  ipcMain.handle("revokeChatGptOAuthTokens", () => {
    const status = revokeLauncherChatGptOAuthTokens(repoRoot);
    return { ok: true, output: "ChatGPT OAuth sessions revoked.", status };
  });
  ipcMain.handle("clearExpiredOAuthTokens", () => {
    const status = clearLauncherExpiredOAuthTokens(repoRoot);
    return { ok: true, output: "Expired OAuth sessions cleared.", status };
  });
  ipcMain.handle("openOAuthMetadata", () => shell.openExternal(getPublicOAuthAuthorizationServerMetadata()));
  ipcMain.handle("openProtectedResourceMetadata", () => shell.openExternal(getPublicOAuthProtectedResourceMetadata()));
  ipcMain.handle("getOAuthMetadataPreview", () => createOAuthMetadataPreview());
  ipcMain.handle("getProtectedResourceMetadataPreview", () => createProtectedResourceMetadataPreview());
  ipcMain.handle("copyGenericConfig", () => {
    const genericConfig = createClientConfigPreviews(repoRoot).generic;
    clipboard.writeText(genericConfig);
    return { ok: true, output: "Generic STDIO MCP config copied to clipboard." };
  });
  ipcMain.handle("openGeneratedFolder", () => shell.openPath(getGeneratedDir(repoRoot)));
  ipcMain.handle("openAuditLog", () => {
    const auditLog = getAuditLogPath(repoRoot);
    if (!fs.existsSync(auditLog)) {
      fs.mkdirSync(path.dirname(auditLog), { recursive: true });
    }
    return shell.openPath(fs.existsSync(auditLog) ? auditLog : path.dirname(auditLog));
  });
  ipcMain.handle("openLogsFolder", () => {
    fs.mkdirSync(getLogsDir(repoRoot), { recursive: true });
    return shell.openPath(getLogsDir(repoRoot));
  });
  ipcMain.handle("openDocs", () => shell.openPath(path.join(repoRoot, "docs", "DESKTOP_APP_SETUP.md")));
  ipcMain.handle("openChatGptGuide", () => shell.openPath(path.join(repoRoot, "docs", "CHATGPT_CONNECTION_GUIDE.md")));
  ipcMain.handle("openDomainGuide", () => shell.openPath(path.join(repoRoot, "docs", "CHAMPCITY_NET_ENDPOINT.md")));
  ipcMain.handle("openCloudflareGuide", () => shell.openPath(path.join(repoRoot, CLOUDFLARE_TUNNEL_GUIDE_RELATIVE)));
  ipcMain.handle("openCloudflareDashboard", () => shell.openExternal("https://one.dash.cloudflare.com/"));
  ipcMain.handle("openCloudflaredConfigTemplate", () => shell.openPath(path.join(repoRoot, CLOUDFLARED_CONFIG_TEMPLATE_RELATIVE)));
  ipcMain.handle("runTunnelReadinessCheck", () => runTunnelReadinessCheck());
  ipcMain.handle("openLocalHealthCheck", () => shell.openExternal(LOCAL_HTTP_HEALTH_ENDPOINT));
  ipcMain.handle("copyLocalMcpEndpoint", () => {
    clipboard.writeText(LOCAL_HTTP_MCP_ENDPOINT);
    return { ok: true, output: "Local HTTP MCP endpoint copied to clipboard." };
  });
  ipcMain.handle("copyPublicMcpEndpoint", () => {
    clipboard.writeText(getPublicMcpEndpoint());
    return { ok: true, output: "Public HTTPS MCP endpoint copied to clipboard." };
  });
  ipcMain.handle("copyPublicHealthEndpoint", () => {
    clipboard.writeText(getPublicHealthEndpoint());
    return { ok: true, output: "Public HTTPS health endpoint copied to clipboard." };
  });
  ipcMain.handle("setHttpWriteToolsEnabled", (_event, enabled: boolean) => {
    const status = setLauncherHttpWriteToolsEnabled(repoRoot, enabled);
    return {
      ok: true,
      output:
        status.writeModeSource === "env"
          ? `Local write mode saved as ${enabled ? "docs" : "off"}, but CHAMPCITY_GPT_WRITE_MODE currently overrides it.`
          : `Write mode set to ${status.writeMode} for newly started local HTTP server processes.`,
      status
    };
  });
  ipcMain.handle("setWriteMode", (_event, writeMode: "off" | "docs" | "patch" | "elevated") => {
    const status = setLauncherWriteMode(repoRoot, writeMode);
    return {
      ok: true,
      output:
        status.writeModeSource === "env"
          ? `Local write mode saved as ${writeMode}, but CHAMPCITY_GPT_WRITE_MODE currently overrides it.`
          : `Write mode set to ${status.writeMode}. Restart the local HTTP server for a running process to pick it up.`,
      status
    };
  });
  ipcMain.handle("clearPendingPatchProposals", () => {
    const status = clearLauncherPendingPatchProposals(repoRoot);
    return { ok: true, output: "Pending patch proposals cleared.", status };
  });
  ipcMain.handle("getWriteAccessStatus", () => getLauncherWriteAccessStatus(repoRoot));
  ipcMain.handle("saveWriteApprovalToken", (_event, token: string) => {
    const status = saveLauncherWriteApprovalToken(repoRoot, token);
    return { ok: true, output: "Local elevated approval token saved as a hash.", status };
  });
  ipcMain.handle("clearWriteApprovalToken", () => {
    const current = getLauncherWriteAccessStatus(repoRoot);
    if (current.legacyApprovalTokenSource === "env") {
      return {
        ok: false,
        output: "Elevated approval token configured via environment variable. Change or remove CHAMPCITY_GPT_WRITE_APPROVAL_TOKEN outside the app.",
        status: current
      };
    }

    const status = clearLauncherWriteApprovalToken(repoRoot);
    return { ok: true, output: "Local elevated approval token cleared.", status };
  });
  ipcMain.handle("generateWriteApprovalToken", () => ({
    ok: true,
    token: generateLauncherWriteApprovalToken()
  }));
  ipcMain.handle("copyTemporaryWriteToken", (_event, token: string) => {
    clipboard.writeText(token);
    return { ok: true, output: "Temporary elevated approval token copied to clipboard." };
  });
  ipcMain.handle("getHttpAuthStatus", () => getHttpAuthStatus(repoRoot));
  ipcMain.handle("saveHttpAuthToken", (_event, token: string) => {
    saveLocalHttpAuthToken(repoRoot, token);
    const status = getHttpAuthStatus(repoRoot);
    return { ok: true, output: "HTTP auth token saved locally.", status };
  });
  ipcMain.handle("clearHttpAuthToken", () => {
    const current = getHttpAuthStatus(repoRoot);
    if (current.source === "env") {
      return {
        ok: false,
        output: "HTTP auth token configured via environment variable. Change or remove the environment variable outside the app.",
        status: current
      };
    }

    const status = clearLocalHttpAuthToken(repoRoot);
    return { ok: true, output: "Local HTTP auth token cleared.", status };
  });
  ipcMain.handle("generateHttpAuthToken", () => ({
    ok: true,
    token: generateHttpAuthToken()
  }));
  ipcMain.handle("setUnauthenticatedLocalHttpAllowed", (_event, enabled: boolean) => {
    if (enabled) {
      process.env.CHAMPCITY_GPT_ALLOW_UNAUTH_LOCAL_HTTP = "true";
      return { ok: true, output: "Local unauthenticated HTTP test mode enabled. LOCAL TEST ONLY - DO NOT TUNNEL." };
    }

    delete process.env.CHAMPCITY_GPT_ALLOW_UNAUTH_LOCAL_HTTP;
    return { ok: true, output: "Local unauthenticated HTTP test mode disabled." };
  });
  ipcMain.handle("startDiagnosticServer", () => startDiagnosticServer());
  ipcMain.handle("stopDiagnosticServer", () => stopDiagnosticServer());
  ipcMain.handle("getDiagnosticServerStatus", () => getDiagnosticServerStatus());
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 860,
    minWidth: 980,
    minHeight: 720,
    title: "ChampCity GPT MCP Launcher",
    backgroundColor: "#f3f6f8",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const htmlPath = fs.existsSync(path.join(repoRoot, "electron", "renderer", "index.html"))
    ? path.join(repoRoot, "electron", "renderer", "index.html")
    : path.resolve(__dirname, "..", "..", "electron", "renderer", "index.html");

  mainWindow.loadFile(htmlPath);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

registerIpcHandlers();

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
