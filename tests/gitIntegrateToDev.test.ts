import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { type AppConfig } from "../src/config.js";
import { createMcpToolsListResult, createToolboxRuntimeContext, tools } from "../src/server/registerTools.js";
import { gitToolbox } from "../src/tools/domainToolboxes.js";
import { type IntegrateToDevOutput } from "../src/tools/gitWorkflow/integrateToDev.js";

const SOURCE_BRANCH = "feature/WC-V1-0401-harden-oauth-dcr-public-connector";
const REPORT_PATH =
  "planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0401_harden_oauth_dcr_public_connector.md";
const TOOLBOX_TOOL_NAMES = [
  "repo_toolbox",
  "git_toolbox",
  "artifact_toolbox",
  "diagnostics_toolbox",
  "integration_toolbox",
  "browser_toolbox",
  "knowledge_toolbox"
] as const;

let tempRoot: string;
let repoRoot: string;
let remoteRoot: string;
let auditRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-integrate-to-dev-"));
  repoRoot = path.join(tempRoot, "repo");
  remoteRoot = path.join(tempRoot, "origin.git");
  auditRoot = path.join(tempRoot, "audit");
  fs.mkdirSync(auditRoot, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function git(root: string, args: string[], expectedStatus = 0): string {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    windowsHide: true
  });
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return result.stdout.trim();
}

function gitMaybe(root: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    windowsHide: true
  });
  return {
    status: result.status,
    stdout: String(result.stdout ?? "").trim(),
    stderr: String(result.stderr ?? "").trim()
  };
}

function writeFile(root: string, relativePath: string, content: string): void {
  const absolutePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf8");
}

function writeFixturePackage(root: string): void {
  writeFile(
    root,
    "package.json",
    `${JSON.stringify(
      {
        name: "champcity-gpt",
        version: "0.1.2",
        scripts: {
          "check:public": "node -e \"process.exit(0)\"",
          "mcp:self-test": "node -e \"console.log(JSON.stringify({ok:true}))\" --"
        }
      },
      null,
      2
    )}\n`
  );
}

function testConfig(root = repoRoot): AppConfig {
  return {
    repoRoot: root,
    allowedRoots: [root],
    defaultWorkspaceRoot: root,
    defaultWorkspaceRootSource: "repoRoot",
    workspaces: [
      {
        workspaceId: "champcity_gpt",
        label: "ChampCity GPT MCP",
        root,
        remote: remoteRoot,
        source: "configured"
      }
    ],
    defaultWorkspaceId: "champcity_gpt",
    defaultWorkspaceIdSource: "local-file",
    auditLogPath: path.join(auditRoot, "audit.log"),
    requireGitRoot: true,
    allowedCommands: [],
    writeToolsEnabled: true,
    writeToolsEnabledSource: "default",
    writeMode: "elevated",
    writeModeSource: "default",
    docsWritesAllowed: true,
    patchWritesAllowed: true,
    elevatedOperationsAllowed: true,
    writeApprovalToken: { source: "none" }
  };
}

function context(config: AppConfig, scope = "files.read files.write") {
  return createToolboxRuntimeContext(config, { scope });
}

function initFixtureRepo(options: { pushSource?: boolean; includeReport?: boolean; conflict?: boolean } = {}): void {
  const pushSource = options.pushSource ?? true;
  const includeReport = options.includeReport ?? true;
  fs.mkdirSync(repoRoot, { recursive: true });
  git(tempRoot, ["init", "--bare", remoteRoot]);
  git(repoRoot, ["init"]);
  git(repoRoot, ["config", "user.email", "test@example.com"]);
  git(repoRoot, ["config", "user.name", "Test User"]);
  git(repoRoot, ["checkout", "-b", "main"]);
  writeFixturePackage(repoRoot);
  writeFile(repoRoot, "README.md", "# Fixture\n");
  writeFile(repoRoot, "shared.txt", "base\n");
  if (includeReport) {
    writeFile(repoRoot, REPORT_PATH, "# Builder Report\n\nFixture validation passed.\n");
  }
  git(repoRoot, ["add", "."]);
  git(repoRoot, ["commit", "-m", "Initial fixture"]);
  git(repoRoot, ["remote", "add", "origin", remoteRoot]);
  git(repoRoot, ["push", "-u", "origin", "main"]);

  git(repoRoot, ["checkout", "-b", "dev"]);
  if (options.conflict) {
    writeFile(repoRoot, "shared.txt", "dev change\n");
  } else {
    writeFile(repoRoot, "dev.txt", "dev baseline\n");
  }
  git(repoRoot, ["add", "."]);
  git(repoRoot, ["commit", "-m", "Dev baseline"]);
  git(repoRoot, ["push", "-u", "origin", "dev"]);

  git(repoRoot, ["checkout", "-b", SOURCE_BRANCH, options.conflict ? "main" : "dev"]);
  if (options.conflict) {
    writeFile(repoRoot, "shared.txt", "feature change\n");
  } else {
    writeFile(repoRoot, "feature.txt", "feature work\n");
  }
  git(repoRoot, ["add", "."]);
  git(repoRoot, ["commit", "-m", "Feature work"]);
  if (pushSource) {
    git(repoRoot, ["push", "-u", "origin", SOURCE_BRANCH]);
  }
}

async function callIntegrate(params: Record<string, unknown>, config = testConfig()) {
  return gitToolbox(
    {
      action: "integrate_to_dev",
      workspaceId: "champcity_gpt",
      params
    },
    config,
    context(config)
  );
}

function payload(result: Awaited<ReturnType<typeof callIntegrate>>): IntegrateToDevOutput {
  assert.equal(result.ok, true, JSON.stringify(result.error));
  return result.result as IntegrateToDevOutput;
}

function currentBranch(): string {
  return git(repoRoot, ["branch", "--show-current"]);
}

function commit(ref: string): string {
  return git(repoRoot, ["rev-parse", ref]);
}

function remoteCommit(ref: string): string {
  return git(tempRoot, ["--git-dir", remoteRoot, "rev-parse", ref]);
}

describe("git_toolbox.integrate_to_dev", () => {
  it("is recognized under git_toolbox", async () => {
    initFixtureRepo();

    const result = await callIntegrate({ dryRun: true, validationReportPath: REPORT_PATH });
    const body = payload(result);

    assert.equal(result.toolbox, "git_toolbox");
    assert.equal(result.action, "integrate_to_dev");
    assert.equal(body.ok, true, JSON.stringify({ blockers: body.blockers, postMerge: body.checks.postMerge }));
    assert.equal(body.mode, "dryRun");
    assert.equal(body.sourceBranch, SOURCE_BRANCH);
    assert.equal(body.targetBranch, "dev");
  });

  it("does not add a new public top-level tool", () => {
    initFixtureRepo();
    const exposed = createMcpToolsListResult(testConfig(), { scope: "files.read files.write" }).tools.map((entry) => entry.name);

    const registeredToolNames = tools.map((entry) => String(entry.name));
    assert.equal(registeredToolNames.includes("integrate_to_dev"), false);
    assert.equal(registeredToolNames.includes("dev_toolbox"), false);
    assert.equal(registeredToolNames.includes("branch_toolbox"), false);
    assert.equal(registeredToolNames.includes("figma_toolbox"), false);
    assert.deepEqual(exposed, [...TOOLBOX_TOOL_NAMES]);
  });

  it("keeps public tool exposure exactly seven toolboxes", () => {
    initFixtureRepo();

    for (const scope of ["files.read", "files.read files.write"]) {
      assert.deepEqual(createMcpToolsListResult(testConfig(), { scope }).tools.map((entry) => entry.name), [...TOOLBOX_TOOL_NAMES]);
    }
  });

  it("rejects unknown params", async () => {
    initFixtureRepo();

    const result = await callIntegrate({ dryRun: true, validationReportPath: REPORT_PATH, unexpected: true });

    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "INVALID_INPUT");
  });

  it("rejects caller-supplied root params", async () => {
    initFixtureRepo();

    const result = await callIntegrate({ dryRun: true, validationReportPath: REPORT_PATH, root: repoRoot });

    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "INVALID_INPUT");
  });

  it("rejects a dirty working tree", async () => {
    initFixtureRepo();
    writeFile(repoRoot, "dirty.md", "# Dirty\n");

    const body = payload(await callIntegrate({ dryRun: true, validationReportPath: REPORT_PATH }));

    assert.equal(body.ok, false);
    assert.equal(body.checks.workingTreeClean, false);
    assert.ok(body.blockers.some((entry) => /working tree must be clean/iu.test(entry)));
  });

  it("rejects main as source", async () => {
    initFixtureRepo();

    const body = payload(await callIntegrate({ sourceBranch: "main", dryRun: true, validationReportPath: REPORT_PATH }));

    assert.equal(body.ok, false);
    assert.ok(body.blockers.some((entry) => /must not be main/iu.test(entry)));
  });

  it("rejects dev as source", async () => {
    initFixtureRepo();

    const body = payload(await callIntegrate({ sourceBranch: "dev", dryRun: true, validationReportPath: REPORT_PATH }));

    assert.equal(body.ok, false);
    assert.ok(body.blockers.some((entry) => /must not be dev/iu.test(entry)));
  });

  it("rejects a non-dev target", async () => {
    initFixtureRepo();

    const result = await callIntegrate({ targetBranch: "main", dryRun: true, validationReportPath: REPORT_PATH });

    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "INVALID_INPUT");
  });

  it("rejects a missing source branch", async () => {
    initFixtureRepo();

    const body = payload(await callIntegrate({ sourceBranch: "feature/WC-V1-0401-missing", dryRun: true, validationReportPath: REPORT_PATH }));

    assert.equal(body.ok, false);
    assert.equal(body.checks.sourceBranchExists, false);
    assert.ok(body.blockers.some((entry) => /does not exist locally/iu.test(entry)));
  });

  it("requires a validation report by default", async () => {
    initFixtureRepo({ includeReport: false });

    const body = payload(await callIntegrate({ dryRun: true }));

    assert.equal(body.ok, false);
    assert.equal(body.checks.validationReport.exists, false);
    assert.ok(body.blockers.some((entry) => /validation report/iu.test(entry)));
  });

  it("rejects an unpushed source branch by default", async () => {
    initFixtureRepo({ pushSource: false });

    const body = payload(await callIntegrate({ dryRun: true, validationReportPath: REPORT_PATH }));

    assert.equal(body.ok, false);
    assert.equal(body.checks.sourceBranchPushed, false);
    assert.ok(body.blockers.some((entry) => /pushed before integration/iu.test(entry)));
  });

  it("dry run does not mutate branches", async () => {
    initFixtureRepo();
    const branchBefore = currentBranch();
    const devBefore = commit("dev");
    const statusBefore = git(repoRoot, ["status", "--short"]);

    const body = payload(await callIntegrate({ dryRun: true, validationReportPath: REPORT_PATH }));

    assert.equal(body.ok, true, JSON.stringify({ blockers: body.blockers, postMerge: body.checks.postMerge }));
    assert.equal(currentBranch(), branchBefore);
    assert.equal(commit("dev"), devBefore);
    assert.equal(git(repoRoot, ["status", "--short"]), statusBefore);
    assert.deepEqual(body.operationsPerformed, []);
    assert.ok(body.operationsPlanned.length > 0);
  });

  it("rejects merge conflicts and leaves the repo in a safe state", async () => {
    initFixtureRepo({ conflict: true });

    const body = payload(await callIntegrate({ dryRun: false, push: false, validationReportPath: REPORT_PATH }));

    assert.equal(body.ok, false);
    assert.equal(currentBranch(), SOURCE_BRANCH);
    assert.equal(git(repoRoot, ["status", "--short"]), "");
    assert.equal(fs.existsSync(path.join(repoRoot, ".git", "MERGE_HEAD")), false);
    assert.ok(body.operationsPerformed.includes("git merge --abort"));
  });

  it("successfully merges a fixture source branch into dev", async () => {
    initFixtureRepo();

    const body = payload(await callIntegrate({ dryRun: false, push: false, validationReportPath: REPORT_PATH }));
    const parents = git(repoRoot, ["rev-list", "--parents", "-n", "1", "HEAD"]).split(/\s+/u);

    assert.equal(body.ok, true, JSON.stringify({ blockers: body.blockers, postMerge: body.checks.postMerge }));
    assert.equal(currentBranch(), "dev");
    assert.equal(body.pushed, false);
    assert.match(body.mergeCommit ?? "", /^[a-f0-9]{40}$/u);
    assert.equal(parents.length, 3);
    assert.equal(body.checks.postMerge.every((check) => check.ok), true);
  });

  it("does not push when push is false", async () => {
    initFixtureRepo();
    const remoteDevBefore = remoteCommit("dev");

    const body = payload(await callIntegrate({ dryRun: false, push: false, validationReportPath: REPORT_PATH }));

    assert.equal(body.ok, true, JSON.stringify({ blockers: body.blockers, postMerge: body.checks.postMerge }));
    assert.equal(body.pushed, false);
    assert.equal(remoteCommit("dev"), remoteDevBefore);
    assert.notEqual(commit("dev"), remoteDevBefore);
  });

  it("pushes dev only after post-merge validation passes", async () => {
    initFixtureRepo();
    const remoteDevBefore = remoteCommit("dev");

    const body = payload(await callIntegrate({ dryRun: false, push: true, validationReportPath: REPORT_PATH }));

    assert.equal(body.ok, true);
    assert.equal(body.pushed, true);
    assert.equal(body.checks.postMerge.every((check) => check.ok), true);
    assert.notEqual(remoteCommit("dev"), remoteDevBefore);
    assert.equal(remoteCommit("dev"), commit("dev"));
  });

  it("does not implement unsafe git operations", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src", "tools", "gitWorkflow", "integrateToDev.ts"), "utf8");

    assert.doesNotMatch(source, /\["push"[^\]]*"-(?:f|-force)"|\["push"[^\]]*"--force(?:-with-lease)?"/u);
    assert.doesNotMatch(source, /\["(?:reset|rebase|stash|tag)"|\["branch"[^\]]*"-(?:d|D)"/u);
    assert.doesNotMatch(source, /git push -f|git push --force/iu);
  });

  it("does not mutate main", async () => {
    initFixtureRepo();
    const mainBefore = commit("main");

    const body = payload(await callIntegrate({ dryRun: false, push: true, validationReportPath: REPORT_PATH }));

    assert.equal(body.ok, true);
    assert.equal(commit("main"), mainBefore);
    assert.equal(remoteCommit("main"), mainBefore);
  });

  it("can skip validation report only when explicitly requested", async () => {
    initFixtureRepo({ includeReport: false });

    const body = payload(await callIntegrate({ dryRun: true, requireValidationReport: false }));

    assert.equal(body.ok, true);
    assert.equal(body.checks.validationReport.required, false);
    assert.equal(body.validationReportPath, null);
  });
});
