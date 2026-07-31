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
import { SUPPORTED_ARTIFACT_ACTIONS } from "../src/tools/toolboxActionPolicy.js";

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

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function concurrentCreates(contentA: string, contentB: string) {
  initRepo();
  const config = testConfig("docs");
  const ready = deferred<void>();
  let waiting = 0;
  const waitForBoth = async () => {
    waiting += 1;
    if (waiting === 2) {
      ready.resolve();
    }
    await ready.promise;
  };

  const first = createMarkdownArtifact(
    { workspaceId: "neutral_workspace", relativePath: "docs/concurrent.md", content: contentA },
    config,
    { beforeFinalInstall: waitForBoth }
  );
  const second = createMarkdownArtifact(
    { workspaceId: "neutral_workspace", relativePath: "docs/concurrent.md", content: contentB },
    config,
    { beforeFinalInstall: waitForBoth }
  );

  return Promise.allSettled([first, second]);
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

  it("allows only one concurrent missing-target create with different bytes and preserves the winner", async () => {
    const results = await concurrentCreates("First winner\n", "Second winner\n");
    const saved = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    assert.equal(saved.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(saved[0].status, "fulfilled");
    assert.equal(saved[0].value.status, "saved");
    assert.equal(rejected[0].status, "rejected");
    assert.match(String(rejected[0].reason), /already exists with different content/u);
    assert.equal(["First winner\n", "Second winner\n"].includes(fs.readFileSync(target("docs/concurrent.md"), "utf8")), true);
    assert.deepEqual(listTemporaryFiles(path.dirname(target("docs/concurrent.md"))), []);
  });

  it("returns saved plus already_saved for concurrent identical missing-target creates without rewriting the winner", async () => {
    const results = await concurrentCreates("Same bytes\n", "Same bytes\n");
    const fulfilled = results.map((result) => {
      assert.equal(result.status, "fulfilled");
      return result.value.status;
    });
    const absolutePath = target("docs/concurrent.md");
    const mtime = fs.statSync(absolutePath).mtimeMs;

    assert.deepEqual(fulfilled.sort(), ["already_saved", "saved"]);
    assert.equal(fs.readFileSync(absolutePath, "utf8"), "Same bytes\n");
    assert.equal(fs.statSync(absolutePath).mtimeMs, mtime);
    assert.deepEqual(listTemporaryFiles(path.dirname(absolutePath)), []);
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

  it("does not overwrite a target that appears after the missing-target observation", async () => {
    initRepo();
    const config = testConfig("docs");

    await assert.rejects(
      () =>
        createMarkdownArtifact(
          { workspaceId: "neutral_workspace", relativePath: "docs/appeared.md", content: "Requested\n", overwrite: false },
          config,
          {
            afterMissingTargetObserved: (targetPath) => {
              fs.mkdirSync(path.dirname(targetPath), { recursive: true });
              fs.writeFileSync(targetPath, "Concurrent\n", "utf8");
            }
          }
        ),
      /already exists with different content/u
    );

    assert.equal(fs.readFileSync(target("docs/appeared.md"), "utf8"), "Concurrent\n");
  });

  it("removes a created final file after exclusive-create failure without deleting another file", async () => {
    initRepo();
    const config = testConfig("docs");

    await assert.rejects(
      () =>
        createMarkdownArtifact(
          { workspaceId: "neutral_workspace", relativePath: "docs/partial.md", content: "Requested\n" },
          config,
          {
            afterCreateFileOpened: () => {
              throw new Error("Injected create failure");
            }
          }
        ),
      /Injected create failure/u
    );

    assert.equal(fs.existsSync(target("docs/partial.md")), false);
    assert.deepEqual(listTemporaryFiles(path.dirname(target("docs/partial.md"))), []);
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

  it("surfaces rollback-write failure instead of suppressing it", async () => {
    initRepo();
    const config = testConfig("docs");
    write("docs/rollback-write.md", "Original\n");

    await assert.rejects(
      () =>
        createMarkdownArtifact(
          { workspaceId: "neutral_workspace", relativePath: "docs/rollback-write.md", content: "Replacement\n", overwrite: true },
          config,
          {
            afterReplaceBeforeVerify: (targetPath) => {
              fs.writeFileSync(targetPath, "Corrupt\n", "utf8");
            },
            restoreOriginalBytesOverride: async () => {
              throw new Error("Injected rollback write failure");
            }
          }
        ),
      /rollback was unsuccessful/u
    );

    assert.equal(fs.readFileSync(target("docs/rollback-write.md"), "utf8"), "Corrupt\n");
    assert.deepEqual(listTemporaryFiles(path.dirname(target("docs/rollback-write.md"))), []);
  });

  it("surfaces rollback-verification mismatch instead of claiming restoration", async () => {
    initRepo();
    const config = testConfig("docs");
    write("docs/rollback-mismatch.md", "Original\n");

    await assert.rejects(
      () =>
        createMarkdownArtifact(
          { workspaceId: "neutral_workspace", relativePath: "docs/rollback-mismatch.md", content: "Replacement\n", overwrite: true },
          config,
          {
            afterReplaceBeforeVerify: (targetPath) => {
              fs.writeFileSync(targetPath, "Corrupt\n", "utf8");
            },
            afterRollbackBeforeVerify: (targetPath) => {
              fs.writeFileSync(targetPath, "Wrong restored bytes\n", "utf8");
            }
          }
        ),
      /rollback was unsuccessful/u
    );

    assert.equal(fs.readFileSync(target("docs/rollback-mismatch.md"), "utf8"), "Wrong restored bytes\n");
    assert.deepEqual(listTemporaryFiles(path.dirname(target("docs/rollback-mismatch.md"))), []);
  });

  it("revalidates each newly created parent directory", async () => {
    initRepo();
    const config = testConfig("docs");
    const validatedSegments: string[] = [];

    const result = await createMarkdownArtifact(
      { workspaceId: "neutral_workspace", relativePath: "docs/new-parent/child.md", content: "Nested\n" },
      config,
      {
        afterParentSegmentValidated: (_segmentPath, relativePath) => {
          validatedSegments.push(relativePath);
        }
      }
    );

    assert.equal(result.status, "saved");
    assert.deepEqual(validatedSegments, ["docs", "docs/new-parent"]);
    assert.equal(fs.readFileSync(target("docs/new-parent/child.md"), "utf8"), "Nested\n");
  });

  it("rejects a parent symlink or junction introduced after initial resolution without writing outside the workspace", async () => {
    initRepo();
    const config = testConfig("docs");
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-create-md-outside-"));
    let fixtureCreated = false;
    let caughtError: unknown;
    try {
      await createMarkdownArtifact(
        { workspaceId: "neutral_workspace", relativePath: "docs/raced-parent/out.md", content: "No escape\n" },
        config,
        {
          afterParentSegmentValidated: (segmentPath, relativePath) => {
            if (relativePath !== "docs" || fixtureCreated) {
              return;
            }
            fs.rmSync(segmentPath, { recursive: true, force: true });
            try {
              fs.symlinkSync(outside, segmentPath, process.platform === "win32" ? "junction" : "dir");
              fixtureCreated = true;
            } catch (error) {
              if (!error || typeof error !== "object" || !("code" in error) || !["EPERM", "EACCES"].includes(String(error.code))) {
                throw error;
              }
            }
          }
        }
      );
    } catch (error) {
      caughtError = error;
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }

    if (fixtureCreated) {
      assert.match(String(caughtError), /parent paths must be regular directories/u);
      assert.equal(fs.existsSync(path.join(outside, "raced-parent", "out.md")), false);
    } else {
      assert.equal(caughtError, undefined);
      assert.equal(fs.readFileSync(target("docs/raced-parent/out.md"), "utf8"), "No escape\n");
    }
  });

  it("revalidates the final parent real path immediately before installation", async () => {
    initRepo();
    const config = testConfig("docs");
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-create-md-final-outside-"));
    let fixtureCreated = false;
    let caughtError: unknown;
    try {
      await createMarkdownArtifact(
        { workspaceId: "neutral_workspace", relativePath: "docs/final-parent/out.md", content: "No escape\n" },
        config,
        {
          afterParentChainValidated: (parentPath) => {
            if (fixtureCreated) {
              return;
            }
            fs.rmSync(parentPath, { recursive: true, force: true });
            try {
              fs.symlinkSync(outside, parentPath, process.platform === "win32" ? "junction" : "dir");
              fixtureCreated = true;
            } catch (error) {
              if (!error || typeof error !== "object" || !("code" in error) || !["EPERM", "EACCES"].includes(String(error.code))) {
                throw error;
              }
            }
          }
        }
      );
    } catch (error) {
      caughtError = error;
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }

    if (fixtureCreated) {
      assert.match(String(caughtError), /parent paths must be regular directories/u);
      assert.equal(fs.existsSync(path.join(outside, "out.md")), false);
    } else {
      assert.equal(caughtError, undefined);
      assert.equal(fs.readFileSync(target("docs/final-parent/out.md"), "utf8"), "No escape\n");
    }
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

  it("keeps the artifact action inventory bounded and submit_handoff_outputs unsupported", async () => {
    initRepo();
    const config = testConfig("docs");

    assert.equal(SUPPORTED_ARTIFACT_ACTIONS.includes("create_markdown_artifact"), true);
    assert.equal(SUPPORTED_ARTIFACT_ACTIONS.includes("submit_handoff_outputs" as never), false);

    const result = await artifactToolbox(
      {
        action: "submit_handoff_outputs",
        workspaceId: "neutral_workspace",
        params: {}
      },
      config,
      context(config)
    );

    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "INVALID_INPUT");
    assert.equal((result.error?.details?.supportedActions as string[] | undefined)?.includes("submit_handoff_outputs"), false);
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
