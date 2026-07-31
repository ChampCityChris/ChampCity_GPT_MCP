import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, it } from "node:test";

import { type AppConfig } from "../src/config.js";
import { createToolboxRuntimeContext } from "../src/server/registerTools.js";
import { createMarkdownArtifact } from "../src/tools/createMarkdownArtifact.js";
import { artifactToolbox } from "../src/tools/domainToolboxes.js";
import { MAX_MARKDOWN_ARTIFACT_CONTENT_LENGTH } from "../src/tools/inputLimits.js";

let tempRoot: string;
let auditRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-create-md-"));
  auditRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-create-md-audit-"));
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.rmSync(auditRoot, { recursive: true, force: true });
});

function git(args: string[], root = tempRoot): void {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function initRepo(root = tempRoot): void {
  fs.mkdirSync(root, { recursive: true });
  git(["init"], root);
  git(["config", "user.email", "test@example.com"], root);
  git(["config", "user.name", "Test User"], root);
  git(["checkout", "-b", "main"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# Test\n", "utf8");
  git(["add", "README.md"], root);
  git(["commit", "-m", "Initial commit"], root);
}

function testConfig(writeMode: AppConfig["writeMode"] = "docs", root = tempRoot): AppConfig {
  return {
    repoRoot: root,
    allowedRoots: [root],
    defaultWorkspaceRoot: root,
    defaultWorkspaceRootSource: "repoRoot",
    auditLogPath: path.join(auditRoot, "audit.log"),
    requireGitRoot: true,
    allowedCommands: [],
    writeToolsEnabled: writeMode !== "off",
    writeToolsEnabledSource: "default",
    writeMode,
    writeModeSource: "default",
    docsWritesAllowed: writeMode === "docs" || writeMode === "patch" || writeMode === "elevated",
    patchWritesAllowed: writeMode === "patch" || writeMode === "elevated",
    elevatedOperationsAllowed: writeMode === "elevated",
    writeApprovalToken: { source: "none" },
    workspaces: [{ workspaceId: "neutral_workspace", label: "Neutral Workspace", root, source: "configured" }],
    defaultWorkspaceId: "neutral_workspace",
    defaultWorkspaceIdSource: "local-file"
  };
}

function artifactOnlyConfig(root = tempRoot, artifactWriteRoots = ["artifacts"]): AppConfig {
  return {
    ...testConfig("docs", root),
    requireGitRoot: false,
    workspaces: [
      {
        workspaceId: "artifact_workspace",
        label: "Artifact Workspace",
        root,
        source: "configured",
        writePolicy: "artifact_only",
        artifactWriteRoots,
        artifactRootWarnings: []
      }
    ],
    defaultWorkspaceId: "artifact_workspace"
  };
}

function context(config: AppConfig, scope = "files.read files.write") {
  return createToolboxRuntimeContext(config, { scope });
}

function target(relativePath: string, root = tempRoot): string {
  return path.join(root, ...relativePath.split("/"));
}

function write(relativePath: string, content: string, root = tempRoot): void {
  const absolutePath = target(relativePath, root);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf8");
}

function listTemporaryFiles(directory: string): string[] {
  return fs.existsSync(directory) ? fs.readdirSync(directory).filter((name) => /\.tmp$/u.test(name)) : [];
}

describe("artifact_toolbox.create_markdown_artifact", () => {
  it("creates a missing neutral Markdown target with exact opaque content and generic response fields", async () => {
    initRepo();
    const config = testConfig("docs");
    const content = "# Session Notes\r\n\r\n<!-- arbitrary metadata -->\n\n```json\n{\"workflowData\":{\"status\":\"Pending\"}}\n```\n";

    const result = await artifactToolbox(
      {
        action: "create_markdown_artifact",
        workspaceId: "neutral_workspace",
        params: { relativePath: "docs/example.md", content }
      },
      config,
      context(config)
    );

    assert.equal(result.ok, true);
    assert.deepEqual(result.result, {
      status: "saved",
      workspaceId: "neutral_workspace",
      relativePath: "docs/example.md",
      sizeBytes: Buffer.byteLength(content, "utf8")
    });
    assert.deepEqual(fs.readFileSync(target("docs/example.md")), Buffer.from(content, "utf8"));
    assert.equal(JSON.stringify(result.result).includes("sha256"), false);
    assert.equal(JSON.stringify(result.result).includes("workflowData"), false);
  });

  it("creates missing safe parent directories under an artifact-only workspace policy", async () => {
    const config = artifactOnlyConfig(tempRoot, ["notes", "artifacts"]);

    const result = await artifactToolbox(
      {
        action: "create_markdown_artifact",
        workspaceId: "artifact_workspace",
        params: { relativePath: "notes/session.md", content: "Neutral notes\n" }
      },
      config,
      context(config)
    );

    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(target("notes/session.md"), "utf8"), "Neutral notes\n");
  });

  it("returns already_saved for identical retries without rewriting", async () => {
    initRepo();
    const config = testConfig("docs");
    const content = "# Retry\n";
    write("docs/retry.md", content);
    const absolutePath = target("docs/retry.md");
    const oldTime = new Date("2026-01-01T00:00:00.000Z");
    fs.utimesSync(absolutePath, oldTime, oldTime);

    const result = await artifactToolbox(
      {
        action: "create_markdown_artifact",
        workspaceId: "neutral_workspace",
        params: { relativePath: "docs/retry.md", content, overwrite: true }
      },
      config,
      context(config)
    );

    assert.equal(result.ok, true);
    assert.equal((result.result as { status?: string }).status, "already_saved");
    assert.equal(fs.statSync(absolutePath).mtime.getTime(), oldTime.getTime());
  });

  it("rejects existing different content when overwrite is false and leaves bytes unchanged", async () => {
    initRepo();
    const config = testConfig("docs");
    write("docs/conflict.md", "Original\n");

    const result = await artifactToolbox(
      {
        action: "create_markdown_artifact",
        workspaceId: "neutral_workspace",
        params: { relativePath: "docs/conflict.md", content: "Replacement\n", overwrite: false }
      },
      config,
      context(config)
    );

    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "DESTINATION_EXISTS");
    assert.equal(fs.readFileSync(target("docs/conflict.md"), "utf8"), "Original\n");
  });

  it("atomically replaces existing different content when overwrite is true and removes temp files", async () => {
    initRepo();
    const config = testConfig("docs");
    write("artifacts/report.md", "Original\n");

    const result = await artifactToolbox(
      {
        action: "create_markdown_artifact",
        workspaceId: "neutral_workspace",
        params: { relativePath: "artifacts/report.md", content: "Replacement\n", overwrite: true }
      },
      config,
      context(config)
    );

    assert.equal(result.ok, true);
    assert.equal((result.result as { status?: string }).status, "saved");
    assert.equal(fs.readFileSync(target("artifacts/report.md"), "utf8"), "Replacement\n");
    assert.deepEqual(listTemporaryFiles(path.dirname(target("artifacts/report.md"))), []);
  });

  it("detects a pre-install raw-byte change and preserves the changed target", async () => {
    initRepo();
    const config = testConfig("docs");
    write("docs/race.md", "Original\n");

    await assert.rejects(
      () =>
        createMarkdownArtifact(
          { workspaceId: "neutral_workspace", relativePath: "docs/race.md", content: "Replacement\n", overwrite: true },
          config,
          {
            afterInitialSnapshot: (targetPath) => {
              fs.writeFileSync(targetPath, "Concurrent\n", "utf8");
            }
          }
        ),
      /changed before replacement/u
    );

    assert.equal(fs.readFileSync(target("docs/race.md"), "utf8"), "Concurrent\n");
  });

  it("restores original bytes after reread verification failure and removes temp files", async () => {
    initRepo();
    const config = testConfig("docs");
    write("docs/restore.md", "Original\n");

    await assert.rejects(
      () =>
        createMarkdownArtifact(
          { workspaceId: "neutral_workspace", relativePath: "docs/restore.md", content: "Replacement\n", overwrite: true },
          config,
          {
            afterReplaceBeforeVerify: (targetPath) => {
              fs.writeFileSync(targetPath, "Corrupt\n", "utf8");
            }
          }
        ),
      /verification failed/u
    );

    assert.equal(fs.readFileSync(target("docs/restore.md"), "utf8"), "Original\n");
    assert.deepEqual(listTemporaryFiles(path.dirname(target("docs/restore.md"))), []);
  });

  it("rejects unsafe paths, non-Markdown targets, blocked paths, symlink segments, and artifact-root escapes", async () => {
    initRepo();
    const config = testConfig("docs");
    const toolboxContext = context(config);
    const attempts = [
      { params: { relativePath: "../escape.md", content: "x" }, code: "PATH_DENIED" },
      { params: { relativePath: path.join(tempRoot, "docs", "absolute.md"), content: "x" }, code: "PATH_DENIED" },
      { params: { relativePath: "docs/CON.md", content: "x" }, code: "PATH_DENIED" },
      { params: { relativePath: "docs/file.md:ads", content: "x" }, code: "PATH_DENIED" },
      { params: { relativePath: "docs/file.txt", content: "x" }, code: "FILE_DENIED" },
      { params: { relativePath: ".git/config.md", content: "x" }, code: "FILE_DENIED" }
    ];

    for (const attempt of attempts) {
      const result = await artifactToolbox(
        { action: "create_markdown_artifact", workspaceId: "neutral_workspace", params: attempt.params },
        config,
        toolboxContext
      );
      assert.equal(result.ok, false);
      assert.equal(result.error?.code, attempt.code);
    }

    const safeLinkedDirectory = path.join(tempRoot, "linked-safe");
    fs.mkdirSync(safeLinkedDirectory);
    const linkPath = path.join(tempRoot, "docs", "linked");
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    let symlinkCreated = false;
    try {
      fs.symlinkSync(safeLinkedDirectory, linkPath, process.platform === "win32" ? "junction" : "dir");
      symlinkCreated = true;
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || !["EPERM", "EACCES"].includes(String(error.code))) {
        throw error;
      }
    }
    if (symlinkCreated) {
      const symlinkResult = await artifactToolbox(
        {
          action: "create_markdown_artifact",
          workspaceId: "neutral_workspace",
          params: { relativePath: "docs/linked/out.md", content: "x" }
        },
        config,
        toolboxContext
      );
      assert.equal(symlinkResult.ok, false);
      assert.equal(symlinkResult.error?.code, "PATH_DENIED");
    }

    const artifactConfig = artifactOnlyConfig(tempRoot, ["artifacts"]);
    const escape = await artifactToolbox(
      {
        action: "create_markdown_artifact",
        workspaceId: "artifact_workspace",
        params: { relativePath: "docs/out.md", content: "x" }
      },
      artifactConfig,
      context(artifactConfig)
    );
    assert.equal(escape.ok, false);
    assert.equal(escape.error?.code, "TARGET_OUTSIDE_ARTIFACT_ROOTS");
  });

  it("rejects oversized content before writing", async () => {
    initRepo();
    const config = testConfig("docs");

    const result = await artifactToolbox(
      {
        action: "create_markdown_artifact",
        workspaceId: "neutral_workspace",
        params: { relativePath: "docs/oversized.md", content: "x".repeat(MAX_MARKDOWN_ARTIFACT_CONTENT_LENGTH + 1) }
      },
      config,
      context(config)
    );

    assert.equal(result.ok, false);
    assert.equal(fs.existsSync(target("docs/oversized.md")), false);
  });

  it("rejects all non-contract params including hashes, workflow fields, and handoff fields", async () => {
    initRepo();
    const config = testConfig("docs");
    const forbiddenFields = [
      "handoffKind",
      "artifactType",
      "participationRole",
      "identity",
      "sourceRevisions",
      "artifactRevision",
      "workflowData",
      "disposition",
      "targetFamilies",
      "schemaName",
      "hash",
      "digest",
      "checksum",
      "revisionToken",
      "concurrencyToken",
      "authority"
    ];

    for (const field of forbiddenFields) {
      const result = await artifactToolbox(
        {
          action: "create_markdown_artifact",
          workspaceId: "neutral_workspace",
          params: { relativePath: `docs/${field}.md`, content: "x", [field]: "forbidden" }
        },
        config,
        context(config)
      );
      assert.equal(result.ok, false, `${field} must be rejected`);
      assert.equal(result.error?.code, "INVALID_INPUT");
      assert.equal(fs.existsSync(target(`docs/${field}.md`)), false);
    }
  });

  it("requires files.write and local docs write mode", async () => {
    initRepo();
    const config = testConfig("docs");
    const readOnly = await artifactToolbox(
      {
        action: "create_markdown_artifact",
        workspaceId: "neutral_workspace",
        params: { relativePath: "docs/no-scope.md", content: "x" }
      },
      config,
      context(config, "files.read")
    );
    const offConfig = testConfig("off");
    const writeModeOff = await artifactToolbox(
      {
        action: "create_markdown_artifact",
        workspaceId: "neutral_workspace",
        params: { relativePath: "docs/off.md", content: "x" }
      },
      offConfig,
      context(offConfig)
    );

    assert.equal(readOnly.ok, false);
    assert.equal(readOnly.error?.code, "APPROVAL_REQUIRED");
    assert.match(readOnly.error?.message ?? "", /files\.write/u);
    assert.equal(writeModeOff.ok, false);
    assert.equal(writeModeOff.error?.code, "APPROVAL_REQUIRED");
    assert.match(writeModeOff.error?.message ?? "", /writeMode docs, patch, or elevated/u);
  });
});
