import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell, type WebContents } from "electron";
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
  getLauncherFigmaStatus,
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
  getPublicOAuthRegistrationEndpoint,
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
  clearLauncherFigmaAccessToken,
  clearLauncherWriteApprovalToken,
  generateLauncherWriteApprovalToken,
  readLocalConfig,
  saveLauncherFigmaAccessToken,
  saveLauncherWriteApprovalToken,
  setLauncherHttpWriteToolsEnabled,
  setLauncherWriteMode,
  clearLauncherPendingPatchProposals,
  TUNNEL_READINESS_SCRIPT_RELATIVE,
  parseLauncherFigmaUrl,
  resetSetupState,
  validateLocalConfig,
  writeSetupState,
  writeClientConfigFiles,
  writeLocalConfig
} from "./launcherCore.js";
import { buildMcpServer, installDependencies, type OperationResult } from "./runtimeOperations.js";
import { detectRuntimes } from "./runtimeDetection.js";
import { ensureRuntimeDirectories, migrateLegacyRuntimeConfig, resolveElectronRuntimePaths } from "./runtimePaths.js";
import { loadConfig } from "../src/config.js";
import { createCodexUiHandoffPrompt } from "../src/figma/codexUiPrompt.js";
import { fetchFigmaFile } from "../src/figma/figmaClient.js";
import { requireFigmaAccessToken } from "../src/figma/figmaConfig.js";
import { extractFigmaDesignSummary } from "../src/figma/figmaExtract.js";
import { createFigmaHandoffPackage } from "../src/figma/figmaHandoff.js";
import { validateRuntimePaths, type RuntimePathInfo } from "../src/runtimePaths.js";
import { getMcpServerStatus, startMcpServer, stopMcpServer } from "../src/server/serverLifecycle.js";
import { readLastMcpDiscoveryTrace, type McpDiscoveryTrace } from "../src/server/discoveryTrace.js";
import { getToolExposureDiagnostics } from "../src/server/registerTools.js";
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

interface EndpointProbeResult {
  url: string;
  ok: boolean;
  status: number | null;
  contentType: string;
  body: string;
  error?: string;
}

type LastMcpDiscoveryTrace = McpDiscoveryTrace;

interface DiagnosticStatus {
  state: ServerState;
  pid: number | null;
  detail: string;
  serverRuntime: "in-process" | "cli-child-process";
  startedAt?: string;
  healthEndpoint?: string;
  mcpEndpoint?: string;
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

interface FigmaTestPayload {
  figmaUrlOrFileKey: string;
}

interface LauncherFigmaHandoffPayload {
  root?: string;
  figmaUrl: string;
  targetArea: string;
  frameNames?: string[];
  nodeIds?: string[];
  relativeOutputDir?: string;
  overwrite?: boolean;
}

interface LauncherCodexPromptPayload {
  root?: string;
  handoffPath: string;
  targetFile?: string;
  targetArea?: string;
  overwrite?: boolean;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let lastDoctorResult: DoctorResult | null = null;
let quitAfterServerShutdown = false;
let shutdownPromise: Promise<void> | null = null;
const textContextMenuWebContents = new WeakSet<WebContents>();

function attachTextContextMenu(webContents: WebContents): void {
  if (textContextMenuWebContents.has(webContents)) {
    return;
  }

  textContextMenuWebContents.add(webContents);
  webContents.on("context-menu", (_event, params) => {
    const hasSelection = params.selectionText.length > 0 || params.editFlags.canCopy;
    const hasClipboardText = clipboard.readText().length > 0;

    if (params.isEditable) {
      const menu = Menu.buildFromTemplate([
        {
          role: "cut",
          enabled: params.editFlags.canCut
        },
        {
          role: "copy",
          enabled: params.editFlags.canCopy
        },
        {
          role: "paste",
          enabled: params.editFlags.canPaste && hasClipboardText
        },
        { type: "separator" },
        {
          role: "selectAll",
          enabled: true
        }
      ]);

      menu.popup({ window: BrowserWindow.fromWebContents(webContents) ?? undefined });
      return;
    }

    if (hasSelection && params.editFlags.canCopy) {
      const menu = Menu.buildFromTemplate([
        {
          role: "copy",
          enabled: true
        }
      ]);

      menu.popup({ window: BrowserWindow.fromWebContents(webContents) ?? undefined });
    }
  });
}

function resolveRepoRoot(): string {
  const envRoot = process.env.CHAMPCITY_GPT_REPO_ROOT;
  if (envRoot && fs.existsSync(path.join(envRoot, "package.json"))) {
    return path.resolve(envRoot);
  }

  const exeDir = path.dirname(app.getPath("exe"));
  const candidates = [
    process.cwd(),
    DEFAULT_REPO_ROOT,
    path.resolve(exeDir, "..", ".."),
    path.resolve(exeDir, ".."),
    path.resolve(__dirname, "..", ".."),
    exeDir,
    app.getAppPath()
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
const migratedRuntimeConfigFiles = migrateLegacyRuntimeConfig(path.join(repoRoot, "config"), runtimePaths.configDir);
process.env.CHAMPCITY_GPT_SERVER_ENTRYPOINT = runtimePaths.serverEntrypoint;
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
  try {
    fs.mkdirSync(runtimePaths.logsDir, { recursive: true });
    fs.appendFileSync(path.join(runtimePaths.logsDir, "launcher.log"), `${line}${os.EOL}`, "utf8");
  } catch {
    // Keep UI logging alive even if the log file cannot be written.
  }
  mainWindow?.webContents.send("launcher:log", line);
}

if (migratedRuntimeConfigFiles.length > 0) {
  appendOutput("runtime", `Migrated ${migratedRuntimeConfigFiles.length} legacy local config file(s) to ${runtimePaths.configDir}.`);
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
  const lifecycleStatus = getMcpServerStatus();
  if (lifecycleStatus.state !== "stopped") {
    return {
      state: lifecycleStatus.state === "stopping" ? "running" : lifecycleStatus.state,
      pid: lifecycleStatus.pid,
      detail: lifecycleStatus.detail,
      serverRuntime: "in-process",
      startedAt: lifecycleStatus.startedAt,
      healthEndpoint: lifecycleStatus.healthEndpoint,
      mcpEndpoint: lifecycleStatus.mcpEndpoint,
      statusFile,
      stdoutLog,
      stderrLog
    };
  }

  if (!fs.existsSync(pidFile)) {
    return {
      state: "stopped",
      pid: null,
      detail: "No local HTTP MCP PID file is present.",
      serverRuntime: "in-process",
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
      serverRuntime: "cli-child-process",
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
      serverRuntime: "cli-child-process",
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
        serverRuntime: "cli-child-process",
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
      serverRuntime: "cli-child-process",
      statusFile,
      stdoutLog,
      stderrLog
    };
  }

  return {
    state: "running",
    pid,
    detail: `Legacy child-process HTTP MCP server PID ${pid} is running.`,
    serverRuntime: "cli-child-process",
    statusFile,
    stdoutLog,
    stderrLog
  };
}

function runtimePathStatus(paths: RuntimePathInfo) {
  return {
    mode: paths.mode,
    serverRuntime: paths.serverRuntime,
    appRoot: paths.appRoot,
    configDir: paths.configDir,
    logsDir: paths.logsDir,
    generatedDir: paths.generatedDir,
    resourceRoot: paths.resourceRoot,
    serverEntrypoint: paths.serverEntrypoint,
    nodeExecutable: paths.nodeExecutable
  };
}

function runRuntimePathCheck(): OperationResult & { diagnostics: ReturnType<typeof runtimePathStatus>; errors: string[] } {
  const validation = validateRuntimePaths(runtimePaths, {
    launcherExecutable: process.execPath,
    requireNodeExecutable: runtimePaths.mode === "development",
    requireServerEntrypoint: runtimePaths.mode === "development"
  });
  const diagnostics = runtimePathStatus(validation.diagnostics);
  const lines = [
    `Runtime mode: ${diagnostics.mode}`,
    `Server runtime: ${diagnostics.serverRuntime}`,
    `Config directory: ${diagnostics.configDir}`,
    `Logs directory: ${diagnostics.logsDir}`,
    `Generated directory: ${diagnostics.generatedDir}`,
    `App root: ${diagnostics.appRoot}`,
    `Resources root: ${diagnostics.resourceRoot}`,
    `Developer Node executable: ${diagnostics.nodeExecutable}`,
    `Developer CLI entrypoint: ${diagnostics.serverEntrypoint}`
  ];
  if (!validation.ok) {
    lines.push(...validation.errors.map((error) => `FAIL ${error}`));
  }

  const output = lines.join(os.EOL);
  appendOutput("runtime", output);
  return {
    ok: validation.ok,
    output: validation.ok ? `${output}${os.EOL}Runtime path check passed.` : output,
    diagnostics,
    errors: validation.errors
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

function currentAppConfig() {
  return loadConfig(process.env, repoRoot, { defaultWriteToolsEnabled: false });
}

function readLastDiscoveryTraceSafe(): LastMcpDiscoveryTrace | null {
  try {
    return readLastMcpDiscoveryTrace(currentAppConfig());
  } catch (error) {
    appendOutput("doctor", `Could not read last MCP discovery trace: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function parseFigmaFileKey(value: string): string {
  const trimmed = value.trim();
  if (/^https?:\/\//iu.test(trimmed)) {
    return parseLauncherFigmaUrl(trimmed).fileKey;
  }

  if (!/^[A-Za-z0-9_-]{6,}$/u.test(trimmed)) {
    throw new Error("Enter a Figma file key or a full Figma URL.");
  }

  return trimmed;
}

async function testFigmaConnection(payload: FigmaTestPayload) {
  const fileKey = parseFigmaFileKey(payload.figmaUrlOrFileKey);
  const token = requireFigmaAccessToken(repoRoot);
  const rawFile = await fetchFigmaFile(fileKey, { token });
  const summary = extractFigmaDesignSummary(rawFile, 25);
  return {
    ok: true,
    output: `Fetched Figma file "${summary.fileName}" with ${summary.pages.length} page(s) and ${summary.topLevelFrames.length} top-level frame(s) in the summary.`,
    summary: {
      fileName: summary.fileName,
      pages: summary.pages,
      topLevelFrames: summary.topLevelFrames,
      componentsCount: summary.components.length,
      stylesCount: summary.styles.length
    }
  };
}

async function createLauncherFigmaHandoffPackage(payload: LauncherFigmaHandoffPayload) {
  const token = requireFigmaAccessToken(repoRoot);
  const root = payload.root?.trim() || repoRoot;
  const output = await createFigmaHandoffPackage(
    {
      root,
      figmaUrl: payload.figmaUrl,
      targetArea: payload.targetArea,
      frameNames: payload.frameNames,
      nodeIds: payload.nodeIds,
      relativeOutputDir: payload.relativeOutputDir,
      overwrite: payload.overwrite
    },
    currentAppConfig(),
    { token }
  );
  return { ok: true, output: `Created Figma handoff package at ${output.handoffDir}.`, result: output };
}

async function createLauncherCodexUiHandoffPrompt(payload: LauncherCodexPromptPayload) {
  const root = payload.root?.trim() || repoRoot;
  const output = await createCodexUiHandoffPrompt(
    {
      root,
      handoffPath: payload.handoffPath,
      targetFile: payload.targetFile,
      targetArea: payload.targetArea,
      overwrite: payload.overwrite
    },
    currentAppConfig()
  );
  return { ok: true, output: `Created Codex UI handoff prompt at ${output.targetFile}.`, result: output };
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
  const oauthStatus = getLauncherOAuthStatus(repoRoot);
  const writeAccessStatus = getLauncherWriteAccessStatus(repoRoot);
  const localHealthPassing = await probeLocalHealth();
  const toolDiagnostics = getToolExposureDiagnostics(currentAppConfig());
  const lastDiscoveryTrace = readLastDiscoveryTraceSafe();

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
    name: app.isPackaged ? "Developer Node.js installed" : "Node.js installed",
    status: runtime.node.found ? "PASS" : app.isPackaged ? "WARN" : "FAIL",
    detail: runtime.node.found && runtime.node.path
      ? `${runtime.node.path}${runtime.node.version ? ` (${runtime.node.version})` : ""}`
      : app.isPackaged
        ? "Node.js is only needed to build from source. Packaged runtime uses Electron's bundled runtime."
        : "node is not installed or not on PATH."
  });

  checks.push({
    name: app.isPackaged ? "Developer npm installed" : "npm installed",
    status: runtime.npm.found ? "PASS" : app.isPackaged ? "WARN" : "FAIL",
    detail: runtime.npm.found && runtime.npm.path
      ? `${runtime.npm.path}${runtime.npm.version ? ` (${runtime.npm.version})` : ""}`
      : app.isPackaged
        ? "npm is only needed to build from source. Packaged runtime starts the MCP server in-process."
        : "npm is not installed or not on PATH."
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
    name: app.isPackaged ? "MCP server bundled" : "MCP server built",
    status: app.isPackaged || fs.existsSync(entrypoint) ? "PASS" : "FAIL",
    detail: app.isPackaged ? "HTTP MCP server starts in-process from bundled Electron modules." : entrypoint
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

  checks.push({
    name: "Public MCP base URL",
    status: getPublicOAuthIssuer().includes("mcp.example.com") ? "WARN" : "PASS",
    detail: getPublicOAuthIssuer()
  });

  checks.push({
    name: "Local MCP URL",
    status: "PASS",
    detail: LOCAL_HTTP_MCP_ENDPOINT
  });

  checks.push({
    name: "OAuth client registry path",
    status: "PASS",
    detail: oauthStatus.clientRegistryPath
  });

  checks.push({
    name: "Registered OAuth client count",
    status: "PASS",
    detail: String(oauthStatus.registeredClientsCount)
  });

  checks.push({
    name: "Active OAuth access token count",
    status: "PASS",
    detail: String(oauthStatus.activeTokensCount)
  });

  checks.push({
    name: "Dynamic Client Registration advertised",
    status: oauthStatus.dynamicClientRegistrationEnabled ? "PASS" : "FAIL",
    detail: oauthStatus.dynamicClientRegistrationEnabled ? `registration_endpoint=${oauthStatus.registrationEndpointPath}` : "DCR disabled"
  });

  checks.push({
    name: "OAuth metadata paths served",
    status: "PASS",
    detail: [
      oauthStatus.authorizationServerMetadataPath,
      `${getPublicOAuthIssuer()}/.well-known/oauth-authorization-server/mcp`,
      oauthStatus.protectedResourceMetadataPath,
      `${getPublicOAuthIssuer()}/.well-known/oauth-protected-resource/mcp`,
      oauthStatus.registrationEndpointPath,
      `${getPublicOAuthIssuer()}/oauth/authorize`,
      `${getPublicOAuthIssuer()}/oauth/token`
    ].join(", ")
  });

  checks.push({
    name: "Local health status",
    status: localHealthPassing ? "PASS" : "WARN",
    detail: localHealthPassing ? `${LOCAL_HTTP_HEALTH_ENDPOINT} returned status ok.` : `${LOCAL_HTTP_HEALTH_ENDPOINT} is not responding. Start the local HTTP MCP server before public ChatGPT connection.`
  });

  const publicMetadata = await probeEndpoint(getPublicOAuthAuthorizationServerMetadata());
  checks.push({
    name: "Public OAuth metadata status",
    status: publicMetadata.ok && publicMetadata.body.includes("registration_endpoint") ? "PASS" : "FAIL",
    detail: publicMetadata.status === null
      ? `${publicMetadata.url}: ${publicMetadata.error ?? "request failed"}`
      : `${publicMetadata.url}: HTTP ${publicMetadata.status}; ${publicMetadata.body}`
  });

  const publicProtectedResource = await probeEndpoint(getPublicOAuthProtectedResourceMetadata());
  checks.push({
    name: "Public protected resource metadata status",
    status: publicProtectedResource.ok && publicProtectedResource.body.includes("authorization_servers") ? "PASS" : "FAIL",
    detail: publicProtectedResource.status === null
      ? `${publicProtectedResource.url}: ${publicProtectedResource.error ?? "request failed"}`
      : `${publicProtectedResource.url}: HTTP ${publicProtectedResource.status}; ${publicProtectedResource.body}`
  });

  const publicRegistration = await probeRegistrationEndpoint(getPublicOAuthRegistrationEndpoint());
  checks.push({
    name: "Public Dynamic Client Registration status",
    status: publicRegistration.status === 201 && publicRegistration.body.includes("client_id") ? "PASS" : "FAIL",
    detail: publicRegistration.status === null
      ? `${publicRegistration.url}: ${publicRegistration.error ?? "request failed"}`
      : `${publicRegistration.url}: HTTP ${publicRegistration.status}; ${publicRegistration.body}`
  });

  checks.push({
    name: "Last OAuth error",
    status: oauthStatus.lastAuthorizeError ? "WARN" : "PASS",
    detail: oauthStatus.lastAuthorizeError
      ? `${oauthStatus.lastAuthorizeError.error} at ${oauthStatus.lastAuthorizeError.occurredAt}`
      : "none recorded"
  });

  checks.push({
    name: "ChatGPT reconnect should work",
    status: oauthStatus.adminPasswordConfigured && localHealthPassing && publicMetadata.ok && publicRegistration.status === 201 ? "PASS" : "FAIL",
    detail: oauthStatus.adminPasswordConfigured && localHealthPassing && publicMetadata.ok && publicRegistration.status === 201
      ? "OAuth admin password, local health, public metadata, and public DCR are all available."
      : "Reconnect is not ready until OAuth admin password, local health, public metadata, and public DCR all pass."
  });

  checks.push({
    name: "ChatGPT delete/recreate connector required",
    status: publicRegistration.status === 201 && oauthStatus.registeredClientsCount > 0 ? "WARN" : "PASS",
    detail: publicRegistration.status === 201 && oauthStatus.registeredClientsCount > 0
      ? "Reconnect should work for clients in this registry; delete/recreate once if ChatGPT cached a client_id from an older registry path."
      : "No one-time delete/recreate is indicated by the local registry state."
  });

  checks.push({
    name: "OAuth files.write grant",
    status: writeAccessStatus.oauthFilesWriteGranted ? "PASS" : "WARN",
    detail: writeAccessStatus.oauthFilesWriteGranted
      ? "At least one active OAuth access token includes files.write."
      : "No active OAuth access token with files.write is currently stored; this is separate from local write mode."
  });

  checks.push({
    name: "MCP tools registered internally",
    status: toolDiagnostics.internalToolNames.length > 0 ? "PASS" : "FAIL",
    detail: `${toolDiagnostics.internalRegisteredToolCount} registered: ${toolDiagnostics.internalToolNames.join(", ")}`
  });

  checks.push({
    name: "MCP tool schemas valid",
    status: toolDiagnostics.invalidToolSchemas.length === 0 ? "PASS" : "FAIL",
    detail: toolDiagnostics.invalidToolSchemas.length === 0
      ? `${toolDiagnostics.schemaValidToolCount} schema-valid tool definition(s).`
      : toolDiagnostics.invalidToolSchemas.map((tool) => `${tool.name}: ${tool.reason}`).join("; ")
  });

  checks.push({
    name: "MCP tools filtered by scope/local gate",
    status: "PASS",
    detail: toolDiagnostics.scopeFilteredTools.length === 0
      ? "No schema-valid tools were filtered for scope files.read files.write and current local write mode."
      : `${toolDiagnostics.scopeFilteredToolCount} filtered: ${toolDiagnostics.scopeFilteredTools.map((tool) => `${tool.name}: ${tool.reason}`).join("; ")}`
  });

  checks.push({
    name: "MCP tools exposed through ChatGPT-facing server",
    status: toolDiagnostics.exposedToolNames.length > 0 ? "PASS" : "FAIL",
    detail: `${toolDiagnostics.schemaValidExposedToolCount} exposed for scope ${toolDiagnostics.scope}: ${toolDiagnostics.exposedToolNames.join(", ")}`
  });

  checks.push({
    name: "Last ChatGPT MCP Discovery",
    status: lastDiscoveryTrace ? lastDiscoveryTrace.tools.finalToolCountReturned > 0 ? "PASS" : "WARN" : "WARN",
    detail: lastDiscoveryTrace
      ? [
        `${lastDiscoveryTrace.timestamp} ${lastDiscoveryTrace.request.httpMethod} ${lastDiscoveryTrace.request.path}`,
        `methods=${lastDiscoveryTrace.jsonRpc.methods.join(", ") || "none"}`,
        `auth=${lastDiscoveryTrace.auth.kind} subject=${lastDiscoveryTrace.auth.subject}`,
        `scopes=${lastDiscoveryTrace.auth.scope || "none"}`,
        `tools=${lastDiscoveryTrace.tools.finalToolCountReturned}: ${lastDiscoveryTrace.tools.finalToolNamesReturned.join(", ") || "none"}`,
        `response=HTTP ${lastDiscoveryTrace.response.statusCode} ${lastDiscoveryTrace.response.contentType || "no content-type"} ${lastDiscoveryTrace.response.kind}`,
        `route=${lastDiscoveryTrace.response.transportRoute}`,
        `recentMethods=${lastDiscoveryTrace.recentDiscoverySequence.methodsObserved.join(", ") || "none"}`
      ].join("; ")
      : "No real /mcp discovery trace has been recorded yet. Reconnect ChatGPT or start a new ChatGPT chat after starting the public endpoint."
  });

  checks.push({
    name: "Write-readiness diagnostics",
    status: writeAccessStatus.publicWriteReadiness === "READY" ? "PASS" : "WARN",
    detail: `OAuth files.write granted=${writeAccessStatus.oauthFilesWriteGranted ? "yes" : "no"}; local write mode=${writeAccessStatus.writeMode}; readiness=${writeAccessStatus.publicWriteReadinessReason}; locally blocked write tools=${toolDiagnostics.writeToolNamesBlockedByLocalMode.join(", ") || "none"}`
  });

  const staleRefs = findStaleEntrypointReferences(repoRoot);
  checks.push({
    name: "stale dist/index.js references absent",
    status: staleRefs.length === 0 ? "PASS" : "FAIL",
    detail: staleRefs.length === 0 ? "No stale top-level dist/index.js references found." : staleRefs.join(", ")
  });

  if (app.isPackaged) {
    checks.push({
      name: "Developer CLI entrypoint probe",
      status: "WARN",
      detail: "Skipped in packaged runtime. The normal server path is in-process; CLI probing is for build-from-source diagnostics."
    });
  } else {
    checks.push(await probeEntrypoint(runtimePaths.nodeExecutable));
  }

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
  const figmaStatus = getLauncherFigmaStatus(repoRoot);
  const oauthStatus = getLauncherOAuthStatus(repoRoot);
  const writeAccessStatus = getLauncherWriteAccessStatus(repoRoot);
  const unauthenticatedLocalHttpAllowed = isUnauthenticatedLocalHttpAllowed();
  const writeToolsEnabled = isHttpWriteToolsEnabled(repoRoot);
  const localHealthPassing = await probeLocalHealth();
  const toolDiagnostics = getToolExposureDiagnostics(currentAppConfig());
  const lastDiscoveryTrace = readLastDiscoveryTraceSafe();
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
    buildExists: runtimePaths.mode !== "development" || fs.existsSync(entrypoint),
    diagnosticStatus: getDiagnosticServerStatus(),
    lastDoctorResult,
    generatedPreviews: createClientConfigPreviews(repoRoot),
    http: {
      serverRuntime: runtimePaths.serverRuntime,
      localEndpoint: LOCAL_HTTP_MCP_ENDPOINT,
      localHealthEndpoint: LOCAL_HTTP_HEALTH_ENDPOINT,
      publicEndpoint: getPublicMcpEndpoint(),
      publicHealthEndpoint: getPublicHealthEndpoint(),
      oauthIssuer: getPublicOAuthIssuer(),
      oauthAuthorizationServerMetadata: getPublicOAuthAuthorizationServerMetadata(),
      oauthProtectedResourceMetadata: getPublicOAuthProtectedResourceMetadata(),
      oauthRegistrationEndpoint: getPublicOAuthRegistrationEndpoint(),
      oauthDynamicClientRegistrationEnabled: oauthStatus.dynamicClientRegistrationEnabled,
      oauthClientRegistryPath: oauthStatus.clientRegistryPath,
      oauthTokenRegistryPath: oauthStatus.tokenRegistryPath,
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
      chatGptReconnectShouldWork: oauthStatus.adminPasswordConfigured && localHealthPassing && oauthStatus.dynamicClientRegistrationEnabled,
      chatGptDeleteRecreateConnectorRequired: oauthStatus.lastAuthorizeError?.error === "Invalid client_id.",
      internalToolNames: toolDiagnostics.internalToolNames,
      exposedToolNames: toolDiagnostics.exposedToolNames,
      internalRegisteredToolCount: toolDiagnostics.internalRegisteredToolCount,
      schemaValidToolCount: toolDiagnostics.schemaValidToolCount,
      schemaValidExposedToolCount: toolDiagnostics.schemaValidExposedToolCount,
      scopeFilteredToolCount: toolDiagnostics.scopeFilteredToolCount,
      invalidToolSchemas: toolDiagnostics.invalidToolSchemas,
      scopeFilteredTools: toolDiagnostics.scopeFilteredTools,
      serializedToolsListPayload: toolDiagnostics.serializedToolsListPayload,
      lastMcpDiscoveryTrace: lastDiscoveryTrace,
      writeToolNamesBlockedByLocalMode: toolDiagnostics.writeToolNamesBlockedByLocalMode,
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
    },
    figma: {
      configured: figmaStatus.configured,
      source: figmaStatus.source,
      configPath: figmaStatus.configPath,
      makeHandoffToolAvailable: figmaStatus.makeHandoffToolAvailable,
      figmaMcp: figmaStatus.figmaMcp
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

  const runtimeValidation = validateRuntimePaths(runtimePaths, {
    launcherExecutable: process.execPath,
    requireNodeExecutable: false,
    requireServerEntrypoint: false
  });
  if (!runtimeValidation.ok) {
    const output = runtimeValidation.errors.join(os.EOL);
    appendOutput("http", output);
    return { ok: false, output, status: getDiagnosticServerStatus() };
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

  appendOutput("http", `Runtime mode: ${runtimePaths.mode}`);
  appendOutput("http", `Server runtime: ${runtimePaths.serverRuntime}`);

  const { logsDir, statusFile } = getDiagnosticPaths();
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(runtimePaths.generatedDir, { recursive: true });

  const writeAccessStatus = getLauncherWriteAccessStatus(repoRoot);
  let serverHandle: Awaited<ReturnType<typeof startMcpServer>>;
  try {
    serverHandle = await startMcpServer({
      repoRoot,
      host: LOCAL_HTTP_HOST,
      port: LOCAL_HTTP_PORT,
      version: app.getVersion(),
      configDir: runtimePaths.configDir,
      logDir: runtimePaths.logsDir,
      generatedDir: runtimePaths.generatedDir,
      publicBaseUrl: getPublicOAuthIssuer(),
      writeMode: writeAccessStatus.writeMode,
      authToken: authConfig.token,
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: authTokenConfigured ? false : unauthenticatedLocalHttpAllowed,
      env: process.env,
      log: (message) => appendOutput("http", message)
    });
  } catch (error) {
    const output = `Failed to start local HTTP MCP server: ${error instanceof Error ? error.message : String(error)}`;
    appendOutput("http", output);
    appendOutput("http", error instanceof Error && error.stack ? error.stack : output);
    return { ok: false, output, status: getDiagnosticServerStatus() };
  }

  fs.writeFileSync(
    statusFile,
    `${JSON.stringify(
      {
        pid: process.pid,
        startedAt: serverHandle.startedAt,
        repoRoot,
        runtimeMode: runtimePaths.mode,
        serverRuntime: "in-process",
        appRoot: runtimePaths.appRoot,
        resourceRoot: runtimePaths.resourceRoot,
        configDir: runtimePaths.configDir,
        logsDir: runtimePaths.logsDir,
        generatedDir: runtimePaths.generatedDir,
        mode: "http",
        localEndpoint: serverHandle.mcpEndpoint,
        healthEndpoint: serverHandle.healthEndpoint,
        publicBaseUrl: getPublicOAuthIssuer(),
        authTokenConfigured,
        authTokenSource: authConfig.source,
        oauthAdminPasswordConfigured: oauthStatus.adminPasswordConfigured,
        unauthenticatedLocalHttpAllowed,
        publicTunnelReady: isPublicTunnelReady(repoRoot),
        writeMode: writeAccessStatus.writeMode,
        writeToolsEnabled: isHttpWriteToolsEnabled(repoRoot)
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const status = getDiagnosticServerStatus();
  appendOutput("http", `Started in-process MCP server at ${serverHandle.mcpEndpoint}`);
  return { ok: true, output: `Started in-process local HTTP MCP server at ${serverHandle.mcpEndpoint}.`, status };
}

async function stopDiagnosticServer(): Promise<OperationResult & { status: DiagnosticStatus }> {
  const lifecycleStatus = getMcpServerStatus();
  if (lifecycleStatus.state !== "stopped") {
    try {
      const stoppedEndpoint = lifecycleStatus.mcpEndpoint ?? LOCAL_HTTP_MCP_ENDPOINT;
      await stopMcpServer({ log: (message) => appendOutput("http", message) });
      clearDiagnosticStatusFiles();
      appendOutput("http", `Stopped in-process MCP server at ${stoppedEndpoint}`);
      return { ok: true, output: `Stopped in-process local HTTP MCP server at ${stoppedEndpoint}.`, status: getDiagnosticServerStatus() };
    } catch (error) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : String(error),
        status: getDiagnosticServerStatus()
      };
    }
  }

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

async function probeEndpoint(url: string, init: RequestInit = {}): Promise<EndpointProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    });
    const body = (await response.text()).replace(/\s+/gu, " ").slice(0, 500);
    return {
      url,
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      body
    };
  } catch (error) {
    return {
      url,
      ok: false,
      status: null,
      contentType: "",
      body: "",
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeRegistrationEndpoint(url: string): Promise<EndpointProbeResult> {
  return probeEndpoint(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      redirect_uris: ["https://chatgpt.com/connector/oauth/champcity-doctor"],
      client_name: "ChampCity Doctor DCR Probe",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "files.read"
    })
  });
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
  ipcMain.handle("runRuntimePathCheck", () => runRuntimePathCheck());
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
  ipcMain.handle("getFigmaStatus", () => getLauncherFigmaStatus(repoRoot));
  ipcMain.handle("saveFigmaAccessToken", (_event, token: string) => {
    const status = saveLauncherFigmaAccessToken(repoRoot, token);
    return { ok: true, output: "Figma access token saved locally.", status };
  });
  ipcMain.handle("clearFigmaAccessToken", () => {
    const current = getLauncherFigmaStatus(repoRoot);
    if (current.source === "env") {
      return {
        ok: false,
        output: "Figma access token is configured via CHAMPCITY_GPT_FIGMA_ACCESS_TOKEN. Change or remove the environment variable outside the app.",
        status: current
      };
    }

    const status = clearLauncherFigmaAccessToken(repoRoot);
    return { ok: true, output: "Local Figma access token cleared.", status };
  });
  ipcMain.handle("parseFigmaUrl", (_event, url: string) => parseLauncherFigmaUrl(url));
  ipcMain.handle("testFigmaConnection", (_event, payload: FigmaTestPayload) => testFigmaConnection(payload));
  ipcMain.handle("createFigmaHandoffPackage", (_event, payload: LauncherFigmaHandoffPayload) => createLauncherFigmaHandoffPackage(payload));
  ipcMain.handle("createCodexUiHandoffPrompt", (_event, payload: LauncherCodexPromptPayload) => createLauncherCodexUiHandoffPrompt(payload));
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

async function stopOwnedServerForShutdown(reason: string): Promise<void> {
  if (!shutdownPromise) {
    appendOutput("http", `Stopping owned MCP server during ${reason}.`);
    shutdownPromise = stopMcpServer({
      log: (message) => appendOutput("http", message)
    })
      .then(() => {
        clearDiagnosticStatusFiles();
      })
      .catch((error) => {
        appendOutput("http", `Failed to stop owned MCP server during ${reason}: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        shutdownPromise = null;
      });
  }

  await shutdownPromise;
}

function shouldDeferQuitForServerShutdown(): boolean {
  return !quitAfterServerShutdown && getMcpServerStatus().state !== "stopped";
}

function deferQuitUntilServerStopped(event: Electron.Event, reason: string): void {
  if (!shouldDeferQuitForServerShutdown()) {
    return;
  }

  event.preventDefault();
  void stopOwnedServerForShutdown(reason).finally(() => {
    quitAfterServerShutdown = true;
    app.quit();
  });
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

  attachTextContextMenu(mainWindow.webContents);

  const htmlPath = fs.existsSync(path.join(repoRoot, "electron", "renderer", "index.html"))
    ? path.join(repoRoot, "electron", "renderer", "index.html")
    : path.resolve(__dirname, "..", "..", "electron", "renderer", "index.html");

  mainWindow.loadFile(htmlPath);
  mainWindow.on("close", (event) => {
    if (process.platform !== "darwin" && shouldDeferQuitForServerShutdown()) {
      event.preventDefault();
      void stopOwnedServerForShutdown("main window close").finally(() => {
        quitAfterServerShutdown = true;
        mainWindow?.close();
      });
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

registerIpcHandlers();

app.on("web-contents-created", (_event, webContents) => {
  attachTextContextMenu(webContents);
});

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

app.on("before-quit", (event) => {
  deferQuitUntilServerStopped(event, "app before-quit");
});

app.on("will-quit", (event) => {
  deferQuitUntilServerStopped(event, "app will-quit");
});

process.on("SIGINT", () => {
  void stopOwnedServerForShutdown("SIGINT").finally(() => {
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  void stopOwnedServerForShutdown("SIGTERM").finally(() => {
    process.exit(0);
  });
});
