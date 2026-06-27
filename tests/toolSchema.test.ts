import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { tools } from "../src/server/registerTools.js";

type ToolSchema = {
  name: string;
  description: string;
  inputSchema: {
    required?: readonly string[];
    properties?: Record<string, unknown>;
  };
};

function tool(name: string): ToolSchema {
  const found = tools.find((entry) => entry.name === name);
  assert.ok(found, `Expected tool to be exposed: ${name}`);
  return found as unknown as ToolSchema;
}

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
    assert.match(script.description, /elevated write mode/i);
    assert.match(script.description, /Never available in docs or patch mode/i);
  });

  it("does not expose stale universal approval-token language", () => {
    const listedTools = JSON.stringify(tools);

    assert.doesNotMatch(listedTools, /approval-token, \.md-only, overwrite, and atomic-write checks/i);
    assert.doesNotMatch(listedTools, /approval token required for every write/i);
    assert.doesNotMatch(listedTools, /write approval token required/i);
  });
});
