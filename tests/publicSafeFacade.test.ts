import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { type AppConfig } from "../src/config.js";
import {
  getChangeSetReadinessSummary,
  getReleaseArtifactSummary,
  getReleasePublicationSummary,
  getWorkspaceStatusSummary
} from "../src/tools/publicSafeFacade.js";

let tempRoot: string;
let auditRoot: string;

const EXPECTED_RELEASE_ASSET_NAME = "ChampCity GPT MCP Launcher-0.1.2-x64.exe";
const DOTTED_RELEASE_ASSET_NAME = "ChampCity.GPT.MCP.Launcher-0.1.2-x64.exe";

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-safe-facade-"));
  auditRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-safe-facade-audit-"));
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.rmSync(auditRoot, { recursive: true, force: true });
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
  git(tempRoot, ["remote", "add", "origin", "https://github.com/ChampCityChris/ChampCity_GPT_MCP.git"]);
  writeFile("README.md", "# Test\n");
  git(tempRoot, ["add", "README.md"]);
  git(tempRoot, ["commit", "-m", "Initial commit"]);
}

function writeFile(relativePath: string, content: string): void {
  const absolutePath = path.join(tempRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf8");
}

function writeReleaseProjectConfig(): void {
  writeFile("package.json", JSON.stringify({ name: "champcity-gpt", version: "0.1.2" }, null, 2));
  writeFile(
    "electron-builder.json",
    JSON.stringify(
      {
        productName: "ChampCity GPT MCP Launcher",
        directories: { output: "release" },
        win: { artifactName: "${productName}-${version}-${arch}.${ext}" }
      },
      null,
      2
    )
  );
}

function sha256Hex(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function mockReleaseFetch(release: Record<string, unknown>): { requestedUrl: () => string; restore: () => void } {
  let requestedUrl = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify(release), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  return {
    requestedUrl: () => requestedUrl,
    restore: () => {
      globalThis.fetch = originalFetch;
    }
  };
}

function testConfig(): AppConfig {
  return {
    repoRoot: tempRoot,
    allowedRoots: [tempRoot],
    workspaces: [{ workspaceId: "fixture_repo", label: "Fixture Repo", root: tempRoot, source: "configured" }],
    auditLogPath: path.join(auditRoot, "audit.log"),
    requireGitRoot: true,
    allowedCommands: [],
    writeToolsEnabled: false,
    writeToolsEnabledSource: "default",
    writeMode: "off",
    writeModeSource: "default",
    docsWritesAllowed: false,
    patchWritesAllowed: false,
    elevatedOperationsAllowed: false,
    writeApprovalToken: { source: "none" }
  };
}

function assertNoLocalUserPath(value: unknown): void {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /[A-Z]:\\Users\\/iu);
  assert.doesNotMatch(serialized, /\/Users\/[^/"']+/iu);
  assert.doesNotMatch(serialized, /\/home\/[^/"']+/iu);
}

describe("public-safe facade tools", () => {
  it("get_workspace_status_summary returns structured status with relative paths", async () => {
    initRepo("dev");
    writeFile("README.md", "# Test\n\nUpdated\n");
    writeFile("src/new.ts", "export const value = 1;\n");

    const result = await getWorkspaceStatusSummary({}, testConfig());

    assert.equal(result.workspaceId, "fixture_repo");
    assert.equal(result.workspaceLabel, "Fixture Repo");
    assert.equal(result.repositoryName, "ChampCityChris/ChampCity_GPT_MCP");
    assert.equal(result.branch, "dev");
    assert.equal(result.isClean, false);
    assert.equal(result.hasUncommittedChanges, true);
    assert.equal(result.trackedModifiedCount, 1);
    assert.equal(result.untrackedCount, 1);
    assert.deepEqual(result.relativeChangedPaths, ["README.md", "src/new.ts"]);
    assertNoLocalUserPath(result);
  });

  it("get_change_set_readiness_summary reports staged, unstaged, and untracked files without git mutation", async () => {
    initRepo("feature/safe-summary");
    writeFile("README.md", "# Test\n\nUpdated\n");
    writeFile("src/staged.ts", "export const staged = true;\n");
    writeFile("src/untracked.ts", "export const untracked = true;\n");
    git(tempRoot, ["add", "--", "src/staged.ts"]);
    const beforeStatus = git(tempRoot, ["status", "--short", "--untracked-files=all"]);

    const result = await getChangeSetReadinessSummary({ targetBranch: "feature" }, testConfig());
    const afterStatus = git(tempRoot, ["status", "--short", "--untracked-files=all"]);

    assert.equal(afterStatus, beforeStatus);
    assert.equal(result.branch, "feature/safe-summary");
    assert.equal(result.targetBranch, "feature");
    assert.equal(result.isClean, false);
    assert.deepEqual(result.stagedFiles, ["src/staged.ts"]);
    assert.deepEqual(result.unstagedFiles, ["README.md"]);
    assert.deepEqual(result.untrackedFiles, ["src/untracked.ts"]);
    assert.deepEqual(result.blockingFindings, []);
    assert.ok(result.recommendedNextSteps.some((entry) => /Staged files have no public-safety blockers/u.test(entry)));
    assertNoLocalUserPath(result);
  });

  it("get_release_artifact_summary maps releaseVersion to the expected final artifact", async () => {
    initRepo("dev");
    writeReleaseProjectConfig();
    const artifactName = EXPECTED_RELEASE_ASSET_NAME;
    writeFile(`release/${artifactName}`, "portable artifact placeholder\n");

    const result = await getReleaseArtifactSummary({ releaseVersion: "v0.1.2" }, testConfig());

    assert.equal(result.releaseVersion, "0.1.2");
    assert.deepEqual(result.expectedArtifactNames, [artifactName]);
    assert.equal(result.localArtifacts[0]?.relativePath, `release/${artifactName}`);
    assert.equal(result.localArtifacts[0]?.exists, true);
    assert.equal(
      result.localArtifacts[0]?.sha256,
      createHash("sha256").update("portable artifact placeholder\n").digest("hex")
    );
    assert.equal(result.releaseOutputPolicy.commitReleaseBinaries, false);
    assert.equal(result.releaseOutputPolicy.finalArtifactRequired, true);
    assert.equal(result.releaseOutputPolicy.intermediateArtifactsAccepted, false);
    assertNoLocalUserPath(result);
  });

  it("get_release_publication_summary looks up a tag and returns sanitized asset metadata", async () => {
    initRepo("dev");
    writeReleaseProjectConfig();
    const fetchMock = mockReleaseFetch({
      html_url: "https://github.com/ChampCityChris/ChampCity_GPT_MCP/releases/tag/v0.1.2",
      target_commitish: "main",
      draft: false,
      prerelease: false,
      published_at: "2026-06-01T00:00:00Z",
      assets: [
        {
          name: EXPECTED_RELEASE_ASSET_NAME,
          size: 1234,
          digest: "sha256:abc123",
          state: "uploaded"
        }
      ]
    });

    try {
      const result = await getReleasePublicationSummary({ tagName: "v0.1.2", includeAssets: true }, testConfig());

      assert.equal(fetchMock.requestedUrl(), "https://api.github.com/repos/ChampCityChris/ChampCity_GPT_MCP/releases/tags/v0.1.2");
      assert.equal(result.tagName, "v0.1.2");
      assert.equal(result.releaseExists, true);
      assert.equal((result as { releaseUrl?: string }).releaseUrl, "https://github.com/ChampCityChris/ChampCity_GPT_MCP/releases/tag/v0.1.2");
      assert.equal(result.expectedAssetMatched, true);
      assert.equal(result.expectedAssetMatchMethod, "exact_name");
      assert.deepEqual(result.blockers, []);
      assert.deepEqual((result as { assets?: unknown }).assets, [
        {
          name: EXPECTED_RELEASE_ASSET_NAME,
          sizeBytes: 1234,
          digest: "sha256:abc123",
          state: "uploaded"
        }
      ]);
      assertNoLocalUserPath(result);
    } finally {
      fetchMock.restore();
    }
  });

  it("get_release_publication_summary matches a renamed release asset by sha256 digest", async () => {
    initRepo("dev");
    writeReleaseProjectConfig();
    const artifactContent = "portable artifact placeholder\n";
    const artifactSha256 = sha256Hex(artifactContent);
    writeFile(`release/${EXPECTED_RELEASE_ASSET_NAME}`, artifactContent);
    const fetchMock = mockReleaseFetch({
      html_url: "https://github.com/ChampCityChris/ChampCity_GPT_MCP/releases/tag/v0.1.2",
      assets: [
        {
          name: DOTTED_RELEASE_ASSET_NAME,
          size: 9999,
          digest: `sha256:${artifactSha256}`,
          state: "uploaded"
        }
      ]
    });

    try {
      const result = await getReleasePublicationSummary({ tagName: "v0.1.2" }, testConfig());

      assert.equal(result.expectedAssetMatched, true);
      assert.equal(result.expectedAssetMatchMethod, "sha256");
      assert.deepEqual(result.blockers, []);
      assert.equal(result.warnings.some((warning) => /Expected release asset was not found/u.test(warning)), false);
      assertNoLocalUserPath(result);
    } finally {
      fetchMock.restore();
    }
  });

  it("get_release_publication_summary does not report sha256 when digest mismatches a similar asset name", async () => {
    initRepo("dev");
    writeReleaseProjectConfig();
    writeFile(`release/${EXPECTED_RELEASE_ASSET_NAME}`, "portable artifact placeholder\n");
    const fetchMock = mockReleaseFetch({
      html_url: "https://github.com/ChampCityChris/ChampCity_GPT_MCP/releases/tag/v0.1.2",
      assets: [
        {
          name: DOTTED_RELEASE_ASSET_NAME,
          size: 9999,
          digest: `sha256:${"0".repeat(64)}`,
          state: "uploaded"
        }
      ]
    });

    try {
      const result = await getReleasePublicationSummary({ tagName: "v0.1.2" }, testConfig());

      assert.equal(result.expectedAssetMatched, true);
      assert.equal(result.expectedAssetMatchMethod, "normalized_name");
      assert.notEqual(result.expectedAssetMatchMethod, "sha256");
      assertNoLocalUserPath(result);
    } finally {
      fetchMock.restore();
    }
  });

  it("get_release_publication_summary warns when the local artifact is missing and no asset name matches", async () => {
    initRepo("dev");
    writeReleaseProjectConfig();
    const fetchMock = mockReleaseFetch({
      html_url: "https://github.com/ChampCityChris/ChampCity_GPT_MCP/releases/tag/v0.1.2",
      assets: [
        {
          name: "Other.Release.Asset-0.1.2-x64.exe",
          size: 1234,
          digest: `sha256:${"f".repeat(64)}`,
          state: "uploaded"
        }
      ]
    });

    try {
      const result = await getReleasePublicationSummary({ tagName: "v0.1.2" }, testConfig());

      assert.equal(result.expectedAssetMatched, false);
      assert.equal(result.expectedAssetMatchMethod, "not_matched");
      assert.ok(result.warnings.some((warning) => /Expected release asset was not found/u.test(warning)));
      assert.ok(result.warnings.some((warning) => /Expected local release artifact was not found/u.test(warning)));
      assertNoLocalUserPath(result);
    } finally {
      fetchMock.restore();
    }
  });
});
