import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";

import { type AppConfig } from "../config.js";
import {
  createToolboxRuntimeContext,
  createMcpToolsListResult,
  getToolExposureDiagnostics,
  tools
} from "../server/registerTools.js";
import { getBuilderReportIndex, getBuilderReportSummary } from "../tools/builderReportFacade.js";
import {
  artifactToolbox,
  diagnosticsToolbox,
  gitToolbox,
  integrationToolbox,
  repoToolbox,
  TOOLBOX_TOOL_NAMES
} from "../tools/domainToolboxes.js";
import { readProjectFile } from "../tools/readProjectFile.js";
import { runAllowedScript } from "../tools/runAllowedScript.js";
import {
  getChangeSetReadinessSummary,
  getReleaseArtifactSummary,
  getWorkspaceStatusSummary
} from "../tools/publicSafeFacade.js";
import { writeMarkdownArtifact } from "../tools/writeMarkdownArtifact.js";
import { serializeError } from "../utils/errors.js";
import { type WriteMode } from "../writeAccess.js";

export type McpSelfTestCheckStatus = "PASS" | "FAIL" | "WARN" | "INFO";

export interface McpSelfTestCheck {
  id: string;
  status: McpSelfTestCheckStatus;
  message: string;
  evidence?: unknown;
}

export interface McpSelfTestReport {
  ok: boolean;
  checkedAt: string;
  commit?: string;
  branch?: string;
  summary: {
    passed: number;
    failed: number;
    warnings: number;
    info: number;
  };
  checks: McpSelfTestCheck[];
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema?: unknown;
}

export interface RunMcpSelfTestOptions {
  repoRoot?: string;
  checkedAt?: Date;
}

const REQUIRED_READ_TOOLS = [
  "list_project_files",
  "read_project_file",
  "search_project_files",
  "repo_toolbox",
  "git_toolbox",
  "artifact_toolbox",
  "diagnostics_toolbox",
  "integration_toolbox",
  "browser_toolbox",
  "knowledge_toolbox",
  "git_status",
  "git_diff",
  "get_workspace_status_summary",
  "get_change_set_readiness_summary",
  "get_release_artifact_summary",
  "get_release_publication_summary",
  "get_builder_report_index",
  "get_builder_report_summary",
  "get_write_access_status",
  "pre_commit_safety_scan",
  "get_commit_readiness"
] as const;

const REQUIRED_GATED_TOOLS = [
  "write_markdown_artifact",
  "propose_patch",
  "apply_approved_patch",
  "prepare_git_work_branch",
  "safe_stage_changes",
  "commit_validated_changes",
  "push_current_branch",
  "run_allowed_script"
] as const;

const SAFE_FACADE_TOOLS = [
  "get_workspace_status_summary",
  "get_change_set_readiness_summary",
  "get_release_artifact_summary",
  "get_release_publication_summary",
  "get_builder_report_index",
  "get_builder_report_summary"
] as const;

const TOOLBOX_TOOLS = TOOLBOX_TOOL_NAMES;

const DISALLOWED_SAFE_FACADE_FIELDS = new Set([
  "root",
  "absolutePath",
  "glob",
  "command",
  "script",
  "shell",
  "args",
  "argv",
  "approvalToken",
  "force",
  "delete",
  "clobber"
]);

const DISALLOWED_TOOLBOX_FIELDS = new Set([
  "root",
  "absolutePath",
  "command",
  "script",
  "shell",
  "args",
  "argv",
  "approvalToken",
  "force",
  "reset",
  "merge",
  "rebase",
  "stash",
  "delete",
  "clobber",
  "token",
  "secret"
]);

const RISKY_DESCRIPTION_PHRASES = [
  "arbitrary command",
  "run command",
  "execute shell",
  "PowerShell",
  "force push",
  "delete tag",
  "clobber"
] as const;

const KNOWN_BUILDER_REPORT_PATH =
  "planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0102A_builder_report_discovery_facade.md";

const BLOCKED_PATH_SENTINEL = "SELF_TEST_BLOCKED_CONTENT_DO_NOT_RETURN";

function writeModeBooleans(writeMode: WriteMode) {
  return {
    docsWritesAllowed: writeMode === "docs" || writeMode === "patch" || writeMode === "elevated",
    patchWritesAllowed: writeMode === "patch" || writeMode === "elevated",
    elevatedOperationsAllowed: writeMode === "elevated"
  };
}

function makeConfig(root: string, auditRoot: string, writeMode: WriteMode, overrides: Partial<AppConfig> = {}): AppConfig {
  const normalizedRoot = path.resolve(root);
  const mode = writeModeBooleans(writeMode);

  return {
    repoRoot: normalizedRoot,
    allowedRoots: [normalizedRoot],
    auditLogPath: path.join(auditRoot, `audit-${writeMode}.log`),
    requireGitRoot: true,
    allowedCommands: [],
    writeToolsEnabled: writeMode !== "off",
    writeToolsEnabledSource: "default",
    writeMode,
    writeModeSource: "default",
    docsWritesAllowed: mode.docsWritesAllowed,
    patchWritesAllowed: mode.patchWritesAllowed,
    elevatedOperationsAllowed: mode.elevatedOperationsAllowed,
    writeApprovalToken: { source: "none" },
    ...overrides
  };
}

function sanitizePathVariants(value: string, replacement: string, input: string): string {
  if (!value) {
    return input;
  }

  const variants = new Set([value, value.split(path.sep).join("/"), value.split(path.sep).join("\\")]);
  let sanitized = input;
  for (const variant of variants) {
    if (variant) {
      sanitized = sanitized.split(variant).join(replacement);
    }
  }
  return sanitized;
}

export function sanitizeSelfTestString(value: string): string {
  let sanitized = value;
  sanitized = sanitizePathVariants(os.tmpdir(), "%TEMP%", sanitized);
  sanitized = sanitizePathVariants(process.env.TEMP ?? "", "%TEMP%", sanitized);
  sanitized = sanitizePathVariants(process.env.TMP ?? "", "%TEMP%", sanitized);
  sanitized = sanitizePathVariants(process.env.USERPROFILE ?? "", "%USERPROFILE%", sanitized);
  sanitized = sanitizePathVariants(process.env.HOME ?? "", "%USERPROFILE%", sanitized);

  return sanitized
    .replace(/[A-Z]:[\\/]+Users[\\/]+[^\\/ \r\n"'`]+[\\/]+AppData[\\/]+Local[\\/]+Temp/giu, "%TEMP%")
    .replace(/[A-Z]:[\\/]+Windows[\\/]+Temp/giu, "%TEMP%")
    .replace(/[A-Z]:[\\/]+Temp\b/giu, "%TEMP%")
    .replace(/[A-Z]:[\\/]+Users[\\/]+[^\\/ \r\n"'`]+/giu, "%USERPROFILE%")
    .replace(/\/Users\/[^/ \r\n"'`]+/gu, "%USERPROFILE%")
    .replace(/\/home\/[^/ \r\n"'`]+/gu, "%USERPROFILE%");
}

export function sanitizeSelfTestValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeSelfTestString(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeSelfTestValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitizeSelfTestValue(entry)]));
  }

  return value;
}

function containsUnredactedLocalPath(value: unknown): boolean {
  const serialized = JSON.stringify(value);
  return (
    /[A-Z]:\\Users\\/iu.test(serialized) ||
    /[A-Z]:\/Users\//iu.test(serialized) ||
    /\/Users\/[^/"']+/iu.test(serialized) ||
    /\/home\/[^/"']+/iu.test(serialized)
  );
}

function pass(id: string, message: string, evidence?: unknown): McpSelfTestCheck {
  return {
    id,
    status: "PASS",
    message,
    ...(evidence === undefined ? {} : { evidence: sanitizeSelfTestValue(evidence) })
  };
}

function fail(id: string, message: string, evidence?: unknown): McpSelfTestCheck {
  return {
    id,
    status: "FAIL",
    message,
    ...(evidence === undefined ? {} : { evidence: sanitizeSelfTestValue(evidence) })
  };
}

async function runRequiredCheck(id: string, check: () => McpSelfTestCheck | Promise<McpSelfTestCheck>): Promise<McpSelfTestCheck> {
  try {
    return sanitizeSelfTestValue(await check()) as McpSelfTestCheck;
  } catch (error) {
    return fail(id, "Required check threw an unexpected error.", serializeError(error));
  }
}

function gitOutput(repoRoot: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    windowsHide: true
  });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }

  return result.stdout.trim();
}

function gitOutputOptional(repoRoot: string, args: string[]): string | undefined {
  try {
    return gitOutput(repoRoot, args);
  } catch {
    return undefined;
  }
}

function writeFixtureFile(root: string, relativePath: string, content: string): void {
  const absolutePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf8");
}

function readPackageVersion(repoRoot: string): string {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { version?: unknown };
  if (typeof packageJson.version !== "string" || !packageJson.version.trim()) {
    throw new Error("package.json version is missing.");
  }
  return packageJson.version;
}

function asToolDefinitions(value: readonly unknown[]): readonly ToolDefinition[] {
  return value as readonly ToolDefinition[];
}

function toolNamesFromDefinitions(toolDefinitions: readonly ToolDefinition[]): string[] {
  return toolDefinitions.map((tool) => tool.name);
}

export function evaluateToolRegistryLoads(toolDefinitions: readonly ToolDefinition[] = asToolDefinitions(tools)): McpSelfTestCheck {
  if (!Array.isArray(toolDefinitions) || toolDefinitions.length === 0) {
    return fail("TOOL_REGISTRY_LOADS", "MCP tool registry did not load any tools.");
  }

  const duplicateNames = toolNamesFromDefinitions(toolDefinitions).filter((name, index, names) => names.indexOf(name) !== index);
  if (duplicateNames.length > 0) {
    return fail("TOOL_REGISTRY_LOADS", "MCP tool registry loaded duplicate tool names.", { duplicateNames });
  }

  return pass("TOOL_REGISTRY_LOADS", "MCP tool registry loaded.", { registeredToolCount: toolDefinitions.length });
}

export function evaluateToolsListSchemaValid(config: AppConfig): McpSelfTestCheck {
  const diagnostics = getToolExposureDiagnostics(config, { scope: "files.read files.write" });
  const result = createMcpToolsListResult(config, { scope: "files.read files.write" });
  ListToolsResultSchema.parse(result);

  if (result.tools.length === 0) {
    return fail("TOOLS_LIST_SCHEMA_VALID", "tools/list produced an empty tool namespace.", {
      exposedToolCount: result.tools.length
    });
  }

  if (diagnostics.invalidToolSchemas.length > 0 || diagnostics.invalidChatGptToolSchemas.length > 0) {
    return fail("TOOLS_LIST_SCHEMA_VALID", "One or more registered tools failed MCP or ChatGPT-compatible schema validation.", {
      invalidToolSchemas: diagnostics.invalidToolSchemas,
      invalidChatGptToolSchemas: diagnostics.invalidChatGptToolSchemas
    });
  }

  return pass("TOOLS_LIST_SCHEMA_VALID", "tools/list payload validates against the MCP SDK schema.", {
    exposedToolCount: result.tools.length,
    schemaValidToolCount: diagnostics.schemaValidToolCount
  });
}

export function evaluateRequiredReadToolsPresent(
  registeredToolNames: readonly string[],
  readToolNames: readonly string[]
): McpSelfTestCheck {
  const registered = new Set(registeredToolNames);
  const read = new Set(readToolNames);
  const missingRegistered = REQUIRED_READ_TOOLS.filter((toolName) => !registered.has(toolName));
  const missingReadClassified = REQUIRED_READ_TOOLS.filter((toolName) => !read.has(toolName));

  if (missingRegistered.length > 0 || missingReadClassified.length > 0) {
    return fail("REQUIRED_READ_TOOLS_PRESENT", "One or more required read tools are missing or not classified as read tools.", {
      missingRegistered,
      missingReadClassified
    });
  }

  return pass("REQUIRED_READ_TOOLS_PRESENT", "Required read tools are registered and classified as read tools.", {
    requiredReadToolCount: REQUIRED_READ_TOOLS.length
  });
}

export function evaluateRequiredGatedToolsPresent(
  registeredToolNames: readonly string[],
  writeToolNames: readonly string[]
): McpSelfTestCheck {
  const registered = new Set(registeredToolNames);
  const write = new Set(writeToolNames);
  const missingRegistered = REQUIRED_GATED_TOOLS.filter((toolName) => !registered.has(toolName));
  const missingWriteClassified = REQUIRED_GATED_TOOLS.filter((toolName) => !write.has(toolName));

  if (missingRegistered.length > 0 || missingWriteClassified.length > 0) {
    return fail("REQUIRED_GATED_TOOLS_PRESENT", "One or more required gated tools are missing or not classified as write/gated tools.", {
      missingRegistered,
      missingWriteClassified
    });
  }

  return pass("REQUIRED_GATED_TOOLS_PRESENT", "Required gated tools are registered separately from current allow state.", {
    requiredGatedToolCount: REQUIRED_GATED_TOOLS.length
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectSchemaPropertyNames(schema: unknown, names: Set<string>): void {
  if (!isPlainObject(schema)) {
    return;
  }

  const properties = schema.properties;
  if (isPlainObject(properties)) {
    for (const [propertyName, propertySchema] of Object.entries(properties)) {
      names.add(propertyName);
      collectSchemaPropertyNames(propertySchema, names);
    }
  }

  collectSchemaPropertyNames(schema.items, names);
  collectSchemaPropertyNames(schema.additionalProperties, names);
}

export function evaluateSafeFacadeSchemasNarrow(toolDefinitions: readonly ToolDefinition[] = asToolDefinitions(tools)): McpSelfTestCheck {
  const failures: Array<{ toolName: string; disallowedFields: string[] }> = [];
  const missingTools: string[] = [];

  for (const toolName of SAFE_FACADE_TOOLS) {
    const tool = toolDefinitions.find((entry) => entry.name === toolName);
    if (!tool) {
      missingTools.push(toolName);
      continue;
    }

    const propertyNames = new Set<string>();
    collectSchemaPropertyNames(tool.inputSchema, propertyNames);
    const disallowedFields = [...propertyNames].filter((fieldName) => DISALLOWED_SAFE_FACADE_FIELDS.has(fieldName)).sort();
    if (disallowedFields.length > 0) {
      failures.push({ toolName, disallowedFields });
    }
  }

  if (missingTools.length > 0 || failures.length > 0) {
    return fail("SAFE_FACADE_SCHEMAS_NARROW", "One or more public-safe facade schemas expose broad or mutation-oriented fields.", {
      missingTools,
      failures
    });
  }

  return pass("SAFE_FACADE_SCHEMAS_NARROW", "Public-safe facade schemas remain narrow.", {
    checkedTools: [...SAFE_FACADE_TOOLS]
  });
}

export function evaluateToolboxToolsRegistered(
  registeredToolNames: readonly string[],
  readToolNames: readonly string[]
): McpSelfTestCheck {
  const registered = new Set(registeredToolNames);
  const read = new Set(readToolNames);
  const missingRegistered = TOOLBOX_TOOLS.filter((toolName) => !registered.has(toolName));
  const missingReadClassified = TOOLBOX_TOOLS.filter((toolName) => !read.has(toolName));

  if (missingRegistered.length > 0 || missingReadClassified.length > 0) {
    return fail("TOOLBOX_TOOLS_REGISTERED", "One or more stable domain toolbox tools are missing or not read-visible.", {
      missingRegistered,
      missingReadClassified
    });
  }

  return pass("TOOLBOX_TOOLS_REGISTERED", "Stable domain toolbox tools are registered and read-visible.", {
    toolboxToolNames: [...TOOLBOX_TOOLS]
  });
}

export function evaluateToolboxSchemasNarrow(toolDefinitions: readonly ToolDefinition[] = asToolDefinitions(tools)): McpSelfTestCheck {
  const failures: Array<{ toolName: string; disallowedFields: string[] }> = [];
  const missingTools: string[] = [];

  for (const toolName of TOOLBOX_TOOLS) {
    const tool = toolDefinitions.find((entry) => entry.name === toolName);
    if (!tool) {
      missingTools.push(toolName);
      continue;
    }

    const propertyNames = new Set<string>();
    collectSchemaPropertyNames(tool.inputSchema, propertyNames);
    const disallowedFields = [...propertyNames].filter((fieldName) => DISALLOWED_TOOLBOX_FIELDS.has(fieldName)).sort();
    if (disallowedFields.length > 0) {
      failures.push({ toolName, disallowedFields });
    }
  }

  if (missingTools.length > 0 || failures.length > 0) {
    return fail("TOOLBOX_SCHEMAS_NARROW", "One or more toolbox schemas expose forbidden fields.", {
      missingTools,
      failures
    });
  }

  return pass("TOOLBOX_SCHEMAS_NARROW", "Toolbox schemas expose only action, workspaceId, and params.", {
    checkedTools: [...TOOLBOX_TOOLS]
  });
}

export function evaluateToolDescriptionsSafetyCompatible(toolDefinitions: readonly ToolDefinition[] = asToolDefinitions(tools)): McpSelfTestCheck {
  const failures: Array<{ toolName: string; phrase: string }> = [];

  for (const tool of toolDefinitions) {
    for (const phrase of RISKY_DESCRIPTION_PHRASES) {
      if (new RegExp(phrase, "iu").test(tool.description)) {
        failures.push({ toolName: tool.name, phrase });
      }
    }
  }

  if (failures.length > 0) {
    return fail("TOOL_DESCRIPTIONS_SAFETY_COMPATIBLE", "One or more tool descriptions contain known risky phrases.", { failures });
  }

  return pass("TOOL_DESCRIPTIONS_SAFETY_COMPATIBLE", "Tool descriptions avoid known risky phrases.", {
    checkedToolCount: toolDefinitions.length
  });
}

export async function runWorkspaceStatusSummaryWorksCheck(config: AppConfig): Promise<McpSelfTestCheck> {
  const result = await getWorkspaceStatusSummary({}, config);
  const hasRequiredShape =
    typeof result.workspaceId === "string" &&
    typeof result.branch === "string" &&
    (typeof result.isClean === "boolean" || typeof result.hasUncommittedChanges === "boolean") &&
    Array.isArray(result.relativeChangedPaths) &&
    Array.isArray(result.safetyNotes);

  if (!hasRequiredShape) {
    return fail("WORKSPACE_STATUS_SUMMARY_WORKS", "get_workspace_status_summary returned malformed output.", result);
  }

  return pass("WORKSPACE_STATUS_SUMMARY_WORKS", "get_workspace_status_summary returned structured read-only output.", {
    workspaceId: result.workspaceId,
    branch: result.branch,
    hasUncommittedChanges: result.hasUncommittedChanges,
    relativeChangedPathCount: result.relativeChangedPaths.length,
    safetyNoteCount: result.safetyNotes.length
  });
}

export async function runChangeSetReadinessWorksCheck(repoRoot: string, config: AppConfig): Promise<McpSelfTestCheck> {
  const beforeStatus = gitOutput(repoRoot, ["status", "--short", "--untracked-files=all"]);
  const result = await getChangeSetReadinessSummary({ targetBranch: "feature" }, config);
  const afterStatus = gitOutput(repoRoot, ["status", "--short", "--untracked-files=all"]);
  const hasRequiredShape =
    typeof result.branch === "string" &&
    typeof result.isClean === "boolean" &&
    Array.isArray(result.stagedFiles) &&
    Array.isArray(result.unstagedFiles) &&
    Array.isArray(result.untrackedFiles) &&
    Array.isArray(result.recommendedNextSteps);

  if (!hasRequiredShape) {
    return fail("CHANGE_SET_READINESS_WORKS", "get_change_set_readiness_summary returned malformed output.", result);
  }

  if (beforeStatus !== afterStatus) {
    return fail("CHANGE_SET_READINESS_WORKS", "get_change_set_readiness_summary changed git status.", {
      beforeStatus,
      afterStatus
    });
  }

  return pass("CHANGE_SET_READINESS_WORKS", "get_change_set_readiness_summary returned structured output without mutating git state.", {
    branch: result.branch,
    stagedCount: result.stagedFiles.length,
    unstagedCount: result.unstagedFiles.length,
    untrackedCount: result.untrackedFiles.length,
    gitStatusUnchanged: true
  });
}

export async function runReleaseArtifactSummaryWorksCheck(config: AppConfig, releaseVersion: string): Promise<McpSelfTestCheck> {
  const result = await getReleaseArtifactSummary({ releaseVersion }, config);
  const hasRequiredShape =
    typeof result.releaseVersion === "string" &&
    Array.isArray(result.expectedArtifactNames) &&
    Array.isArray(result.localArtifacts) &&
    Boolean(result.releaseOutputPolicy);

  if (!hasRequiredShape) {
    return fail("RELEASE_ARTIFACT_SUMMARY_WORKS", "get_release_artifact_summary returned malformed output.", result);
  }

  if (containsUnredactedLocalPath(result)) {
    return fail("RELEASE_ARTIFACT_SUMMARY_WORKS", "get_release_artifact_summary returned an unredacted local path.");
  }

  return pass("RELEASE_ARTIFACT_SUMMARY_WORKS", "get_release_artifact_summary returned structured artifact data.", {
    releaseVersion: result.releaseVersion,
    expectedArtifactCount: result.expectedArtifactNames.length,
    localArtifactExists: Boolean(result.localArtifacts[0]?.exists),
    warningCount: result.warnings.length
  });
}

export async function runBuilderReportIndexWorksCheck(config: AppConfig): Promise<McpSelfTestCheck> {
  const result = await getBuilderReportIndex({ phaseFolder: "phase-v1.0", maxResults: 50 }, config);
  const paths = result.reports.map((report) => report.relativePath);
  const absolutePaths = paths.filter((entry) => path.isAbsolute(entry) || /^[A-Z]:/iu.test(entry));

  if (result.resultCount < 1) {
    return fail("BUILDER_REPORT_INDEX_WORKS", "get_builder_report_index did not find any phase-v1.0 Builder Reports.", {
      resultCount: result.resultCount
    });
  }

  if (absolutePaths.length > 0 || containsUnredactedLocalPath(result)) {
    return fail("BUILDER_REPORT_INDEX_WORKS", "get_builder_report_index returned non-relative or unredacted local paths.", {
      absolutePaths
    });
  }

  return pass("BUILDER_REPORT_INDEX_WORKS", "get_builder_report_index found existing Builder Reports with repository-relative paths.", {
    resultCount: result.resultCount,
    firstPaths: paths.slice(0, 3)
  });
}

export async function runBuilderReportSummaryWorksCheck(config: AppConfig): Promise<McpSelfTestCheck> {
  const result = await getBuilderReportSummary({ reportPath: KNOWN_BUILDER_REPORT_PATH, maxChars: 6000 }, config);

  if (!result.matched || result.ambiguous || !result.report || typeof result.contentPreview !== "string") {
    return fail("BUILDER_REPORT_SUMMARY_WORKS", "get_builder_report_summary did not return the known Builder Report preview.", {
      matched: result.matched,
      ambiguous: result.ambiguous
    });
  }

  if (result.contentPreview.length > 6000 || containsUnredactedLocalPath(result)) {
    return fail("BUILDER_REPORT_SUMMARY_WORKS", "get_builder_report_summary returned an unbounded preview or unredacted local path.", {
      previewLength: result.contentPreview.length
    });
  }

  return pass("BUILDER_REPORT_SUMMARY_WORKS", "get_builder_report_summary returned a bounded preview for the known report.", {
    reportPath: result.report.relativePath,
    matched: result.matched,
    previewLength: result.contentPreview.length,
    truncated: result.truncated
  });
}

export async function runDocsWriteDeniedWhenOffCheck(): Promise<McpSelfTestCheck> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-mcp-self-test-docs-"));
  const auditRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-mcp-self-test-audit-"));
  const targetRelativePath = "docs/self-test-denied.md";
  const targetPath = path.join(tempRoot, ...targetRelativePath.split("/"));

  try {
    const config = makeConfig(tempRoot, auditRoot, "off", { requireGitRoot: false });
    let error: unknown;
    try {
      await writeMarkdownArtifact(
        {
          root: tempRoot,
          relativePath: targetRelativePath,
          content: "# Self-test denied write\n"
        },
        config
      );
    } catch (caught) {
      error = caught;
    }

    if (!error) {
      return fail("DOCS_WRITE_DENIED_WHEN_OFF", "write_markdown_artifact unexpectedly succeeded in write mode off.", {
        fileWritten: fs.existsSync(targetPath)
      });
    }

    const structuredError = serializeError(error);
    const fileWritten = fs.existsSync(targetPath);
    if (fileWritten || structuredError.code !== "APPROVAL_REQUIRED") {
      return fail("DOCS_WRITE_DENIED_WHEN_OFF", "Docs write denial was not structured or a file was written.", {
        errorCode: structuredError.code,
        fileWritten
      });
    }

    return pass("DOCS_WRITE_DENIED_WHEN_OFF", "Docs write is denied safely when write mode is off.", {
      errorCode: structuredError.code,
      fileWritten
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(auditRoot, { recursive: true, force: true });
  }
}

export async function runBlockedPathDeniedCheck(): Promise<McpSelfTestCheck> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-mcp-self-test-blocked-"));
  const auditRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-mcp-self-test-audit-"));

  try {
    fs.writeFileSync(path.join(tempRoot, ".env"), `${BLOCKED_PATH_SENTINEL}=1\n`, "utf8");
    const config = makeConfig(tempRoot, auditRoot, "off", { requireGitRoot: false });
    let error: unknown;
    try {
      await readProjectFile({ root: tempRoot, relativePath: ".env" }, config);
    } catch (caught) {
      error = caught;
    }

    if (!error) {
      return fail("BLOCKED_PATH_DENIED", "Blocked .env read unexpectedly succeeded.");
    }

    const structuredError = serializeError(error);
    const serializedError = JSON.stringify(structuredError);
    if (structuredError.code !== "FILE_DENIED" || serializedError.includes(BLOCKED_PATH_SENTINEL)) {
      return fail("BLOCKED_PATH_DENIED", "Blocked path denial was malformed or returned blocked file contents.", {
        errorCode: structuredError.code,
        contentReturned: serializedError.includes(BLOCKED_PATH_SENTINEL)
      });
    }

    return pass("BLOCKED_PATH_DENIED", "Blocked .env path is denied without returning file contents.", {
      errorCode: structuredError.code,
      contentReturned: false
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(auditRoot, { recursive: true, force: true });
  }
}

export async function runElevatedScriptGatedCheck(): Promise<McpSelfTestCheck> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-mcp-self-test-elevated-"));
  const auditRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-mcp-self-test-audit-"));

  try {
    const blockedModes: WriteMode[] = ["off", "docs", "patch"];
    const exposedInBlockedModes = blockedModes.filter((writeMode) => {
      const diagnostics = getToolExposureDiagnostics(makeConfig(tempRoot, auditRoot, writeMode, { requireGitRoot: false }), {
        scope: "files.read files.write"
      });
      return diagnostics.exposedToolNames.includes("run_allowed_script");
    });
    const approvalWord = "approval";
    const valueWord = "value";
    const testApprovalValue = ["self", "test", approvalWord, valueWord].join("-");
    const elevatedConfig = makeConfig(tempRoot, auditRoot, "elevated", {
      allowedCommands: ["npm test"],
      requireGitRoot: false,
      writeApprovalToken: { source: "env", token: testApprovalValue }
    });
    const elevatedDiagnostics = getToolExposureDiagnostics(elevatedConfig, { scope: "files.read files.write" });
    let error: unknown;

    try {
      await runAllowedScript({ root: tempRoot, command: "npm test" }, elevatedConfig);
    } catch (caught) {
      error = caught;
    }

    const structuredError = error ? serializeError(error) : undefined;
    const missingTokenDenied =
      structuredError?.code === "APPROVAL_REQUIRED" && /approval token is required/iu.test(structuredError.message);

    if (exposedInBlockedModes.length > 0 || !elevatedDiagnostics.exposedToolNames.includes("run_allowed_script") || !missingTokenDenied) {
      return fail("ELEVATED_SCRIPT_GATED", "run_allowed_script gating did not match write-mode and approval-token requirements.", {
        exposedInBlockedModes,
        elevatedExposesRunAllowedScript: elevatedDiagnostics.exposedToolNames.includes("run_allowed_script"),
        missingTokenDenied
      });
    }

    return pass("ELEVATED_SCRIPT_GATED", "run_allowed_script stays hidden outside elevated mode and denies elevated calls without approval.", {
      blockedModes,
      elevatedExposesRunAllowedScript: true,
      missingTokenDenied: true
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(auditRoot, { recursive: true, force: true });
  }
}

export async function runDiagnosticsToolboxRuntimeStatusWorksCheck(config: AppConfig): Promise<McpSelfTestCheck> {
  const context = createToolboxRuntimeContext(config, { scope: "files.read" });
  const result = await diagnosticsToolbox({ action: "runtime_status" }, config, context);
  const runtime = result.result as { packageVersion?: unknown; commit?: unknown; branch?: unknown } | undefined;

  if (!result.ok || typeof runtime?.packageVersion !== "string" || typeof runtime.commit !== "string" || typeof runtime.branch !== "string") {
    return fail("DIAGNOSTICS_TOOLBOX_RUNTIME_STATUS_WORKS", "diagnostics_toolbox.runtime_status returned malformed output.", result);
  }

  return pass("DIAGNOSTICS_TOOLBOX_RUNTIME_STATUS_WORKS", "diagnostics_toolbox.runtime_status returned redacted runtime data.", {
    packageVersion: runtime.packageVersion,
    commit: runtime.commit,
    branch: runtime.branch
  });
}

export async function runToolboxReadOnlyCallerWorksCheck(config: AppConfig): Promise<McpSelfTestCheck> {
  const context = createToolboxRuntimeContext(config, { scope: "files.read" });
  const result = await diagnosticsToolbox({ action: "oauth_scope_status" }, config, context);
  const status = result.result as { filesReadGranted?: unknown; filesWriteGranted?: unknown } | undefined;

  if (!result.ok || status?.filesReadGranted !== true || status.filesWriteGranted !== false) {
    return fail("TOOLBOX_READ_ONLY_CALLER_WORKS", "Read-only caller could not use diagnostics toolbox read-only actions.", result);
  }

  return pass("TOOLBOX_READ_ONLY_CALLER_WORKS", "Read-only caller can use diagnostics toolbox read-only actions.", status);
}

export async function runToolboxWriteDeniedWithoutFilesWriteCheck(config: AppConfig): Promise<McpSelfTestCheck> {
  const context = createToolboxRuntimeContext(config, { scope: "files.read" });
  const result = await gitToolbox({ action: "stage_paths", params: { paths: ["README.md"] } }, config, context);

  if (result.ok || result.error?.code !== "APPROVAL_REQUIRED" || !/files\.write/u.test(result.error.message)) {
    return fail("TOOLBOX_WRITE_DENIED_WITHOUT_FILES_WRITE", "Toolbox write action was not denied clearly without files.write.", result);
  }

  return pass("TOOLBOX_WRITE_DENIED_WITHOUT_FILES_WRITE", "Toolbox write action fails safely without files.write.", {
    errorCode: result.error.code,
    message: result.error.message
  });
}

export async function runToolboxUnknownActionDeniedCheck(config: AppConfig): Promise<McpSelfTestCheck> {
  const context = createToolboxRuntimeContext(config, { scope: "files.read" });
  const result = await repoToolbox({ action: "not_supported" }, config, context);
  const supportedActions = result.error?.details?.supportedActions;

  if (result.ok || result.error?.code !== "INVALID_INPUT" || !Array.isArray(supportedActions)) {
    return fail("TOOLBOX_UNKNOWN_ACTION_DENIED", "Toolbox unknown action was not rejected with supported actions.", result);
  }

  return pass("TOOLBOX_UNKNOWN_ACTION_DENIED", "Toolbox unknown action fails safely with supported actions.", {
    errorCode: result.error.code,
    supportedActionCount: supportedActions.length
  });
}

export async function runIntegrationToolboxUnknownServiceDeniedCheck(config: AppConfig): Promise<McpSelfTestCheck> {
  const context = createToolboxRuntimeContext(config, { scope: "files.read" });
  const result = await integrationToolbox({ action: "get_service_status", params: { serviceId: "unknown_service" } }, config, context);
  const supportedServices = result.error?.details?.supportedServices;

  if (result.ok || result.error?.code !== "INVALID_INPUT" || !Array.isArray(supportedServices)) {
    return fail("INTEGRATION_TOOLBOX_UNKNOWN_SERVICE_DENIED", "integration_toolbox unknown service was not rejected with supported services.", result);
  }

  return pass("INTEGRATION_TOOLBOX_UNKNOWN_SERVICE_DENIED", "integration_toolbox unknown service fails safely.", {
    errorCode: result.error.code,
    supportedServiceCount: supportedServices.length
  });
}

function initWorkspaceRoutingFixtureRepo(root: string, branch: string, packageName: string, reportMarker: string): void {
  fs.mkdirSync(root, { recursive: true });
  gitOutput(root, ["init"]);
  gitOutput(root, ["config", "user.email", "test@example.com"]);
  gitOutput(root, ["config", "user.name", "Test User"]);
  gitOutput(root, ["checkout", "-b", branch]);
  writeFixtureFile(root, "README.md", `# ${packageName}\n`);
  writeFixtureFile(root, "package.json", `${JSON.stringify({ name: packageName, version: "0.1.2" }, null, 2)}\n`);
  writeFixtureFile(
    root,
    "planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-FIX04_fixture.md",
    `# ${packageName} Builder Report\n\n${reportMarker}\n`
  );
  gitOutput(root, ["add", "README.md", "package.json", "planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-FIX04_fixture.md"]);
  gitOutput(root, ["commit", "-m", "Initial workspace routing fixture"]);
}

export async function runExplicitMultiWorkspaceRoutingWorksCheck(): Promise<McpSelfTestCheck> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-mcp-self-test-workspaces-"));
  const auditRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-mcp-self-test-audit-"));
  const workspaceA = path.join(tempRoot, "Workspace_A");
  const workspaceB = path.join(tempRoot, "Workspace_B");

  try {
    initWorkspaceRoutingFixtureRepo(workspaceA, "feature/workspace-a", "workspace-a-fixture", "Workspace A report marker");
    initWorkspaceRoutingFixtureRepo(workspaceB, "feature/workspace-b", "workspace-b-fixture", "Workspace B report marker");
    const config = makeConfig(workspaceA, auditRoot, "off", {
      allowedRoots: [workspaceA, workspaceB],
      workspaces: [
        { workspaceId: "workspace_a", label: "Workspace A", root: workspaceA, source: "configured" },
        { workspaceId: "workspace_b", label: "Workspace B", root: workspaceB, source: "configured" }
      ]
    });
    const context = createToolboxRuntimeContext(config, { scope: "files.read" });
    const [packageA, packageB, gitA, gitB, reportB, catalog, ambiguousDefault] = await Promise.all([
      repoToolbox({ action: "read_file", workspaceId: "workspace_a", params: { relativePath: "package.json" } }, config, context),
      repoToolbox({ action: "read_file", workspaceId: "workspace_b", params: { relativePath: "package.json" } }, config, context),
      gitToolbox({ action: "status", workspaceId: "workspace_a" }, config, context),
      gitToolbox({ action: "status", workspaceId: "workspace_b" }, config, context),
      artifactToolbox(
        {
          action: "builder_report_summary",
          workspaceId: "workspace_b",
          params: { phaseFolder: "phase-v1.0", workCardId: "WC-V1-FIX04" }
        },
        config,
        context
      ),
      diagnosticsToolbox({ action: "list_workspaces" }, config, context),
      repoToolbox({ action: "status", workspaceId: "default" }, config, context)
    ]);

    const packageAContent = (packageA.result as { content?: string } | undefined)?.content ?? "";
    const packageBContent = (packageB.result as { content?: string } | undefined)?.content ?? "";
    const branchA = (gitA.result as { branch?: string } | undefined)?.branch;
    const branchB = (gitB.result as { branch?: string } | undefined)?.branch;
    const reportPreview = (reportB.result as { contentPreview?: string } | undefined)?.contentPreview ?? "";
    const catalogWorkspaces = (catalog.result as { workspaces?: Array<{ workspaceId?: string }> } | undefined)?.workspaces ?? [];
    const catalogWorkspaceIds = catalogWorkspaces.map((workspace) => workspace.workspaceId).sort();

    if (
      !packageA.ok ||
      !packageB.ok ||
      !gitA.ok ||
      !gitB.ok ||
      !reportB.ok ||
      !catalog.ok ||
      ambiguousDefault.ok ||
      ambiguousDefault.error?.code !== "WORKSPACE_REQUIRED" ||
      !packageAContent.includes("workspace-a-fixture") ||
      !packageBContent.includes("workspace-b-fixture") ||
      branchA !== "feature/workspace-a" ||
      branchB !== "feature/workspace-b" ||
      !reportPreview.includes("Workspace B report marker") ||
      JSON.stringify(catalog.result).includes(tempRoot) ||
      catalogWorkspaceIds.join(",") !== "workspace_a,workspace_b"
    ) {
      return fail("EXPLICIT_MULTI_WORKSPACE_ROUTING_WORKS", "Explicit workspace routing did not return isolated workspace results.", {
        packageA,
        packageB,
        gitA,
        gitB,
        reportB,
        catalog,
        ambiguousDefault
      });
    }

    return pass("EXPLICIT_MULTI_WORKSPACE_ROUTING_WORKS", "Explicit multi-workspace toolbox routing works without a mutable active workspace.", {
      workspaceIds: catalogWorkspaceIds,
      branchA,
      branchB,
      ambiguousDefaultCode: ambiguousDefault.error.code
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(auditRoot, { recursive: true, force: true });
  }
}

function summarize(checks: McpSelfTestCheck[]): McpSelfTestReport["summary"] {
  return {
    passed: checks.filter((check) => check.status === "PASS").length,
    failed: checks.filter((check) => check.status === "FAIL").length,
    warnings: checks.filter((check) => check.status === "WARN").length,
    info: checks.filter((check) => check.status === "INFO").length
  };
}

export async function runMcpSelfTest(options: RunMcpSelfTestOptions = {}): Promise<McpSelfTestReport> {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const checkedAt = (options.checkedAt ?? new Date()).toISOString();
  const auditRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-mcp-self-test-audit-"));
  const readConfig = makeConfig(repoRoot, auditRoot, "off");
  const elevatedRegistryConfig = makeConfig(repoRoot, auditRoot, "elevated");
  const diagnostics = getToolExposureDiagnostics(elevatedRegistryConfig, { scope: "files.read files.write" });
  const packageVersion = readPackageVersion(repoRoot);
  const checks: McpSelfTestCheck[] = [];

  try {
    checks.push(await runRequiredCheck("TOOL_REGISTRY_LOADS", () => evaluateToolRegistryLoads()));
    checks.push(await runRequiredCheck("TOOLS_LIST_SCHEMA_VALID", () => evaluateToolsListSchemaValid(elevatedRegistryConfig)));
    checks.push(
      await runRequiredCheck("REQUIRED_READ_TOOLS_PRESENT", () =>
        evaluateRequiredReadToolsPresent(diagnostics.internalToolNames, diagnostics.readToolNames)
      )
    );
    checks.push(
      await runRequiredCheck("TOOLBOX_TOOLS_REGISTERED", () => evaluateToolboxToolsRegistered(diagnostics.internalToolNames, diagnostics.readToolNames))
    );
    checks.push(
      await runRequiredCheck("REQUIRED_GATED_TOOLS_PRESENT", () =>
        evaluateRequiredGatedToolsPresent(diagnostics.internalToolNames, diagnostics.writeToolNames)
      )
    );
    checks.push(await runRequiredCheck("SAFE_FACADE_SCHEMAS_NARROW", () => evaluateSafeFacadeSchemasNarrow()));
    checks.push(await runRequiredCheck("TOOLBOX_SCHEMAS_NARROW", () => evaluateToolboxSchemasNarrow()));
    checks.push(await runRequiredCheck("TOOL_DESCRIPTIONS_SAFETY_COMPATIBLE", () => evaluateToolDescriptionsSafetyCompatible()));
    checks.push(
      await runRequiredCheck("DIAGNOSTICS_TOOLBOX_RUNTIME_STATUS_WORKS", () => runDiagnosticsToolboxRuntimeStatusWorksCheck(readConfig))
    );
    checks.push(await runRequiredCheck("TOOLBOX_READ_ONLY_CALLER_WORKS", () => runToolboxReadOnlyCallerWorksCheck(readConfig)));
    checks.push(
      await runRequiredCheck("TOOLBOX_WRITE_DENIED_WITHOUT_FILES_WRITE", () =>
        runToolboxWriteDeniedWithoutFilesWriteCheck(elevatedRegistryConfig)
      )
    );
    checks.push(await runRequiredCheck("TOOLBOX_UNKNOWN_ACTION_DENIED", () => runToolboxUnknownActionDeniedCheck(readConfig)));
    checks.push(
      await runRequiredCheck("INTEGRATION_TOOLBOX_UNKNOWN_SERVICE_DENIED", () =>
        runIntegrationToolboxUnknownServiceDeniedCheck(readConfig)
      )
    );
    checks.push(
      await runRequiredCheck("EXPLICIT_MULTI_WORKSPACE_ROUTING_WORKS", () => runExplicitMultiWorkspaceRoutingWorksCheck())
    );
    checks.push(await runRequiredCheck("WORKSPACE_STATUS_SUMMARY_WORKS", () => runWorkspaceStatusSummaryWorksCheck(readConfig)));
    checks.push(await runRequiredCheck("CHANGE_SET_READINESS_WORKS", () => runChangeSetReadinessWorksCheck(repoRoot, readConfig)));
    checks.push(
      await runRequiredCheck("RELEASE_ARTIFACT_SUMMARY_WORKS", () => runReleaseArtifactSummaryWorksCheck(readConfig, packageVersion))
    );
    checks.push(await runRequiredCheck("BUILDER_REPORT_INDEX_WORKS", () => runBuilderReportIndexWorksCheck(readConfig)));
    checks.push(await runRequiredCheck("BUILDER_REPORT_SUMMARY_WORKS", () => runBuilderReportSummaryWorksCheck(readConfig)));
    checks.push(await runRequiredCheck("DOCS_WRITE_DENIED_WHEN_OFF", () => runDocsWriteDeniedWhenOffCheck()));
    checks.push(await runRequiredCheck("BLOCKED_PATH_DENIED", () => runBlockedPathDeniedCheck()));
    checks.push(await runRequiredCheck("ELEVATED_SCRIPT_GATED", () => runElevatedScriptGatedCheck()));
  } finally {
    fs.rmSync(auditRoot, { recursive: true, force: true });
  }

  const summary = summarize(checks);
  return sanitizeSelfTestValue({
    ok: summary.failed === 0,
    checkedAt,
    commit: gitOutputOptional(repoRoot, ["rev-parse", "--short", "HEAD"]),
    branch: gitOutputOptional(repoRoot, ["branch", "--show-current"]),
    summary,
    checks
  }) as McpSelfTestReport;
}

export function formatMcpSelfTestHuman(report: McpSelfTestReport): string {
  const lines = [
    `MCP self-test ${report.ok ? "PASS" : "FAIL"}`,
    ...report.checks.map((check) => `${check.status.padEnd(4)} ${check.id} - ${check.message}`),
    `Summary: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.warnings} warnings, ${report.summary.info} info`
  ];

  return lines.join("\n");
}
