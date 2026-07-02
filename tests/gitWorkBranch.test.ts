import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { type AppConfig } from "../src/config.js";
import { prepareGitWorkBranch } from "../src/tools/gitWorkflow/prepareGitWorkBranch.js";
import { hashWriteApprovalToken } from "../src/writeAccess.js";

let tempRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-git-work-branch-"));
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function git(args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: tempRoot,
    encoding: "utf8",
    shell: false,
    windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function initRepo(branch = "main"): void {
  git(["init"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test User"]);
  git(["checkout", "-b", branch]);
  writeFile("README.md", "# Test\n");
  git(["add", "README.md"]);
  git(["commit", "-m", "Initial commit"]);
}

function writeFile(relativePath: string, content: string): void {
  const absolutePath = path.join(tempRoot, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf8");
}

function testConfig(): AppConfig {
  return {
    repoRoot: tempRoot,
    allowedRoots: [tempRoot],
    auditLogPath: path.join(tempRoot, "logs", "audit.log"),
    requireGitRoot: true,
    allowedCommands: [],
    writeToolsEnabled: true,
    writeToolsEnabledSource: "local-file",
    writeMode: "elevated",
    writeModeSource: "local-file",
    docsWritesAllowed: true,
    patchWritesAllowed: true,
    elevatedOperationsAllowed: true,
    writeApprovalToken: {
      source: "local-file",
      tokenHash: hashWriteApprovalToken("correct-write-token")
    }
  };
}

async function assertRejectsBranchPrep(input: unknown, pattern: RegExp): Promise<void> {
  await assert.rejects(() => prepareGitWorkBranch(input, testConfig()), pattern);
}

describe("prepare_git_work_branch", () => {
  it("creates dev from main in a clean repo", async () => {
    initRepo("main");

    const result = await prepareGitWorkBranch({ branchKind: "dev" }, testConfig());

    assert.equal(result.branchBefore, "main");
    assert.equal(result.branchAfter, "dev");
    assert.equal(result.baseBranch, "main");
    assert.equal(result.targetBranch, "dev");
    assert.equal(result.created, true);
    assert.equal(result.switched, true);
    assert.equal(result.statusBefore, "");
    assert.equal(result.statusAfter, "");
    assert.equal(git(["branch", "--show-current"]), "dev");
  });

  it("switches to an existing dev branch in a clean repo", async () => {
    initRepo("main");
    git(["checkout", "-b", "dev"]);
    git(["checkout", "main"]);

    const result = await prepareGitWorkBranch({ branchKind: "dev" }, testConfig());

    assert.equal(result.created, false);
    assert.equal(result.switched, true);
    assert.equal(result.branchBefore, "main");
    assert.equal(result.branchAfter, "dev");
  });

  it("creates a feature branch from dev", async () => {
    initRepo("main");
    git(["checkout", "-b", "dev"]);

    const result = await prepareGitWorkBranch(
      {
        branchKind: "feature",
        workCardId: "WC-V1-FIX01",
        slug: "safe-branch-workflow-tool"
      },
      testConfig()
    );

    assert.equal(result.created, true);
    assert.equal(result.branchBefore, "dev");
    assert.equal(result.branchAfter, "feature/WC-V1-FIX01-safe-branch-workflow-tool");
    assert.equal(result.baseBranch, "dev");
    assert.equal(git(["branch", "--show-current"]), "feature/WC-V1-FIX01-safe-branch-workflow-tool");
  });

  it("rejects target main", async () => {
    initRepo("main");

    await assertRejectsBranchPrep({ branchKind: "main" }, /branchKind|Invalid enum value/i);
  });

  it("rejects arbitrary branch names and unsafe branch fragments", async () => {
    initRepo("main");

    await assertRejectsBranchPrep(
      {
        branchKind: "feature",
        workCardId: "WC-V1-0401;bad",
        slug: "safe-slug"
      },
      /workCardId/i
    );
    await assertRejectsBranchPrep(
      {
        branchKind: "feature",
        workCardId: "WC-V1-0401",
        slug: "../bad"
      },
      /slug/i
    );
    await assertRejectsBranchPrep(
      {
        branchKind: "feature",
        workCardId: "WC-V1-0401",
        slug: "bad slug"
      },
      /slug/i
    );
  });

  it("rejects missing workCardId for feature branch preparation", async () => {
    initRepo("main");

    await assertRejectsBranchPrep({ branchKind: "feature", slug: "safe-slug" }, /workCardId is required/i);
  });

  it("rejects a dirty working tree", async () => {
    initRepo("main");
    writeFile("README.md", "# Changed\n");

    await assertRejectsBranchPrep({ branchKind: "dev" }, /clean working tree/i);
  });

  it("rejects staged changes", async () => {
    initRepo("main");
    writeFile("src/app.ts", "export const value = 1;\n");
    git(["add", "src/app.ts"]);

    await assertRejectsBranchPrep({ branchKind: "dev" }, /clean working tree/i);
  });

  it("rejects untracked files", async () => {
    initRepo("main");
    writeFile("notes.md", "# Untracked\n");

    await assertRejectsBranchPrep({ branchKind: "dev" }, /clean working tree/i);
  });

  it("rejects detached HEAD", async () => {
    initRepo("main");
    git(["checkout", "--detach", "HEAD"]);

    await assertRejectsBranchPrep({ branchKind: "dev" }, /Detached HEAD/i);
  });

  it("does not push", async () => {
    initRepo("main");

    const result = await prepareGitWorkBranch({ branchKind: "dev" }, testConfig());

    assert.equal(result.created, true);
    assert.equal(result.branchAfter, "dev");

    const source = fs.readFileSync(path.join(process.cwd(), "src", "tools", "gitWorkflow", "prepareGitWorkBranch.ts"), "utf8");
    assert.doesNotMatch(source, /runGit\([\s\S]*\[\s*["']push["']/u);
  });

  it("does not merge, rebase, reset, stash, or delete branches", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src", "tools", "gitWorkflow", "prepareGitWorkBranch.ts"), "utf8");

    for (const unsafeOperation of ["merge", "rebase", "reset", "stash"]) {
      assert.doesNotMatch(source, new RegExp(`runGit\\([\\s\\S]*\\[\\s*["']${unsafeOperation}["']`, "u"));
    }
    assert.doesNotMatch(source, /runGit\([\s\S]*\[\s*["']branch["'][\s\S]*["']-(?:d|D)["']/u);
  });

  it("rejects an existing branch that is not based on the selected base branch", async () => {
    initRepo("main");
    git(["checkout", "--orphan", "dev"]);
    git(["rm", "-rf", "."]);
    writeFile("README.md", "# Independent dev\n");
    git(["add", "README.md"]);
    git(["commit", "-m", "Independent dev"]);
    git(["checkout", "main"]);

    await assertRejectsBranchPrep({ branchKind: "dev" }, /human merge decision/i);
  });
});
