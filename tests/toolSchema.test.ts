import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ListToolsResultSchema, ToolSchema } from "@modelcontextprotocol/sdk/types.js";

import { createMcpToolsListResult, getToolExposureDiagnostics, isReadToolName, isWriteToolName, serializeMcpToolsListPayload, tools } from "../src/server/registerTools.js";
import { type AppConfig } from "../src/config.js";

type TestToolSchema = {
  name: string;
  description: string;
  inputSchema: {
    required?: readonly string[];
    properties?: Record<string, unknown>;
  };
};

function tool(name: string): TestToolSchema {
  const found = tools.find((entry) => entry.name === name);
  assert.ok(found, `Expected tool to be exposed: ${name}`);
  return found as unknown as TestToolSchema;
}

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

const publicSafeFacadeToolNames = [
  "get_workspace_status_summary",
  "get_change_set_readiness_summary",
  "get_release_artifact_summary",
  "get_release_publication_summary",
  "get_builder_report_index",
  "get_builder_report_summary"
] as const;

const toolboxToolNames = [
  "repo_toolbox",
  "git_toolbox",
  "artifact_toolbox",
  "diagnostics_toolbox",
  "integration_toolbox",
  "browser_toolbox",
  "knowledge_toolbox"
] as const;

const mutationInputFields = new Set([
  "root",
  "absolutePath",
  "command",
  "script",
  "shell",
  "args",
  "argv",
  "glob",
  "absoluteOutputPath",
  "approvalToken",
  "force",
  "reset",
  "merge",
  "rebase",
  "stash",
  "delete",
  "clobber"
]);

const unsafeBranchToolFields = new Set([
  "root",
  "absolutePath",
  "branchName",
  "targetBranch",
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
  "clobber"
]);

const forbiddenToolboxFields = new Set([
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

const riskyDescriptionPhrases = [
  "arbitrary command",
  "run command",
  "execute shell",
  "PowerShell",
  "force push",
  "delete tag",
  "clobber"
];

describe("MCP tool schemas", () => {
  it("exposes write_markdown_artifact with optional approvalToken", () => {
    const writeMarkdown = tool("write_markdown_artifact");

    assert.deepEqual(writeMarkdown.inputSchema.required, ["root", "relativePath", "content"]);
    assert.ok(writeMarkdown.inputSchema.properties?.approvalToken);
    assert.equal(writeMarkdown.description.includes("Does not require approvalToken"), true);
  });

  it("exposes patch proposal flow fields without requiring approvalToken", () => {
    const propose = tool("propose_patch");
    const apply = tool("apply_approved_patch");

    assert.match(propose.description, /register a short-lived patch proposal/i);
    assert.match(propose.description, /proposalId\/patchHash/i);
    assert.deepEqual(apply.inputSchema.required, ["root", "patch"]);
    assert.ok(apply.inputSchema.properties?.proposalId);
    assert.ok(apply.inputSchema.properties?.patchHash);
    assert.ok(apply.inputSchema.properties?.approvalToken);
    assert.match(apply.description, /matches a registered proposal from propose_patch/i);
  });

  it("exposes get_write_access_status and keeps run_allowed_script elevated gated", () => {
    const status = tool("get_write_access_status");
    const script = tool("run_allowed_script");

    assert.deepEqual(status.inputSchema.required, []);
    assert.match(status.description, /without exposing secrets/i);
    assert.deepEqual(script.inputSchema.required, ["root", "command", "approvalToken"]);
    assert.match(script.description, /Internal\/elevated exception/i);
    assert.match(script.description, /Never available in docs or patch mode/i);
  });

  it("registers the public-safe read-only facade tools with narrow schemas", () => {
    for (const toolName of publicSafeFacadeToolNames) {
      const facade = tool(toolName);
      const properties = facade.inputSchema.properties ?? {};

      assert.equal(isReadToolName(toolName), true, `${toolName} should require files.read`);
      assert.equal(isWriteToolName(toolName), false, `${toolName} must not be a write tool`);
      assert.match(facade.description, /^Read-only\./u);
      assert.match(facade.description, /Does not modify repository files, git state, release state, or configuration\./u);

      for (const fieldName of Object.keys(properties)) {
        assert.equal(mutationInputFields.has(fieldName), false, `${toolName} must not expose mutation field ${fieldName}`);
      }
    }

    assert.deepEqual(tool("get_workspace_status_summary").inputSchema.required, []);
    assert.deepEqual(tool("get_change_set_readiness_summary").inputSchema.required, []);
    assert.deepEqual(tool("get_release_artifact_summary").inputSchema.required, ["releaseVersion"]);
    assert.deepEqual(tool("get_release_publication_summary").inputSchema.required, ["tagName"]);
    assert.deepEqual(tool("get_builder_report_index").inputSchema.required, []);
    assert.deepEqual(tool("get_builder_report_summary").inputSchema.required, []);
    assert.ok(tool("get_release_artifact_summary").inputSchema.properties?.releaseVersion);
    assert.ok(tool("get_release_publication_summary").inputSchema.properties?.tagName);
    assert.ok(tool("get_builder_report_index").inputSchema.properties?.workspaceId);
    assert.ok(tool("get_builder_report_index").inputSchema.properties?.phaseFolder);
    assert.ok(tool("get_builder_report_index").inputSchema.properties?.workCardId);
    assert.ok(tool("get_builder_report_index").inputSchema.properties?.maxResults);
    assert.ok(tool("get_builder_report_summary").inputSchema.properties?.reportPath);
    assert.ok(tool("get_builder_report_summary").inputSchema.properties?.maxChars);
    assert.equal("glob" in (tool("get_release_artifact_summary").inputSchema.properties ?? {}), false);
    assert.equal("command" in (tool("get_release_publication_summary").inputSchema.properties ?? {}), false);
    assert.equal("root" in (tool("get_builder_report_index").inputSchema.properties ?? {}), false);
    assert.equal("glob" in (tool("get_builder_report_index").inputSchema.properties ?? {}), false);
    assert.equal("absolutePath" in (tool("get_builder_report_summary").inputSchema.properties ?? {}), false);
    assert.equal("approvalToken" in (tool("get_builder_report_summary").inputSchema.properties ?? {}), false);
  });

  it("keeps public-facing tool descriptions free of risky phrases", () => {
    for (const registeredTool of tools) {
      for (const phrase of riskyDescriptionPhrases) {
        assert.doesNotMatch(registeredTool.description, new RegExp(phrase, "iu"), `${registeredTool.name} description contains ${phrase}`);
      }
    }
  });

  it("registers stable domain toolbox tools as read-visible narrow action dispatchers", () => {
    for (const toolName of toolboxToolNames) {
      const toolbox = tool(toolName);
      const properties = toolbox.inputSchema.properties ?? {};

      assert.equal(isReadToolName(toolName), true, `${toolName} should be visible with files.read`);
      assert.equal(isWriteToolName(toolName), false, `${toolName} must enforce write actions internally`);
      assert.deepEqual(toolbox.inputSchema.required, ["action"]);
      assert.deepEqual(Object.keys(properties).sort(), ["action", "params", "workspaceId"]);
      assert.ok(properties.action);
      assert.ok(properties.workspaceId);
      assert.ok(properties.params);

      for (const fieldName of Object.keys(properties)) {
        assert.equal(forbiddenToolboxFields.has(fieldName), false, `${toolName} must not expose forbidden field ${fieldName}`);
      }
    }

    assert.equal((tools as readonly { name: string }[]).some((entry) => entry.name === "figma_toolbox"), false);
  });

  it("exposes narrow git workflow tools", () => {
    const prepareBranch = tool("prepare_git_work_branch");

    assert.equal(isReadToolName("prepare_git_work_branch"), false);
    assert.equal(isWriteToolName("prepare_git_work_branch"), true);
    assert.deepEqual(prepareBranch.inputSchema.required, ["branchKind"]);
    assert.deepEqual(prepareBranch.inputSchema.properties?.branchKind, { type: "string", enum: ["dev", "feature"] });
    assert.deepEqual(prepareBranch.inputSchema.properties?.baseBranch, { type: "string", enum: ["main", "dev"] });
    assert.ok(prepareBranch.inputSchema.properties?.workspaceId);
    assert.ok(prepareBranch.inputSchema.properties?.workCardId);
    assert.ok(prepareBranch.inputSchema.properties?.slug);
    assert.ok(prepareBranch.inputSchema.properties?.createIfMissing);
    assert.match(prepareBranch.description, /Requires a clean working tree/i);
    assert.match(prepareBranch.description, /refuses main as the active work target/i);
    for (const fieldName of Object.keys(prepareBranch.inputSchema.properties ?? {})) {
      assert.equal(unsafeBranchToolFields.has(fieldName), false, `prepare_git_work_branch must not expose ${fieldName}`);
    }

    assert.match(tool("safe_stage_changes").description, /Never stages local config, logs, generated output, release artifacts, dist, node_modules, \.env, or ignored files/i);
    assert.match(tool("commit_validated_changes").description, /already staged files only/i);
    assert.match(tool("commit_validated_changes").description, /Refuses main branch by default/i);
    assert.match(tool("push_current_branch").description, /standard non-forcing behavior/i);
    assert.match(tool("push_current_branch").description, /Refuses main by default/i);
    assert.match(tool("get_commit_readiness").description, /read-only commit\/push readiness/i);
    assert.match(tool("pre_commit_safety_scan").description, /without staging or committing/i);
  });

  it("exposes Figma handoff tools with precise write requirements", () => {
    assert.deepEqual(tool("get_figma_status").inputSchema.required, []);
    assert.deepEqual(tool("parse_figma_url").inputSchema.required, ["url"]);
    assert.deepEqual(tool("fetch_figma_file_summary").inputSchema.required, ["fileKey"]);
    assert.match(tool("fetch_figma_file_summary").description, /summary only|compact metadata summary/i);

    const image = tool("fetch_figma_frame_image");
    assert.deepEqual(image.inputSchema.required, ["root", "fileKey", "nodeId", "format", "scale", "relativeOutputPath"]);
    assert.match(image.description, /OAuth files\.write/i);
    assert.match(image.description, /writeMode docs, patch, or elevated/i);

    assert.match(tool("create_figma_handoff_package").description, /Writes Markdown specs, design tokens, screenshots/i);
    assert.match(tool("create_figma_handoff_package").description, /never includes the Figma token/i);
    assert.match(tool("create_codex_ui_handoff_prompt").description, /Codex-ready UI implementation prompt/i);

    const make = tool("run_figma_make_handoff");
    assert.deepEqual(make.inputSchema.required, ["makeUrl"]);
    assert.ok(make.inputSchema.properties?.targetUiArea);
    assert.ok(make.inputSchema.properties?.outputDirectory);
    assert.ok(make.inputSchema.properties?.codexPromptFile);
    assert.match(make.description, /One-shot Figma Make handoff orchestration/i);
    assert.match(make.description, /upstream official Figma MCP server/i);
    assert.match(make.description, /retrieves Make resources\/files/i);
    assert.match(make.description, /never exposes tokens or session credentials/i);

    const makeFile = tool("run_figma_make_file_handoff");
    assert.deepEqual(makeFile.inputSchema.required, ["makeFilePath"]);
    assert.ok(makeFile.inputSchema.properties?.targetUiArea);
    assert.ok(makeFile.inputSchema.properties?.outputDirectory);
    assert.ok(makeFile.inputSchema.properties?.codexPromptFile);
    assert.match(makeFile.description, /local Figma Make \.make export handoff/i);
    assert.match(makeFile.description, /allowed roots/i);
    assert.match(makeFile.description, /reconstructs source where possible/i);
    assert.match(makeFile.description, /never uses screenshots or browser scraping/i);

    const mcp = tool("test_figma_mcp_connection");
    assert.deepEqual(mcp.inputSchema.required, []);
    assert.match(mcp.description, /upstream Figma MCP server connection/i);
    assert.ok(mcp.inputSchema.properties?.endpoint);
    assert.ok(mcp.inputSchema.properties?.mode);
  });

  it("validates every current MCP tool schema against the SDK tool schema", () => {
    const diagnostics = getToolExposureDiagnostics(testConfig({ writeMode: "elevated" }));

    assert.deepEqual(diagnostics.invalidToolSchemas, []);
    for (const registeredTool of tools) {
      assert.doesNotThrow(() => ToolSchema.parse(registeredTool), `Expected ${registeredTool.name} to match MCP ToolSchema`);
    }
  });

  it("validates the Figma Make handoff tool schemas", () => {
    assert.doesNotThrow(() => ToolSchema.parse(tool("run_figma_make_handoff")));
    assert.doesNotThrow(() => ToolSchema.parse(tool("run_figma_make_file_handoff")));
  });

  it("serializes a valid JSON-RPC tools/list payload for ChatGPT-facing diagnostics", () => {
    const config = testConfig({ writeMode: "docs" });
    const result = createMcpToolsListResult(config, { scope: "files.read files.write" });
    const payload = JSON.parse(serializeMcpToolsListPayload(config, { scope: "files.read files.write", id: 42 })) as {
      jsonrpc: string;
      id: number;
      result: unknown;
    };

    assert.equal(payload.jsonrpc, "2.0");
    assert.equal(payload.id, 42);
    assert.deepEqual(payload.result, result);
    assert.doesNotThrow(() => ListToolsResultSchema.parse(payload.result));
  });

  it("serializes ChatGPT-compatible schemas without local validation-only keywords", () => {
    const diagnostics = getToolExposureDiagnostics(testConfig({ writeMode: "docs" }), { scope: "files.read files.write" });
    const payload = JSON.parse(serializeMcpToolsListPayload(testConfig({ writeMode: "docs" }), { scope: "files.read files.write", id: 42 })) as {
      result: { tools: Array<{ name: string; inputSchema: unknown }> };
    };
    const serialized = JSON.stringify(payload.result.tools);

    assert.doesNotThrow(() => ListToolsResultSchema.parse(payload.result));
    assert.doesNotMatch(serialized, /"default"/u);
    assert.doesNotMatch(serialized, /"maxLength"/u);
    assert.doesNotMatch(serialized, /"minimum"/u);
    assert.ok(diagnostics.sanitizedToolSchemas.some((entry) => entry.name === "list_project_files" && entry.removedKeywords.includes("default")));
    assert.ok(payload.result.tools.some((entry) => entry.name === "run_figma_make_file_handoff"));
  });

  it("keeps read-only tools visible with files.read and hides write tools without files.write", () => {
    const diagnostics = getToolExposureDiagnostics(testConfig({ writeMode: "docs" }), { scope: "files.read" });

    assert.ok(diagnostics.exposedToolNames.includes("list_project_files"));
    assert.ok(diagnostics.exposedToolNames.includes("read_project_file"));
    assert.ok(diagnostics.exposedToolNames.includes("search_project_files"));
    assert.ok(diagnostics.exposedToolNames.includes("get_figma_status"));
    for (const toolName of toolboxToolNames) {
      assert.ok(diagnostics.exposedToolNames.includes(toolName), `${toolName} should remain visible with files.read`);
    }
    assert.equal(diagnostics.exposedToolNames.includes("write_markdown_artifact"), false);
    assert.equal(diagnostics.exposedToolNames.includes("run_figma_make_file_handoff"), false);
    assert.ok(diagnostics.scopeFilteredTools.some((entry) => entry.name === "run_figma_make_file_handoff" && /files\.write/u.test(entry.reason)));
  });

  it("exposes docs-mode write tools with files.read files.write but keeps elevated-only tools hidden", () => {
    const diagnostics = getToolExposureDiagnostics(testConfig({ writeMode: "docs" }), { scope: "files.read files.write" });

    assert.ok(diagnostics.exposedToolNames.includes("write_markdown_artifact"));
    assert.ok(diagnostics.exposedToolNames.includes("run_figma_make_handoff"));
    assert.ok(diagnostics.exposedToolNames.includes("run_figma_make_file_handoff"));
    assert.equal(diagnostics.exposedToolNames.includes("prepare_git_work_branch"), false);
    assert.equal(diagnostics.exposedToolNames.includes("safe_stage_changes"), false);
    assert.ok(diagnostics.scopeFilteredTools.some((entry) => entry.name === "prepare_git_work_branch" && /elevated/u.test(entry.reason)));
    assert.ok(diagnostics.scopeFilteredTools.some((entry) => entry.name === "safe_stage_changes" && /elevated/u.test(entry.reason)));
  });

  it("exposes prepare_git_work_branch only with files.write and elevated mode", () => {
    const readOnlyDiagnostics = getToolExposureDiagnostics(testConfig({ writeMode: "elevated" }), { scope: "files.read" });
    const docsDiagnostics = getToolExposureDiagnostics(testConfig({ writeMode: "docs" }), { scope: "files.read files.write" });
    const elevatedDiagnostics = getToolExposureDiagnostics(testConfig({ writeMode: "elevated" }), { scope: "files.read files.write" });

    assert.equal(readOnlyDiagnostics.exposedToolNames.includes("prepare_git_work_branch"), false);
    assert.ok(readOnlyDiagnostics.scopeFilteredTools.some((entry) => entry.name === "prepare_git_work_branch" && /files\.write/u.test(entry.reason)));
    assert.equal(docsDiagnostics.exposedToolNames.includes("prepare_git_work_branch"), false);
    assert.ok(docsDiagnostics.scopeFilteredTools.some((entry) => entry.name === "prepare_git_work_branch" && /elevated/u.test(entry.reason)));
    assert.equal(elevatedDiagnostics.exposedToolNames.includes("prepare_git_work_branch"), true);
  });

  it("excludes only a malformed tool schema from public exposure", () => {
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
      assert.equal((diagnostics.exposedToolNames as readonly string[]).includes("broken_optional_tool"), false);
      assert.ok(diagnostics.exposedToolNames.includes("list_project_files"));
      assert.ok(diagnostics.exposedToolNames.includes("read_project_file"));
      assert.ok(diagnostics.exposedToolNames.includes("search_project_files"));
      assert.ok(diagnostics.exposedToolNames.includes("get_write_access_status"));
      assert.ok(diagnostics.exposedToolNames.includes("get_figma_status"));
    } finally {
      mutableTools.pop();
    }
  });

  it("does not expose stale universal approval-token language", () => {
    const listedTools = JSON.stringify(tools);

    assert.doesNotMatch(listedTools, /approval-token, \.md-only, overwrite, and atomic-write checks/i);
    assert.doesNotMatch(listedTools, /approval token required for every write/i);
    assert.doesNotMatch(listedTools, /write approval token required/i);
  });

  it("reports internal and ChatGPT-exposed tool diagnostics from the registered tools", () => {
    const config = testConfig({ writeMode: "docs" });

    const diagnostics = getToolExposureDiagnostics(config, { scope: "files.read files.write" });
    const transportResult = createMcpToolsListResult(config, { scope: "files.read files.write" });

    assert.deepEqual(diagnostics.internalToolNames, tools.map((entry) => entry.name));
    assert.deepEqual(diagnostics.exposedToolNames, transportResult.tools.map((entry) => entry.name));
    assert.ok(diagnostics.writeToolNamesBlockedByLocalMode.includes("apply_approved_patch"));
    assert.ok(diagnostics.exposedToolNames.includes("run_figma_make_file_handoff"));
    assert.equal(diagnostics.schemaValidExposedToolCount, transportResult.tools.length);
  });
});
