import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { type AppConfig } from "../src/config.js";
import { applyApprovedPatch } from "../src/tools/applyApprovedPatch.js";
import { getWriteAccessStatus } from "../src/tools/getWriteAccessStatus.js";
import { writeJsonArtifact } from "../src/tools/writeJsonArtifact.js";
import { writeMarkdownArtifact } from "../src/tools/writeMarkdownArtifact.js";
import { proposePatch } from "../src/tools/proposePatch.js";
import { runAllowedScript } from "../src/tools/runAllowedScript.js";
import { hashWriteApprovalToken } from "../src/writeAccess.js";

let tempRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-write-tools-"));
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const writeMode = overrides.writeMode ?? "docs";
  return {
    repoRoot: tempRoot,
    allowedRoots: [tempRoot],
    auditLogPath: path.join(tempRoot, "logs", "audit.log"),
    requireGitRoot: false,
    allowedCommands: [],
    writeToolsEnabled: writeMode !== "off",
    writeToolsEnabledSource: "local-file",
    writeMode,
    writeModeSource: "local-file",
    docsWritesAllowed: writeMode === "docs" || writeMode === "patch" || writeMode === "elevated",
    patchWritesAllowed: writeMode === "patch" || writeMode === "elevated",
    elevatedOperationsAllowed: writeMode === "elevated",
    writeApprovalToken: {
      source: "local-file",
      tokenHash: hashWriteApprovalToken("correct-write-token")
    },
    ...overrides
  };
}

describe("write approval token enforcement", () => {
  it("write_markdown_artifact refuses when write mode is off", async () => {
    await assert.rejects(
      () =>
        writeMarkdownArtifact(
          {
            root: tempRoot,
            relativePath: "note.md",
            content: "# Note\n",
            approvalToken: "correct-write-token"
          },
          testConfig({ writeMode: "off", writeToolsEnabled: false, docsWritesAllowed: false })
        ),
      /write_markdown_artifact requires writeMode/i
    );
  });

  it("write_markdown_artifact allows docs mode without approvalToken", async () => {
    const result = await writeMarkdownArtifact(
      {
        root: tempRoot,
        relativePath: "note.md",
        content: "# Note\n"
      },
      testConfig({ writeApprovalToken: { source: "none" } })
    );

    assert.equal(result.relativePath, "note.md");
    assert.equal(fs.readFileSync(path.join(tempRoot, "note.md"), "utf8"), "# Note\n");
  });

  it("write_markdown_artifact still enforces .md-only", async () => {
    await assert.rejects(
      () =>
        writeMarkdownArtifact(
          {
            root: tempRoot,
            relativePath: "note.txt",
            content: "# Note\n",
          },
          testConfig()
        ),
      /only allow \.md files/i
    );
  });

  it("write_markdown_artifact still rejects blocked paths", async () => {
    await assert.rejects(
      () =>
        writeMarkdownArtifact(
          {
            root: tempRoot,
            relativePath: ".env.secret.md",
            content: "# Secret\n"
          },
          testConfig()
        ),
      /Environment files are blocked/i
    );
  });

  it("write_json_artifact refuses when write mode is off", async () => {
    await assert.rejects(
      () =>
        writeJsonArtifact(
          {
            root: tempRoot,
            relativePath: "data/example.json",
            content: "{}"
          },
          testConfig({ writeMode: "off", writeToolsEnabled: false, docsWritesAllowed: false })
        ),
      /write_json_artifact requires writeMode/i
    );
  });

  it("write_json_artifact writes normalized JSON with metadata", async () => {
    const result = await writeJsonArtifact(
      {
        root: tempRoot,
        relativePath: "data/example.json",
        content: "{\"z\":1,\"a\":[true,false]}"
      },
      testConfig({ writeApprovalToken: { source: "none" } })
    );

    assert.equal(result.relativePath, "data/example.json");
    assert.equal(result.sizeBytes, Buffer.byteLength("{\n  \"z\": 1,\n  \"a\": [\n    true,\n    false\n  ]\n}\n", "utf8"));
    assert.match(result.sha256, /^[a-f0-9]{64}$/u);
    assert.doesNotThrow(() => new Date(result.modifiedTime).toISOString());
    assert.equal(
      fs.readFileSync(path.join(tempRoot, "data", "example.json"), "utf8"),
      "{\n  \"z\": 1,\n  \"a\": [\n    true,\n    false\n  ]\n}\n"
    );
  });

  it("write_json_artifact rejects invalid JSON and non-json paths", async () => {
    await assert.rejects(
      () =>
        writeJsonArtifact(
          {
            root: tempRoot,
            relativePath: "data/example.json",
            content: "{broken"
          },
          testConfig()
        ),
      /must parse as valid JSON/i
    );

    await assert.rejects(
      () =>
        writeJsonArtifact(
          {
            root: tempRoot,
            relativePath: "data/example.txt",
            content: "{}"
          },
          testConfig()
        ),
      /only allow \.json files/i
    );
  });

  it("write_json_artifact rejects blocked and generated-risk paths", async () => {
    for (const relativePath of [".env.secret.json", "config/figma.local.json", "logs/status.json", "release/app.json", "dist/app.json"]) {
      await assert.rejects(
        () =>
          writeJsonArtifact(
            {
              root: tempRoot,
              relativePath,
              content: "{}"
            },
            testConfig()
          ),
        /blocked|must not be|Environment files|Log directories|Release artifacts|Build output|Local config/i,
        relativePath
      );
    }
  });

  it("apply_approved_patch refuses in docs mode", async () => {
    await assert.rejects(
      () =>
        applyApprovedPatch(
          {
            root: tempRoot,
            patch: "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n"
          },
          testConfig()
        ),
      /writeMode patch or elevated/i
    );
  });

  it("apply_approved_patch allows a matching pending proposal in patch mode without approvalToken", async () => {
    fs.writeFileSync(path.join(tempRoot, "note.txt"), "hello\n", "utf8");
    const proposal = await proposePatch(
      {
        root: tempRoot,
        changes: [{ relativePath: "note.txt", originalText: "hello", replacementText: "hello patched" }]
      },
      testConfig({ writeMode: "patch" })
    );

    await applyApprovedPatch(
      {
        root: tempRoot,
        patch: proposal.patch,
        proposalId: proposal.proposalId,
        patchHash: proposal.patchHash
      },
      testConfig({ writeMode: "patch" })
    );

    assert.equal(fs.readFileSync(path.join(tempRoot, "note.txt"), "utf8").replace(/\r\n/gu, "\n"), "hello patched\n");
  });

  it("apply_approved_patch refuses when patch differs from the proposal", async () => {
    fs.writeFileSync(path.join(tempRoot, "note.txt"), "hello\n", "utf8");
    const proposal = await proposePatch(
      {
        root: tempRoot,
        changes: [{ relativePath: "note.txt", originalText: "hello", replacementText: "hello patched" }]
      },
      testConfig({ writeMode: "patch" })
    );

    await assert.rejects(
      () =>
        applyApprovedPatch(
          {
            root: tempRoot,
            patch: proposal.patch.replace("hello patched", "hello changed"),
            proposalId: proposal.proposalId,
            patchHash: proposal.patchHash
          },
          testConfig({ writeMode: "patch" })
        ),
      /Patch hash does not match/i
    );
  });

  it("apply_approved_patch refuses expired proposals", async () => {
    fs.writeFileSync(path.join(tempRoot, "note.txt"), "hello\n", "utf8");
    const proposal = await proposePatch(
      {
        root: tempRoot,
        changes: [{ relativePath: "note.txt", originalText: "hello", replacementText: "hello patched" }]
      },
      testConfig({ writeMode: "patch" })
    );
    const storePath = path.join(tempRoot, "config", "pending-patches.local.json");
    const store = JSON.parse(fs.readFileSync(storePath, "utf8")) as { proposals: Array<Record<string, unknown>> };
    store.proposals[0].expiresAt = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");

    await assert.rejects(
      () =>
        applyApprovedPatch(
          {
            root: tempRoot,
            patch: proposal.patch,
            proposalId: proposal.proposalId,
            patchHash: proposal.patchHash
          },
          testConfig({ writeMode: "patch" })
        ),
      /expired/i
    );
  });

  it("apply_approved_patch marks a proposal used and refuses reuse", async () => {
    fs.writeFileSync(path.join(tempRoot, "note.txt"), "hello\n", "utf8");
    const proposal = await proposePatch(
      {
        root: tempRoot,
        changes: [{ relativePath: "note.txt", originalText: "hello", replacementText: "hello patched" }]
      },
      testConfig({ writeMode: "patch" })
    );

    await applyApprovedPatch(
      {
        root: tempRoot,
        patch: proposal.patch,
        proposalId: proposal.proposalId,
        patchHash: proposal.patchHash
      },
      testConfig({ writeMode: "patch" })
    );

    await assert.rejects(
      () =>
        applyApprovedPatch(
          {
            root: tempRoot,
            patch: proposal.patch,
            proposalId: proposal.proposalId,
            patchHash: proposal.patchHash
          },
          testConfig({ writeMode: "patch" })
        ),
      /already been used/i
    );
  });

  it("run_allowed_script requires elevated mode and valid elevated approval", async () => {
    await assert.rejects(
      () =>
        runAllowedScript(
          {
            root: tempRoot,
            command: "node --version",
            approvalToken: "correct-write-token"
          },
          testConfig({ allowedCommands: ["node --version"], writeMode: "patch" })
        ),
      /writeMode elevated/i
    );

    await assert.rejects(
      () =>
        runAllowedScript(
          {
            root: tempRoot,
            command: "node --version",
            approvalToken: "wrong-write-token"
          },
          testConfig({ allowedCommands: ["node --version"], writeMode: "elevated" })
        ),
      /invalid/i
    );
  });

  it("run_allowed_script allows only allowlisted commands with elevated approval", async () => {
    const result = await runAllowedScript(
      {
        root: tempRoot,
        command: "node --version",
        approvalToken: "correct-write-token"
      },
      testConfig({ allowedCommands: ["node --version"], writeMode: "elevated" })
    );

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /^v?\d+\./i);
  });

  it("get_write_access_status returns non-secret status", async () => {
    const status = await getWriteAccessStatus({}, testConfig({ writeMode: "patch" }));

    assert.equal(status.writeMode, "patch");
    assert.equal(status.docsWritesAllowed, true);
    assert.equal(status.patchWritesAllowed, true);
    assert.equal(status.elevatedOperationsAllowed, false);
    assert.equal(status.legacyApprovalTokenConfigured, true);
    assert.equal(status.oauthFilesWriteGranted, "unknown");
    assert.equal(typeof status.pendingPatchProposalCount, "number");
    assert.equal("approvalToken" in status, false);
  });
});
