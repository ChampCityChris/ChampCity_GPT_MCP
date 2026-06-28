import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { type AppConfig } from "../src/config.js";
import { commitValidatedChanges } from "../src/tools/gitWorkflow/commitValidatedChanges.js";
import { getCommitReadiness } from "../src/tools/gitWorkflow/getCommitReadiness.js";
import { pushCurrentBranch } from "../src/tools/gitWorkflow/pushCurrentBranch.js";
import { safeStageChanges } from "../src/tools/gitWorkflow/safeStageChanges.js";
import { redactRemoteUrl } from "../src/tools/gitWorkflow/safety.js";
import { hashWriteApprovalToken } from "../src/writeAccess.js";

let tempRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-git-workflow-"));
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

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

function initRepo(branch = "dev"): void {
  git(tempRoot, ["init"]);
  git(tempRoot, ["config", "user.email", "test@example.com"]);
  git(tempRoot, ["config", "user.name", "Test User"]);
  git(tempRoot, ["checkout", "-b", branch]);
  fs.writeFileSync(path.join(tempRoot, "README.md"), "# Test\n", "utf8");
  git(tempRoot, ["add", "README.md"]);
  git(tempRoot, ["commit", "-m", "Initial commit"]);
}

function writeFile(relativePath: string, content: string): void {
  const absolutePath = path.join(tempRoot, relativePath);
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

describe("git workflow tools", () => {
  it("safe_stage_changes stages a safe source file", async () => {
    initRepo();
    writeFile("src/app.ts", "export const value = 1;\n");

    const result = await safeStageChanges({ root: tempRoot, mode: "all-safe" }, testConfig());

    assert.equal(result.safe, true);
    assert.ok(result.stagedFiles.includes("src/app.ts"));
  });

  it("safe_stage_changes refuses config/http-auth.local.json", async () => {
    initRepo();
    writeFile("config/http-auth.local.json", "{}\n");

    const result = await safeStageChanges({ root: tempRoot, mode: "paths", paths: ["config/http-auth.local.json"] }, testConfig());

    assert.equal(result.safe, false);
    assert.equal(result.blockingFindings[0]?.rule, "local-config");
  });

  it("safe_stage_changes refuses .env but allows .env.example", async () => {
    initRepo();
    writeFile(".env", "SECRET=value\n");
    writeFile(".env.example", "SECRET=example\n");

    const envResult = await safeStageChanges({ root: tempRoot, mode: "paths", paths: [".env"] }, testConfig());
    assert.equal(envResult.safe, false);
    assert.equal(envResult.blockingFindings[0]?.rule, "env-file");

    const exampleResult = await safeStageChanges({ root: tempRoot, mode: "paths", paths: [".env.example"] }, testConfig());
    assert.equal(exampleResult.safe, true);
    assert.ok(exampleResult.stagedFiles.includes(".env.example"));
  });

  it("safe_stage_changes refuses generated, release, dist, and logs paths", async () => {
    initRepo();
    const blockedPaths = ["generated/out.txt", "release/app.zip", "dist/index.js", "logs/app.log"];

    for (const blockedPath of blockedPaths) {
      writeFile(blockedPath, "local artifact\n");
      const result = await safeStageChanges({ root: tempRoot, mode: "paths", paths: [blockedPath] }, testConfig());
      assert.equal(result.safe, false, blockedPath);
      assert.equal(result.blockingFindings.length, 1, blockedPath);
    }
  });

  it("safe_stage_changes refuses files with private paths or token-like secrets", async () => {
    initRepo();
    const tokenLikeValue = `${"abcdefghijkl"}${"mnopqrstuvwxyz123456"}`;
    writeFile("src/private-path.ts", 'export const p = "C:\\\\Users\\\\alice\\\\secret.txt";\n');
    writeFile("src/token.ts", `export const access_token = "${tokenLikeValue}";\n`);

    const result = await safeStageChanges({ root: tempRoot, mode: "all-safe" }, testConfig());

    assert.equal(result.safe, false);
    assert.ok(result.blockingFindings.some((finding) => finding.rule === "windows-user-path"));
    assert.ok(result.blockingFindings.some((finding) => finding.rule === "named-secret"));
  });

  it("commit_validated_changes refuses when no staged files", async () => {
    initRepo();

    await assert.rejects(
      () => commitValidatedChanges({ root: tempRoot, message: "No-op", targetBranch: "dev" }, testConfig()),
      /No staged files/i
    );
  });

  it("commit_validated_changes refuses when pre-commit scan has blockers", async () => {
    initRepo();
    writeFile("config/http-auth.local.json", "{}\n");
    git(tempRoot, ["add", "--", "config/http-auth.local.json"]);

    await assert.rejects(
      () => commitValidatedChanges({ root: tempRoot, message: "Add local config", targetBranch: "dev" }, testConfig()),
      /pre-commit safety scan has blockers/i
    );
  });

  it("commit_validated_changes refuses main by default", async () => {
    initRepo("main");
    writeFile("src/main.ts", "export const main = true;\n");
    git(tempRoot, ["add", "--", "src/main.ts"]);

    await assert.rejects(
      () => commitValidatedChanges({ root: tempRoot, message: "Main change", targetBranch: "main" }, testConfig()),
      /Committing to main is refused/i
    );
  });

  it("commit_validated_changes creates a commit from safe staged files on dev", async () => {
    initRepo("dev");
    writeFile("src/dev.ts", "export const dev = true;\n");
    git(tempRoot, ["add", "--", "src/dev.ts"]);

    const result = await commitValidatedChanges({ root: tempRoot, message: "Add dev file", targetBranch: "dev" }, testConfig());

    assert.match(result.commitHash, /^[a-f0-9]{40}$/u);
    assert.equal(result.branch, "dev");
    assert.deepEqual(result.committedFiles, ["src/dev.ts"]);
  });

  it("push_current_branch refuses main by default", async () => {
    initRepo("main");

    await assert.rejects(
      () => pushCurrentBranch({ root: tempRoot, remote: "origin", setUpstream: true }, testConfig()),
      /Pushing main is refused/i
    );
  });

  it("push_current_branch implementation never uses force flags", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src", "tools", "gitWorkflow", "pushCurrentBranch.ts"), "utf8");

    assert.doesNotMatch(source, /"--force"|"--force-with-lease"|"-f"/u);
  });

  it("get_commit_readiness reports blockers accurately", async () => {
    initRepo("dev");
    writeFile("config/http-auth.local.json", "{}\n");
    git(tempRoot, ["add", "--", "config/http-auth.local.json"]);

    const result = await getCommitReadiness({ root: tempRoot, targetBranch: "dev" }, testConfig());

    assert.equal(result.readyToCommit, false);
    assert.ok(result.blockingFindings.some((finding) => finding.rule === "local-config"));
  });

  it("remote URL redaction does not leak credentials", () => {
    const redacted = redactRemoteUrl("https://user:super-secret-token@example.com/owner/repo.git");

    assert.equal(redacted, "https://***:***@example.com/owner/repo.git");
    assert.doesNotMatch(redacted, /super-secret-token/u);
  });
});
