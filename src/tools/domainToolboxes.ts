import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { type AppConfig } from "../config.js";
import { getOAuthEndpointPaths, scopeIncludes } from "../oauth.js";
import { readLastMcpDiscoveryTrace } from "../server/discoveryTrace.js";
import { serializeError, AppError } from "../utils/errors.js";
import { runGit } from "../utils/git.js";
import { resolveDefaultWorkspaceRoot } from "../workspaceRoot.js";
import { getBuilderReportIndex, getBuilderReportSummary } from "./builderReportFacade.js";
import {
  createCodexUiHandoffPromptTool,
  getFigmaStatusTool
} from "./figma/index.js";
import { commitValidatedChanges } from "./gitWorkflow/commitValidatedChanges.js";
import { getCommitReadiness } from "./gitWorkflow/getCommitReadiness.js";
import { preCommitSafetyScan } from "./gitWorkflow/preCommitSafetyScan.js";
import { prepareGitWorkBranch } from "./gitWorkflow/prepareGitWorkBranch.js";
import { pushCurrentBranch } from "./gitWorkflow/pushCurrentBranch.js";
import { safeStageChanges } from "./gitWorkflow/safeStageChanges.js";
import {
  getChangeSetReadinessSummary,
  getReleaseArtifactSummary,
  getReleasePublicationSummary,
  getWorkspaceStatusSummary
} from "./publicSafeFacade.js";
import { gitDiff } from "./gitDiff.js";
import { listProjectFiles } from "./listProjectFiles.js";
import { readProjectFile } from "./readProjectFile.js";
import { searchProjectFiles } from "./searchProjectFiles.js";
import { writeMarkdownArtifact } from "./writeMarkdownArtifact.js";
import {
  MAX_GLOB_LENGTH,
  MAX_MARKDOWN_ARTIFACT_CONTENT_LENGTH,
  MAX_QUERY_LENGTH,
  MAX_RELATIVE_PATH_LENGTH
} from "./inputLimits.js";

export const TOOLBOX_TOOL_NAMES = [
  "repo_toolbox",
  "git_toolbox",
  "artifact_toolbox",
  "diagnostics_toolbox",
  "integration_toolbox",
  "browser_toolbox",
  "knowledge_toolbox"
] as const;

export type ToolboxName = (typeof TOOLBOX_TOOL_NAMES)[number];

export interface ToolboxRuntimeContext {
  callerScope: string;
  internalRegisteredToolCount: number;
  schemaValidExposedToolCount: number;
  scopeFilteredToolCount: number;
  registeredToolNames: string[];
  readToolNames: string[];
  writeToolNames: string[];
  exposedToolNames: string[];
  writeToolNamesBlockedByLocalMode: string[];
  scopeFilteredTools: Array<{ name: string; reason: string }>;
  assertWriteToolEnabled: (toolName: string) => void;
}

export interface RuntimeScopeToolDiagnostics {
  runtime: {
    packageVersion: string | "unknown";
    commit: string | "unknown";
    branch: string | "unknown";
    startedAt: string;
  };
  oauth: {
    filesReadGranted: boolean | "unknown";
    filesWriteGranted: boolean | "unknown";
  };
  tools: {
    registeredToolCount: number;
    registeredToolNamesHash: string;
    registeredToolboxNames: string[];
    scopeFilteredToolCount: number;
    exposedToolCount: number;
    writeToolsHiddenByLocalMode: string[];
  };
}

interface ToolboxInput {
  action: string;
  workspaceId: string;
  params: Record<string, unknown>;
}

interface ToolboxResult {
  toolbox: ToolboxName;
  action: string;
  ok: boolean;
  result?: unknown;
  error?: ReturnType<typeof serializeError>;
  warnings?: string[];
  recommendedNextSteps?: string[];
}

const TOOLBOX_RUNTIME_STARTED_AT = new Date().toISOString();
const DEFAULT_WORKSPACE_ID = "default";
const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9_-]+$/u;
const SERVICE_ID_PATTERN = /^[a-z0-9_]+$/u;

const ToolboxInputSchema = z
  .object({
    action: z.string().min(1).max(80),
    workspaceId: z.string().min(1).max(64).regex(WORKSPACE_ID_PATTERN).default(DEFAULT_WORKSPACE_ID),
    params: z.record(z.unknown()).default({})
  })
  .strict();

const EmptyParamsSchema = z.object({}).strict();
const RepoListFilesParamsSchema = z
  .object({
    relativePath: z.string().max(MAX_RELATIVE_PATH_LENGTH).default("."),
    glob: z.string().max(MAX_GLOB_LENGTH).default("*"),
    maxResults: z.number().int().positive().max(200).default(100)
  })
  .strict();
const RepoReadFileParamsSchema = z
  .object({
    relativePath: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH),
    maxBytes: z.number().int().positive().max(500_000).default(200_000)
  })
  .strict();
const RepoSearchFilesParamsSchema = z
  .object({
    query: z.string().min(1).max(MAX_QUERY_LENGTH),
    glob: z.string().max(MAX_GLOB_LENGTH).default("*.md"),
    maxResults: z.number().int().positive().max(100).default(25),
    contextLines: z.number().int().min(0).max(5).default(2)
  })
  .strict();
const RepoWriteMarkdownParamsSchema = z
  .object({
    relativePath: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH),
    content: z.string().max(MAX_MARKDOWN_ARTIFACT_CONTENT_LENGTH),
    overwrite: z.boolean().default(false)
  })
  .strict();

const GitDiffParamsSchema = z
  .object({
    staged: z.boolean().default(false),
    maxBytes: z.number().int().positive().max(500_000).default(200_000)
  })
  .strict();
const GitPrepareWorkBranchParamsSchema = z
  .object({
    branchKind: z.enum(["dev", "feature"]),
    workCardId: z.string().min(1).max(32).optional(),
    slug: z.string().min(1).max(80).optional(),
    baseBranch: z.enum(["main", "dev"]).optional(),
    createIfMissing: z.boolean().default(true)
  })
  .strict();
const GitPreCommitScanParamsSchema = z
  .object({
    mode: z.enum(["staged", "working-tree", "paths"]).default("staged"),
    paths: z.array(z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH)).max(200).optional()
  })
  .strict();
const GitStagePathsParamsSchema = z
  .object({
    paths: z.array(z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH)).min(1).max(200)
  })
  .strict();
const GitCommitStagedParamsSchema = z
  .object({
    message: z.string().min(1).max(10_000),
    targetBranch: z.enum(["dev", "feature"]).default("feature")
  })
  .strict();
const GitPushCurrentBranchParamsSchema = z
  .object({
    setUpstream: z.boolean().default(true)
  })
  .strict();
const GitReadinessParamsSchema = z
  .object({
    targetBranch: z.enum(["dev", "feature", "main"]).default("feature")
  })
  .strict();

const BuilderReportIndexParamsSchema = z
  .object({
    phaseFolder: z.string().min(1).max(128).optional(),
    workCardId: z.string().min(1).max(128).optional(),
    maxResults: z.number().int().positive().max(50).optional()
  })
  .strict();
const BuilderReportSummaryParamsSchema = z
  .object({
    reportPath: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH).optional(),
    phaseFolder: z.string().min(1).max(128).optional(),
    workCardId: z.string().min(1).max(128).optional(),
    maxChars: z.number().int().positive().max(12_000).optional()
  })
  .strict();
const ReleaseArtifactParamsSchema = z
  .object({
    releaseVersion: z.string().min(1).max(64)
  })
  .strict();
const ReleasePublicationParamsSchema = z
  .object({
    tagName: z.string().min(1).max(128),
    includeAssets: z.boolean().default(false)
  })
  .strict();
const CodexHandoffPromptParamsSchema = z
  .object({
    handoffPath: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH),
    targetFile: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH).default("docs/handoffs/CODEX_UI_REDESIGN_HANDOFF.md"),
    targetArea: z.string().max(500).optional(),
    overwrite: z.boolean().default(false)
  })
  .strict();

const IntegrationServiceParamsSchema = z
  .object({
    serviceId: z.string().min(1).max(64).regex(SERVICE_ID_PATTERN)
  })
  .strict();
const IntegrationHandoffParamsSchema = IntegrationServiceParamsSchema.extend({
  targetFile: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH).optional(),
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(5000).optional(),
  overwrite: z.boolean().default(false)
}).strict();

const BrowserEndpointParamsSchema = z
  .object({
    endpointKind: z.enum(["configured_public", "local"]).default("configured_public")
  })
  .strict();

const SUPPORTED_REPO_ACTIONS = ["status", "list_files", "read_file", "search_files", "write_markdown_artifact"] as const;
const SUPPORTED_GIT_ACTIONS = [
  "status",
  "diff",
  "prepare_work_branch",
  "pre_commit_scan",
  "stage_paths",
  "commit_staged",
  "push_current_branch",
  "readiness_summary"
] as const;
const SUPPORTED_ARTIFACT_ACTIONS = [
  "builder_report_index",
  "builder_report_summary",
  "release_artifact_summary",
  "release_publication_summary",
  "local_package_summary",
  "create_codex_handoff_prompt"
] as const;
const SUPPORTED_DIAGNOSTICS_ACTIONS = [
  "runtime_status",
  "write_access_status",
  "tool_exposure_status",
  "oauth_scope_status",
  "chatgpt_discovery_status",
  "public_safety_status"
] as const;
const SUPPORTED_INTEGRATION_ACTIONS = [
  "list_supported_services",
  "get_service_status",
  "list_service_capabilities",
  "validate_service_configuration",
  "prepare_external_handoff"
] as const;
const SUPPORTED_BROWSER_ACTIONS = ["get_browser_capabilities", "validate_public_endpoint"] as const;
const SUPPORTED_KNOWLEDGE_ACTIONS = ["list_supported_sources", "get_project_memory_status", "get_reference_capabilities"] as const;

export const SUPPORTED_INTEGRATION_SERVICES = [
  "figma",
  "figma_make",
  "github",
  "cloudflare",
  "playwright",
  "docker_mcp",
  "sentry",
  "linear",
  "jira",
  "slack",
  "notion",
  "custom"
] as const;

type IntegrationServiceId = (typeof SUPPORTED_INTEGRATION_SERVICES)[number];

const INTEGRATION_SERVICE_CAPABILITIES: Record<IntegrationServiceId, string[]> = {
  figma: ["status", "configuration validation", "legacy Figma tools retained outside toolbox"],
  figma_make: ["status", "configuration validation", "handoff preparation guidance"],
  github: ["status placeholder", "handoff preparation guidance"],
  cloudflare: ["status placeholder", "public endpoint handoff guidance"],
  playwright: ["status placeholder", "browser automation deferred"],
  docker_mcp: ["status placeholder", "governed MCP integration deferred"],
  sentry: ["status placeholder"],
  linear: ["status placeholder"],
  jira: ["status placeholder"],
  slack: ["status placeholder"],
  notion: ["status placeholder"],
  custom: ["status placeholder", "operator-defined integration notes"]
};

function parseToolboxInput(rawInput: unknown): ToolboxInput {
  const input = ToolboxInputSchema.parse(rawInput);
  return {
    action: input.action,
    workspaceId: input.workspaceId,
    params: input.params
  };
}

function repoRootForDefaultWorkspace(workspaceId: string, config: AppConfig): string {
  if (workspaceId !== DEFAULT_WORKSPACE_ID) {
    throw new AppError("INVALID_INPUT", "Only the default workspace is supported by this toolbox action.", {
      availableWorkspaceIds: [DEFAULT_WORKSPACE_ID]
    });
  }

  return resolveDefaultWorkspaceRoot(config);
}

function assertFilesWrite(context: ToolboxRuntimeContext, mappedToolName: string, toolbox: ToolboxName, action: string): void {
  if (!scopeIncludes(context.callerScope, "files.write")) {
    throw new AppError("APPROVAL_REQUIRED", `${toolbox}.${action} requires OAuth scope files.write.`, {
      requiredScope: "files.write"
    });
  }

  context.assertWriteToolEnabled(mappedToolName);
}

function toolNamesHash(names: readonly string[]): string {
  return createHash("sha256").update([...names].sort().join("\n")).digest("hex");
}

async function runtimeGitOutputOptional(repoRoot: string, args: string[]): Promise<string | "unknown"> {
  try {
    const result = await runGit(repoRoot, args, { timeoutMs: 30_000, maxBytes: 50_000 });
    if (result.exitCode !== 0 || result.timedOut) {
      return "unknown";
    }
    return result.stdout.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function readPackageJson(root: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function readOptionalJson(root: string, relativePath: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function packageVersion(root: string): string | "unknown" {
  const value = readPackageJson(root).version;
  return typeof value === "string" && value.trim() ? value : "unknown";
}

export async function buildRuntimeScopeToolDiagnostics(
  config: AppConfig,
  context: ToolboxRuntimeContext
): Promise<RuntimeScopeToolDiagnostics> {
  const [commit, branch] = await Promise.all([
    runtimeGitOutputOptional(config.repoRoot, ["rev-parse", "--short", "HEAD"]),
    runtimeGitOutputOptional(config.repoRoot, ["branch", "--show-current"])
  ]);

  return {
    runtime: {
      packageVersion: packageVersion(config.repoRoot),
      commit,
      branch,
      startedAt: TOOLBOX_RUNTIME_STARTED_AT
    },
    oauth: {
      filesReadGranted: context.callerScope ? scopeIncludes(context.callerScope, "files.read") : "unknown",
      filesWriteGranted: context.callerScope ? scopeIncludes(context.callerScope, "files.write") : "unknown"
    },
    tools: {
      registeredToolCount: context.internalRegisteredToolCount,
      registeredToolNamesHash: toolNamesHash(context.registeredToolNames),
      registeredToolboxNames: [...TOOLBOX_TOOL_NAMES],
      scopeFilteredToolCount: context.scopeFilteredToolCount,
      exposedToolCount: context.schemaValidExposedToolCount,
      writeToolsHiddenByLocalMode: context.writeToolNamesBlockedByLocalMode
    }
  };
}

function supportedActionError(toolbox: ToolboxName, action: string, supportedActions: readonly string[]): ToolboxResult {
  return {
    toolbox,
    action,
    ok: false,
    error: serializeError(
      new AppError("INVALID_INPUT", "Unsupported toolbox action.", {
        supportedActions
      })
    ),
    recommendedNextSteps: [`Use one of: ${supportedActions.join(", ")}.`]
  };
}

function ok(toolbox: ToolboxName, action: string, result: unknown, warnings: string[] = [], recommendedNextSteps: string[] = []): ToolboxResult {
  return {
    toolbox,
    action,
    ok: true,
    result: sanitizeToolboxValue(result),
    warnings,
    recommendedNextSteps
  };
}

function failed(toolbox: ToolboxName, action: string, error: unknown, supportedActions?: readonly string[]): ToolboxResult {
  const structuredError =
    error instanceof z.ZodError
      ? new AppError("INVALID_INPUT", "Toolbox action parameters failed validation.", {
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message
          }))
        })
      : error;

  return {
    toolbox,
    action,
    ok: false,
    error: serializeError(structuredError),
    ...(supportedActions ? { recommendedNextSteps: [`Use one of: ${supportedActions.join(", ")}.`] } : {})
  };
}

async function runToolboxAction(
  toolbox: ToolboxName,
  rawInput: unknown,
  supportedActions: readonly string[],
  handler: (input: ToolboxInput) => Promise<ToolboxResult>
): Promise<ToolboxResult> {
  let input: ToolboxInput;
  try {
    input = parseToolboxInput(rawInput);
  } catch (error) {
    return failed(toolbox, "unknown", error, supportedActions);
  }

  if (!supportedActions.includes(input.action)) {
    return supportedActionError(toolbox, input.action, supportedActions);
  }

  try {
    return await handler(input);
  } catch (error) {
    return failed(toolbox, input.action, error);
  }
}

function withoutRoot<T extends { root?: unknown }>(value: T): Omit<T, "root"> {
  const { root: _root, ...rest } = value;
  return rest;
}

function sanitizeToolboxString(value: string): string {
  return value
    .replace(/[A-Z]:[\\/]+Users[\\/]+[^\\/ \r\n"'`]+[\\/]+AppData[\\/]+Local[\\/]+Temp/giu, "%TEMP%")
    .replace(/[A-Z]:[\\/]+Windows[\\/]+Temp/giu, "%TEMP%")
    .replace(/[A-Z]:[\\/]+Temp\b/giu, "%TEMP%")
    .replace(/[A-Z]:[\\/]+Users[\\/]+[^\\/ \r\n"'`]+/giu, "%USERPROFILE%")
    .replace(/\/Users\/[^/ \r\n"'`]+/gu, "%USERPROFILE%")
    .replace(/\/home\/[^/ \r\n"'`]+/gu, "%USERPROFILE%")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|figd_[A-Za-z0-9_-]{20,})\b/gu, "<REDACTED_SECRET>")
    .replace(
      /\b(?<key>access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|client[_-]?secret|figmaAccessToken|password|secret)\b\s*[:=]\s*["']?[^"'\s\r\n]+["']?/giu,
      "$<key>=<REDACTED_SECRET>"
    );
}

function sanitizeToolboxValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeToolboxString(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeToolboxValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitizeToolboxValue(entry)]));
  }

  return value;
}

export async function repoToolbox(rawInput: unknown, config: AppConfig, context: ToolboxRuntimeContext): Promise<ToolboxResult> {
  return runToolboxAction("repo_toolbox", rawInput, SUPPORTED_REPO_ACTIONS, async (input) => {
    const root = repoRootForDefaultWorkspace(input.workspaceId, config);

    switch (input.action) {
      case "status":
        EmptyParamsSchema.parse(input.params);
        return ok("repo_toolbox", input.action, await getWorkspaceStatusSummary({ workspaceId: input.workspaceId }, config));
      case "list_files": {
        const params = RepoListFilesParamsSchema.parse(input.params);
        return ok("repo_toolbox", input.action, withoutRoot(await listProjectFiles({ root, ...params }, config)));
      }
      case "read_file": {
        const params = RepoReadFileParamsSchema.parse(input.params);
        return ok("repo_toolbox", input.action, await readProjectFile({ root, ...params }, config));
      }
      case "search_files": {
        const params = RepoSearchFilesParamsSchema.parse(input.params);
        return ok("repo_toolbox", input.action, withoutRoot(await searchProjectFiles({ root, ...params }, config)));
      }
      case "write_markdown_artifact": {
        assertFilesWrite(context, "write_markdown_artifact", "repo_toolbox", input.action);
        const params = RepoWriteMarkdownParamsSchema.parse(input.params);
        return ok("repo_toolbox", input.action, await writeMarkdownArtifact({ root, ...params }, config));
      }
      default:
        return supportedActionError("repo_toolbox", input.action, SUPPORTED_REPO_ACTIONS);
    }
  });
}

export async function gitToolbox(rawInput: unknown, config: AppConfig, context: ToolboxRuntimeContext): Promise<ToolboxResult> {
  return runToolboxAction("git_toolbox", rawInput, SUPPORTED_GIT_ACTIONS, async (input) => {
    const root = repoRootForDefaultWorkspace(input.workspaceId, config);

    switch (input.action) {
      case "status":
        EmptyParamsSchema.parse(input.params);
        return ok("git_toolbox", input.action, await getWorkspaceStatusSummary({ workspaceId: input.workspaceId }, config));
      case "diff": {
        const params = GitDiffParamsSchema.parse(input.params);
        return ok("git_toolbox", input.action, await gitDiff({ root, ...params }, config));
      }
      case "prepare_work_branch": {
        assertFilesWrite(context, "prepare_git_work_branch", "git_toolbox", input.action);
        const params = GitPrepareWorkBranchParamsSchema.parse(input.params);
        return ok("git_toolbox", input.action, await prepareGitWorkBranch({ workspaceId: input.workspaceId, ...params }, config));
      }
      case "pre_commit_scan": {
        const params = GitPreCommitScanParamsSchema.parse(input.params);
        return ok("git_toolbox", input.action, await preCommitSafetyScan({ root, ...params }, config));
      }
      case "stage_paths": {
        assertFilesWrite(context, "safe_stage_changes", "git_toolbox", input.action);
        const params = GitStagePathsParamsSchema.parse(input.params);
        return ok("git_toolbox", input.action, await safeStageChanges({ root, mode: "paths", paths: params.paths }, config));
      }
      case "commit_staged": {
        assertFilesWrite(context, "commit_validated_changes", "git_toolbox", input.action);
        const params = GitCommitStagedParamsSchema.parse(input.params);
        return ok("git_toolbox", input.action, await commitValidatedChanges({ root, ...params, allowMainCommit: false }, config));
      }
      case "push_current_branch": {
        assertFilesWrite(context, "push_current_branch", "git_toolbox", input.action);
        const params = GitPushCurrentBranchParamsSchema.parse(input.params);
        return ok("git_toolbox", input.action, await pushCurrentBranch({ root, remote: "origin", ...params, allowMainPush: false }, config));
      }
      case "readiness_summary": {
        const params = GitReadinessParamsSchema.parse(input.params);
        return ok("git_toolbox", input.action, await getCommitReadiness({ root, targetBranch: params.targetBranch }, config));
      }
      default:
        return supportedActionError("git_toolbox", input.action, SUPPORTED_GIT_ACTIONS);
    }
  });
}

function localPackageSummary(root: string) {
  const packageJson = readPackageJson(root);
  const builderConfig = readOptionalJson(root, "electron-builder.json");
  const directories = builderConfig.directories && typeof builderConfig.directories === "object" ? builderConfig.directories as Record<string, unknown> : {};
  const win = builderConfig.win && typeof builderConfig.win === "object" ? builderConfig.win as Record<string, unknown> : {};

  return {
    packageName: typeof packageJson.name === "string" ? packageJson.name : "unknown",
    packageVersion: typeof packageJson.version === "string" ? packageJson.version : "unknown",
    productName: typeof builderConfig.productName === "string" ? builderConfig.productName : undefined,
    releaseOutputDirectory: typeof directories.output === "string" ? directories.output : "release",
    windowsArtifactNameTemplate: typeof win.artifactName === "string" ? win.artifactName : undefined,
    policy: {
      packageValidationRun: false,
      finalReleaseExecutableRequiredForPackagingSuccess: true,
      intermediateNsisArchiveAccepted: false,
      unpackedExecutableAcceptedAsFinal: false
    }
  };
}

export async function artifactToolbox(rawInput: unknown, config: AppConfig, context: ToolboxRuntimeContext): Promise<ToolboxResult> {
  return runToolboxAction("artifact_toolbox", rawInput, SUPPORTED_ARTIFACT_ACTIONS, async (input) => {
    switch (input.action) {
      case "builder_report_index": {
        const params = BuilderReportIndexParamsSchema.parse(input.params);
        return ok("artifact_toolbox", input.action, await getBuilderReportIndex({ workspaceId: input.workspaceId, ...params }, config));
      }
      case "builder_report_summary": {
        const params = BuilderReportSummaryParamsSchema.parse(input.params);
        return ok("artifact_toolbox", input.action, await getBuilderReportSummary({ workspaceId: input.workspaceId, ...params }, config));
      }
      case "release_artifact_summary": {
        const params = ReleaseArtifactParamsSchema.parse(input.params);
        return ok("artifact_toolbox", input.action, await getReleaseArtifactSummary({ workspaceId: input.workspaceId, ...params }, config));
      }
      case "release_publication_summary": {
        const params = ReleasePublicationParamsSchema.parse(input.params);
        return ok("artifact_toolbox", input.action, await getReleasePublicationSummary({ workspaceId: input.workspaceId, ...params }, config));
      }
      case "local_package_summary":
        EmptyParamsSchema.parse(input.params);
        return ok("artifact_toolbox", input.action, localPackageSummary(repoRootForDefaultWorkspace(input.workspaceId, config)));
      case "create_codex_handoff_prompt": {
        assertFilesWrite(context, "create_codex_ui_handoff_prompt", "artifact_toolbox", input.action);
        const root = repoRootForDefaultWorkspace(input.workspaceId, config);
        const params = CodexHandoffPromptParamsSchema.parse(input.params);
        return ok("artifact_toolbox", input.action, await createCodexUiHandoffPromptTool({ root, ...params }, config));
      }
      default:
        return supportedActionError("artifact_toolbox", input.action, SUPPORTED_ARTIFACT_ACTIONS);
    }
  });
}

export async function diagnosticsToolbox(rawInput: unknown, config: AppConfig, context: ToolboxRuntimeContext): Promise<ToolboxResult> {
  return runToolboxAction("diagnostics_toolbox", rawInput, SUPPORTED_DIAGNOSTICS_ACTIONS, async (input) => {
    EmptyParamsSchema.parse(input.params);
    repoRootForDefaultWorkspace(input.workspaceId, config);

    const diagnostics = await buildRuntimeScopeToolDiagnostics(config, context);
    switch (input.action) {
      case "runtime_status":
        return ok("diagnostics_toolbox", input.action, diagnostics.runtime);
      case "write_access_status":
        return ok("diagnostics_toolbox", input.action, {
          writeMode: config.writeMode,
          writeModeSource: config.writeModeSource,
          docsWritesAllowed: config.docsWritesAllowed,
          patchWritesAllowed: config.patchWritesAllowed,
          elevatedOperationsAllowed: config.elevatedOperationsAllowed,
          writeToolsHiddenByLocalMode: context.writeToolNamesBlockedByLocalMode
        });
      case "tool_exposure_status":
        return ok("diagnostics_toolbox", input.action, {
          registeredToolCount: diagnostics.tools.registeredToolCount,
          registeredToolNamesHash: diagnostics.tools.registeredToolNamesHash,
          registeredToolboxNames: diagnostics.tools.registeredToolboxNames,
          exposedToolCount: diagnostics.tools.exposedToolCount,
          scopeFilteredToolCount: diagnostics.tools.scopeFilteredToolCount,
          scopeFilteredTools: context.scopeFilteredTools
        });
      case "oauth_scope_status":
        return ok("diagnostics_toolbox", input.action, diagnostics.oauth);
      case "chatgpt_discovery_status": {
        const trace = readLastMcpDiscoveryTrace(config);
        return ok("diagnostics_toolbox", input.action, trace
          ? {
              latestDiscoveryAt: trace.timestamp,
              latestMethods: trace.jsonRpc.methods,
              latestChatGptDiscoveryToolCount: trace.tools.finalToolCountReturned,
              latestScopeFilteredToolCount: trace.tools.scopeFilteredTools.length,
              responseStatusCode: trace.response.statusCode,
              responseKind: trace.response.kind,
              responseRoute: trace.response.transportRoute,
              error: trace.response.error
            }
          : {
              latestDiscoveryAt: null,
              latestChatGptDiscoveryToolCount: "unknown",
              latestScopeFilteredToolCount: "unknown",
              warnings: ["No last ChatGPT MCP discovery trace is available."]
            });
      }
      case "public_safety_status":
        return ok("diagnostics_toolbox", input.action, await getChangeSetReadinessSummary({ workspaceId: input.workspaceId, targetBranch: "feature" }, config));
      default:
        return supportedActionError("diagnostics_toolbox", input.action, SUPPORTED_DIAGNOSTICS_ACTIONS);
    }
  });
}

function assertSupportedService(serviceId: string): asserts serviceId is IntegrationServiceId {
  if (!SUPPORTED_INTEGRATION_SERVICES.includes(serviceId as IntegrationServiceId)) {
    throw new AppError("INVALID_INPUT", "Unknown integration service.", {
      supportedServices: [...SUPPORTED_INTEGRATION_SERVICES]
    });
  }
}

async function serviceStatus(serviceId: IntegrationServiceId, config: AppConfig) {
  if (serviceId === "figma") {
    return {
      serviceId,
      status: await getFigmaStatusTool({}, config),
      legacyToolsRetained: true,
      governedBrokerOnly: true
    };
  }

  if (serviceId === "figma_make") {
    return {
      serviceId,
      status: "configuration_probe_deferred",
      legacyToolsRetained: true,
      governedBrokerOnly: true,
      arbitraryUpstreamMcpPassthrough: false
    };
  }

  return {
    serviceId,
    configured: "unknown",
    status: "not_implemented",
    externalWritesImplemented: false,
    arbitraryUpstreamMcpPassthrough: false
  };
}

function serviceCapabilities(serviceId: IntegrationServiceId) {
  return {
    serviceId,
    capabilities: INTEGRATION_SERVICE_CAPABILITIES[serviceId],
    safetyModel: {
      allowlistedService: true,
      arbitraryUpstreamToolNameAccepted: false,
      arbitraryServerUrlAccepted: false,
      rawTokensAccepted: false,
      externalWritesImplemented: false
    }
  };
}

function validateServiceConfiguration(serviceId: IntegrationServiceId) {
  return {
    serviceId,
    validatable: serviceId === "figma" || serviceId === "figma_make" ? "legacy_status_available" : "placeholder_only",
    requiresOperatorConfiguration: serviceId !== "custom",
    arbitraryServerUrlAccepted: false,
    rawTokenAccepted: false,
    recommendedNextSteps: [
      "Use service-specific setup outside ChatGPT for credentials.",
      "Do not paste API tokens, cookies, or private service URLs into ChatGPT.",
      "Future Work Cards may add audited service-specific actions under integration_toolbox."
    ]
  };
}

function defaultIntegrationHandoffPath(serviceId: IntegrationServiceId): string {
  return `docs/handoffs/INTEGRATION_${serviceId.toUpperCase()}_HANDOFF.md`;
}

function integrationHandoffMarkdown(serviceId: IntegrationServiceId, title: string | undefined, notes: string | undefined): string {
  return `# ${title?.trim() || `${serviceId} Integration Handoff`}

Service: \`${serviceId}\`

This handoff is a local Markdown artifact for operator review. It does not contain credentials, tokens, cookies, private browser state, arbitrary upstream MCP tool calls, or service API mutations.

## Current Capability

- Supported service ID: \`${serviceId}\`
- Arbitrary upstream MCP passthrough: no
- External writes: not implemented in this Work Card
- Raw tokens accepted from ChatGPT: no

## Notes

${notes?.trim() || "No operator notes provided."}
`;
}

export async function integrationToolbox(rawInput: unknown, config: AppConfig, context: ToolboxRuntimeContext): Promise<ToolboxResult> {
  return runToolboxAction("integration_toolbox", rawInput, SUPPORTED_INTEGRATION_ACTIONS, async (input) => {
    switch (input.action) {
      case "list_supported_services":
        EmptyParamsSchema.parse(input.params);
        return ok("integration_toolbox", input.action, {
          supportedServices: [...SUPPORTED_INTEGRATION_SERVICES],
          externalServicesAreAllowlisted: true,
          arbitraryUpstreamMcpPassthrough: false
        });
      case "get_service_status": {
        const params = IntegrationServiceParamsSchema.parse(input.params);
        assertSupportedService(params.serviceId);
        return ok("integration_toolbox", input.action, await serviceStatus(params.serviceId, config));
      }
      case "list_service_capabilities": {
        const params = IntegrationServiceParamsSchema.parse(input.params);
        assertSupportedService(params.serviceId);
        return ok("integration_toolbox", input.action, serviceCapabilities(params.serviceId));
      }
      case "validate_service_configuration": {
        const params = IntegrationServiceParamsSchema.parse(input.params);
        assertSupportedService(params.serviceId);
        return ok("integration_toolbox", input.action, validateServiceConfiguration(params.serviceId));
      }
      case "prepare_external_handoff": {
        assertFilesWrite(context, "write_markdown_artifact", "integration_toolbox", input.action);
        const root = repoRootForDefaultWorkspace(input.workspaceId, config);
        const params = IntegrationHandoffParamsSchema.parse(input.params);
        assertSupportedService(params.serviceId);
        const relativePath = params.targetFile ?? defaultIntegrationHandoffPath(params.serviceId);
        if (!relativePath.startsWith("docs/handoffs/")) {
          throw new AppError("PATH_DENIED", "Integration handoff targetFile must stay under docs/handoffs/.");
        }
        return ok(
          "integration_toolbox",
          input.action,
          await writeMarkdownArtifact(
            {
              root,
              relativePath,
              content: integrationHandoffMarkdown(params.serviceId, params.title, params.notes),
              overwrite: params.overwrite
            },
            config
          )
        );
      }
      default:
        return supportedActionError("integration_toolbox", input.action, SUPPORTED_INTEGRATION_ACTIONS);
    }
  });
}

export async function browserToolbox(rawInput: unknown, config: AppConfig): Promise<ToolboxResult> {
  return runToolboxAction("browser_toolbox", rawInput, SUPPORTED_BROWSER_ACTIONS, async (input) => {
    repoRootForDefaultWorkspace(input.workspaceId, config);
    switch (input.action) {
      case "get_browser_capabilities":
        EmptyParamsSchema.parse(input.params);
        return ok("browser_toolbox", input.action, {
          browserAutomationImplemented: false,
          screenshotsByDefault: false,
          credentialEntrySupported: false,
          arbitraryBrowsingSupported: false,
          safeCapabilities: ["configured endpoint metadata summary", "operator-run public endpoint verification guidance"]
        });
      case "validate_public_endpoint": {
        const params = BrowserEndpointParamsSchema.parse(input.params);
        const endpoints = getOAuthEndpointPaths();
        return ok("browser_toolbox", input.action, {
          endpointKind: params.endpointKind,
          validationMode: "configuration_only",
          liveNetworkRequestPerformed: false,
          browserAutomationPerformed: false,
          expectedChecks: ["/health status ok", "/mcp rejects unauthenticated public access", "OAuth metadata reachable"],
          endpointPaths: {
            mcpPath: "/mcp",
            healthPath: "/health",
            authorizationServerMetadataPath: new URL(endpoints.authorizationServerMetadata).pathname,
            protectedResourceMetadataPath: new URL(endpoints.protectedResourceMetadata).pathname
          }
        });
      }
      default:
        return supportedActionError("browser_toolbox", input.action, SUPPORTED_BROWSER_ACTIONS);
    }
  });
}

export async function knowledgeToolbox(rawInput: unknown, config: AppConfig): Promise<ToolboxResult> {
  return runToolboxAction("knowledge_toolbox", rawInput, SUPPORTED_KNOWLEDGE_ACTIONS, async (input) => {
    repoRootForDefaultWorkspace(input.workspaceId, config);
    switch (input.action) {
      case "list_supported_sources":
        EmptyParamsSchema.parse(input.params);
        return ok("knowledge_toolbox", input.action, {
          supportedSources: ["project_docs", "builder_reports", "live_connector_evidence_template", "package_metadata"],
          arbitraryWebFetchSupported: false,
          privateDocumentConnectorScrapeSupported: false
        });
      case "get_project_memory_status":
        EmptyParamsSchema.parse(input.params);
        return ok("knowledge_toolbox", input.action, {
          hiddenPersistentMemoryMutation: false,
          memoryWritesImplemented: false,
          projectMemorySources: ["repository documents only through explicit read tools"]
        });
      case "get_reference_capabilities":
        EmptyParamsSchema.parse(input.params);
        return ok("knowledge_toolbox", input.action, {
          referenceCapabilities: ["bounded local project document lookup", "Builder Report index and summary via artifact_toolbox"],
          webFetchImplemented: false,
          externalDocsRetrievalImplemented: false
        });
      default:
        return supportedActionError("knowledge_toolbox", input.action, SUPPORTED_KNOWLEDGE_ACTIONS);
    }
  });
}
