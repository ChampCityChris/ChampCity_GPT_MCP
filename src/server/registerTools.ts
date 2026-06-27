import { type Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { type AppConfig } from "../config.js";
import { applyApprovedPatch } from "../tools/applyApprovedPatch.js";
import { getWriteAccessStatus } from "../tools/getWriteAccessStatus.js";
import { gitDiff } from "../tools/gitDiff.js";
import { gitStatus } from "../tools/gitStatus.js";
import {
  MAX_APPROVAL_TOKEN_LENGTH,
  MAX_COMMAND_LENGTH,
  MAX_GLOB_LENGTH,
  MAX_MARKDOWN_ARTIFACT_CONTENT_LENGTH,
  MAX_PATCH_LENGTH,
  MAX_PROPOSE_PATCH_TEXT_LENGTH,
  MAX_QUERY_LENGTH,
  MAX_RELATIVE_PATH_LENGTH,
  MAX_ROOT_LENGTH
} from "../tools/inputLimits.js";
import { listProjectFiles } from "../tools/listProjectFiles.js";
import { proposePatch } from "../tools/proposePatch.js";
import { readProjectFile } from "../tools/readProjectFile.js";
import { runAllowedScript } from "../tools/runAllowedScript.js";
import { searchProjectFiles } from "../tools/searchProjectFiles.js";
import { writeMarkdownArtifact } from "../tools/writeMarkdownArtifact.js";
import { serializeError, AppError } from "../utils/errors.js";

const textSchema = { type: "string" };
const rootSchema = { type: "string", maxLength: MAX_ROOT_LENGTH, description: "Absolute configured allowed root." };
const relativePathSchema = { ...textSchema, maxLength: MAX_RELATIVE_PATH_LENGTH };
const approvalTokenSchema = { ...textSchema, maxLength: MAX_APPROVAL_TOKEN_LENGTH };

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
    name: "get_write_access_status",
    description: "Return the server-side write-mode status without exposing secrets.",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
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
    name: "run_allowed_script",
    description: "Run only allowlisted commands in elevated write mode with required elevated approval. Never available in docs or patch mode.",
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

  if (toolName === "apply_approved_patch" && !config.patchWritesAllowed) {
    throw new AppError("APPROVAL_REQUIRED", "apply_approved_patch requires writeMode patch or elevated.");
  }

  if (toolName === "run_allowed_script" && !config.elevatedOperationsAllowed) {
    throw new AppError("APPROVAL_REQUIRED", "run_allowed_script requires writeMode elevated.");
  }
}

export function registerTools(server: Server, config: AppConfig): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {};

    try {
      assertWriteToolEnabled(request.params.name, config);

      switch (request.params.name) {
        case "list_project_files":
          return toolResponse(await listProjectFiles(args, config));
        case "read_project_file":
          return toolResponse(await readProjectFile(args, config));
        case "search_project_files":
          return toolResponse(await searchProjectFiles(args, config));
        case "get_write_access_status":
          return toolResponse(await getWriteAccessStatus(args, config));
        case "propose_patch":
          return toolResponse(await proposePatch(args, config));
        case "apply_approved_patch":
          return toolResponse(await applyApprovedPatch(args, config));
        case "write_markdown_artifact":
          return toolResponse(await writeMarkdownArtifact(args, config));
        case "git_status":
          return toolResponse(await gitStatus(args, config));
        case "git_diff":
          return toolResponse(await gitDiff(args, config));
        case "run_allowed_script":
          return toolResponse(await runAllowedScript(args, config));
        default:
          return toolErrorResponse(new Error(`Unknown tool: ${request.params.name}`));
      }
    } catch (error) {
      return toolErrorResponse(error);
    }
  });
}
