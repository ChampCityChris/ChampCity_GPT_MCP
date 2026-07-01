import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  evaluateRequiredReadToolsPresent,
  runBlockedPathDeniedCheck,
  runDocsWriteDeniedWhenOffCheck,
  runMcpSelfTest,
  type McpSelfTestReport
} from "../src/validation/mcpSelfTest.js";

let tempRoot: string;

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-mcp-self-test-test-"));
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function runCli(args: string[]): CliResult {
  const result = spawnSync(process.execPath, ["scripts/mcp-self-test.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
    windowsHide: true
  });

  return {
    status: result.status,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? "")
  };
}

function git(root: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function writeFixtureFile(root: string, relativePath: string, content: string): void {
  const absolutePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf8");
}

function initSelfTestFixtureRepo(root: string): void {
  git(root, ["init"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  git(root, ["checkout", "-b", "feature/self-test"]);
  writeFixtureFile(root, "package.json", `${JSON.stringify({ name: "champcity-self-test-fixture", version: "0.1.2" }, null, 2)}\n`);
  writeFixtureFile(
    root,
    "planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0102A_builder_report_discovery_facade.md",
    "# Builder Report - WC-V1-0102A\n\nFixture report for MCP self-test.\n"
  );
  git(root, ["add", "package.json", "planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0102A_builder_report_discovery_facade.md"]);
  git(root, ["commit", "-m", "Initial self-test fixture"]);
  writeFixtureFile(root, "dirty-working-tree-file.md", "# Dirty fixture\n");
}

function assertNoUnredactedLocalUserPath(value: unknown): void {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /[A-Z]:\\Users\\/iu);
  assert.doesNotMatch(serialized, /[A-Z]:\/Users\//iu);
  assert.doesNotMatch(serialized, /\/Users\/[^/"']+/iu);
  assert.doesNotMatch(serialized, /\/home\/[^/"']+/iu);
}

describe("MCP protocol self-test", () => {
  it("JSON mode emits valid JSON with ok, summary, and checks", () => {
    const result = runCli(["--json"]);

    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout) as McpSelfTestReport;
    assert.equal(typeof parsed.ok, "boolean");
    assert.equal(typeof parsed.summary.passed, "number");
    assert.ok(Array.isArray(parsed.checks));
    assert.ok(parsed.checks.length > 0);
    assertNoUnredactedLocalUserPath(parsed);
  });

  it("normal self-test run exits 0", () => {
    const result = runCli([]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /MCP self-test PASS/u);
  });

  it("forced missing required read tool fixture produces a failed check", () => {
    const check = evaluateRequiredReadToolsPresent(["list_project_files"], ["list_project_files"]);

    assert.equal(check.status, "FAIL");
    assert.equal(check.id, "REQUIRED_READ_TOOLS_PRESENT");
    assert.match(check.message, /missing/u);
  });

  it("write-denied fixture does not write files", async () => {
    const check = await runDocsWriteDeniedWhenOffCheck();

    assert.equal(check.status, "PASS");
    assert.equal(check.id, "DOCS_WRITE_DENIED_WHEN_OFF");
    assert.deepEqual((check.evidence as { fileWritten?: boolean }).fileWritten, false);
  });

  it("blocked-path fixture does not return file contents", async () => {
    const check = await runBlockedPathDeniedCheck();

    assert.equal(check.status, "PASS");
    assert.equal(check.id, "BLOCKED_PATH_DENIED");
    assert.doesNotMatch(JSON.stringify(check), /SELF_TEST_BLOCKED_CONTENT_DO_NOT_RETURN/u);
  });

  it("includes Builder Report and explicit workspace routing checks", async () => {
    const report = await runMcpSelfTest();
    const checkIds = report.checks.map((check) => check.id);

    assert.ok(checkIds.includes("BUILDER_REPORT_INDEX_WORKS"));
    assert.ok(checkIds.includes("BUILDER_REPORT_SUMMARY_WORKS"));
    assert.ok(checkIds.includes("EXPLICIT_MULTI_WORKSPACE_ROUTING_WORKS"));
  });

  it("does not include unredacted local user paths in JSON output", async () => {
    const report = await runMcpSelfTest();

    assertNoUnredactedLocalUserPath(report);
  });

  it("does not require the target working tree to be clean", async () => {
    initSelfTestFixtureRepo(tempRoot);

    const report = await runMcpSelfTest({ repoRoot: tempRoot });
    const workspaceCheck = report.checks.find((check) => check.id === "WORKSPACE_STATUS_SUMMARY_WORKS");
    const readinessCheck = report.checks.find((check) => check.id === "CHANGE_SET_READINESS_WORKS");

    assert.equal(report.ok, true);
    assert.equal(workspaceCheck?.status, "PASS");
    assert.equal(readinessCheck?.status, "PASS");
  });
});
