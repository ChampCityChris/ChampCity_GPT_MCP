import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import type { Notification, Request } from "@modelcontextprotocol/sdk/types.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";

import {
  SUPPORTED_ARTIFACT_ACTIONS,
  SUPPORTED_TOOLBOX_ACTIONS,
  TOOLBOX_ACTION_POLICY,
  TOOLBOX_TOOL_NAMES,
  getToolboxActionPolicy,
  mappedInternalOperationForToolboxAction,
  requiredScopeForPublicToolCall
} from "../src/tools/toolboxActionPolicy.js";

describe("toolbox action policy", () => {
  it("proves the installed MCP SDK request handler metadata exposes requestId", () => {
    const declarationPath = path.join(process.cwd(), "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "shared", "protocol.d.ts");
    const declaration = fs.readFileSync(declarationPath, "utf8");
    const fixture = (extra: RequestHandlerExtra<Request, Notification>): string | number => {
      const requestId: string | number = extra.requestId;
      return requestId;
    };

    assert.match(declaration, /requestId:\s*RequestId/u);
    assert.equal(typeof fixture, "function");
  });

  it("defines every supported toolbox action exactly once and derives supported action arrays", () => {
    assert.deepEqual(TOOLBOX_TOOL_NAMES, [
      "repo_toolbox",
      "git_toolbox",
      "artifact_toolbox",
      "diagnostics_toolbox",
      "integration_toolbox",
      "browser_toolbox",
      "knowledge_toolbox"
    ]);

    for (const toolbox of TOOLBOX_TOOL_NAMES) {
      const policyActions = Object.keys(TOOLBOX_ACTION_POLICY[toolbox]);
      assert.deepEqual(SUPPORTED_TOOLBOX_ACTIONS[toolbox], policyActions, `${toolbox} action list must be derived from policy keys`);
      assert.equal(new Set(policyActions).size, policyActions.length, `${toolbox} policy must not duplicate actions`);
      for (const action of policyActions) {
        assert.equal(getToolboxActionPolicy(toolbox, action), TOOLBOX_ACTION_POLICY[toolbox][action as keyof typeof TOOLBOX_ACTION_POLICY[typeof toolbox]]);
      }
    }
  });

  it("records required scope and mapped write operation for write-capable toolbox actions", () => {
    assert.equal(requiredScopeForPublicToolCall("repo_toolbox", "read_file"), "files.read");
    assert.equal(requiredScopeForPublicToolCall("repo_toolbox", "write_markdown_artifact"), "files.write");
    assert.equal(requiredScopeForPublicToolCall("git_toolbox", "stage_paths"), "files.write");
    assert.equal(requiredScopeForPublicToolCall("diagnostics_toolbox", "workspace_safety_status"), "files.read");
    assert.equal(requiredScopeForPublicToolCall("artifact_toolbox", "create_markdown_artifact"), "files.write");
    assert.equal(requiredScopeForPublicToolCall("artifact_toolbox", "submit_handoff_outputs"), undefined);
    assert.equal(requiredScopeForPublicToolCall("integration_toolbox", "prepare_external_handoff"), "files.write");
    assert.equal(requiredScopeForPublicToolCall("browser_toolbox", "get_browser_capabilities"), "files.read");
    assert.equal(requiredScopeForPublicToolCall("unknown_tool", "write_markdown_artifact"), undefined);
    assert.equal(requiredScopeForPublicToolCall("repo_toolbox", "unknown_action"), undefined);

    assert.equal(mappedInternalOperationForToolboxAction("repo_toolbox", "write_markdown_artifact"), "write_markdown_artifact");
    assert.equal(mappedInternalOperationForToolboxAction("git_toolbox", "stage_paths"), "safe_stage_changes");
    assert.equal(mappedInternalOperationForToolboxAction("artifact_toolbox", "create_markdown_artifact"), "write_markdown_artifact");
    assert.equal(mappedInternalOperationForToolboxAction("artifact_toolbox", "submit_handoff_outputs"), undefined);
    assert.equal(mappedInternalOperationForToolboxAction("integration_toolbox", "prepare_external_handoff"), "write_markdown_artifact");
    assert.equal(mappedInternalOperationForToolboxAction("repo_toolbox", "read_file"), undefined);
  });

  it("keeps retired and unsupported handoff submission action names out of production source and action inventory", () => {
    const srcRoot = path.join(process.cwd(), "src");
    const retiredNames = [
      "saveArchitectInterviewOutput",
      "SaveArchitectInterviewOutputParamsSchema",
      "saveProjectPlanningOutputs",
      "SaveProjectPlanningOutputsParamsSchema",
      "submitHandoffOutputs",
      "SubmitHandoffOutputsParamsSchema",
      "SUPPORTED_HANDOFF_KINDS",
      "HANDOFF_OUTPUT_CONTRACT_REGISTRY"
    ];
    const retiredFiles = [
      path.join(srcRoot, "tools", "saveArchitectInterviewOutput.ts"),
      path.join(srcRoot, "tools", "saveProjectPlanningOutputs.ts"),
      path.join(srcRoot, "tools", "submitHandoffOutputs.ts"),
      path.join(srcRoot, "tools", "internal", "handoffContracts", "architectInterview.ts"),
      path.join(srcRoot, "tools", "internal", "handoffContracts", "projectPlanning.ts"),
      path.join(srcRoot, "tools", "internal", "canonicalSubmission", "canonicalMarkdown.ts")
    ];
    const files: string[] = [];
    const collect = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          collect(absolutePath);
        } else if (entry.isFile() && /\.(?:ts|tsx|js|mjs|cjs)$/u.test(entry.name)) {
          files.push(absolutePath);
        }
      }
    };
    collect(srcRoot);
    const productionSource = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");

    for (const retiredName of retiredNames) {
      assert.equal(productionSource.includes(retiredName), false, `${retiredName} must not appear in production source`);
    }
    for (const retiredFile of retiredFiles) {
      assert.equal(fs.existsSync(retiredFile), false, `${retiredFile} must not exist`);
    }
    assert.equal(SUPPORTED_ARTIFACT_ACTIONS.includes("submit_handoff_outputs" as never), false);
    assert.equal(SUPPORTED_ARTIFACT_ACTIONS.includes("save_architect_interview_output" as never), false);
    assert.equal(SUPPORTED_ARTIFACT_ACTIONS.includes("save_project_planning_outputs" as never), false);
  });

  it("tracks repo bounded-read actions and the generic artifact Markdown write action", () => {
    assert.deepEqual(SUPPORTED_TOOLBOX_ACTIONS.repo_toolbox, [
      "status",
      "list_files",
      "read_file",
      "inspect_text_file",
      "read_text_chunk",
      "read_text_lines",
      "read_markdown_section",
      "search_files",
      "write_markdown_artifact",
      "write_json_artifact",
      "propose_patch",
      "apply_approved_patch"
    ]);
    assert.ok(SUPPORTED_ARTIFACT_ACTIONS.includes("create_markdown_artifact"));
    assert.equal(SUPPORTED_ARTIFACT_ACTIONS.includes("submit_handoff_outputs" as never), false);
  });
});
