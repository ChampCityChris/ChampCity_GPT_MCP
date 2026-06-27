import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { type AppConfig } from "../src/config.js";
import { registerPatchProposal } from "../src/pendingPatches.js";
import { applyApprovedPatch } from "../src/tools/applyApprovedPatch.js";
import { runGit } from "../src/utils/git.js";

let tempRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-apply-patch-"));
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function testConfig(): AppConfig {
  return {
    repoRoot: tempRoot,
    allowedRoots: [tempRoot],
    auditLogPath: path.join(tempRoot, "logs", "audit.log"),
    requireGitRoot: true,
    allowedCommands: [],
    writeToolsEnabled: true,
    writeToolsEnabledSource: "env",
    writeMode: "patch",
    writeModeSource: "env",
    docsWritesAllowed: true,
    patchWritesAllowed: true,
    elevatedOperationsAllowed: false,
    writeApprovalToken: { source: "env", token: "test-write-token" }
  };
}

async function assertGit(args: string[]): Promise<void> {
  const result = await runGit(tempRoot, args, {
    timeoutMs: 30_000,
    maxBytes: 100_000
  });

  assert.equal(result.exitCode, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  assert.equal(result.timedOut, false, `git ${args.join(" ")} timed out`);
}

async function initializeRepoWithTextFile(fileName = "note.txt", content = "hello\n"): Promise<void> {
  await assertGit(["init"]);
  await assertGit(["config", "core.autocrlf", "false"]);
  fs.writeFileSync(path.join(tempRoot, fileName), content, "utf8");
  await assertGit(["add", fileName]);
}

describe("apply_approved_patch integration", () => {
  it("applies an approved normal text patch and writes an audit log", async () => {
    await initializeRepoWithTextFile();
    const patch = `${[
      "diff --git a/note.txt b/note.txt",
      "--- a/note.txt",
      "+++ b/note.txt",
      "@@ -1 +1 @@",
      "-hello",
      "+hello hardened"
    ].join("\n")}\n`;

    const result = await applyApprovedPatch(
      {
        root: tempRoot,
        patch,
        proposalId: registerPatchProposal(tempRoot, tempRoot, patch, ["note.txt"]).id
      },
      testConfig()
    );

    assert.equal(fs.readFileSync(path.join(tempRoot, "note.txt"), "utf8"), "hello hardened\n");
    assert.deepEqual(result.changedFiles, ["note.txt"]);
    assert.equal(typeof result.gitDiffSummary, "string");
    assert.match(result.gitDiffSummary, /note\.txt/);

    const auditLog = fs.readFileSync(path.join(tempRoot, "logs", "audit.log"), "utf8");
    assert.match(auditLog, /"toolName":"apply_approved_patch"/);
    assert.match(auditLog, /"result":"allow"/);
  });

  it("rejects symlink-mode patches before unsafe output remains", async () => {
    await initializeRepoWithTextFile();
    const patch = `${[
      "diff --git a/link.txt b/link.txt",
      "new file mode 120000",
      "index 0000000..d95f3ad 120000",
      "--- /dev/null",
      "+++ b/link.txt",
      "@@ -0,0 +1 @@",
      "+note.txt"
    ].join("\n")}\n`;

    await assert.rejects(
      () =>
        applyApprovedPatch(
          {
            root: tempRoot,
            patch,
            approvalToken: "test-write-token"
          },
          { ...testConfig(), writeMode: "elevated", elevatedOperationsAllowed: true }
        ),
      /symlink|special file mode/i
    );

    assert.equal(fs.existsSync(path.join(tempRoot, "link.txt")), false);
  });
});
