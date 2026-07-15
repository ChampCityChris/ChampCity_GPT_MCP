import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

import {
  assertVerifiedRepositoryRoot,
  captureRepositoryState,
  completedResult,
  runFixedProcess,
  safeFixedProcessEnv,
  type ArchitectToolResult,
  type FixedProcessResult
} from "./common.js";

const FIXED_STARTUP_DIAGNOSTIC_ARG = "--champcity-fixed-startup-diagnostic";
const EVENT_PREFIX = "CHAMPCITY_DIAGNOSTIC_EVENT ";

interface StartupEvent {
  timestamp: string;
  phase: "main" | "preload" | "renderer" | "shutdown";
  milestone: string;
  detail?: string;
}

interface ElectronStartupData {
  diagnosticType: "development" | "packaged";
  applicationVersion: string;
  electronVersion: string;
  nodeVersion: string;
  status: string;
  startupMilestones: StartupEvent[];
  mainProcessLogs: string[];
  preloadLogs: string[];
  rendererLogs: string[];
  uncaughtExceptions: string[];
  unhandledRejections: string[];
  exitCode: number | null;
  shutdownStatus: "clean" | "forced" | "not_started";
  timeout: boolean;
  packagePath?: string;
  process: FixedProcessResult;
}

function packageMetadata(root: string): { version: string; productName: string; artifactName: string } {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version?: string; name?: string };
  const builder = JSON.parse(fs.readFileSync(path.join(root, "electron-builder.json"), "utf8")) as {
    productName?: string;
    win?: { artifactName?: string };
  };
  const version = packageJson.version ?? "unknown";
  const productName = builder.productName ?? packageJson.name ?? "champcity-gpt";
  const artifactName = (builder.win?.artifactName ?? "${productName}-${version}-${arch}.${ext}")
    .replaceAll("${productName}", productName)
    .replaceAll("${name}", packageJson.name ?? "champcity-gpt")
    .replaceAll("${version}", version)
    .replaceAll("${arch}", "x64")
    .replaceAll("${ext}", "exe");
  return { version, productName, artifactName };
}

function developmentElectronExecutable(root: string): string | undefined {
  const candidates = process.platform === "win32"
    ? [path.join(root, "node_modules", "electron", "dist", "electron.exe")]
    : [path.join(root, "node_modules", ".bin", "electron")];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function parseEvents(output: string): StartupEvent[] {
  const events: StartupEvent[] = [];
  for (const line of output.split(/\r?\n/u)) {
    const marker = line.indexOf(EVENT_PREFIX);
    if (marker < 0) {
      continue;
    }
    try {
      const parsed = JSON.parse(line.slice(marker + EVENT_PREFIX.length)) as StartupEvent;
      if (parsed && typeof parsed.milestone === "string" && typeof parsed.phase === "string") {
        events.push(parsed);
      }
    } catch {
      // Malformed diagnostic lines remain in the bounded main-process log.
    }
  }
  return events;
}

function phaseLogs(events: StartupEvent[], phase: StartupEvent["phase"]): string[] {
  return events.filter((event) => event.phase === phase).map((event) => `${event.timestamp} ${event.milestone}${event.detail ? `: ${event.detail}` : ""}`);
}

async function runElectronStartup(
  root: string,
  diagnosticType: "development" | "packaged",
  executable: string,
  args: string[],
  timeoutMs: number,
  packagePath?: string
): Promise<ArchitectToolResult<ElectronStartupData>> {
  const startedAt = new Date().toISOString();
  const before = await captureRepositoryState(root);
  const metadata = packageMetadata(root);
  const diagnosticRunId = randomBytes(16).toString("hex");
  const diagnosticOutputPath = path.join(root, "logs", `architect-startup-${diagnosticRunId}.jsonl`);
  fs.mkdirSync(path.dirname(diagnosticOutputPath), { recursive: true });
  fs.rmSync(diagnosticOutputPath, { force: true });
  const processResult = await runFixedProcess({
    executable,
    args,
    cwd: root,
    timeoutMs,
    maxStdoutBytes: 300_000,
    maxStderrBytes: 300_000,
    env: safeFixedProcessEnv({
      CHAMPCITY_GPT_REPO_ROOT: root,
      CHAMPCITY_GPT_ALLOWED_ROOTS: root,
      CHAMPCITY_GPT_REQUIRE_GIT_ROOT: "true",
      CHAMPCITY_GPT_WRITE_MODE: "off",
      CHAMPCITY_GPT_STARTUP_DIAGNOSTIC: "1",
      CHAMPCITY_GPT_STARTUP_DIAGNOSTIC_OUTPUT: diagnosticOutputPath,
      ELECTRON_ENABLE_LOGGING: "1",
      NO_COLOR: "1"
    })
  });
  const diagnosticFileOutput = fs.existsSync(diagnosticOutputPath)
    ? fs.readFileSync(diagnosticOutputPath, "utf8")
    : "";
  fs.rmSync(diagnosticOutputPath, { force: true });
  const eventOutput = diagnosticFileOutput || `${processResult.stdout}\n${processResult.stderr}`;
  const events = parseEvents(eventOutput);
  const milestones = new Set(events.map((event) => event.milestone));
  const runtimeVersionsEvent = events.find((event) => event.milestone === "runtime_versions");
  let launchedVersions: { electron?: string; node?: string; app?: string } = {};
  if (runtimeVersionsEvent?.detail) {
    try {
      launchedVersions = JSON.parse(runtimeVersionsEvent.detail) as typeof launchedVersions;
    } catch {
      // The raw bounded event remains available for diagnostics.
    }
  }
  const fatalEvents = events.filter((event) => event.milestone === "uncaught_exception" || event.milestone === "unhandled_rejection");
  const passed =
    processResult.exitCode === 0 &&
    !processResult.timedOut &&
    milestones.has("app_ready") &&
    milestones.has("window_created") &&
    milestones.has("renderer_initialized") &&
    milestones.has("mcp_tool_registration_validated") &&
    milestones.has("will_quit") &&
    fatalEvents.length === 0;
  const after = await captureRepositoryState(root);
  const data: ElectronStartupData = {
    diagnosticType,
    applicationVersion: metadata.version,
    electronVersion: launchedVersions.electron ?? "unknown",
    nodeVersion: launchedVersions.node ?? "unknown",
    status: passed ? "passed" : processResult.timedOut ? "timed_out" : "startup_failure",
    startupMilestones: events,
    mainProcessLogs: [processResult.stdout, processResult.stderr, ...phaseLogs(events, "main")].filter(Boolean),
    preloadLogs: phaseLogs(events, "preload"),
    rendererLogs: phaseLogs(events, "renderer"),
    uncaughtExceptions: events.filter((event) => event.milestone === "uncaught_exception").map((event) => event.detail ?? "unknown"),
    unhandledRejections: events.filter((event) => event.milestone === "unhandled_rejection").map((event) => event.detail ?? "unknown"),
    exitCode: processResult.exitCode,
    shutdownStatus: processResult.timedOut ? "forced" : milestones.has("will_quit") ? "clean" : "not_started",
    timeout: processResult.timedOut,
    packagePath,
    process: processResult
  };
  return completedResult({
    tool: `diagnostics_toolbox.electron_${diagnosticType}_startup`,
    root,
    startedAt,
    status: passed ? "passed" : processResult.timedOut ? "timed_out" : "startup_failure",
    headBefore: before.head,
    headAfter: after.head,
    warnings: [
      "Preload success is not directly observable in the current preload contract; renderer load is reported separately.",
      "Electron startup validates MCP tool registration but does not start a second MCP listener; use mcp_server_startup for listener readiness."
    ],
    errors: passed ? [] : [{ code: processResult.timedOut ? "timeout" : "startup_failure", message: `Fixed ${diagnosticType} Electron startup diagnostic did not pass.` }],
    truncated: processResult.stdoutTruncated || processResult.stderrTruncated,
    data
  });
}

export async function validateDevelopmentElectronStartup(rootInput: string): Promise<ArchitectToolResult<ElectronStartupData>> {
  const root = assertVerifiedRepositoryRoot(rootInput);
  const executable = developmentElectronExecutable(root);
  const startedAt = new Date().toISOString();
  if (!executable || !fs.existsSync(path.join(root, "dist", "electron", "main.js"))) {
    return completedResult({
      tool: "diagnostics_toolbox.electron_development_startup",
      root,
      startedAt,
      status: "not_configured",
      errors: [{ code: "not_configured", message: "Built Electron entrypoint or repository-owned Electron executable is unavailable. Run the fixed build validation first." }]
    });
  }
  return runElectronStartup(root, "development", executable, [root, FIXED_STARTUP_DIAGNOSTIC_ARG], 30_000);
}

export async function validatePackagedElectronStartup(rootInput: string): Promise<ArchitectToolResult<ElectronStartupData>> {
  const root = assertVerifiedRepositoryRoot(rootInput);
  const metadata = packageMetadata(root);
  const packagePath = path.join(root, "release", metadata.artifactName);
  const startedAt = new Date().toISOString();
  if (!fs.existsSync(packagePath)) {
    return completedResult({
      tool: "diagnostics_toolbox.electron_packaged_startup",
      root,
      startedAt,
      status: "not_packaged",
      errors: [{ code: "not_packaged", message: `Expected current-version package is not present: release/${metadata.artifactName}.` }]
    });
  }
  return runElectronStartup(root, "packaged", packagePath, [FIXED_STARTUP_DIAGNOSTIC_ARG], 180_000, packagePath);
}
