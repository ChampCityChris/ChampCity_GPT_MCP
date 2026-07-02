import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ListToolsResultSchema, ToolSchema } from "@modelcontextprotocol/sdk/types.js";

import {
  createMcpToolsListResult,
  getToolExposureDiagnostics,
  isReadToolName,
  isWriteToolName,
  serializeMcpToolsListPayload,
  tools
} from "../src/server/registerTools.js";
import { type AppConfig } from "../src/config.js";

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const writeMode = overrides.writeMode ?? "off";
  return {
    repoRoot: process.cwd(),
    allowedRoots: [process.cwd()],
    auditLogPath: "audit.log",
    requireGitRoot: false,
    allowedCommands: [],
    writeToolsEnabled: writeMode !== "off",
    writeToolsEnabledSource: "default",
    writeMode,
    writeModeSource: "default",
    docsWritesAllowed: writeMode === "docs" || writeMode === "patch" || writeMode === "elevated",
    patchWritesAllowed: writeMode === "patch" || writeMode === "elevated",
    elevatedOperationsAllowed: writeMode === "elevated",
    writeApprovalToken: { source: "none" },
    ...overrides
  } satisfies AppConfig;
}

const toolboxToolNames = [
  "repo_toolbox",
  "git_toolbox",
  "artifact_toolbox",
  "diagnostics_toolbox",
  "integration_toolbox",
  "browser_toolbox",
  "knowledge_toolbox"
] as const;

const legacyTopLevelToolNames = [
  "list_project_files",
  "read_project_file",
  "search_project_files",
  "propose_patch",
  "apply_approved_patch",
  "write_markdown_artifact",
  "git_status",
  "git_diff",
  "pre_commit_safety_scan",
  "get_commit_readiness",
  "prepare_git_work_branch",
  "safe_stage_changes",
  "commit_validated_changes",
  "push_current_branch",
  "get_workspace_status_summary",
  "get_change_set_readiness_summary",
  "get_release_artifact_summary",
  "get_release_publication_summary",
  "get_builder_report_index",
  "get_builder_report_summary",
  "get_write_access_status",
  "run_allowed_script"
] as const;

const figmaLegacyToolNames = [
  "get_figma_status",
  "parse_figma_url",
  "fetch_figma_file_summary",
  "fetch_figma_frame_image",
  "create_figma_handoff_package",
  "create_codex_ui_handoff_prompt",
  "run_figma_make_handoff",
  "run_figma_make_file_handoff",
  "test_figma_mcp_connection"
] as const;

function publicToolNames(config = testConfig({ writeMode: "elevated" }), scope = "files.read files.write"): string[] {
  return createMcpToolsListResult(config, { scope }).tools.map((entry) => entry.name);
}

describe("MCP tool schemas", () => {
  it("keeps the ChatGPT-facing tools/list surface to exactly the seven toolboxes", () => {
    for (const writeMode of ["off", "docs", "patch", "elevated"] as const) {
      assert.deepEqual(publicToolNames(testConfig({ writeMode }), "files.read"), [...toolboxToolNames]);
      assert.deepEqual(publicToolNames(testConfig({ writeMode }), "files.read files.write"), [...toolboxToolNames]);
    }
  });

  it("does not expose legacy top-level or obsolete Figma tools publicly", () => {
    const exposed = publicToolNames();

    for (const toolName of legacyTopLevelToolNames) {
      assert.equal(exposed.includes(toolName), false, `${toolName} must not be ChatGPT-visible`);
    }

    for (const toolName of figmaLegacyToolNames) {
      assert.equal(exposed.includes(toolName), false, `${toolName} must not be ChatGPT-visible`);
      assert.equal(tools.some((entry) => String(entry.name) === toolName), false, `${toolName} must be removed from registered schemas`);
    }

    assert.equal(exposed.includes("figma_toolbox"), false);
    assert.equal(tools.some((entry) => String(entry.name) === "figma_toolbox"), false);
  });

  it("registers stable domain toolbox tools as read-visible narrow action dispatchers", () => {
    for (const toolName of toolboxToolNames) {
      const toolbox = tools.find((entry) => entry.name === toolName);
      assert.ok(toolbox, `${toolName} should be registered`);
      const properties = toolbox.inputSchema.properties ?? {};

      assert.equal(isReadToolName(toolName), true, `${toolName} should be visible with files.read`);
      assert.equal(isWriteToolName(toolName), false, `${toolName} must enforce write actions internally`);
      assert.deepEqual(toolbox.inputSchema.required, ["action"]);
      assert.deepEqual(Object.keys(properties).sort(), ["action", "params", "workspaceId"]);
      assert.equal("root" in properties, false);
      assert.equal("approvalToken" in properties, false);
      assert.equal("command" in properties, false);
    }
  });

  it("validates every current registered MCP tool schema against the SDK tool schema", () => {
    const diagnostics = getToolExposureDiagnostics(testConfig({ writeMode: "elevated" }));

    assert.deepEqual(diagnostics.invalidToolSchemas, []);
    for (const registeredTool of tools) {
      assert.doesNotThrow(() => ToolSchema.parse(registeredTool), `Expected ${registeredTool.name} to match MCP ToolSchema`);
    }
  });

  it("serializes a valid JSON-RPC toolbox-only tools/list payload for ChatGPT-facing diagnostics", () => {
    const config = testConfig({ writeMode: "docs" });
    const result = createMcpToolsListResult(config, { scope: "files.read files.write" });
    const payload = JSON.parse(serializeMcpToolsListPayload(config, { scope: "files.read files.write", id: 42 })) as {
      jsonrpc: string;
      id: number;
      result: { tools: Array<{ name: string; inputSchema: unknown }> };
    };
    const serialized = JSON.stringify(payload.result.tools);

    assert.equal(payload.jsonrpc, "2.0");
    assert.equal(payload.id, 42);
    assert.deepEqual(payload.result, result);
    assert.deepEqual(payload.result.tools.map((entry) => entry.name), [...toolboxToolNames]);
    assert.doesNotThrow(() => ListToolsResultSchema.parse(payload.result));
    assert.doesNotMatch(serialized, /"default"|"maxLength"|"minimum"|"maximum"/u);
  });

  it("excludes malformed non-public schemas from public exposure without changing the seven-tool public surface", () => {
    const mutableTools = tools as unknown as Array<unknown>;
    mutableTools.push({
      name: "broken_optional_tool",
      description: "Broken test tool",
      inputSchema: {
        type: "object",
        properties: {
          broken: undefined
        },
        required: ["missingProperty"]
      }
    });

    try {
      const diagnostics = getToolExposureDiagnostics(testConfig({ writeMode: "docs" }), { scope: "files.read files.write" });
      assert.ok(diagnostics.invalidToolSchemas.some((entry) => String(entry.name) === "broken_optional_tool"));
      assert.deepEqual(diagnostics.exposedToolNames, [...toolboxToolNames]);
    } finally {
      mutableTools.pop();
    }
  });

  it("reports internal and ChatGPT-exposed tool diagnostics from the registered tools", () => {
    const config = testConfig({ writeMode: "docs" });

    const diagnostics = getToolExposureDiagnostics(config, { scope: "files.read files.write" });
    const transportResult = createMcpToolsListResult(config, { scope: "files.read files.write" });

    assert.deepEqual(diagnostics.internalToolNames, tools.map((entry) => entry.name));
    assert.deepEqual(diagnostics.exposedToolNames, transportResult.tools.map((entry) => entry.name));
    assert.deepEqual(diagnostics.finalChatGptFacingToolNames, [...toolboxToolNames]);
    assert.equal(diagnostics.schemaValidExposedToolCount, 7);
    assert.ok(diagnostics.writeToolNamesBlockedByLocalMode.includes("apply_approved_patch"));
  });
});
