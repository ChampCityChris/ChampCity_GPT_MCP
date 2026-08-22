import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { type AppConfig } from "../src/config.js";
import { getWorkspaceDiagnostics, listWorkspaceCatalog, resolveWorkspace } from "../src/workspaces.js";

let tempRoot: string;
let auditRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-workspaces-"));
  auditRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-workspaces-audit-"));
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.rmSync(auditRoot, { recursive: true, force: true });
});

function testConfig(allowedRoots: string[], overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    repoRoot: allowedRoots[0],
    allowedRoots,
    auditLogPath: path.join(auditRoot, "audit.log"),
    requireGitRoot: false,
    allowedCommands: [],
    writeToolsEnabled: false,
    writeToolsEnabledSource: "default",
    writeMode: "off",
    writeModeSource: "default",
    docsWritesAllowed: false,
    patchWritesAllowed: false,
    elevatedOperationsAllowed: false,
    writeApprovalToken: { source: "none" },
    ...overrides
  };
}

describe("workspace registry", () => {
  it("routes default only when the workspace is deterministic", () => {
    const workspaceA = path.join(tempRoot, "Workspace_A");
    const workspaceB = path.join(tempRoot, "Workspace_B");
    fs.mkdirSync(workspaceA, { recursive: true });
    fs.mkdirSync(workspaceB, { recursive: true });

    const single = resolveWorkspace("default", testConfig([workspaceA]));
    const explicitDefault = resolveWorkspace(
      "default",
      testConfig([workspaceA, workspaceB], {
        defaultWorkspaceId: "workspace_b"
      })
    );

    assert.equal(single.workspaceId, "workspace_a");
    assert.equal(single.root, fs.realpathSync.native(workspaceA));
    assert.equal(explicitDefault.workspaceId, "workspace_b");
    assert.equal(explicitDefault.root, fs.realpathSync.native(workspaceB));
    assert.throws(() => resolveWorkspace("default", testConfig([workspaceA, workspaceB])), (error: unknown) => {
      assert.equal((error as { code?: string }).code, "WORKSPACE_REQUIRED");
      assert.deepEqual((error as { details?: { availableWorkspaceIds?: string[] } }).details?.availableWorkspaceIds, [
        "workspace_a",
        "workspace_b"
      ]);
      return true;
    });
  });

  it("rejects unsafe or unknown workspace IDs without treating them as paths", () => {
    const workspaceA = path.join(tempRoot, "Workspace_A");
    fs.mkdirSync(workspaceA, { recursive: true });
    const config = testConfig([workspaceA]);
    const pathLikeWorkspaceId = ["C:", "Us" + "ers", "Alice", "Project"].join("\\");

    assert.throws(() => resolveWorkspace(pathLikeWorkspaceId, config), /safe lowercase server-defined alias/i);
    assert.throws(() => resolveWorkspace("../workspace_a", config), /safe lowercase server-defined alias/i);
    assert.throws(() => resolveWorkspace("unknown_workspace", config), (error: unknown) => {
      assert.equal((error as { code?: string }).code, "WORKSPACE_NOT_FOUND");
      assert.deepEqual((error as { details?: { availableWorkspaceIds?: string[] } }).details?.availableWorkspaceIds, ["workspace_a"]);
      return true;
    });
  });

  it("lists safe workspace catalog metadata without absolute roots", async () => {
    const workspaceA = path.join(tempRoot, "Workspace_A");
    const workspaceB = path.join(tempRoot, "Workspace_B");
    fs.mkdirSync(workspaceA, { recursive: true });
    fs.mkdirSync(workspaceB, { recursive: true });
    const config = testConfig([workspaceA, workspaceB], {
      workspaces: [
        {
          workspaceId: "workspace_a",
          label: "Workspace A",
          root: workspaceA,
          remote: "https://github.com/ChampCityChris/Workspace_A.git",
          source: "configured"
        },
        { workspaceId: "workspace_b", label: "Workspace B", root: workspaceB, source: "configured" }
      ],
      defaultWorkspaceId: "workspace_a"
    });

    const catalog = await listWorkspaceCatalog(config);
    const diagnostics = getWorkspaceDiagnostics(config);
    const serialized = JSON.stringify(catalog);

    assert.deepEqual(catalog.workspaces.map((workspace) => workspace.workspaceId), ["workspace_a", "workspace_b"]);
    assert.equal(catalog.workspaces[0]?.isDefault, true);
    assert.equal(catalog.workspaces[0]?.remoteMatchesExpected, "unknown");
    assert.equal(catalog.workspaces[0]?.writePolicy, "git_required");
    assert.equal(catalog.workspaces[0]?.gitDetected, false);
    assert.equal(catalog.workspaces[0]?.artifactPersistenceAvailable, false);
    assert.equal(catalog.workspaces[0]?.artifactPersistenceReason, "ARTIFACT_PERSISTENCE_PREREQUISITE_UNMET");
    assert.equal(catalog.workspaces[0]?.gitMutationAvailable, false);
    assert.match(catalog.workspaces[0]?.gitMutationReason ?? "", /GIT_CAPABILITY_UNAVAILABLE/u);
    assert.equal(catalog.diagnostics.defaultWorkspaceId, "workspace_a");
    assert.equal(diagnostics.defaultWorkspaceIsExplicit, true);
    assert.doesNotMatch(serialized, new RegExp(tempRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  });

  it("maps legacy requireGitRoot false only to bounded non-Git derived planning workspaces", async () => {
    const workspaceA = path.join(tempRoot, "Workspace_A");
    fs.mkdirSync(workspaceA, { recursive: true });
    const config = testConfig([workspaceA], { requireGitRoot: false });

    const resolved = resolveWorkspace("default", config);
    const catalog = await listWorkspaceCatalog(config);

    assert.equal(resolved.writePolicy, "artifact_only");
    assert.deepEqual(resolved.artifactWriteRoots, ["planning"]);
    assert.equal(resolved.legacyRequireGitRootDeprecated, true);
    assert.equal(catalog.workspaces[0]?.capabilityConfig.workspaceCapabilities.artifactPersistence, "enabled");
    assert.equal(catalog.workspaces[0]?.artifactPersistenceAvailable, false);
    assert.equal(catalog.workspaces[0]?.gitMutationAvailable, false);
    assert.ok(catalog.workspaces[0]?.warnings.some((warning) => /deprecated/i.test(warning)));
  });

  it("preserves explicit workspace capabilities in catalog compatibility metadata and authoritative summaries", async () => {
    const workspaceA = path.join(tempRoot, "Workspace_A");
    fs.mkdirSync(path.join(workspaceA, ".git"), { recursive: true });
    const config = testConfig([workspaceA], {
      workspaces: [
        {
          workspaceId: "workspace_a",
          label: "Workspace A",
          root: workspaceA,
          source: "configured",
          workspaceCapabilities: {
            artifactPersistence: "disabled",
            patchWorkflow: "disabled",
            gitOperations: "disabled",
            releaseOperations: "disabled"
          }
        }
      ],
      defaultWorkspaceId: "workspace_a"
    });

    const catalog = await listWorkspaceCatalog(config);
    const workspace = catalog.workspaces[0];

    assert.equal(workspace?.branch, "unknown");
    assert.deepEqual(workspace?.capabilityConfig.workspaceCapabilities, {
      artifactPersistence: "disabled",
      patchWorkflow: "disabled",
      gitOperations: "disabled",
      releaseOperations: "disabled"
    });
    assert.equal(workspace?.capabilities.artifactPersistence.available, false);
    assert.equal(workspace?.capabilities.artifactPersistence.reasonCode, "ARTIFACT_PERSISTENCE_DISABLED");
    assert.equal(workspace?.capabilities.patchWorkflow.available, false);
    assert.equal(workspace?.capabilities.patchWorkflow.reasonCode, "PATCH_WORKFLOW_DISABLED");
    assert.equal(workspace?.capabilities.gitInspection.available, false);
    assert.equal(workspace?.capabilities.gitInspection.reasonCode, "GIT_OPERATIONS_DISABLED");
    assert.equal(workspace?.capabilities.gitMutation.reasonCode, "GIT_OPERATIONS_DISABLED");
    assert.equal(workspace?.capabilities.releaseInspection.available, false);
    assert.equal(workspace?.capabilities.releaseInspection.reasonCode, "RELEASE_OPERATIONS_DISABLED");
    assert.equal(workspace?.capabilities.releasePublication.reasonCode, "RELEASE_OPERATIONS_DISABLED");
    assert.equal(workspace?.artifactPersistenceAvailable, false);
    assert.equal(workspace?.artifactPersistenceReason, "ARTIFACT_PERSISTENCE_DISABLED");
    assert.equal(workspace?.gitMutationAvailable, false);
    assert.equal(workspace?.gitMutationReason, "GIT_OPERATIONS_DISABLED");
  });

  it("keeps legacy requireGitRoot false Git repositories git_required", () => {
    const workspaceA = path.join(tempRoot, "Workspace_A");
    fs.mkdirSync(path.join(workspaceA, ".git"), { recursive: true });
    const resolved = resolveWorkspace("default", testConfig([workspaceA], { requireGitRoot: false }));

    assert.equal(resolved.writePolicy, "git_required");
    assert.equal(resolved.legacyRequireGitRootDeprecated, false);
  });
});
