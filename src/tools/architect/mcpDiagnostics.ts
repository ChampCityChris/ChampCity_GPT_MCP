import fs from "node:fs";
import path from "node:path";

import {
  assertVerifiedRepositoryRoot,
  captureRepositoryState,
  completedResult,
  type ArchitectToolResult
} from "./common.js";

export interface RegisteredToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpToolInventoryEntry {
  toolName: string;
  description: string;
  inputFields: string[];
  requiredInputFields: string[];
  category: string;
  sourceRegistrationModule: "src/server/registerTools.ts";
}

function categoryForTool(name: string): string {
  return name.endsWith("_toolbox") ? name.slice(0, -"_toolbox".length) : "internal";
}

export function buildMcpToolInventory(definitions: readonly RegisteredToolDefinition[]): McpToolInventoryEntry[] {
  return definitions.map((definition) => {
    const properties = definition.inputSchema?.properties;
    const inputFields = properties && typeof properties === "object" && !Array.isArray(properties) ? Object.keys(properties) : [];
    const required = Array.isArray(definition.inputSchema?.required)
      ? definition.inputSchema.required.filter((value): value is string => typeof value === "string")
      : [];
    return {
      toolName: definition.name,
      description: definition.description ?? "",
      inputFields,
      requiredInputFields: required,
      category: categoryForTool(definition.name),
      sourceRegistrationModule: "src/server/registerTools.ts"
    };
  });
}

export function validateMcpToolRegistration(definitions: readonly RegisteredToolDefinition[]) {
  const counts = new Map<string, number>();
  for (const definition of definitions) {
    counts.set(definition.name, (counts.get(definition.name) ?? 0) + 1);
  }
  const duplicateNames = [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name);
  const missingDescriptions = definitions.filter((definition) => !definition.description?.trim()).map((definition) => definition.name);
  const schemaFailures = definitions
    .filter((definition) => definition.inputSchema?.type !== "object" || !definition.inputSchema.properties)
    .map((definition) => ({ toolName: definition.name, reason: "Input schema must be an object with properties." }));
  const genericCommandTools = definitions
    .map((definition) => definition.name)
    .filter((name) => /(?:shell|command_runner|exec|run_command)/iu.test(name));

  return {
    registeredToolCount: definitions.length,
    toolNames: definitions.map((definition) => definition.name),
    duplicateNames,
    schemaFailures,
    missingDescriptions,
    initializationErrors: [] as string[],
    genericCommandTools,
    overallResult:
      duplicateNames.length === 0 && schemaFailures.length === 0 && missingDescriptions.length === 0 && genericCommandTools.length === 0
        ? "passed"
        : "failed"
  };
}

function packageVersion(root: string): string {
  const parsed = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version?: unknown };
  return typeof parsed.version === "string" ? parsed.version : "unknown";
}

export async function runMcpServerStartupDiagnostic(rootInput: string): Promise<ArchitectToolResult<unknown>> {
  const root = assertVerifiedRepositoryRoot(rootInput);
  const startedAt = new Date().toISOString();
  const before = await captureRepositoryState(root);
  const milestones: Array<{ id: string; timestamp: string; detail?: string }> = [];
  const errors: Array<{ code: string; message: string }> = [];
  let handle: Awaited<ReturnType<(typeof import("../../server/serverLifecycle.js"))["startHttpMcpServer"]>> | undefined;
  let healthStatus: number | undefined;
  let shutdownStatus: "not_started" | "clean" | "forced" = "not_started";

  try {
    milestones.push({ id: "diagnostic_started", timestamp: new Date().toISOString() });
    const { startHttpMcpServer } = await import("../../server/serverLifecycle.js");
    milestones.push({ id: "server_module_loaded", timestamp: new Date().toISOString() });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CHAMPCITY_GPT_ALLOWED_ROOTS: root,
      CHAMPCITY_GPT_REQUIRE_GIT_ROOT: "true",
      CHAMPCITY_GPT_WRITE_MODE: "off",
      CHAMPCITY_GPT_ALLOW_UNAUTH_LOCAL_HTTP: "true"
    };
    handle = await startHttpMcpServer({
      repoRoot: root,
      host: "127.0.0.1",
      port: 0,
      version: packageVersion(root),
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: true,
      ensureRootsExist: true,
      env
    });
    milestones.push({ id: "server_ready", timestamp: new Date().toISOString(), detail: handle.mcpEndpoint });
    const response = await fetch(handle.healthEndpoint, { signal: AbortSignal.timeout(5000) });
    healthStatus = response.status;
    if (!response.ok) {
      throw new Error(`Health endpoint returned HTTP ${response.status}.`);
    }
    milestones.push({ id: "health_ready", timestamp: new Date().toISOString(), detail: `HTTP ${response.status}` });
    await handle.stop();
    handle = undefined;
    shutdownStatus = "clean";
    milestones.push({ id: "clean_shutdown", timestamp: new Date().toISOString() });
  } catch (error) {
    errors.push({ code: "startup_failure", message: error instanceof Error ? error.message : String(error) });
    if (handle) {
      try {
        await handle.forceStop();
        shutdownStatus = "forced";
      } catch (stopError) {
        errors.push({ code: "shutdown_failure", message: stopError instanceof Error ? stopError.message : String(stopError) });
      }
    }
  }

  const after = await captureRepositoryState(root);
  const passed = errors.length === 0 && healthStatus !== undefined && healthStatus >= 200 && healthStatus < 300 && shutdownStatus === "clean";
  return completedResult({
    tool: "diagnostics_toolbox.mcp_server_startup",
    root,
    startedAt,
    status: passed ? "passed" : "startup_failure",
    headBefore: before.head,
    headAfter: after.head,
    errors,
    data: {
      applicationVersion: packageVersion(root),
      status: passed ? "passed" : "startup_failure",
      startupMilestones: milestones,
      healthStatus,
      shutdownStatus,
      timeout: false,
      changedFiles: after.changedFiles
    }
  });
}
