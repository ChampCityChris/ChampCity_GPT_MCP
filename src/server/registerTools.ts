import { type Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ListToolsResultSchema,
  ToolSchema,
  type Tool
} from "@modelcontextprotocol/sdk/types.js";

import { type AppConfig } from "../config.js";
import { scopeIncludes } from "../oauth.js";
import {
  artifactToolbox,
  browserToolbox,
  diagnosticsToolbox,
  gitToolbox,
  integrationToolbox,
  knowledgeToolbox,
  repoToolbox,
  TOOLBOX_TOOL_NAMES,
  type ToolboxRuntimeContext
} from "../tools/domainToolboxes.js";
import {
  MAX_APPROVAL_TOKEN_LENGTH,
  MAX_COMMAND_LENGTH,
  MAX_GLOB_LENGTH,
  MAX_JSON_ARTIFACT_CONTENT_LENGTH,
  MAX_MARKDOWN_ARTIFACT_CONTENT_LENGTH,
  MAX_PATCH_LENGTH,
  MAX_PROPOSE_PATCH_TEXT_LENGTH,
  MAX_QUERY_LENGTH,
  MAX_RELATIVE_PATH_LENGTH,
  MAX_ROOT_LENGTH
} from "../tools/inputLimits.js";
import { serializeError, AppError } from "../utils/errors.js";

const textSchema = { type: "string" };
const rootSchema = { type: "string", maxLength: MAX_ROOT_LENGTH, description: "Absolute configured allowed root." };
const relativePathSchema = { ...textSchema, maxLength: MAX_RELATIVE_PATH_LENGTH };
const approvalTokenSchema = { ...textSchema, maxLength: MAX_APPROVAL_TOKEN_LENGTH };
const workspaceIdSchema = { ...textSchema, maxLength: 64, default: "default" };
const phaseFolderSchema = { ...textSchema, maxLength: 128 };
const workCardIdSchema = { ...textSchema, maxLength: 128 };
const branchSlugSchema = { ...textSchema, maxLength: 80 };
const toolboxActionSchema = { ...textSchema, maxLength: 80 };
const toolboxParamsSchema = {
  type: "object",
  description: "Optional action-specific parameters. Unknown action parameters are rejected by server-side validation.",
  additionalProperties: true
};
const toolboxInputSchema = {
  type: "object",
  properties: {
    action: toolboxActionSchema,
    workspaceId: workspaceIdSchema,
    params: toolboxParamsSchema
  },
  required: ["action"]
};

export const tools = [
  {
    name: "list_project_files",
    description: "List files under an allowed root or subdirectory without returning contents.",
    inputSchema: {
      type: "object",
      properties: {
        root: rootSchema,
        relativePath: { ...relativePathSchema, default: "." },
        glob: { ...textSchema, maxLength: MAX_GLOB_LENGTH, default: "**/*" },
        maxResults: { type: "integer", default: 200, minimum: 1, maximum: 5000 }
      },
      required: ["root"]
    }
  },
  {
    name: "read_project_file",
    description: "Read a text file from an allowed root with path, file, binary, and size checks.",
    inputSchema: {
      type: "object",
      properties: {
        root: rootSchema,
        relativePath: relativePathSchema,
        maxBytes: { type: "integer", default: 200000, minimum: 1, maximum: 5000000 }
      },
      required: ["root", "relativePath"]
    }
  },
  {
    name: "search_project_files",
    description: "Search text files under an allowed root and return line-level matches with limited context.",
    inputSchema: {
      type: "object",
      properties: {
        root: rootSchema,
        query: { ...textSchema, maxLength: MAX_QUERY_LENGTH },
        glob: { ...textSchema, maxLength: MAX_GLOB_LENGTH, default: "**/*.{ts,tsx,js,jsx,json,md}" },
        maxResults: { type: "integer", default: 50, minimum: 1, maximum: 1000 },
        contextLines: { type: "integer", default: 2, minimum: 0, maximum: 10 }
      },
      required: ["root", "query"]
    }
  },
  {
    name: "propose_patch",
    description:
      "Generate a unified diff without modifying files and register a short-lived patch proposal. The returned proposalId/patchHash can be used by apply_approved_patch in patch write mode.",
    inputSchema: {
      type: "object",
      properties: {
        root: rootSchema,
        changes: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          items: {
            type: "object",
            properties: {
              relativePath: relativePathSchema,
              originalText: { ...textSchema, maxLength: MAX_PROPOSE_PATCH_TEXT_LENGTH },
              replacementText: { ...textSchema, maxLength: MAX_PROPOSE_PATCH_TEXT_LENGTH }
            },
            required: ["relativePath", "originalText", "replacementText"]
          }
        }
      },
      required: ["root", "changes"]
    }
  },
  {
    name: "apply_approved_patch",
    description:
      "Apply a patch only when local write mode is patch/elevated and the patch matches a registered proposal from propose_patch, or when elevated approval is explicitly configured. Preserves allowed-root, blocked-file, regular-file, symlink/submodule, size, and audit safeguards.",
    inputSchema: {
      type: "object",
      properties: {
        root: rootSchema,
        patch: { ...textSchema, minLength: 1, maxLength: MAX_PATCH_LENGTH },
        proposalId: { ...textSchema, description: "Short-lived proposal id returned by propose_patch." },
        patchHash: { ...textSchema, description: "SHA-256 hash returned by propose_patch." },
        approvalToken: approvalTokenSchema
      },
      required: ["root", "patch"]
    }
  },
  {
    name: "write_markdown_artifact",
    description:
      "Write a Markdown artifact when OAuth files.write is granted and local write mode is docs, patch, or elevated. Enforces allowed roots, .md-only writes, blocked-file policy, overwrite rules, atomic write, and audit logging. Does not require approvalToken in docs/patch write modes.",
    inputSchema: {
      type: "object",
      properties: {
        root: rootSchema,
        relativePath: relativePathSchema,
        content: { ...textSchema, maxLength: MAX_MARKDOWN_ARTIFACT_CONTENT_LENGTH },
        approvalToken: approvalTokenSchema,
        overwrite: { type: "boolean", default: false }
      },
      required: ["root", "relativePath", "content"]
    }
  },
  {
    name: "write_json_artifact",
    description:
      "Internal gated implementation for repo_toolbox.write_json_artifact. Requires OAuth files.write through the toolbox action and local write mode docs, patch, or elevated. Enforces allowed roots, .json-only writes, blocked-file policy, JSON parsing/normalization, overwrite rules, atomic write, and audit logging.",
    inputSchema: {
      type: "object",
      properties: {
        root: rootSchema,
        relativePath: relativePathSchema,
        content: { ...textSchema, maxLength: MAX_JSON_ARTIFACT_CONTENT_LENGTH },
        overwrite: { type: "boolean", default: false }
      },
      required: ["root", "relativePath", "content"]
    }
  },
  {
    name: "get_write_access_status",
    description: "Return the server-side write-mode status without exposing secrets.",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "get_workspace_status_summary",
    description:
      "Read-only. Returns a sanitized summary of the configured workspace state. Does not modify repository files, git state, release state, or configuration.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: workspaceIdSchema
      },
      required: []
    }
  },
  {
    name: "get_change_set_readiness_summary",
    description:
      "Read-only. Returns a sanitized change set readiness summary for the configured workspace. Does not modify repository files, git state, release state, or configuration.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: workspaceIdSchema,
        targetBranch: { type: "string", enum: ["main", "dev", "feature"], default: "feature" }
      },
      required: []
    }
  },
  {
    name: "get_release_artifact_summary",
    description:
      "Read-only. Returns a sanitized release artifact summary for a requested version. Does not modify repository files, git state, release state, or configuration.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: workspaceIdSchema,
        releaseVersion: { ...textSchema, maxLength: 64 }
      },
      required: ["releaseVersion"]
    }
  },
  {
    name: "get_release_publication_summary",
    description:
      "Read-only. Returns a sanitized GitHub release publication summary for a requested tag. Does not modify repository files, git state, release state, or configuration.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: workspaceIdSchema,
        tagName: { ...textSchema, maxLength: 128 },
        includeAssets: { type: "boolean", default: false }
      },
      required: ["tagName"]
    }
  },
  {
    name: "get_builder_report_index",
    description:
      "Read-only. Returns a bounded Builder Report index for configured workspaces. Does not modify repository files, git state, release state, or configuration.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: workspaceIdSchema,
        phaseFolder: phaseFolderSchema,
        workCardId: workCardIdSchema,
        maxResults: { type: "integer", default: 25, minimum: 1, maximum: 50 }
      },
      required: []
    }
  },
  {
    name: "get_builder_report_summary",
    description:
      "Read-only. Returns a bounded Builder Report preview from a safe report lookup. Does not modify repository files, git state, release state, or configuration.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: workspaceIdSchema,
        reportPath: relativePathSchema,
        phaseFolder: phaseFolderSchema,
        workCardId: workCardIdSchema,
        maxChars: { type: "integer", default: 6000, minimum: 1, maximum: 12000 }
      },
      required: []
    }
  },
  {
    name: "repo_toolbox",
    description:
      "Stable repository toolbox. Routes allowlisted file and Markdown artifact actions through existing safety checks; write actions still require OAuth files.write and local write mode.",
    inputSchema: toolboxInputSchema
  },
  {
    name: "git_toolbox",
    description:
      "Stable git workflow toolbox. Routes allowlisted status, diff, readiness, branch, stage, commit, and push actions without accepting raw git commands.",
    inputSchema: toolboxInputSchema
  },
  {
    name: "artifact_toolbox",
    description:
      "Stable artifact toolbox. Routes allowlisted Builder Report, release-summary, package-summary, and handoff-prompt actions through existing safeguards.",
    inputSchema: toolboxInputSchema
  },
  {
    name: "diagnostics_toolbox",
    description:
      "Stable diagnostics toolbox. Returns redacted runtime, write-access, tool-exposure, OAuth-scope, ChatGPT-discovery, and public-safety status.",
    inputSchema: toolboxInputSchema
  },
  {
    name: "integration_toolbox",
    description:
      "Stable integration toolbox. Provides an allowlisted service broker for status, capabilities, configuration checks, and handoff artifacts; it is not arbitrary upstream MCP passthrough.",
    inputSchema: toolboxInputSchema
  },
  {
    name: "browser_toolbox",
    description:
      "Stable constrained browser-validation toolbox. Reports safe capabilities and configured endpoint validation guidance without browser automation or arbitrary browsing.",
    inputSchema: toolboxInputSchema
  },
  {
    name: "knowledge_toolbox",
    description:
      "Stable knowledge toolbox. Reports safe project reference capabilities without web fetches, connector scraping, hidden memory writes, or external document retrieval.",
    inputSchema: toolboxInputSchema
  },
  {
    name: "git_status",
    description: "Return git status --short and the current branch for an allowed root.",
    inputSchema: {
      type: "object",
      properties: {
        root: rootSchema
      },
      required: ["root"]
    }
  },
  {
    name: "git_diff",
    description: "Return git diff or git diff --staged for an allowed root with byte truncation.",
    inputSchema: {
      type: "object",
      properties: {
        root: rootSchema,
        staged: { type: "boolean", default: false },
        maxBytes: { type: "integer", default: 300000, minimum: 1, maximum: 5000000 }
      },
      required: ["root"]
    }
  },
  {
    name: "pre_commit_safety_scan",
    description: "Run public-repo safety scans for staged files, working-tree changes, or selected paths without staging or committing anything.",
    inputSchema: {
      type: "object",
      properties: {
        root: rootSchema,
        mode: { type: "string", enum: ["staged", "working-tree", "paths"], default: "staged" },
        paths: { type: "array", maxItems: 200, items: relativePathSchema }
      },
      required: ["root"]
    }
  },
  {
    name: "get_commit_readiness",
    description: "Return read-only commit/push readiness status.",
    inputSchema: {
      type: "object",
      properties: {
        root: rootSchema,
        targetBranch: { type: "string", enum: ["dev", "feature", "main"] }
      },
      required: ["root", "targetBranch"]
    }
  },
  {
    name: "prepare_git_work_branch",
    description:
      "Prepare dev or a Work Card feature branch using fixed git branch operations. Requires a clean working tree, OAuth files.write, and writeMode elevated; refuses main as the active work target.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: workspaceIdSchema,
        branchKind: { type: "string", enum: ["dev", "feature"] },
        workCardId: workCardIdSchema,
        slug: branchSlugSchema,
        baseBranch: { type: "string", enum: ["main", "dev"] },
        createIfMissing: { type: "boolean", default: true }
      },
      required: ["branchKind"]
    }
  },
  {
    name: "safe_stage_changes",
    description:
      "Stage only files that pass public-repo safety rules. Never stages local config, logs, generated output, release artifacts, dist, node_modules, .env, or ignored files.",
    inputSchema: {
      type: "object",
      properties: {
        root: rootSchema,
        mode: { type: "string", enum: ["all-safe", "paths"] },
        paths: { type: "array", maxItems: 200, items: relativePathSchema }
      },
      required: ["root", "mode"]
    }
  },
  {
    name: "commit_validated_changes",
    description: "Create a local git commit from already staged files only after pre-commit safety scan passes. Refuses main branch by default.",
    inputSchema: {
      type: "object",
      properties: {
        root: rootSchema,
        message: { ...textSchema, minLength: 1, maxLength: 10000 },
        targetBranch: { type: "string", enum: ["dev", "feature", "main"] },
        allowMainCommit: { type: "boolean", default: false }
      },
      required: ["root", "message", "targetBranch"]
    }
  },
  {
    name: "push_current_branch",
    description: "Push the current branch to origin using standard non-forcing behavior. Refuses main by default.",
    inputSchema: {
      type: "object",
      properties: {
        root: rootSchema,
        remote: { type: "string", enum: ["origin"] },
        setUpstream: { type: "boolean" },
        allowMainPush: { type: "boolean", default: false }
      },
      required: ["root", "remote", "setUpstream"]
    }
  },
  {
    name: "run_allowed_script",
    description: "Internal/elevated exception for exact allowlisted maintenance tasks with required elevated approval. Never available in docs or patch mode.",
    inputSchema: {
      type: "object",
      properties: {
        root: rootSchema,
        command: { ...textSchema, maxLength: MAX_COMMAND_LENGTH },
        timeoutSeconds: { type: "integer", default: 120, minimum: 1, maximum: 600 },
        approvalToken: approvalTokenSchema
      },
      required: ["root", "command", "approvalToken"]
    }
  }
] as const;

export type RegisteredToolName = (typeof tools)[number]["name"];

export const READ_TOOL_NAMES = [
  "list_project_files",
  "read_project_file",
  "search_project_files",
  "git_status",
  "git_diff",
  "get_workspace_status_summary",
  "get_change_set_readiness_summary",
  "get_release_artifact_summary",
  "get_release_publication_summary",
  "get_builder_report_index",
  "get_builder_report_summary",
  ...TOOLBOX_TOOL_NAMES,
  "get_write_access_status",
  "pre_commit_safety_scan",
  "get_commit_readiness"
] as const satisfies readonly RegisteredToolName[];

export const WRITE_TOOL_NAMES = [
  "propose_patch",
  "apply_approved_patch",
  "write_markdown_artifact",
  "write_json_artifact",
  "run_allowed_script",
  "prepare_git_work_branch",
  "safe_stage_changes",
  "commit_validated_changes",
  "push_current_branch"
] as const satisfies readonly RegisteredToolName[];

const READ_TOOL_NAME_SET = new Set<string>(READ_TOOL_NAMES);
const WRITE_TOOL_NAME_SET = new Set<string>(WRITE_TOOL_NAMES);
const PUBLIC_TOOL_NAME_SET = new Set<string>(TOOLBOX_TOOL_NAMES);
const TOOL_NAME_PATTERN = /^[A-Za-z0-9._-]{1,128}$/u;
const SUPPORTED_JSON_SCHEMA_KEYS = new Set([
  "type",
  "properties",
  "required",
  "items",
  "enum",
  "default",
  "description",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
  "additionalProperties"
]);
const CHATGPT_SCHEMA_KEYS_TO_KEEP = new Set(["type", "properties", "required", "items", "enum", "description", "additionalProperties"]);
const CHATGPT_SCHEMA_KEYS_TO_DROP = new Set(["default", "minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems"]);

export interface ToolExposureOptions {
  scope?: string;
  id?: string | number | null;
}

export interface InvalidToolSchemaDiagnostic {
  name: string;
  reason: string;
}

export interface ScopeFilteredToolDiagnostic {
  name: string;
  reason: string;
}

interface ToolValidationRecord {
  tool: (typeof tools)[number];
  errors: string[];
}

interface ChatGptSanitizedToolRecord {
  tool: Tool;
  removedKeywords: string[];
  errors: string[];
}

export function isReadToolName(toolName: string): boolean {
  return READ_TOOL_NAME_SET.has(toolName);
}

export function isWriteToolName(toolName: string): boolean {
  return WRITE_TOOL_NAME_SET.has(toolName);
}

export function getRegisteredToolNames(): string[] {
  return tools.map((tool) => tool.name);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function validateJsonValue(value: unknown, path: string, errors: string[]): void {
  if (value === undefined) {
    errors.push(`${path} must not be undefined.`);
    return;
  }

  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    errors.push(`${path} must be JSON-serializable.`);
    return;
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    errors.push(`${path} must be a finite number.`);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateJsonValue(entry, `${path}[${index}]`, errors));
    return;
  }

  if (value && typeof value === "object") {
    if (!isPlainObject(value)) {
      errors.push(`${path} must be a plain JSON object.`);
      return;
    }

    for (const [key, nestedValue] of Object.entries(value)) {
      validateJsonValue(nestedValue, `${path}.${key}`, errors);
    }
  }
}

function validateSchemaObject(schema: unknown, path: string, errors: string[], root = false): void {
  if (!isPlainObject(schema)) {
    errors.push(`${path} must be a JSON object.`);
    return;
  }

  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_JSON_SCHEMA_KEYS.has(key)) {
      errors.push(`${path}.${key} uses unsupported JSON Schema keyword "${key}".`);
    }
  }

  if (root && schema.type !== "object") {
    errors.push(`${path}.type must be "object".`);
  }

  if (schema.type !== undefined) {
    const allowedTypes = ["string", "number", "integer", "boolean", "object", "array", "null"];
    if (typeof schema.type !== "string" || !allowedTypes.includes(schema.type)) {
      errors.push(`${path}.type must be a supported JSON Schema primitive type.`);
    }
  }

  if (schema.properties !== undefined) {
    if (!isPlainObject(schema.properties)) {
      errors.push(`${path}.properties must be an object.`);
    } else {
      for (const [propertyName, propertySchema] of Object.entries(schema.properties)) {
        validateSchemaObject(propertySchema, `${path}.properties.${propertyName}`, errors);
      }
    }
  }

  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || schema.required.some((entry) => typeof entry !== "string")) {
      errors.push(`${path}.required must be an array of strings.`);
    } else if (isPlainObject(schema.properties)) {
      for (const requiredName of schema.required) {
        if (!(requiredName in schema.properties)) {
          errors.push(`${path}.required includes "${requiredName}" but no matching property exists.`);
        }
      }
    }
  }

  if (schema.items !== undefined) {
    validateSchemaObject(schema.items, `${path}.items`, errors);
  }

  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
    errors.push(`${path}.enum must be a non-empty array when present.`);
  }

  if (schema.default !== undefined && Array.isArray(schema.enum) && !schema.enum.some((entry) => Object.is(entry, schema.default))) {
    errors.push(`${path}.default must be one of ${path}.enum when both are present.`);
  }

  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") {
    validateSchemaObject(schema.additionalProperties, `${path}.additionalProperties`, errors);
  }
}

function validateToolDefinition(tool: (typeof tools)[number], seenToolNames: Set<string>): ToolValidationRecord {
  const errors: string[] = [];
  validateJsonValue(tool, tool.name || "<unnamed tool>", errors);

  if (typeof tool.name !== "string" || !TOOL_NAME_PATTERN.test(tool.name)) {
    errors.push("Tool name must be 1-128 characters and contain only letters, numbers, underscore, dash, or dot.");
  }

  if (seenToolNames.has(tool.name)) {
    errors.push(`Duplicate tool name "${tool.name}".`);
  }
  seenToolNames.add(tool.name);

  const parsedTool = ToolSchema.safeParse(tool);
  if (!parsedTool.success) {
    errors.push(parsedTool.error.issues.map((issue) => `${issue.path.join(".") || "tool"}: ${issue.message}`).join("; "));
  }

  validateSchemaObject(tool.inputSchema, `${tool.name}.inputSchema`, errors, true);
  return {
    tool,
    errors
  };
}

function validateRegisteredTools(): ToolValidationRecord[] {
  const seenToolNames = new Set<string>();
  return tools.map((tool) => validateToolDefinition(tool, seenToolNames));
}

function sanitizeJsonSchemaForChatGpt(schema: unknown, path: string, removedKeywords: Set<string>, errors: string[], root = false): unknown {
  if (!isPlainObject(schema)) {
    errors.push(`${path} must be a JSON object.`);
    return {};
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (CHATGPT_SCHEMA_KEYS_TO_DROP.has(key)) {
      removedKeywords.add(key);
      continue;
    }

    if (!CHATGPT_SCHEMA_KEYS_TO_KEEP.has(key)) {
      errors.push(`${path}.${key} uses unsupported ChatGPT schema keyword "${key}".`);
      continue;
    }

    if (key === "properties") {
      if (!isPlainObject(value)) {
        errors.push(`${path}.properties must be an object.`);
        continue;
      }

      sanitized.properties = Object.fromEntries(
        Object.entries(value).map(([propertyName, propertySchema]) => [
          propertyName,
          sanitizeJsonSchemaForChatGpt(propertySchema, `${path}.properties.${propertyName}`, removedKeywords, errors)
        ])
      );
      continue;
    }

    if (key === "items") {
      sanitized.items = sanitizeJsonSchemaForChatGpt(value, `${path}.items`, removedKeywords, errors);
      continue;
    }

    if (key === "additionalProperties") {
      if (typeof value === "boolean") {
        sanitized.additionalProperties = value;
      } else {
        sanitized.additionalProperties = sanitizeJsonSchemaForChatGpt(value, `${path}.additionalProperties`, removedKeywords, errors);
      }
      continue;
    }

    sanitized[key] = value;
  }

  if (root) {
    sanitized.type = "object";
  }

  if (sanitized.type === "object" && sanitized.additionalProperties === undefined) {
    sanitized.additionalProperties = false;
  }

  return sanitized;
}

function sanitizeToolForChatGpt(tool: (typeof tools)[number]): ChatGptSanitizedToolRecord {
  const removedKeywords = new Set<string>();
  const errors: string[] = [];
  const sanitizedTool = {
    name: tool.name,
    description: tool.description,
    inputSchema: sanitizeJsonSchemaForChatGpt(tool.inputSchema, `${tool.name}.inputSchema`, removedKeywords, errors, true)
  };

  const parsed = ToolSchema.safeParse(sanitizedTool);
  if (!parsed.success) {
    errors.push(parsed.error.issues.map((issue) => `${issue.path.join(".") || "tool"}: ${issue.message}`).join("; "));
  }

  return {
    tool: parsed.success ? parsed.data : sanitizedTool as Tool,
    removedKeywords: [...removedKeywords].sort(),
    errors
  };
}

function scopeFilterReason(toolName: string, scope: string, config: AppConfig): string | undefined {
  if (isReadToolName(toolName) && !scopeIncludes(scope, "files.read")) {
    return "missing OAuth scope files.read";
  }

  if (isWriteToolName(toolName)) {
    if (!scopeIncludes(scope, "files.write")) {
      return "missing OAuth scope files.write";
    }

    try {
      assertWriteToolEnabled(toolName, config);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  return undefined;
}

export function createMcpToolsListResult(config: AppConfig, options: ToolExposureOptions = {}) {
  const diagnostics = getToolExposureDiagnostics(config, options);
  const result = {
    tools: diagnostics.exposedTools
  };
  ListToolsResultSchema.parse(result);
  return result;
}

export function serializeMcpToolsListPayload(config: AppConfig, options: ToolExposureOptions & { id?: string | number | null } = {}): string {
  return JSON.stringify(
    {
      jsonrpc: "2.0",
      id: options.id ?? 1,
      result: createMcpToolsListResult(config, options)
    },
    null,
    2
  );
}

export function getToolExposureDiagnostics(config: AppConfig, options: ToolExposureOptions = {}) {
  const scope = options.scope ?? "files.read files.write";
  const registeredToolNames = getRegisteredToolNames();
  const validationRecords = validateRegisteredTools();
  const invalidToolSchemas = validationRecords
    .filter((record) => record.errors.length > 0)
    .map((record) => ({
      name: record.tool.name,
      reason: record.errors.join(" ")
    }));
  const validTools = validationRecords.filter((record) => record.errors.length === 0).map((record) => record.tool);
  const publicTools = validTools.filter((tool) => PUBLIC_TOOL_NAME_SET.has(tool.name));
  const sanitizedRecords = publicTools.map(sanitizeToolForChatGpt);
  const invalidChatGptToolSchemas = sanitizedRecords
    .filter((record) => record.errors.length > 0)
    .map((record) => ({
      name: record.tool.name,
      reason: record.errors.join(" ")
    }));
  const chatGptCompatibleTools = sanitizedRecords.filter((record) => record.errors.length === 0).map((record) => record.tool);
  const scopeFilteredTools: ScopeFilteredToolDiagnostic[] = [];
  const exposedTools = chatGptCompatibleTools.filter((tool) => {
    const reason = scopeFilterReason(tool.name, scope, config);
    if (reason) {
      scopeFilteredTools.push({
        name: tool.name,
        reason
      });
      return false;
    }

    return true;
  });

  return {
    scope,
    internalRegisteredToolCount: registeredToolNames.length,
    schemaValidToolCount: validTools.length,
    schemaValidExposedToolCount: exposedTools.length,
    chatGptCompatibleToolCount: chatGptCompatibleTools.length,
    scopeFilteredToolCount: scopeFilteredTools.length,
    internalToolNames: registeredToolNames,
    exposedToolNames: exposedTools.map((tool) => tool.name),
    finalChatGptFacingToolNames: exposedTools.map((tool) => tool.name),
    exposedTools: exposedTools as unknown as Tool[],
    invalidToolSchemas,
    invalidChatGptToolSchemas,
    sanitizedToolSchemas: sanitizedRecords
      .filter((record) => record.removedKeywords.length > 0)
      .map((record) => ({
        name: record.tool.name,
        removedKeywords: record.removedKeywords
      })),
    scopeFilteredTools,
    serializedToolsListPayload: serializeMcpToolsListPayloadWithoutRecursing(exposedTools, options.id ?? 1),
    readToolNames: [...READ_TOOL_NAMES],
    writeToolNames: [...WRITE_TOOL_NAMES],
    writeToolNamesBlockedByLocalMode: WRITE_TOOL_NAMES.filter((toolName) => {
      try {
        assertWriteToolEnabled(toolName, config);
        return false;
      } catch {
        return true;
      }
    }),
    writeMode: config.writeMode,
    writeModeSource: config.writeModeSource
  };
}

function serializeMcpToolsListPayloadWithoutRecursing(exposedTools: readonly unknown[], id: string | number | null): string {
  return JSON.stringify(
    {
      jsonrpc: "2.0",
      id,
      result: {
        tools: exposedTools
      }
    },
    null,
    2
  );
}

function toolResponse(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2)
      }
    ]
  };
}

function toolErrorResponse(error: unknown) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: serializeError(error) }, null, 2)
      }
    ]
  };
}

export function assertWriteToolEnabled(toolName: string, config: AppConfig): void {
  if (toolName === "write_markdown_artifact" && !config.docsWritesAllowed) {
    throw new AppError("APPROVAL_REQUIRED", "write_markdown_artifact requires writeMode docs, patch, or elevated.");
  }

  if (toolName === "write_json_artifact" && !config.docsWritesAllowed) {
    throw new AppError("APPROVAL_REQUIRED", "write_json_artifact requires writeMode docs, patch, or elevated.");
  }

  if (toolName === "apply_approved_patch" && !config.patchWritesAllowed) {
    throw new AppError("APPROVAL_REQUIRED", "apply_approved_patch requires writeMode patch or elevated.");
  }

  if (toolName === "run_allowed_script" && !config.elevatedOperationsAllowed) {
    throw new AppError("APPROVAL_REQUIRED", "run_allowed_script requires writeMode elevated.");
  }

  if (
    (toolName === "prepare_git_work_branch" ||
      toolName === "safe_stage_changes" ||
      toolName === "commit_validated_changes" ||
      toolName === "push_current_branch" ||
      toolName === "integrate_to_dev") &&
    !config.elevatedOperationsAllowed
  ) {
    throw new AppError("APPROVAL_REQUIRED", `${toolName} requires writeMode elevated.`);
  }
}

export function createToolboxRuntimeContext(config: AppConfig, options: ToolExposureOptions = {}): ToolboxRuntimeContext {
  const diagnostics = getToolExposureDiagnostics(config, options);
  return {
    callerScope: diagnostics.scope,
    internalRegisteredToolCount: diagnostics.internalRegisteredToolCount,
    schemaValidExposedToolCount: diagnostics.schemaValidExposedToolCount,
    scopeFilteredToolCount: diagnostics.scopeFilteredToolCount,
    registeredToolNames: diagnostics.internalToolNames,
    readToolNames: diagnostics.readToolNames,
    writeToolNames: diagnostics.writeToolNames,
    exposedToolNames: diagnostics.exposedToolNames,
    writeToolNamesBlockedByLocalMode: diagnostics.writeToolNamesBlockedByLocalMode,
    scopeFilteredTools: diagnostics.scopeFilteredTools,
    assertWriteToolEnabled: (toolName: string) => assertWriteToolEnabled(toolName, config)
  };
}

export function registerTools(server: Server, config: AppConfig, exposureOptions: ToolExposureOptions = {}): void {
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: []
  }));

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: []
  }));

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const diagnostics = getToolExposureDiagnostics(config, exposureOptions);
    for (const invalidTool of [...diagnostics.invalidToolSchemas, ...diagnostics.invalidChatGptToolSchemas]) {
      console.warn(`MCP tool schema invalid; excluding ${invalidTool.name}: ${invalidTool.reason}`);
    }

    return {
      tools: diagnostics.exposedTools
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {};

    try {
      if (!PUBLIC_TOOL_NAME_SET.has(request.params.name)) {
        throw new AppError("INVALID_INPUT", "Tool is not exposed on the public toolbox surface.", {
          publicTools: [...TOOLBOX_TOOL_NAMES]
        });
      }

      assertWriteToolEnabled(request.params.name, config);
      const toolboxContext = () => createToolboxRuntimeContext(config, exposureOptions);

      switch (request.params.name) {
        case "repo_toolbox":
          return toolResponse(await repoToolbox(args, config, toolboxContext()));
        case "git_toolbox":
          return toolResponse(await gitToolbox(args, config, toolboxContext()));
        case "artifact_toolbox":
          return toolResponse(await artifactToolbox(args, config, toolboxContext()));
        case "diagnostics_toolbox":
          return toolResponse(await diagnosticsToolbox(args, config, toolboxContext()));
        case "integration_toolbox":
          return toolResponse(await integrationToolbox(args, config, toolboxContext()));
        case "browser_toolbox":
          return toolResponse(await browserToolbox(args, config));
        case "knowledge_toolbox":
          return toolResponse(await knowledgeToolbox(args, config));
        default:
          return toolErrorResponse(new Error(`Unknown tool: ${request.params.name}`));
      }
    } catch (error) {
      return toolErrorResponse(error);
    }
  });
}
