import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { type AppConfig } from "../config.js";
import { getOAuthEndpointPaths, scopeIncludes } from "../oauth.js";
import { readLastMcpDiscoveryTrace } from "../server/discoveryTrace.js";
import {
  ACKNOWLEDGEMENT_CONTEXTS,
  acknowledgeToolResult,
  resultDeliveryStatus
} from "../server/resultDeliveryTrace.js";
import { readRecentToolCalls, recordToolCallTrace, updateCurrentToolCallTraceContext } from "../server/toolCallTrace.js";
import { serializeError, AppError } from "../utils/errors.js";
import { runGit } from "../utils/git.js";
import { assertWorkspaceAuthorityAllowed, resolveWorkspaceAuthority } from "../workspaceAuthority.js";
import {
  artifactPairStatus,
  currentActionContext,
  exportPlanningCorpus,
  inspectArtifactText,
  latestArtifact,
  listArtifacts,
  readArtifactById,
  readArtifactTextChunk,
  reviewQueue,
  takeBoundedArtifactTextPayload
} from "./artifactCatalog.js";
import { getBuilderReportIndex, getBuilderReportSummary } from "./builderReportFacade.js";
import { applyApprovedPatch } from "./applyApprovedPatch.js";
import { commitValidatedChanges } from "./gitWorkflow/commitValidatedChanges.js";
import { getCommitReadiness } from "./gitWorkflow/getCommitReadiness.js";
import { integrateToDev } from "./gitWorkflow/integrateToDev.js";
import { preCommitSafetyScan } from "./gitWorkflow/preCommitSafetyScan.js";
import { prepareGitWorkBranch } from "./gitWorkflow/prepareGitWorkBranch.js";
import { pushCurrentBranch } from "./gitWorkflow/pushCurrentBranch.js";
import { safeStageChanges } from "./gitWorkflow/safeStageChanges.js";
import {
  getReleaseArtifactSummary,
  getReleasePublicationSummary,
  getWorkspaceStatusSummary
} from "./publicSafeFacade.js";
import { getGeneralWorkspaceStatus, getWorkspaceSafetyStatus } from "./workspaceStatusFacade.js";
import { gitDiff } from "./gitDiff.js";
import { listProjectFiles } from "./listProjectFiles.js";
import { proposePatch } from "./proposePatch.js";
import { readProjectFile } from "./readProjectFile.js";
import { MAX_IMAGE_ARTIFACT_BYTES, readImageArtifact } from "./readImageArtifact.js";
import { searchProjectFiles } from "./searchProjectFiles.js";
import {
  TEXT_PROJECTION_DEFAULT_CHUNK_BYTES,
  TEXT_PROJECTION_DEFAULT_MAX_HEADINGS,
  TEXT_PROJECTION_DEFAULT_MAX_LINES,
  TEXT_PROJECTION_HARD_CONTENT_ITEM_BYTES,
  TEXT_PROJECTION_HARD_MAX_HEADINGS,
  TEXT_PROJECTION_HARD_MAX_LINES,
  TEXT_PROJECTION_INLINE_THRESHOLD_BYTES,
  boundedTextContentItems,
  boundedTextStructuredContent,
  inspectTextProjectionSource,
  loadTextProjectionSource,
  readMarkdownSection,
  readTextChunk,
  readTextLines
} from "./textProjection.js";
import { writeJsonArtifact } from "./writeJsonArtifact.js";
import { writeMarkdownArtifact } from "./writeMarkdownArtifact.js";
import { CreateMarkdownArtifactParamsSchema, createMarkdownArtifact } from "./createMarkdownArtifact.js";
import { completedResult, type ArchitectToolResult } from "./architect/common.js";
import { validateDevelopmentElectronStartup, validatePackagedElectronStartup } from "./architect/electronDiagnostics.js";
import { runGitInspection, type GitInspectionInput } from "./architect/gitInspection.js";
import {
  buildMcpToolInventory,
  runMcpServerStartupDiagnostic,
  validateMcpToolRegistration,
  type RegisteredToolDefinition
} from "./architect/mcpDiagnostics.js";
import { runProjectValidation, type ProjectValidationOperation } from "./architect/projectValidation.js";
import { runSourceAnalysis, type SourceAnalysisInput } from "./architect/sourceAnalysis.js";
import {
  MAX_GLOB_LENGTH,
  MAX_JSON_ARTIFACT_CONTENT_LENGTH,
  MAX_MARKDOWN_ARTIFACT_CONTENT_LENGTH,
  MAX_PATCH_LENGTH,
  MAX_PROPOSE_PATCH_TEXT_LENGTH,
  MAX_QUERY_LENGTH,
  MAX_RELATIVE_PATH_LENGTH
} from "./inputLimits.js";
import {
  DEFAULT_WORKSPACE_ID,
  WORKSPACE_ID_PATTERN,
  type WorkspaceDiagnostics,
  getWorkspaceDiagnostics,
  listWorkspaceCatalog,
  resolveWorkspaceRoot
} from "../workspaces.js";
import {
  getToolboxActionPolicy,
  SUPPORTED_ARTIFACT_ACTIONS,
  SUPPORTED_BROWSER_ACTIONS,
  SUPPORTED_DIAGNOSTICS_ACTIONS,
  SUPPORTED_GIT_ACTIONS,
  SUPPORTED_INTEGRATION_ACTIONS,
  SUPPORTED_KNOWLEDGE_ACTIONS,
  SUPPORTED_REPO_ACTIONS,
  SUPPORTED_TOOLBOX_ACTIONS,
  TOOLBOX_TOOL_NAMES,
  UNSUPPORTED_ACTION_ALTERNATIVES,
  getToolboxActionContract,
  listToolboxActionContracts,
  type ToolboxName
} from "./toolboxActionPolicy.js";

export { TOOLBOX_TOOL_NAMES, type ToolboxName } from "./toolboxActionPolicy.js";

export interface ToolboxRuntimeContext {
  callerScope: string;
  internalRegisteredToolCount: number;
  schemaValidExposedToolCount: number;
  scopeFilteredToolCount: number;
  registeredToolNames: string[];
  registeredToolDefinitions: RegisteredToolDefinition[];
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
    runtimePackageVersion: string | "unknown";
    selectedWorkspacePackageVersion: string | "unknown";
    packageVersionMatch: boolean | "unknown" | "not_applicable";
    commit: string | "unknown";
    runtimeSourceCommit: string | "unknown";
    selectedWorkspaceHead: string | "unknown";
    branch: string | "unknown";
    startedAt: string;
    runtimeDriftDetected: boolean;
    warnings: string[];
    workspaceRouting: WorkspaceDiagnostics;
    serviceRuntime: {
      packageVersion: string | "unknown";
      sourceCommit: string | "unknown";
      mode: "packaged" | "development";
      provenance: string;
    };
    targetWorkspace: {
      workspaceId: string | "unknown";
      packageVersion: string | "unknown";
      head: string | "unknown";
      alignment: "checked" | "not_applicable" | "unknown";
    };
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

export interface ToolboxResult {
  toolbox: ToolboxName;
  action: string;
  ok: boolean;
  result?: unknown;
  error?: ReturnType<typeof serializeError>;
  warnings?: string[];
  recommendedNextSteps?: string[];
  mcpContent?: CallToolResult["content"];
  structuredContent?: Record<string, unknown>;
}

const TOOLBOX_RUNTIME_STARTED_AT = new Date().toISOString();
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
const RepoInspectTextFileParamsSchema = z
  .object({
    relativePath: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH),
    includeHeadingIndex: z.boolean().optional(),
    maximumHeadings: z.number().int().positive().max(TEXT_PROJECTION_HARD_MAX_HEADINGS).default(TEXT_PROJECTION_DEFAULT_MAX_HEADINGS)
  })
  .strict();
const RepoReadTextChunkParamsSchema = z
  .object({
    relativePath: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH).optional(),
    cursor: z.string().min(1).max(4096).optional(),
    maximumBytes: z.number().int().positive().max(TEXT_PROJECTION_HARD_CONTENT_ITEM_BYTES).default(TEXT_PROJECTION_DEFAULT_CHUNK_BYTES),
    maximumLines: z.number().int().positive().max(TEXT_PROJECTION_HARD_MAX_LINES).default(TEXT_PROJECTION_DEFAULT_MAX_LINES),
    expectedSourceSha256: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
    priorResultAttemptId: z.string().min(1).max(128).optional(),
    maxBytes: z.number().int().positive().max(500_000).default(200_000)
  })
  .strict()
  .refine((value) => Boolean(value.relativePath || value.cursor), "relativePath or cursor is required.");
const RepoReadTextLinesParamsSchema = z
  .object({
    relativePath: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH).optional(),
    cursor: z.string().min(1).max(4096).optional(),
    startLine: z.number().int().positive().optional(),
    maximumLines: z.number().int().positive().max(TEXT_PROJECTION_HARD_MAX_LINES).optional(),
    maximumBytes: z.number().int().positive().max(TEXT_PROJECTION_HARD_CONTENT_ITEM_BYTES).default(TEXT_PROJECTION_DEFAULT_CHUNK_BYTES),
    expectedSourceSha256: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
    priorResultAttemptId: z.string().min(1).max(128).optional(),
    maxBytes: z.number().int().positive().max(500_000).default(200_000)
  })
  .strict()
  .refine((value) => Boolean(value.cursor || value.relativePath && value.startLine && value.maximumLines), "cursor or relativePath/startLine/maximumLines is required.");
const RepoReadMarkdownSectionParamsSchema = z
  .object({
    relativePath: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH).optional(),
    sectionId: z.string().min(1).max(160).optional(),
    cursor: z.string().min(1).max(4096).optional(),
    maximumBytes: z.number().int().positive().max(TEXT_PROJECTION_HARD_CONTENT_ITEM_BYTES).default(TEXT_PROJECTION_DEFAULT_CHUNK_BYTES),
    maximumLines: z.number().int().positive().max(TEXT_PROJECTION_HARD_MAX_LINES).default(TEXT_PROJECTION_DEFAULT_MAX_LINES),
    expectedSourceSha256: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
    priorResultAttemptId: z.string().min(1).max(128).optional(),
    maxBytes: z.number().int().positive().max(500_000).default(200_000)
  })
  .strict()
  .refine((value) => Boolean(value.sectionId || value.cursor), "sectionId or cursor is required.");
const RepoSearchFilesParamsSchema = z
  .object({
    query: z.string().min(1).max(MAX_QUERY_LENGTH),
    scopePath: z.string().max(MAX_RELATIVE_PATH_LENGTH).default("."),
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
const RepoWriteJsonParamsSchema = z
  .object({
    relativePath: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH),
    content: z.string().max(MAX_JSON_ARTIFACT_CONTENT_LENGTH),
    overwrite: z.boolean().default(false)
  })
  .strict();
const RepoPatchChangeParamsSchema = z
  .object({
    relativePath: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH),
    originalText: z.string().max(MAX_PROPOSE_PATCH_TEXT_LENGTH),
    replacementText: z.string().max(MAX_PROPOSE_PATCH_TEXT_LENGTH)
  })
  .strict();
const RepoProposePatchParamsSchema = z
  .object({
    changes: z.array(RepoPatchChangeParamsSchema).min(1).max(50)
  })
  .strict();
const RepoApplyApprovedPatchParamsSchema = z
  .object({
    patch: z.string().min(1).max(MAX_PATCH_LENGTH),
    proposalId: z.string().uuid().optional(),
    patchHash: z.string().regex(/^[a-f0-9]{64}$/u).optional()
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
const GitInspectParamsSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("log"), maxCount: z.number().int().min(1).max(100).default(25), ref: z.string().min(1).max(128).optional() }).strict(),
  z.object({ operation: z.literal("show_commit"), ref: z.string().min(1).max(128) }).strict(),
  z.object({ operation: z.literal("diff_refs"), baseRef: z.string().min(1).max(128), targetRef: z.string().min(1).max(128) }).strict(),
  z.object({ operation: z.literal("file_history"), file: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH), maxCount: z.number().int().min(1).max(100).default(25) }).strict(),
  z.object({
    operation: z.literal("blame"),
    file: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH),
    ref: z.string().min(1).max(128).optional(),
    startLine: z.number().int().min(1).max(100_000).optional(),
    endLine: z.number().int().min(1).max(100_000).optional()
  }).strict(),
  z.object({ operation: z.literal("merge_base"), baseRef: z.string().min(1).max(128), targetRef: z.string().min(1).max(128) }).strict(),
  z.object({ operation: z.literal("check_ancestry"), ancestorRef: z.string().min(1).max(128), descendantRef: z.string().min(1).max(128) }).strict()
]);
const ReadImageArtifactParamsSchema = z
  .object({
    path: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH),
    maxBytes: z.number().int().positive().max(MAX_IMAGE_ARTIFACT_BYTES).default(MAX_IMAGE_ARTIFACT_BYTES)
  })
  .strict();
const ArtifactCatalogLimitSchema = z.number().int().min(1).max(200).default(50);
const ArtifactFilterParamsSchema = z
  .object({
    phaseId: z.string().min(1).max(128).optional(),
    artifactType: z.string().min(1).max(128).optional(),
    artifactTypes: z.array(z.string().min(1).max(128)).max(20).optional(),
    workCardId: z.string().min(1).max(128).optional(),
    status: z.string().min(1).max(128).optional(),
    statuses: z.array(z.string().min(1).max(128)).max(20).optional(),
    pathPrefix: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH).optional(),
    recordKind: z.enum(["source", "sidecar", "derived"]).optional(),
    includeDerived: z.boolean().optional(),
    includeSidecars: z.boolean().optional(),
    sourceOnly: z.boolean().optional()
  })
  .strict();
const ListArtifactsParamsSchema = ArtifactFilterParamsSchema.extend({
  limit: ArtifactCatalogLimitSchema,
  cursor: z.string().min(1).max(32).optional()
}).strict();
const ExportPlanningCorpusParamsSchema = z
  .object({
    pathPrefix: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH).default("planning/"),
    includeFullText: z.boolean().default(false),
    includeDerived: z.boolean().default(false),
    includeSidecars: z.boolean().default(false),
    artifactTypes: z.array(z.string().min(1).max(128)).max(20).optional(),
    statuses: z.array(z.string().min(1).max(128)).max(20).optional(),
    limit: ArtifactCatalogLimitSchema,
    cursor: z.string().min(1).max(32).optional(),
    maxBundleBytes: z.number().int().positive().max(500_000).default(200_000)
  })
  .strict();
const ReadArtifactByIdParamsSchema = z
  .object({
    artifactId: z.string().min(1).max(128),
    component: z.enum(["preferred", "markdown", "json", "both"]).default("preferred")
  })
  .strict();
const InspectArtifactTextParamsSchema = z
  .object({
    artifactId: z.string().min(1).max(128),
    includeHeadingIndex: z.boolean().optional(),
    maximumHeadings: z.number().int().positive().max(TEXT_PROJECTION_HARD_MAX_HEADINGS).default(TEXT_PROJECTION_DEFAULT_MAX_HEADINGS)
  })
  .strict();
const ReadArtifactTextChunkParamsSchema = z
  .object({
    artifactId: z.string().min(1).max(128).optional(),
    cursor: z.string().min(1).max(4096).optional(),
    maximumBytes: z.number().int().positive().max(TEXT_PROJECTION_HARD_CONTENT_ITEM_BYTES).default(TEXT_PROJECTION_DEFAULT_CHUNK_BYTES),
    maximumLines: z.number().int().positive().max(TEXT_PROJECTION_HARD_MAX_LINES).default(TEXT_PROJECTION_DEFAULT_MAX_LINES),
    expectedSourceSha256: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
    priorResultAttemptId: z.string().min(1).max(128).optional()
  })
  .strict()
  .refine((value) => Boolean(value.artifactId || value.cursor), "artifactId or cursor is required.");
const LatestArtifactParamsSchema = ArtifactFilterParamsSchema.extend({
  includeContent: z.boolean().default(false)
}).strict();
const ArtifactPairStatusParamsSchema = z
  .object({
    artifactId: z.string().min(1).max(128)
  })
  .strict();
const CurrentActionContextParamsSchema = z
  .object({
    phaseId: z.string().min(1).max(128).optional()
  })
  .strict();
const STRICT_ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;
const StrictIsoTimestampSchema = z.string().min(20).max(35).refine(
  (value) => STRICT_ISO_TIMESTAMP_PATTERN.test(value) && !Number.isNaN(Date.parse(value)),
  "since must be a strict ISO-8601 timestamp."
);
const RecentToolCallsParamsSchema = z
  .object({
    limit: z.number().int().min(1).max(50).default(20),
    since: StrictIsoTimestampSchema.optional(),
    correlationId: z.string().min(1).max(128).optional(),
    publicToolName: z.string().min(1).max(128).optional()
  })
  .strict();
const AcknowledgeToolResultParamsSchema = z
  .object({
    correlationId: z.string().min(1).max(128),
    resultAttemptId: z.string().min(1).max(128),
    payloadSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    acknowledgementContext: z.enum(ACKNOWLEDGEMENT_CONTEXTS).optional()
  })
  .strict();
const ResultDeliveryStatusParamsSchema = z
  .object({
    correlationId: z.string().min(1).max(128).optional(),
    resultAttemptId: z.string().min(1).max(128).optional()
  })
  .strict()
  .refine((value) => Boolean(value.correlationId || value.resultAttemptId), "correlationId or resultAttemptId is required.");
const DescribeToolboxActionParamsSchema = z
  .object({
    toolboxName: z.enum(TOOLBOX_TOOL_NAMES),
    actionName: z.string().min(1).max(80)
  })
  .strict();
const ReviewQueueParamsSchema = ArtifactFilterParamsSchema.extend({
  limit: ArtifactCatalogLimitSchema,
  cursor: z.string().min(1).max(32).optional()
}).strict();
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
const ProjectValidationParamsSchema = z.object({ operation: z.enum(["typecheck", "build", "test", "release_checks"]) }).strict();
const SourceAnalysisParamsSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("find_symbol"), symbol: z.string().min(1).max(200) }).strict(),
  z.object({ operation: z.literal("find_references"), symbol: z.string().min(1).max(200) }).strict(),
  z.object({ operation: z.literal("import_graph"), file: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH), maxDepth: z.number().int().min(1).max(5).default(2) }).strict(),
  z.object({ operation: z.literal("get_callers"), symbol: z.string().min(1).max(200) }).strict(),
  z.object({ operation: z.literal("get_callees"), symbol: z.string().min(1).max(200) }).strict(),
  z.object({ operation: z.literal("mcp_registrations") }).strict(),
  z.object({ operation: z.literal("duplicate_mcp_tool_names") }).strict()
]);

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
  figma: ["governed broker placeholder", "legacy direct Figma tools removed", "no arbitrary upstream MCP passthrough"],
  figma_make: ["governed broker placeholder", "legacy direct Figma Make handoff removed", "no arbitrary upstream MCP passthrough"],
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

function assertToolboxActionPolicy(context: ToolboxRuntimeContext | undefined, toolbox: ToolboxName, action: string): void {
  const policy = getToolboxActionPolicy(toolbox, action);
  if (!policy) {
    return;
  }

  if (!context) {
    if (policy.requiredScope === "files.write") {
      throw new AppError("APPROVAL_REQUIRED", `${toolbox}.${action} requires OAuth scope ${policy.requiredScope}.`, {
        requiredScope: policy.requiredScope
      });
    }
    return;
  }

  if (!scopeIncludes(context.callerScope, policy.requiredScope)) {
    throw new AppError("APPROVAL_REQUIRED", `${toolbox}.${action} requires OAuth scope ${policy.requiredScope}.`, {
      requiredScope: policy.requiredScope
    });
  }

  if (policy.requiredScope === "files.write" && policy.mappedInternalOperation) {
    context.assertWriteToolEnabled(policy.mappedInternalOperation);
  }
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

function isPackagedApplicationRoot(value: string): boolean {
  return /(?:^|[\\/])app\.asar(?:$|[\\/])/iu.test(path.resolve(value));
}

function comparePackageVersions(
  runtimePackageVersion: string | "unknown",
  selectedWorkspacePackageVersion: string | "unknown"
): boolean | "unknown" {
  if (runtimePackageVersion === "unknown" || selectedWorkspacePackageVersion === "unknown") {
    return "unknown";
  }

  return runtimePackageVersion === selectedWorkspacePackageVersion;
}

function targetGitInspectionAllowed(config: AppConfig, selectedWorkspaceId: string | undefined): boolean {
  try {
    return resolveWorkspaceAuthority(selectedWorkspaceId, config, "git_inspection").allowed;
  } catch {
    return false;
  }
}

export async function buildRuntimeScopeToolDiagnostics(
  config: AppConfig,
  context: ToolboxRuntimeContext,
  selectedWorkspaceRoot = config.defaultWorkspaceRoot ?? config.repoRoot,
  selectedWorkspaceId: string | undefined = undefined
): Promise<RuntimeScopeToolDiagnostics> {
  const allowTargetGitInspection = targetGitInspectionAllowed(config, selectedWorkspaceId);
  const [runtimeSourceCommit, branch, selectedWorkspaceHead] = await Promise.all([
    runtimeGitOutputOptional(config.repoRoot, ["rev-parse", "--short", "HEAD"]),
    runtimeGitOutputOptional(config.repoRoot, ["branch", "--show-current"]),
    allowTargetGitInspection ? runtimeGitOutputOptional(selectedWorkspaceRoot, ["rev-parse", "--short", "HEAD"]) : Promise.resolve("unknown" as const)
  ]);
  const runtimePackageVersion = packageVersion(config.repoRoot);
  const selectedWorkspacePackageVersion = packageVersion(selectedWorkspaceRoot);
  const selectedIsServiceRepository =
    selectedWorkspaceId === "champcity_gpt" ||
    path.resolve(selectedWorkspaceRoot) === path.resolve(config.repoRoot);
  const servicePackageVersionMatch = comparePackageVersions(runtimePackageVersion, selectedWorkspacePackageVersion);
  const packageVersionMatch = selectedIsServiceRepository ? servicePackageVersionMatch : "not_applicable";
  const runtimeDriftDetected = packageVersionMatch === false;
  const warnings = [
    ...(runtimeDriftDetected
      ? [
          "The active MCP runtime package version does not match the ChampCity GPT service repository version. Package, promote, restart, and reconnect the runtime before relying on current source behavior."
        ]
      : []),
    ...(config.configWarnings ?? [])
  ];

  return {
    runtime: {
      packageVersion: runtimePackageVersion,
      runtimePackageVersion,
      selectedWorkspacePackageVersion,
      packageVersionMatch,
      commit: runtimeSourceCommit,
      runtimeSourceCommit,
      selectedWorkspaceHead,
      branch,
      startedAt: TOOLBOX_RUNTIME_STARTED_AT,
      runtimeDriftDetected,
      warnings,
      workspaceRouting: getWorkspaceDiagnostics(config),
      serviceRuntime: {
        packageVersion: runtimePackageVersion,
        sourceCommit: runtimeSourceCommit,
        mode: isPackagedApplicationRoot(config.repoRoot) ? "packaged" : "development",
        provenance: "ChampCity GPT MCP runtime"
      },
      targetWorkspace: {
        workspaceId: selectedWorkspaceId ?? "unknown",
        packageVersion: selectedWorkspacePackageVersion,
        head: selectedWorkspaceHead,
        alignment: selectedIsServiceRepository ? "checked" : "not_applicable"
      }
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
  const alternatives = UNSUPPORTED_ACTION_ALTERNATIVES[`${toolbox}.${action}`] ?? [];
  return {
    toolbox,
    action,
    ok: false,
    error: serializeError(
      new AppError("INVALID_INPUT", "Unsupported toolbox action.", {
        classification: "contract_rejection",
        toolbox,
        action,
        supportedActions,
        alternatives
      })
    ),
    recommendedNextSteps: [
      `Use one of: ${supportedActions.join(", ")}.`,
      ...alternatives.map((alternative) => `Alternative: ${alternative}.`)
    ]
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

function architectResult(toolbox: ToolboxName, action: string, result: ArchitectToolResult<unknown>): ToolboxResult {
  const safeResult = sanitizeToolboxValue(result);
  const firstError = result.errors[0];
  return {
    toolbox,
    action,
    ok: result.ok,
    result: safeResult,
    ...(firstError
      ? {
          error: {
            code: firstError.code,
            message: firstError.message
          }
        }
      : {}),
    warnings: result.warnings
  };
}

function okWithMcpContent(
  toolbox: ToolboxName,
  action: string,
  result: object,
  mcpContent: CallToolResult["content"]
): ToolboxResult {
  const safeResult = sanitizeToolboxValue(result) as Record<string, unknown>;
  return {
    toolbox,
    action,
    ok: true,
    result: safeResult,
    mcpContent,
    structuredContent: safeResult
  };
}

function artifactOk(toolbox: "artifact_toolbox", action: string, result: Record<string, unknown>): ToolboxResult {
  const boundedPayload = takeBoundedArtifactTextPayload(result);
  if (!boundedPayload) {
    return ok(toolbox, action, result);
  }
  return okWithMcpContent(toolbox, action, boundedPayload.structuredContent, boundedPayload.mcpContent);
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

function gitCapabilityUnavailableResult(toolbox: "git_toolbox", action: string, workspaceId: string, reasonCode = "GIT_CAPABILITY_UNAVAILABLE"): ToolboxResult {
  return ok(toolbox, action, {
    status: "not_git_repository",
    reasonCode,
    capability: "git_inspection",
    workspaceId,
    operation: action,
    generalWorkspaceOperationsUnaffected: true,
    recommendedNextAction: "repo_toolbox.status"
  });
}

async function runToolboxAction(
  toolbox: ToolboxName,
  rawInput: unknown,
  supportedActions: readonly string[],
  config: AppConfig,
  context: ToolboxRuntimeContext | undefined,
  handler: (input: ToolboxInput) => Promise<ToolboxResult>
): Promise<ToolboxResult> {
  let input: ToolboxInput;
  try {
    input = parseToolboxInput(rawInput);
  } catch (error) {
    return failed(toolbox, "unknown", error, supportedActions);
  }

  updateCurrentToolCallTraceContext({
    publicTool: toolbox,
    action: input.action,
    workspaceId: input.workspaceId
  });
  recordToolCallTrace(config, {
    stage: "toolbox_entered",
    publicTool: toolbox,
    action: input.action,
    workspaceId: input.workspaceId,
    requestedPath: typeof input.params.relativePath === "string" ? input.params.relativePath : undefined,
    result: "allow"
  });

  if (!supportedActions.includes(input.action)) {
    return supportedActionError(toolbox, input.action, supportedActions);
  }

  try {
    assertToolboxActionPolicy(context, toolbox, input.action);
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
  return runToolboxAction("repo_toolbox", rawInput, SUPPORTED_REPO_ACTIONS, config, context, async (input) => {
    const root = resolveWorkspaceRoot(input.workspaceId, config);

    switch (input.action) {
      case "status":
        EmptyParamsSchema.parse(input.params);
        return ok("repo_toolbox", input.action, await getGeneralWorkspaceStatus({ workspaceId: input.workspaceId }, config, {
          callerScope: context.callerScope,
          writeToolsHiddenByLocalMode: context.writeToolNamesBlockedByLocalMode
        }));
      case "list_files": {
        const params = RepoListFilesParamsSchema.parse(input.params);
        return ok("repo_toolbox", input.action, withoutRoot(await listProjectFiles({ root, ...params }, config)));
      }
      case "read_file": {
        const params = RepoReadFileParamsSchema.parse(input.params);
        const result = await readProjectFile({ root, workspaceId: input.workspaceId, ...params }, config);
        if (result.contentComplete) {
          return ok("repo_toolbox", input.action, result);
        }
        const chunk = await readTextChunk(config, {
          workspaceId: input.workspaceId,
          root,
          relativePath: result.relativePath,
          maximumBytes: TEXT_PROJECTION_DEFAULT_CHUNK_BYTES,
          expectedSourceSha256: result.sha256,
          maxBytes: params.maxBytes
        });
        return okWithMcpContent(
          "repo_toolbox",
          input.action,
          {
            ...boundedTextStructuredContent(chunk),
            readFileCompatibilityMode: true,
            contentComplete: false,
            inlineThresholdBytes: TEXT_PROJECTION_INLINE_THRESHOLD_BYTES,
            recommendedNextAction: "read_text_chunk"
          },
          boundedTextContentItems(chunk)
        );
      }
      case "inspect_text_file": {
        const params = RepoInspectTextFileParamsSchema.parse(input.params);
        const source = await loadTextProjectionSource(config, {
          workspaceId: input.workspaceId,
          root,
          relativePath: params.relativePath
        });
        return ok("repo_toolbox", input.action, inspectTextProjectionSource(config, source, params));
      }
      case "read_text_chunk": {
        const params = RepoReadTextChunkParamsSchema.parse(input.params);
        const chunk = await readTextChunk(config, { workspaceId: input.workspaceId, root, ...params });
        return okWithMcpContent("repo_toolbox", input.action, boundedTextStructuredContent(chunk), boundedTextContentItems(chunk));
      }
      case "read_text_lines": {
        const params = RepoReadTextLinesParamsSchema.parse(input.params);
        const chunk = await readTextLines(config, { workspaceId: input.workspaceId, root, ...params });
        return okWithMcpContent("repo_toolbox", input.action, boundedTextStructuredContent(chunk), boundedTextContentItems(chunk));
      }
      case "read_markdown_section": {
        const params = RepoReadMarkdownSectionParamsSchema.parse(input.params);
        const chunk = await readMarkdownSection(config, { workspaceId: input.workspaceId, root, ...params });
        return okWithMcpContent("repo_toolbox", input.action, boundedTextStructuredContent(chunk), boundedTextContentItems(chunk));
      }
      case "search_files": {
        const params = RepoSearchFilesParamsSchema.parse(input.params);
        return ok("repo_toolbox", input.action, withoutRoot(await searchProjectFiles({ root, ...params }, config)));
      }
      case "write_markdown_artifact": {
        const params = RepoWriteMarkdownParamsSchema.parse(input.params);
        return ok("repo_toolbox", input.action, await writeMarkdownArtifact({ root, ...params }, config));
      }
      case "write_json_artifact": {
        const params = RepoWriteJsonParamsSchema.parse(input.params);
        return ok("repo_toolbox", input.action, await writeJsonArtifact({ root, ...params }, config));
      }
      case "propose_patch": {
        const params = RepoProposePatchParamsSchema.parse(input.params);
        return ok("repo_toolbox", input.action, await proposePatch({ root, ...params }, config));
      }
      case "apply_approved_patch": {
        const params = RepoApplyApprovedPatchParamsSchema.parse(input.params);
        return ok("repo_toolbox", input.action, await applyApprovedPatch({ root, ...params }, config));
      }
      default:
        return supportedActionError("repo_toolbox", input.action, SUPPORTED_REPO_ACTIONS);
    }
  });
}

export async function gitToolbox(rawInput: unknown, config: AppConfig, context: ToolboxRuntimeContext): Promise<ToolboxResult> {
  return runToolboxAction("git_toolbox", rawInput, SUPPORTED_GIT_ACTIONS, config, context, async (input) => {
    const root = resolveWorkspaceRoot(input.workspaceId, config);
    const gitInspectionAuthority = () => resolveWorkspaceAuthority(input.workspaceId, config, "git_inspection");
    const assertGitBacked = () => {
      assertWorkspaceAuthorityAllowed(resolveWorkspaceAuthority(input.workspaceId, config, "git_mutation"));
    };

    switch (input.action) {
      case "status":
        EmptyParamsSchema.parse(input.params);
        const statusAuthority = gitInspectionAuthority();
        if (!statusAuthority.allowed) {
          return gitCapabilityUnavailableResult("git_toolbox", input.action, input.workspaceId, statusAuthority.denialReason);
        }
        return ok("git_toolbox", input.action, await getWorkspaceStatusSummary({ workspaceId: input.workspaceId }, config));
      case "diff": {
        const params = GitDiffParamsSchema.parse(input.params);
        const diffAuthority = gitInspectionAuthority();
        if (!diffAuthority.allowed) {
          return gitCapabilityUnavailableResult("git_toolbox", input.action, input.workspaceId, diffAuthority.denialReason);
        }
        return ok("git_toolbox", input.action, await gitDiff({ root, ...params }, config));
      }
      case "prepare_work_branch": {
        assertGitBacked();
        const params = GitPrepareWorkBranchParamsSchema.parse(input.params);
        return ok("git_toolbox", input.action, await prepareGitWorkBranch({ workspaceId: input.workspaceId, ...params }, config));
      }
      case "pre_commit_scan": {
        assertGitBacked();
        const params = GitPreCommitScanParamsSchema.parse(input.params);
        return ok("git_toolbox", input.action, await preCommitSafetyScan({ root, ...params }, config));
      }
      case "stage_paths": {
        assertGitBacked();
        const params = GitStagePathsParamsSchema.parse(input.params);
        return ok("git_toolbox", input.action, await safeStageChanges({ root, mode: "paths", paths: params.paths }, config));
      }
      case "commit_staged": {
        assertGitBacked();
        const params = GitCommitStagedParamsSchema.parse(input.params);
        return ok("git_toolbox", input.action, await commitValidatedChanges({ root, ...params, allowMainCommit: false }, config));
      }
      case "push_current_branch": {
        assertGitBacked();
        const params = GitPushCurrentBranchParamsSchema.parse(input.params);
        return ok("git_toolbox", input.action, await pushCurrentBranch({ root, remote: "origin", ...params, allowMainPush: false }, config));
      }
      case "readiness_summary": {
        assertGitBacked();
        const params = GitReadinessParamsSchema.parse(input.params);
        return ok("git_toolbox", input.action, await getCommitReadiness({ root, targetBranch: params.targetBranch }, config));
      }
      case "integrate_to_dev": {
        assertGitBacked();
        return ok("git_toolbox", input.action, await integrateToDev({ workspaceId: input.workspaceId, ...input.params }, config));
      }
      case "inspect_history": {
        const params = GitInspectParamsSchema.parse(input.params) as GitInspectionInput;
        const inspectAuthority = gitInspectionAuthority();
        if (!inspectAuthority.allowed) {
          return gitCapabilityUnavailableResult("git_toolbox", input.action, input.workspaceId, inspectAuthority.denialReason);
        }
        return architectResult("git_toolbox", input.action, await runGitInspection(root, params));
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
  return runToolboxAction("artifact_toolbox", rawInput, SUPPORTED_ARTIFACT_ACTIONS, config, context, async (input) => {
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
        return ok("artifact_toolbox", input.action, localPackageSummary(resolveWorkspaceRoot(input.workspaceId, config)));
      case "create_markdown_artifact": {
        const params = CreateMarkdownArtifactParamsSchema.parse(input.params);
        return ok("artifact_toolbox", input.action, await createMarkdownArtifact({ workspaceId: input.workspaceId, ...params }, config));
      }
      case "read_image_artifact": {
        const params = ReadImageArtifactParamsSchema.parse(input.params);
        const image = await readImageArtifact({ workspaceId: input.workspaceId, ...params }, config);
        return okWithMcpContent("artifact_toolbox", input.action, image.metadata, [
          {
            type: "text",
            text: `Loaded image artifact: ${image.metadata.path}`
          },
          {
            type: "image",
            data: image.base64Data,
            mimeType: image.metadata.mimeType
          }
        ]);
      }
      case "list_artifacts": {
        const params = ListArtifactsParamsSchema.parse(input.params);
        return ok("artifact_toolbox", input.action, await listArtifacts({ workspaceId: input.workspaceId, ...params }, config));
      }
      case "read_artifact_by_id": {
        const params = ReadArtifactByIdParamsSchema.parse(input.params);
        return artifactOk("artifact_toolbox", input.action, await readArtifactById({ workspaceId: input.workspaceId, ...params }, config) as Record<string, unknown>);
      }
      case "inspect_artifact_text": {
        const params = InspectArtifactTextParamsSchema.parse(input.params);
        return ok("artifact_toolbox", input.action, await inspectArtifactText({ workspaceId: input.workspaceId, ...params }, config));
      }
      case "read_artifact_text_chunk": {
        const params = ReadArtifactTextChunkParamsSchema.parse(input.params);
        return artifactOk("artifact_toolbox", input.action, await readArtifactTextChunk({ workspaceId: input.workspaceId, ...params }, config) as Record<string, unknown>);
      }
      case "latest_artifact": {
        const params = LatestArtifactParamsSchema.parse(input.params);
        return artifactOk("artifact_toolbox", input.action, await latestArtifact({ workspaceId: input.workspaceId, ...params }, config) as Record<string, unknown>);
      }
      case "artifact_pair_status": {
        const params = ArtifactPairStatusParamsSchema.parse(input.params);
        return ok("artifact_toolbox", input.action, await artifactPairStatus({ workspaceId: input.workspaceId, ...params }, config));
      }
      case "current_action_context": {
        const params = CurrentActionContextParamsSchema.parse(input.params);
        return ok("artifact_toolbox", input.action, await currentActionContext({ workspaceId: input.workspaceId, ...params }, config));
      }
      case "export_planning_corpus": {
        const params = ExportPlanningCorpusParamsSchema.parse(input.params);
        return artifactOk("artifact_toolbox", input.action, await exportPlanningCorpus({ workspaceId: input.workspaceId, ...params }, config) as Record<string, unknown>);
      }
      case "review_queue": {
        const params = ReviewQueueParamsSchema.parse(input.params);
        return ok("artifact_toolbox", input.action, await reviewQueue({ workspaceId: input.workspaceId, ...params }, config));
      }
      default:
        return supportedActionError("artifact_toolbox", input.action, SUPPORTED_ARTIFACT_ACTIONS);
    }
  });
}

export async function diagnosticsToolbox(rawInput: unknown, config: AppConfig, context: ToolboxRuntimeContext): Promise<ToolboxResult> {
  return runToolboxAction("diagnostics_toolbox", rawInput, SUPPORTED_DIAGNOSTICS_ACTIONS, config, context, async (input) => {
    if (
      input.action !== "project_validation" &&
      input.action !== "recent_tool_calls" &&
      input.action !== "acknowledge_tool_result" &&
      input.action !== "result_delivery_status" &&
      input.action !== "describe_toolbox_action"
    ) {
      EmptyParamsSchema.parse(input.params);
    }
    const selectedWorkspaceRoot =
      input.action !== "list_workspaces" &&
      input.action !== "recent_tool_calls" &&
      input.action !== "acknowledge_tool_result" &&
      input.action !== "result_delivery_status" &&
      input.action !== "describe_toolbox_action"
        ? resolveWorkspaceRoot(input.workspaceId, config)
        : undefined;

    if (input.action === "workspace_safety_status") {
      return ok("diagnostics_toolbox", input.action, await getWorkspaceSafetyStatus({ workspaceId: input.workspaceId }, config, {
        callerScope: context.callerScope,
        writeToolsHiddenByLocalMode: context.writeToolNamesBlockedByLocalMode
      }));
    }
    if (input.action === "public_safety_status") {
      return ok("diagnostics_toolbox", input.action, await getWorkspaceSafetyStatus({ workspaceId: input.workspaceId, deprecatedAlias: "public_safety_status" }, config, {
        callerScope: context.callerScope,
        writeToolsHiddenByLocalMode: context.writeToolNamesBlockedByLocalMode
      }));
    }

    const diagnostics = await buildRuntimeScopeToolDiagnostics(config, context, selectedWorkspaceRoot, input.workspaceId);
    switch (input.action) {
      case "runtime_status":
        return ok("diagnostics_toolbox", input.action, diagnostics.runtime, diagnostics.runtime.warnings);
      case "write_access_status": {
        const catalog = await listWorkspaceCatalog(config, {
          oauthFilesWriteGranted: diagnostics.oauth.filesWriteGranted
        });
        return ok("diagnostics_toolbox", input.action, {
          writeMode: config.writeMode,
          writeModeSource: config.writeModeSource,
          docsWritesAllowed: config.docsWritesAllowed,
          patchWritesAllowed: config.patchWritesAllowed,
          elevatedOperationsAllowed: config.elevatedOperationsAllowed,
          writeToolsHiddenByLocalMode: context.writeToolNamesBlockedByLocalMode,
          workspaceWriteAuthority: catalog.workspaces.map((workspace) => ({
            workspaceId: workspace.workspaceId,
            writePolicy: workspace.writePolicy,
            gitDetected: workspace.gitDetected,
            capabilities: workspace.capabilities,
            artifactWriteRoots: workspace.artifactWriteRoots,
            artifactPersistenceAvailable: workspace.artifactPersistenceAvailable,
            artifactPersistenceReason: workspace.artifactPersistenceReason,
            gitMutationAvailable: workspace.gitMutationAvailable,
            gitMutationReason: workspace.gitMutationReason,
            warnings: workspace.warnings
          }))
        });
      }
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
      case "recent_tool_calls": {
        const params = RecentToolCallsParamsSchema.parse(input.params);
        return ok("diagnostics_toolbox", input.action, readRecentToolCalls(config, params));
      }
      case "acknowledge_tool_result": {
        const params = AcknowledgeToolResultParamsSchema.parse(input.params);
        return ok("diagnostics_toolbox", input.action, await acknowledgeToolResult(config, params));
      }
      case "result_delivery_status": {
        const params = ResultDeliveryStatusParamsSchema.parse(input.params);
        return ok("diagnostics_toolbox", input.action, resultDeliveryStatus(config, params));
      }
      case "list_workspaces":
        return ok("diagnostics_toolbox", input.action, await listWorkspaceCatalog(config, {
          oauthFilesWriteGranted: diagnostics.oauth.filesWriteGranted
        }));
      case "project_validation": {
        const params = ProjectValidationParamsSchema.parse(input.params);
        return architectResult(
          "diagnostics_toolbox",
          input.action,
          await runProjectValidation(resolveWorkspaceRoot(input.workspaceId, config), params.operation as ProjectValidationOperation)
        );
      }
      case "mcp_server_startup":
        return architectResult(
          "diagnostics_toolbox",
          input.action,
          await runMcpServerStartupDiagnostic(resolveWorkspaceRoot(input.workspaceId, config))
        );
      case "mcp_tool_registration": {
        const root = resolveWorkspaceRoot(input.workspaceId, config);
        const startedAt = new Date().toISOString();
        const registration = validateMcpToolRegistration(context.registeredToolDefinitions);
        const expectedArchitectActions = {
          diagnostics_toolbox: [
            "project_validation",
            "recent_tool_calls",
            "acknowledge_tool_result",
            "result_delivery_status",
            "mcp_server_startup",
            "mcp_tool_registration",
            "mcp_tool_inventory",
            "describe_toolbox_action",
            "workspace_safety_status",
            "electron_development_startup",
            "electron_packaged_startup"
          ],
          git_toolbox: ["inspect_history"],
          knowledge_toolbox: ["source_analysis"]
        };
        const passed = registration.overallResult === "passed";
        return architectResult(
          "diagnostics_toolbox",
          input.action,
          completedResult({
            tool: "diagnostics_toolbox.mcp_tool_registration",
            root,
            startedAt,
            status: passed ? "passed" : "validation_failure",
            data: { ...registration, expectedArchitectActions },
            errors: passed ? [] : [{ code: "validation_failure", message: "MCP tool registration validation failed." }]
          })
        );
      }
      case "mcp_tool_inventory": {
        const root = resolveWorkspaceRoot(input.workspaceId, config);
        return architectResult(
          "diagnostics_toolbox",
          input.action,
          completedResult({
            tool: "diagnostics_toolbox.mcp_tool_inventory",
            root,
            startedAt: new Date().toISOString(),
            status: "passed",
            data: {
              registeredTools: buildMcpToolInventory(context.registeredToolDefinitions),
              toolboxActions: {
                repo_toolbox: [...SUPPORTED_REPO_ACTIONS],
                artifact_toolbox: [...SUPPORTED_ARTIFACT_ACTIONS],
                diagnostics_toolbox: [...SUPPORTED_DIAGNOSTICS_ACTIONS],
                browser_toolbox: [...SUPPORTED_BROWSER_ACTIONS],
                git_toolbox: [...SUPPORTED_GIT_ACTIONS],
                integration_toolbox: [...SUPPORTED_INTEGRATION_ACTIONS],
                knowledge_toolbox: [...SUPPORTED_KNOWLEDGE_ACTIONS]
              },
              toolboxActionContracts: listToolboxActionContracts()
            }
          })
        );
      }
      case "describe_toolbox_action": {
        const params = DescribeToolboxActionParamsSchema.parse(input.params);
        const contract = getToolboxActionContract(params.toolboxName, params.actionName);
        if (!contract) {
          return supportedActionError(params.toolboxName, params.actionName, SUPPORTED_TOOLBOX_ACTIONS[params.toolboxName]);
        }
        return ok("diagnostics_toolbox", input.action, {
          status: "ok",
          contract
        });
      }
      case "electron_development_startup":
        return architectResult(
          "diagnostics_toolbox",
          input.action,
          await validateDevelopmentElectronStartup(resolveWorkspaceRoot(input.workspaceId, config))
        );
      case "electron_packaged_startup":
        return architectResult(
          "diagnostics_toolbox",
          input.action,
          await validatePackagedElectronStartup(resolveWorkspaceRoot(input.workspaceId, config))
        );
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

async function serviceStatus(serviceId: IntegrationServiceId, _config: AppConfig) {
  if (serviceId === "figma" || serviceId === "figma_make") {
    return {
      serviceId,
      status: "broker_not_implemented",
      governedBrokerOnly: true,
      arbitraryUpstreamMcpPassthrough: false,
      legacyDirectFigmaToolsRemoved: true
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
      governedBrokerOnly: serviceId === "figma" || serviceId === "figma_make" ? true : undefined,
      legacyDirectFigmaToolsRemoved: serviceId === "figma" || serviceId === "figma_make" ? true : undefined,
      arbitraryUpstreamToolNameAccepted: false,
      arbitraryServerUrlAccepted: false,
      rawTokensAccepted: false,
      externalWritesImplemented: false
    }
  };
}

function validateServiceConfiguration(serviceId: IntegrationServiceId) {
  if (serviceId === "figma" || serviceId === "figma_make") {
    return {
      serviceId,
      status: "broker_not_implemented",
      governedBrokerOnly: true,
      arbitraryUpstreamMcpPassthrough: false,
      legacyDirectFigmaToolsRemoved: true,
      validatable: "broker_not_implemented",
      rawTokenAccepted: false,
      arbitraryServerUrlAccepted: false,
      recommendedNextSteps: [
        "Configure future governed broker support through a scoped Work Card.",
        "Do not paste Figma tokens, cookies, private URLs, or upstream MCP server details into ChatGPT."
      ]
    };
  }

  return {
    serviceId,
    validatable: "placeholder_only",
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
  return runToolboxAction("integration_toolbox", rawInput, SUPPORTED_INTEGRATION_ACTIONS, config, context, async (input) => {
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
        const root = resolveWorkspaceRoot(input.workspaceId, config);
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

export async function browserToolbox(rawInput: unknown, config: AppConfig, context?: ToolboxRuntimeContext): Promise<ToolboxResult> {
  return runToolboxAction("browser_toolbox", rawInput, SUPPORTED_BROWSER_ACTIONS, config, context, async (input) => {
    resolveWorkspaceRoot(input.workspaceId, config);
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

export async function knowledgeToolbox(rawInput: unknown, config: AppConfig, context?: ToolboxRuntimeContext): Promise<ToolboxResult> {
  return runToolboxAction("knowledge_toolbox", rawInput, SUPPORTED_KNOWLEDGE_ACTIONS, config, context, async (input) => {
    resolveWorkspaceRoot(input.workspaceId, config);
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
      case "source_analysis": {
        const params = SourceAnalysisParamsSchema.parse(input.params) as SourceAnalysisInput;
        return architectResult(
          "knowledge_toolbox",
          input.action,
          await runSourceAnalysis(resolveWorkspaceRoot(input.workspaceId, config), params)
        );
      }
      default:
        return supportedActionError("knowledge_toolbox", input.action, SUPPORTED_KNOWLEDGE_ACTIONS);
    }
  });
}
