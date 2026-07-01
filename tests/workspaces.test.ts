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
    assert.equal(catalog.diagnostics.defaultWorkspaceId, "workspace_a");
    assert.equal(diagnostics.defaultWorkspaceIsExplicit, true);
    assert.doesNotMatch(serialized, new RegExp(tempRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  });
});
