import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

import { type AppConfig } from "../src/config.js";
import { readPendingPatchStore } from "../src/pendingPatches.js";
import { createToolboxRuntimeContext, toolResponse } from "../src/server/registerTools.js";
import { gitStatus as legacyGitStatus } from "../src/tools/gitStatus.js";
import {
  artifactToolbox,
  browserToolbox,
  buildRuntimeScopeToolDiagnostics,
  diagnosticsToolbox,
  gitToolbox,
  integrationToolbox,
  knowledgeToolbox,
  repoToolbox
} from "../src/tools/domainToolboxes.js";
import { getWriteAccessStatus } from "../src/tools/getWriteAccessStatus.js";
import { readProjectFile } from "../src/tools/readProjectFile.js";

let tempRoot: string;
let auditRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-domain-toolboxes-"));
  auditRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-domain-toolboxes-audit-"));
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.rmSync(auditRoot, { recursive: true, force: true });
});

function git(args: string[]): string {
  return gitIn(tempRoot, args);
}

function gitIn(root: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function writeFile(relativePath: string, content: string): void {
  writeFileIn(tempRoot, relativePath, content);
}

function writeFileIn(root: string, relativePath: string, content: string): void {
  const absolutePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf8");
}

function writeBinaryFile(relativePath: string, content: Buffer): void {
  const absolutePath = path.join(tempRoot, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
}

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function initRepo(): void {
  git(["init"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test User"]);
  git(["checkout", "-b", "main"]);
  writeFile("README.md", "# Test\n");
  writeFile("package.json", `${JSON.stringify({ name: "champcity-toolbox-fixture", version: "0.1.2" }, null, 2)}\n`);
  git(["add", "README.md", "package.json"]);
  git(["commit", "-m", "Initial commit"]);
  git(["checkout", "-b", "dev"]);
}

function initRepoAt(root: string, branch: string, packageName: string, reportMarker?: string): void {
  fs.mkdirSync(root, { recursive: true });
  gitIn(root, ["init"]);
  gitIn(root, ["config", "user.email", "test@example.com"]);
  gitIn(root, ["config", "user.name", "Test User"]);
  gitIn(root, ["checkout", "-b", branch]);
  writeFileIn(root, "README.md", `# ${packageName}\n`);
  writeFileIn(root, "package.json", `${JSON.stringify({ name: packageName, version: "0.1.2" }, null, 2)}\n`);
  if (reportMarker) {
    writeFileIn(
      root,
      "planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-FIX04_fixture.md",
      `# ${packageName} Report\n\n${reportMarker}\n`
    );
  }
  gitIn(root, ["add", "README.md", "package.json"]);
  if (reportMarker) {
    gitIn(root, ["add", "planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-FIX04_fixture.md"]);
  }
  gitIn(root, ["commit", "-m", "Initial commit"]);
}

function installGitProcessTrap(root: string) {
  const fakeBin = path.join(auditRoot, `fake-git-${Date.now()}`);
  const marker = path.join(auditRoot, `git-called-${Date.now()}.txt`);
  fs.mkdirSync(fakeBin, { recursive: true });
  const originalPath = process.env.PATH;
  const originalTrap = process.env.CHAMPCITY_GIT_TRAP;
  process.env.CHAMPCITY_GIT_TRAP = marker;

  if (process.platform === "win32") {
    fs.copyFileSync(process.execPath, path.join(fakeBin, "git.exe"));
    const trapScript = "require('node:fs').writeFileSync(process.env.CHAMPCITY_GIT_TRAP, process.argv.join(' ')); process.exit(23);\n";
    fs.writeFileSync(path.join(root, "branch"), trapScript, "utf8");
    fs.writeFileSync(path.join(root, "status"), trapScript, "utf8");
    fs.writeFileSync(path.join(root, "remote"), trapScript, "utf8");
  } else {
    const gitPath = path.join(fakeBin, "git");
    fs.writeFileSync(gitPath, "#!/bin/sh\nprintf '%s' \"$*\" > \"$CHAMPCITY_GIT_TRAP\"\nexit 23\n", "utf8");
    fs.chmodSync(gitPath, 0o755);
  }

  process.env.PATH = `${fakeBin}${path.delimiter}${originalPath ?? ""}`;

  return {
    marker,
    restore: () => {
      process.env.PATH = originalPath;
      if (originalTrap === undefined) {
        delete process.env.CHAMPCITY_GIT_TRAP;
      } else {
        process.env.CHAMPCITY_GIT_TRAP = originalTrap;
      }
    }
  };
}

function testConfig(
  writeMode: AppConfig["writeMode"] = "off",
  root = tempRoot,
  allowedRoots = [root],
  defaultWorkspaceRoot = root,
  defaultWorkspaceRootSource: AppConfig["defaultWorkspaceRootSource"] = "repoRoot"
): AppConfig {
  return {
    repoRoot: root,
    allowedRoots,
    defaultWorkspaceRoot,
    defaultWorkspaceRootSource,
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
    writeApprovalToken: { source: "none" }
  };
}

function context(config: AppConfig, scope: string) {
  return createToolboxRuntimeContext(config, { scope });
}

describe("stable domain toolbox tools", () => {
  it("diagnostics_toolbox.runtime_status returns runtime and registered tool-count data", async () => {
    initRepo();
    const config = testConfig("off");
    const result = await diagnosticsToolbox({ action: "runtime_status" }, config, context(config, "files.read"));

    assert.equal(result.ok, true);
    assert.equal(result.toolbox, "diagnostics_toolbox");
    assert.equal(result.action, "runtime_status");
    assert.equal(typeof (result.result as { packageVersion?: unknown }).packageVersion, "string");

    const exposure = await diagnosticsToolbox({ action: "tool_exposure_status" }, config, context(config, "files.read"));
    assert.equal(exposure.ok, true);
    assert.equal(typeof (exposure.result as { registeredToolCount?: unknown }).registeredToolCount, "number");
    assert.ok((exposure.result as { registeredToolboxNames?: string[] }).registeredToolboxNames?.includes("repo_toolbox"));
  });

  it("diagnostics_toolbox.runtime_status reports matching runtime and workspace package versions", async () => {
    initRepo();
    const config = testConfig("off");
    const result = await diagnosticsToolbox({ action: "runtime_status" }, config, context(config, "files.read"));
    const runtime = result.result as {
      packageVersion?: unknown;
      runtimePackageVersion?: unknown;
      selectedWorkspacePackageVersion?: unknown;
      packageVersionMatch?: unknown;
      runtimeDriftDetected?: unknown;
      warnings?: unknown;
    };

    assert.equal(result.ok, true);
    assert.equal(runtime.packageVersion, "0.1.2");
    assert.equal(runtime.runtimePackageVersion, "0.1.2");
    assert.equal(runtime.selectedWorkspacePackageVersion, "0.1.2");
    assert.equal(runtime.packageVersionMatch, true);
    assert.equal(runtime.runtimeDriftDetected, false);
    assert.deepEqual(runtime.warnings, []);
  });

  it("diagnostics_toolbox.runtime_status does not compare runtime package version to an unrelated workspace", async () => {
    initRepo();
    const workspaceRoot = path.join(auditRoot, "workspace");
    initRepoAt(workspaceRoot, "dev", "workspace-fixture");
    writeFileIn(workspaceRoot, "package.json", `${JSON.stringify({ name: "workspace-fixture", version: "9.9.9" }, null, 2)}\n`);
    const config: AppConfig = {
      ...testConfig("off", tempRoot, [workspaceRoot], workspaceRoot, "local-file"),
      workspaces: [{ workspaceId: "selected_workspace", label: "Selected Workspace", root: workspaceRoot, source: "configured" }],
      defaultWorkspaceId: "selected_workspace",
      defaultWorkspaceIdSource: "local-file"
    };
    const result = await diagnosticsToolbox(
      { action: "runtime_status", workspaceId: "selected_workspace" },
      config,
      context(config, "files.read")
    );
    const runtime = result.result as {
      runtimePackageVersion?: unknown;
      selectedWorkspacePackageVersion?: unknown;
      packageVersionMatch?: unknown;
      runtimeDriftDetected?: unknown;
      warnings?: string[];
      runtimeSourceCommit?: unknown;
      selectedWorkspaceHead?: unknown;
      targetWorkspace?: { alignment?: unknown };
    };
    const serialized = JSON.stringify(result);

    assert.equal(result.ok, true);
    assert.equal(runtime.runtimePackageVersion, "0.1.2");
    assert.equal(runtime.selectedWorkspacePackageVersion, "9.9.9");
    assert.equal(runtime.packageVersionMatch, "not_applicable");
    assert.equal(runtime.runtimeDriftDetected, false);
    assert.deepEqual(runtime.warnings, []);
    assert.equal(result.warnings?.length, 0);
    assert.equal(runtime.targetWorkspace?.alignment, "not_applicable");
    assert.match(String(runtime.runtimeSourceCommit), /^[a-f0-9]{7,40}$|^unknown$/u);
    assert.match(String(runtime.selectedWorkspaceHead), /^[a-f0-9]{7,40}$|^unknown$/u);
    assert.doesNotMatch(serialized, new RegExp(tempRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    assert.doesNotMatch(serialized, new RegExp(workspaceRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    assert.doesNotMatch(serialized, /access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization[_-]?code/iu);
  });

  it("diagnostics_toolbox.runtime_status reports unknown package match when workspace package metadata is missing", async () => {
    initRepo();
    const workspaceRoot = path.join(auditRoot, "workspace-no-package");
    fs.mkdirSync(workspaceRoot, { recursive: true });
    gitIn(workspaceRoot, ["init"]);
    gitIn(workspaceRoot, ["config", "user.email", "test@example.com"]);
    gitIn(workspaceRoot, ["config", "user.name", "Test User"]);
    gitIn(workspaceRoot, ["checkout", "-b", "dev"]);
    writeFileIn(workspaceRoot, "README.md", "# No package metadata\n");
    gitIn(workspaceRoot, ["add", "README.md"]);
    gitIn(workspaceRoot, ["commit", "-m", "Initial commit"]);
    const config: AppConfig = {
      ...testConfig("off", tempRoot, [workspaceRoot], workspaceRoot, "local-file"),
      workspaces: [{ workspaceId: "workspace_no_package", label: "Workspace Without Package", root: workspaceRoot, source: "configured" }],
      defaultWorkspaceId: "workspace_no_package",
      defaultWorkspaceIdSource: "local-file"
    };
    const result = await diagnosticsToolbox(
      { action: "runtime_status", workspaceId: "workspace_no_package" },
      config,
      context(config, "files.read")
    );
    const runtime = result.result as {
      selectedWorkspacePackageVersion?: unknown;
      packageVersionMatch?: unknown;
      runtimeDriftDetected?: unknown;
      warnings?: unknown;
    };

    assert.equal(result.ok, true);
    assert.equal(runtime.selectedWorkspacePackageVersion, "unknown");
    assert.equal(runtime.packageVersionMatch, "not_applicable");
    assert.equal(runtime.runtimeDriftDetected, false);
    assert.deepEqual(runtime.warnings, []);
  });

  it("diagnostics_toolbox.oauth_scope_status and get_write_access_status do not expose tokens", async () => {
    initRepo();
    const config = testConfig("docs");
    const runtimeDiagnostics = await buildRuntimeScopeToolDiagnostics(config, context(config, "files.read"));
    const status = await getWriteAccessStatus({}, config, runtimeDiagnostics);
    const oauth = await diagnosticsToolbox({ action: "oauth_scope_status" }, config, context(config, "files.read"));
    const serialized = JSON.stringify({ status, oauth });

    assert.equal(status.diagnostics?.oauth.filesReadGranted, true);
    assert.equal(status.diagnostics?.oauth.filesWriteGranted, false);
    assert.equal(oauth.ok, true);
    assert.doesNotMatch(serialized, /access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization[_-]?code/iu);
  });

  it("repo_toolbox and git_toolbox reject unknown actions with supported actions", async () => {
    initRepo();
    const config = testConfig("off");
    const repoResult = await repoToolbox({ action: "unknown_action" }, config, context(config, "files.read"));
    const gitResult = await gitToolbox({ action: "unknown_action" }, config, context(config, "files.read"));

    assert.equal(repoResult.ok, false);
    assert.equal(repoResult.error?.code, "INVALID_INPUT");
    assert.ok(Array.isArray(repoResult.error?.details?.supportedActions));
    assert.equal(gitResult.ok, false);
    assert.equal(gitResult.error?.code, "INVALID_INPUT");
    assert.ok(Array.isArray(gitResult.error?.details?.supportedActions));
  });

  it("artifact_toolbox.read_image_artifact returns PNG pixels as MCP image content and safe structured metadata", async () => {
    initRepo();
    const relativePath = "planning/phases/phase-v1.0/evidence/screenshots/example.png";
    writeBinaryFile(relativePath, ONE_PIXEL_PNG);
    const config: AppConfig = {
      ...testConfig("off"),
      workspaces: [{ workspaceId: "test_workspace", label: "Test Workspace", root: tempRoot, source: "configured" }],
      defaultWorkspaceId: "test_workspace",
      defaultWorkspaceIdSource: "local-file"
    };

    const toolboxResult = await artifactToolbox(
      {
        action: "read_image_artifact",
        workspaceId: "test_workspace",
        params: { path: relativePath }
      },
      config,
      context(config, "files.read")
    );
    const mcpResult = toolResponse(toolboxResult);
    const textContent = mcpResult.content.find((entry) => entry.type === "text");
    const imageContent = mcpResult.content.find((entry) => entry.type === "image");
    const metadata = mcpResult.structuredContent as Record<string, unknown>;

    assert.equal(toolboxResult.ok, true);
    assert.doesNotThrow(() => CallToolResultSchema.parse(mcpResult));
    assert.equal(textContent?.type, "text");
    assert.equal(textContent?.type === "text" ? textContent.text : "", `Loaded image artifact: ${relativePath}`);
    assert.equal(imageContent?.type, "image");
    assert.equal(imageContent?.type === "image" ? imageContent.mimeType : "", "image/png");
    assert.equal(imageContent?.type === "image" ? imageContent.data : "", ONE_PIXEL_PNG.toString("base64"));
    assert.equal((textContent?.type === "text" ? textContent.text : "").includes(ONE_PIXEL_PNG.toString("base64")), false);
    assert.equal(JSON.stringify(metadata).includes(ONE_PIXEL_PNG.toString("base64")), false);
    assert.equal(metadata.path, relativePath);
    assert.equal(metadata.workspaceId, "test_workspace");
    assert.equal(metadata.mimeType, "image/png");
    assert.equal(metadata.sizeBytes, ONE_PIXEL_PNG.length);
    assert.equal(metadata.width, 1);
    assert.equal(metadata.height, 1);
    assert.match(String(metadata.sha256), /^[a-f0-9]{64}$/u);
    assert.equal(typeof metadata.lastModifiedAt, "string");
  });

  it("artifact_toolbox.read_image_artifact rejects unsafe paths and non-evidence locations", async () => {
    initRepo();
    const relativePath = "planning/evidence/example.png";
    writeBinaryFile(relativePath, ONE_PIXEL_PNG);
    writeBinaryFile("src/example.png", ONE_PIXEL_PNG);
    writeBinaryFile("planning/secrets/example.png", ONE_PIXEL_PNG);
    const config = testConfig("off");
    const toolboxContext = context(config, "files.read");

    const traversal = await artifactToolbox(
      { action: "read_image_artifact", params: { path: "../secret.png" } },
      config,
      toolboxContext
    );
    const absolute = await artifactToolbox(
      { action: "read_image_artifact", params: { path: path.join(tempRoot, ...relativePath.split("/")) } },
      config,
      toolboxContext
    );
    const arbitraryDirectory = await artifactToolbox(
      { action: "read_image_artifact", params: { path: "src/example.png" } },
      config,
      toolboxContext
    );
    const secretsDirectory = await artifactToolbox(
      { action: "read_image_artifact", params: { path: "planning/secrets/example.png" } },
      config,
      toolboxContext
    );

    assert.equal(traversal.error?.code, "PATH_DENIED");
    assert.equal(absolute.error?.code, "PATH_DENIED");
    assert.equal(arbitraryDirectory.error?.code, "FILE_DENIED");
    assert.equal(secretsDirectory.error?.code, "FILE_DENIED");
  });

  it("artifact_toolbox.read_image_artifact rejects unsupported, oversized, spoofed, and missing files", async () => {
    initRepo();
    const oversizedPng = Buffer.alloc(5_000_001);
    ONE_PIXEL_PNG.copy(oversizedPng);
    writeBinaryFile("planning/evidence/unsupported.txt", ONE_PIXEL_PNG);
    writeBinaryFile("planning/evidence/oversized.png", oversizedPng);
    writeBinaryFile("planning/evidence/spoofed.png", Buffer.from("not a png", "utf8"));
    const config = testConfig("off");
    const toolboxContext = context(config, "files.read");

    const unsupported = await artifactToolbox(
      { action: "read_image_artifact", params: { path: "planning/evidence/unsupported.txt" } },
      config,
      toolboxContext
    );
    const oversized = await artifactToolbox(
      { action: "read_image_artifact", params: { path: "planning/evidence/oversized.png" } },
      config,
      toolboxContext
    );
    const spoofed = await artifactToolbox(
      { action: "read_image_artifact", params: { path: "planning/evidence/spoofed.png" } },
      config,
      toolboxContext
    );
    const missing = await artifactToolbox(
      { action: "read_image_artifact", params: { path: "planning/evidence/missing.png" } },
      config,
      toolboxContext
    );

    assert.equal(unsupported.error?.code, "FILE_DENIED");
    assert.equal(oversized.error?.code, "FILE_DENIED");
    assert.equal(spoofed.error?.code, "FILE_DENIED");
    assert.equal(missing.error?.code, "FILE_DENIED");
  });

  it("artifact_toolbox.read_image_artifact rejects a final path outside the workspace root", async () => {
    initRepo();
    const outsideDirectory = path.join(auditRoot, "outside-images");
    fs.mkdirSync(outsideDirectory, { recursive: true });
    fs.writeFileSync(path.join(outsideDirectory, "escape.png"), ONE_PIXEL_PNG);
    const linkPath = path.join(tempRoot, "planning", "evidence", "outside-link");
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.symlinkSync(outsideDirectory, linkPath, process.platform === "win32" ? "junction" : "dir");
    const config = testConfig("off");

    const result = await artifactToolbox(
      { action: "read_image_artifact", params: { path: "planning/evidence/outside-link/escape.png" } },
      config,
      context(config, "files.read")
    );

    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "PATH_DENIED");
  });

  it("routes default toolbox workspaces to the configured allowed root in packaged runtime configs", async () => {
    initRepo();
    writeFile(
      "planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-FIX03_toolbox_default_workspace_routing.md",
      "# Packaged Workspace Report\n\nConfigured default workspace marker.\n"
    );
    const packagedAppRoot = path.join(auditRoot, "resources", "app.asar");
    fs.mkdirSync(packagedAppRoot, { recursive: true });
    fs.writeFileSync(path.join(packagedAppRoot, "package.json"), JSON.stringify({ name: "champcity-gpt", version: "0.1.2" }), "utf8");
    const config = testConfig("off", packagedAppRoot, [tempRoot], tempRoot, "local-file");
    const toolboxContext = context(config, "files.read");

    const repoRead = await repoToolbox(
      { action: "read_file", params: { relativePath: "README.md" } },
      config,
      toolboxContext
    );
    const repoStatus = await repoToolbox({ action: "status" }, config, toolboxContext);
    const gitStatusResult = await gitToolbox({ action: "status" }, config, toolboxContext);
    const reportSummary = await artifactToolbox(
      {
        action: "builder_report_summary",
        params: {
          phaseFolder: "phase-v1.0",
          workCardId: "WC-V1-FIX03"
        }
      },
      config,
      toolboxContext
    );

    assert.equal(repoRead.ok, true);
    assert.equal((repoRead.result as { relativePath?: string }).relativePath, "README.md");
    assert.match((repoRead.result as { content?: string }).content ?? "", /# Test/u);
    assert.equal(repoStatus.ok, true);
    assert.equal((repoStatus.result as { git?: { status?: { branch?: string } } }).git?.status?.branch, "dev");
    assert.equal(gitStatusResult.ok, true);
    assert.equal((gitStatusResult.result as { branch?: string }).branch, "dev");
    assert.equal(reportSummary.ok, true);
    assert.equal((reportSummary.result as { matched?: boolean }).matched, true);
    assert.match((reportSummary.result as { contentPreview?: string }).contentPreview ?? "", /Configured default workspace marker/u);

    const unknownWorkspace = await repoToolbox(
      { action: "status", workspaceId: "unknown_workspace" },
      config,
      toolboxContext
    );
    const rootParamSmuggle = await repoToolbox(
      { action: "read_file", params: { root: packagedAppRoot, relativePath: "README.md" } },
      config,
      toolboxContext
    );
    const legacyRead = await readProjectFile({ root: tempRoot, relativePath: "README.md" }, config);
    const legacyGit = await legacyGitStatus({ root: tempRoot }, config);

    assert.equal(unknownWorkspace.ok, false);
    assert.equal(unknownWorkspace.error?.code, "WORKSPACE_NOT_FOUND");
    assert.equal(rootParamSmuggle.ok, false);
    assert.equal(rootParamSmuggle.error?.code, "INVALID_INPUT");
    assert.equal(legacyRead.relativePath, "README.md");
    assert.equal(legacyGit.branch, "dev");
  });

  it("repo_toolbox lists nested directories with diagnostics and searches by path, filename, and content", async () => {
    initRepo();
    writeFile("planning/phases/phase-04/README.md", "# Phase 04\n");
    writeFile(
      "planning/phases/phase-04/Implementer_Reports/WC03_IMPLEMENTER_REPORT.md",
      "# WC03 Report\n\nDistinct WC03 corpus marker.\n"
    );
    fs.mkdirSync(path.join(tempRoot, "planning", "phases", "phase-04", "Empty"), { recursive: true });
    const config = testConfig("off");
    const toolboxContext = context(config, "files.read");

    const phaseList = await repoToolbox(
      { action: "list_files", params: { relativePath: "planning\\phases\\phase-04" } },
      config,
      toolboxContext
    );
    const reportsList = await repoToolbox(
      { action: "list_files", params: { relativePath: "planning/phases/phase-04/Implementer_Reports" } },
      config,
      toolboxContext
    );
    const emptyList = await repoToolbox(
      { action: "list_files", params: { relativePath: "planning/phases/phase-04/Empty" } },
      config,
      toolboxContext
    );
    const missingList = await repoToolbox(
      { action: "list_files", params: { relativePath: "planning/phases/phase-04/Missing" } },
      config,
      toolboxContext
    );
    const traversal = await repoToolbox(
      { action: "list_files", params: { relativePath: "../outside" } },
      config,
      toolboxContext
    );
    const exactPathSearch = await repoToolbox(
      {
        action: "search_files",
        params: { query: "planning/phases/phase-04/Implementer_Reports/WC03_IMPLEMENTER_REPORT.md" }
      },
      config,
      toolboxContext
    );
    const filenameSearch = await repoToolbox(
      { action: "search_files", params: { query: "WC03_IMPLEMENTER_REPORT.md", scopePath: "planning/phases/phase-04" } },
      config,
      toolboxContext
    );
    const contentSearch = await repoToolbox(
      { action: "search_files", params: { query: "Distinct WC03 corpus marker", scopePath: "planning/phases/phase-04" } },
      config,
      toolboxContext
    );

    assert.equal(phaseList.ok, true);
    assert.ok((phaseList.result as { files?: string[] }).files?.includes("planning/phases/phase-04/Implementer_Reports/WC03_IMPLEMENTER_REPORT.md"));
    assert.equal((phaseList.result as { diagnostics?: { pathExists?: boolean; returnedEntryCount?: number } }).diagnostics?.pathExists, true);
    assert.equal(reportsList.ok, true);
    assert.deepEqual((reportsList.result as { files?: string[] }).files, ["planning/phases/phase-04/Implementer_Reports/WC03_IMPLEMENTER_REPORT.md"]);
    assert.equal((emptyList.result as { diagnostics?: { pathExists?: boolean; returnedEntryCount?: number } }).diagnostics?.pathExists, true);
    assert.equal((emptyList.result as { diagnostics?: { returnedEntryCount?: number } }).diagnostics?.returnedEntryCount, 0);
    assert.equal((missingList.result as { diagnostics?: { pathExists?: boolean; errorCode?: string } }).diagnostics?.pathExists, false);
    assert.equal((missingList.result as { diagnostics?: { errorCode?: string } }).diagnostics?.errorCode, "path_not_found");
    assert.equal(traversal.ok, false);
    assert.equal(traversal.error?.code, "PATH_DENIED");
    assert.equal((exactPathSearch.result as { matches?: Array<{ relativePath?: string; matchType?: string }> }).matches?.[0]?.relativePath, "planning/phases/phase-04/Implementer_Reports/WC03_IMPLEMENTER_REPORT.md");
    assert.equal((exactPathSearch.result as { matches?: Array<{ matchType?: string }> }).matches?.[0]?.matchType, "path");
    assert.equal((filenameSearch.result as { matches?: Array<{ matchType?: string }> }).matches?.[0]?.matchType, "filename");
    assert.equal((contentSearch.result as { matches?: Array<{ lineNumber?: number; matchType?: string }> }).matches?.[0]?.matchType, "content");
  });

  it("routes repo, git, artifact, and diagnostics toolbox actions by explicit workspace ID", async () => {
    const gptRoot = path.join(tempRoot, "ChampCity_GPT");
    const aiRoot = path.join(tempRoot, "ChampCity_AI");
    const rpRoot = path.join(tempRoot, "ChampCity_RP_Desktop");
    initRepoAt(gptRoot, "feature/gpt-fixture", "champcity-gpt-fixture", "GPT report marker");
    initRepoAt(aiRoot, "feature/ai-fixture", "champcity-ai-fixture", "AI report marker");
    initRepoAt(rpRoot, "feature/rp-fixture", "champcity-rp-fixture", "RP report marker");

    const config: AppConfig = {
      ...testConfig("off", gptRoot, [gptRoot, aiRoot, rpRoot], undefined),
      workspaces: [
        { workspaceId: "champcity_gpt", label: "ChampCity GPT MCP", root: gptRoot, source: "configured" },
        { workspaceId: "champcity_ai", label: "ChampCity AI", root: aiRoot, source: "configured" },
        { workspaceId: "champcity_rp_desktop", label: "ChampCity RP Desktop", root: rpRoot, source: "configured" }
      ]
    };
    const toolboxContext = context(config, "files.read");

    const gptPackage = await repoToolbox(
      { action: "read_file", workspaceId: "champcity_gpt", params: { relativePath: "package.json" } },
      config,
      toolboxContext
    );
    const aiPackage = await repoToolbox(
      { action: "read_file", workspaceId: "champcity_ai", params: { relativePath: "package.json" } },
      config,
      toolboxContext
    );
    const rpPackage = await repoToolbox(
      { action: "read_file", workspaceId: "champcity_rp_desktop", params: { relativePath: "package.json" } },
      config,
      toolboxContext
    );
    const gptGit = await gitToolbox({ action: "status", workspaceId: "champcity_gpt" }, config, toolboxContext);
    const aiGit = await gitToolbox({ action: "status", workspaceId: "champcity_ai" }, config, toolboxContext);
    const aiReport = await artifactToolbox(
      {
        action: "builder_report_summary",
        workspaceId: "champcity_ai",
        params: { phaseFolder: "phase-v1.0", workCardId: "WC-V1-FIX04" }
      },
      config,
      toolboxContext
    );
    const catalog = await diagnosticsToolbox({ action: "list_workspaces" }, config, toolboxContext);
    const ambiguousDefault = await repoToolbox({ action: "status", workspaceId: "default" }, config, toolboxContext);
    const unknownWorkspace = await repoToolbox({ action: "status", workspaceId: "unknown_workspace" }, config, toolboxContext);

    assert.equal(gptPackage.ok, true);
    assert.match((gptPackage.result as { content?: string }).content ?? "", /champcity-gpt-fixture/u);
    assert.equal(aiPackage.ok, true);
    assert.match((aiPackage.result as { content?: string }).content ?? "", /champcity-ai-fixture/u);
    assert.equal(rpPackage.ok, true);
    assert.match((rpPackage.result as { content?: string }).content ?? "", /champcity-rp-fixture/u);
    assert.equal(gptGit.ok, true);
    assert.equal((gptGit.result as { branch?: string }).branch, "feature/gpt-fixture");
    assert.equal(aiGit.ok, true);
    assert.equal((aiGit.result as { branch?: string }).branch, "feature/ai-fixture");
    assert.equal(aiReport.ok, true);
    assert.match((aiReport.result as { contentPreview?: string }).contentPreview ?? "", /AI report marker/u);
    assert.equal(catalog.ok, true);
    const catalogResult = catalog.result as { workspaces?: Array<{ workspaceId?: string }>; diagnostics?: { registeredWorkspaceCount?: number } };
    assert.equal(catalogResult.diagnostics?.registeredWorkspaceCount, 3);
    assert.deepEqual(catalogResult.workspaces?.map((workspace) => workspace.workspaceId).sort(), [
      "champcity_ai",
      "champcity_gpt",
      "champcity_rp_desktop"
    ]);
    assert.doesNotMatch(JSON.stringify(catalog.result), new RegExp(tempRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    assert.equal(ambiguousDefault.ok, false);
    assert.equal(ambiguousDefault.error?.code, "WORKSPACE_REQUIRED");
    assert.deepEqual(ambiguousDefault.error?.details?.availableWorkspaceIds, [
      "champcity_ai",
      "champcity_gpt",
      "champcity_rp_desktop"
    ]);
    assert.equal(unknownWorkspace.ok, false);
    assert.equal(unknownWorkspace.error?.code, "WORKSPACE_NOT_FOUND");
  });

  it("git_toolbox.prepare_work_branch delegates to the safe branch tool in a temp repo", async () => {
    initRepo();
    const config = testConfig("elevated");
    const result = await gitToolbox(
      {
        action: "prepare_work_branch",
        params: {
          branchKind: "feature",
          workCardId: "WC-V1-FIX02",
          slug: "stable-domain-toolboxes"
        }
      },
      config,
      context(config, "files.read files.write")
    );

    assert.equal(result.ok, true);
    assert.equal((result.result as { branchAfter?: string }).branchAfter, "feature/WC-V1-FIX02-stable-domain-toolboxes");
    assert.equal(git(["branch", "--show-current"]), "feature/WC-V1-FIX02-stable-domain-toolboxes");
  });

  it("git_toolbox write actions fail safely without files.write", async () => {
    initRepo();
    const config = testConfig("elevated");
    const result = await gitToolbox({ action: "stage_paths", params: { paths: ["README.md"] } }, config, context(config, "files.read"));

    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "APPROVAL_REQUIRED");
    assert.match(result.error?.message ?? "", /files\.write/u);
  });

  it("treats a registered non-Git workspace as valid for reads, status, safety, and artifact writes", async () => {
    fs.mkdirSync(tempRoot, { recursive: true });
    writeFile("planning/project-intake.md", "# Project Intake\n\nRevisionary-like planning input.\n");
    const config: AppConfig = {
      ...testConfig("docs"),
      requireGitRoot: true,
      workspaces: [
        {
          workspaceId: "revisionary",
          label: "Revisionary",
          root: tempRoot,
          source: "configured",
          writePolicy: "git_required"
        }
      ],
      defaultWorkspaceId: "revisionary",
      defaultWorkspaceIdSource: "local-file"
    };
    const readContext = context(config, "files.read");
    const writeContext = context(config, "files.read files.write");

    const read = await repoToolbox(
      { action: "read_file", workspaceId: "revisionary", params: { relativePath: "planning/project-intake.md" } },
      config,
      readContext
    );
    const list = await repoToolbox(
      { action: "list_files", workspaceId: "revisionary", params: { relativePath: "planning" } },
      config,
      readContext
    );
    const search = await repoToolbox(
      { action: "search_files", workspaceId: "revisionary", params: { query: "Revisionary-like", scopePath: "planning" } },
      config,
      readContext
    );
    const status = await repoToolbox({ action: "status", workspaceId: "revisionary" }, config, readContext);
    const runtimeStatus = await diagnosticsToolbox({ action: "runtime_status", workspaceId: "revisionary" }, config, readContext);
    const safety = await diagnosticsToolbox({ action: "workspace_safety_status", workspaceId: "revisionary" }, config, readContext);
    const deprecatedSafety = await diagnosticsToolbox({ action: "public_safety_status", workspaceId: "revisionary" }, config, readContext);
    const markdown = await repoToolbox(
      { action: "write_markdown_artifact", workspaceId: "revisionary", params: { relativePath: "planning/draft.md", content: "# Draft\n" } },
      config,
      writeContext
    );
    const json = await repoToolbox(
      { action: "write_json_artifact", workspaceId: "revisionary", params: { relativePath: "planning/draft.json", content: "{\"ok\":true}" } },
      config,
      writeContext
    );
    const gitStatus = await gitToolbox({ action: "status", workspaceId: "revisionary" }, config, readContext);
    const gitDiff = await gitToolbox({ action: "diff", workspaceId: "revisionary" }, config, readContext);
    const patch = await repoToolbox(
      {
        action: "propose_patch",
        workspaceId: "revisionary",
        params: { changes: [{ relativePath: "planning/project-intake.md", originalText: "Project", replacementText: "Updated" }] }
      },
      { ...config, writeMode: "patch", patchWritesAllowed: true },
      context({ ...config, writeMode: "patch", patchWritesAllowed: true }, "files.read files.write")
    );

    assert.equal(read.ok, true);
    assert.equal(list.ok, true);
    assert.equal(search.ok, true);
    assert.equal(status.ok, true);
    assert.equal((status.result as { git?: { status?: { status?: string } } }).git?.status?.status, "not_git_repository");
    assert.equal(runtimeStatus.ok, true);
    assert.equal((runtimeStatus.result as { targetWorkspace?: { head?: string } }).targetWorkspace?.head, "unknown");
    assert.equal(safety.ok, true);
    assert.equal((safety.result as { checks?: { gitCapabilitiesAreOptional?: boolean } }).checks?.gitCapabilitiesAreOptional, true);
    assert.equal(deprecatedSafety.ok, true);
    assert.equal((deprecatedSafety.result as { deprecation?: { replacementAction?: string } }).deprecation?.replacementAction, "workspace_safety_status");
    assert.equal(markdown.ok, true);
    assert.equal(json.ok, true);
    assert.equal(gitStatus.ok, true);
    assert.equal((gitStatus.result as { status?: string }).status, "not_git_repository");
    assert.equal(gitDiff.ok, true);
    assert.equal((gitDiff.result as { status?: string }).status, "not_git_repository");
    assert.equal(patch.ok, false);
    assert.equal(patch.error?.code, "GIT_CAPABILITY_UNAVAILABLE");
    assert.doesNotMatch(JSON.stringify({ status: status.result, safety: safety.result, read, markdown, json }), /GIT_REQUIRED/u);
  });

  it("public toolbox diagnostics and execution honor explicit disabled workspace capabilities", async () => {
    initRepo();
    const config: AppConfig = {
      ...testConfig("elevated"),
      workspaces: [
        {
          workspaceId: "locked_repo",
          label: "Locked Repo",
          root: tempRoot,
          source: "configured",
          workspaceCapabilities: {
            artifactPersistence: "disabled",
            patchWorkflow: "disabled",
            gitOperations: "disabled",
            releaseOperations: "disabled"
          }
        }
      ],
      defaultWorkspaceId: "locked_repo",
      defaultWorkspaceIdSource: "local-file"
    };
    const toolboxContext = context(config, "files.read files.write");

    const list = await diagnosticsToolbox({ action: "list_workspaces", workspaceId: "locked_repo" }, config, toolboxContext);
    const writeAccess = await diagnosticsToolbox({ action: "write_access_status", workspaceId: "locked_repo" }, config, toolboxContext);
    const gitTrap = installGitProcessTrap(tempRoot);
    let status: Awaited<ReturnType<typeof repoToolbox>> | undefined;
    let safety: Awaited<ReturnType<typeof diagnosticsToolbox>> | undefined;
    let gitStatus: Awaited<ReturnType<typeof gitToolbox>> | undefined;
    try {
      status = await repoToolbox({ action: "status", workspaceId: "locked_repo" }, config, toolboxContext);
      safety = await diagnosticsToolbox({ action: "workspace_safety_status", workspaceId: "locked_repo" }, config, toolboxContext);
      gitStatus = await gitToolbox({ action: "status", workspaceId: "locked_repo" }, config, toolboxContext);
    } finally {
      gitTrap.restore();
    }
    assert.ok(status);
    assert.ok(safety);
    assert.ok(gitStatus);
    const write = await repoToolbox(
      {
        action: "write_markdown_artifact",
        workspaceId: "locked_repo",
        params: { relativePath: "docs/blocked.md", content: "# Blocked\n" }
      },
      config,
      toolboxContext
    );
    const patch = await repoToolbox(
      {
        action: "propose_patch",
        workspaceId: "locked_repo",
        params: { changes: [{ relativePath: "README.md", originalText: "# Test", replacementText: "# Updated" }] }
      },
      config,
      toolboxContext
    );

    const listedWorkspace = (list.result as { workspaces?: Array<{ capabilities?: Record<string, { available?: boolean; reasonCode?: string }>; artifactPersistenceAvailable?: boolean; gitMutationAvailable?: boolean }> }).workspaces?.[0];
    const writeAuthority = (writeAccess.result as { workspaceWriteAuthority?: Array<{ capabilities?: Record<string, { available?: boolean; reasonCode?: string }>; artifactPersistenceAvailable?: boolean; gitMutationReason?: string }> }).workspaceWriteAuthority?.[0];
    const statusResult = status.result as {
      artifactPersistence?: { available?: boolean; reasonCode?: string };
      patchCapability?: { available?: boolean; reasonCode?: string };
      git?: { inspection?: { available?: boolean; reasonCode?: string }; status?: { status?: string; reasonCode?: string } };
      release?: { inspection?: { available?: boolean; reasonCode?: string } };
    };
    const safetyResult = safety.result as { git?: { status?: { status?: string; reasonCode?: string } } };

    assert.equal(list.ok, true);
    assert.equal(listedWorkspace?.capabilities?.artifactPersistence.reasonCode, "ARTIFACT_PERSISTENCE_DISABLED");
    assert.equal(listedWorkspace?.capabilities?.patchWorkflow.reasonCode, "PATCH_WORKFLOW_DISABLED");
    assert.equal(listedWorkspace?.capabilities?.gitInspection.reasonCode, "GIT_OPERATIONS_DISABLED");
    assert.equal(listedWorkspace?.capabilities?.releaseInspection.reasonCode, "RELEASE_OPERATIONS_DISABLED");
    assert.equal(listedWorkspace?.artifactPersistenceAvailable, false);
    assert.equal(listedWorkspace?.gitMutationAvailable, false);
    assert.equal(writeAccess.ok, true);
    assert.equal(writeAuthority?.capabilities?.artifactPersistence.reasonCode, "ARTIFACT_PERSISTENCE_DISABLED");
    assert.equal(writeAuthority?.artifactPersistenceAvailable, false);
    assert.equal(writeAuthority?.gitMutationReason, "GIT_OPERATIONS_DISABLED");
    assert.equal(status.ok, true);
    assert.equal(statusResult.artifactPersistence?.reasonCode, "ARTIFACT_PERSISTENCE_DISABLED");
    assert.equal(statusResult.patchCapability?.reasonCode, "PATCH_WORKFLOW_DISABLED");
    assert.equal(statusResult.git?.inspection?.reasonCode, "GIT_OPERATIONS_DISABLED");
    assert.equal(statusResult.git?.status?.status, "git_inspection_disabled");
    assert.equal(statusResult.git?.status?.reasonCode, "GIT_OPERATIONS_DISABLED");
    assert.equal(statusResult.release?.inspection?.reasonCode, "RELEASE_OPERATIONS_DISABLED");
    assert.equal(safety.ok, true);
    assert.equal(safetyResult.git?.status?.status, "git_inspection_disabled");
    assert.equal(safetyResult.git?.status?.reasonCode, "GIT_OPERATIONS_DISABLED");
    assert.equal(fs.existsSync(gitTrap.marker), false);
    assert.equal(write.ok, false);
    assert.equal(write.error?.code, "WORKSPACE_POLICY_DENIED");
    assert.equal(patch.ok, false);
    assert.equal(patch.error?.code, "WORKSPACE_POLICY_DENIED");
    assert.equal(gitStatus.ok, true);
    assert.equal((gitStatus.result as { reasonCode?: string }).reasonCode, "WORKSPACE_POLICY_DENIED");
  });

  it("artifact_toolbox release summaries reject release-disabled workspaces before release state inspection", async () => {
    initRepo();
    const config: AppConfig = {
      ...testConfig("elevated"),
      workspaces: [
        {
          workspaceId: "release_disabled",
          label: "Release Disabled",
          root: tempRoot,
          source: "configured",
          workspaceCapabilities: {
            releaseOperations: "disabled"
          }
        }
      ],
      defaultWorkspaceId: "release_disabled",
      defaultWorkspaceIdSource: "local-file"
    };
    const toolboxContext = context(config, "files.read files.write");
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    try {
      const artifact = await artifactToolbox(
        { action: "release_artifact_summary", workspaceId: "release_disabled", params: { releaseVersion: "v0.1.2" } },
        config,
        toolboxContext
      );
      const publication = await artifactToolbox(
        { action: "release_publication_summary", workspaceId: "release_disabled", params: { tagName: "v0.1.2", includeAssets: true } },
        config,
        toolboxContext
      );
      const read = await repoToolbox(
        { action: "read_file", workspaceId: "release_disabled", params: { relativePath: "README.md" } },
        config,
        toolboxContext
      );
      const status = await repoToolbox({ action: "status", workspaceId: "release_disabled" }, config, toolboxContext);

      assert.equal(artifact.ok, false);
      assert.equal(artifact.error?.code, "WORKSPACE_POLICY_DENIED");
      assert.equal(publication.ok, false);
      assert.equal(publication.error?.code, "WORKSPACE_POLICY_DENIED");
      assert.equal(fetchCalled, false);
      assert.equal(read.ok, true);
      assert.equal(status.ok, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("artifact_toolbox release summaries reject git-disabled and non-release-capable workspaces before release probes", async () => {
    initRepo();
    const toolboxContextFor = (config: AppConfig) => context(config, "files.read files.write");
    const gitDisabledConfig: AppConfig = {
      ...testConfig("elevated"),
      workspaces: [
        {
          workspaceId: "git_disabled_release",
          label: "Git Disabled Release",
          root: tempRoot,
          source: "configured",
          workspaceCapabilities: {
            gitOperations: "disabled"
          }
        }
      ],
      defaultWorkspaceId: "git_disabled_release",
      defaultWorkspaceIdSource: "local-file"
    };
    const nonReleaseConfig: AppConfig = {
      ...testConfig("elevated"),
      workspaces: [
        {
          workspaceId: "ordinary_repo",
          label: "Ordinary Repo",
          root: tempRoot,
          source: "configured"
        }
      ],
      defaultWorkspaceId: "ordinary_repo",
      defaultWorkspaceIdSource: "local-file"
    };
    for (const config of [gitDisabledConfig, nonReleaseConfig]) {
      const catalog = await diagnosticsToolbox({ action: "list_workspaces", workspaceId: config.defaultWorkspaceId }, config, toolboxContextFor(config));
      const listedWorkspace = (catalog.result as { workspaces?: Array<{ capabilities?: { releaseInspection?: { available?: boolean } } }> }).workspaces?.[0];

      assert.equal(catalog.ok, true);
      assert.equal(listedWorkspace?.capabilities?.releaseInspection?.available, false);
    }

    const originalFetch = globalThis.fetch;
    const originalExistsSync = fs.existsSync;
    let fetchCalled = false;
    let releasePathChecked = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    fs.existsSync = ((target: fs.PathLike) => {
      const targetText = String(target).replace(/\\/gu, "/");
      if (targetText.includes("/release/")) {
        releasePathChecked = true;
      }
      return originalExistsSync(target);
    }) as typeof fs.existsSync;
    const gitTrap = installGitProcessTrap(tempRoot);

    try {
      for (const config of [gitDisabledConfig, nonReleaseConfig]) {
        const artifact = await artifactToolbox(
          { action: "release_artifact_summary", workspaceId: config.defaultWorkspaceId, params: { releaseVersion: "v0.1.2" } },
          config,
          toolboxContextFor(config)
        );
        const publication = await artifactToolbox(
          { action: "release_publication_summary", workspaceId: config.defaultWorkspaceId, params: { tagName: "v0.1.2", includeAssets: true } },
          config,
          toolboxContextFor(config)
        );

        assert.equal(artifact.ok, false);
        assert.equal(artifact.error?.code, "WORKSPACE_POLICY_DENIED");
        assert.equal(publication.ok, false);
        assert.equal(publication.error?.code, "WORKSPACE_POLICY_DENIED");
      }
      assert.equal(fetchCalled, false);
      assert.equal(releasePathChecked, false);
      assert.equal(fs.existsSync(gitTrap.marker), false);
    } finally {
      gitTrap.restore();
      globalThis.fetch = originalFetch;
      fs.existsSync = originalExistsSync;
    }
  });

  it("git_toolbox mutations are denied for artifact-only workspaces", async () => {
    fs.mkdirSync(path.join(tempRoot, ".git"), { recursive: true });
    const config = testConfig("elevated");
    config.workspaces = [
      {
        workspaceId: "planning_workspace",
        label: "Planning Workspace",
        root: tempRoot,
        source: "configured",
        writePolicy: "artifact_only",
        artifactWriteRoots: ["planning"],
        artifactRootWarnings: []
      }
    ];
    config.defaultWorkspaceId = "planning_workspace";

    const result = await gitToolbox(
      { action: "stage_paths", workspaceId: "planning_workspace", params: { paths: ["README.md"] } },
      config,
      context(config, "files.read files.write")
    );

    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "WORKSPACE_POLICY_DENIED");
  });

  it("repo_toolbox writes Markdown and JSON artifacts while rejecting unsafe JSON params", async () => {
    initRepo();
    const config = testConfig("docs");
    const toolboxContext = context(config, "files.read files.write");

    const markdown = await repoToolbox(
      { action: "write_markdown_artifact", params: { relativePath: "docs/note.md", content: "# Note\n" } },
      config,
      toolboxContext
    );
    const json = await repoToolbox(
      { action: "write_json_artifact", params: { relativePath: "docs/data.json", content: "{\"b\":2,\"a\":1}" } },
      config,
      toolboxContext
    );
    const invalidJson = await repoToolbox(
      { action: "write_json_artifact", params: { relativePath: "docs/bad.json", content: "{broken" } },
      config,
      toolboxContext
    );
    const nonJson = await repoToolbox(
      { action: "write_json_artifact", params: { relativePath: "docs/data.txt", content: "{}" } },
      config,
      toolboxContext
    );
    const rootSmuggle = await repoToolbox(
      { action: "write_json_artifact", params: { root: auditRoot, relativePath: "docs/data.json", content: "{}" } },
      config,
      toolboxContext
    );
    const blocked = await repoToolbox(
      { action: "write_json_artifact", params: { relativePath: "logs/status.json", content: "{}" } },
      config,
      toolboxContext
    );
    const missingScope = await repoToolbox(
      { action: "write_json_artifact", params: { relativePath: "docs/no-scope.json", content: "{}" } },
      config,
      context(config, "files.read")
    );
    const writeModeOff = await repoToolbox(
      { action: "write_json_artifact", params: { relativePath: "docs/off.json", content: "{}" } },
      testConfig("off"),
      context(testConfig("off"), "files.read files.write")
    );

    assert.equal(markdown.ok, true);
    assert.equal(fs.readFileSync(path.join(tempRoot, "docs", "note.md"), "utf8"), "# Note\n");
    assert.equal(json.ok, true);
    assert.equal(fs.readFileSync(path.join(tempRoot, "docs", "data.json"), "utf8"), "{\n  \"b\": 2,\n  \"a\": 1\n}\n");
    assert.match((json.result as { sha256?: string }).sha256 ?? "", /^[a-f0-9]{64}$/u);
    assert.equal(typeof (json.result as { modifiedTime?: string }).modifiedTime, "string");
    assert.equal(invalidJson.ok, false);
    assert.equal(invalidJson.error?.code, "INVALID_INPUT");
    assert.equal(nonJson.ok, false);
    assert.equal(nonJson.error?.code, "FILE_DENIED");
    assert.equal(rootSmuggle.ok, false);
    assert.equal(rootSmuggle.error?.code, "INVALID_INPUT");
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error?.code, "FILE_DENIED");
    assert.equal(missingScope.ok, false);
    assert.equal(missingScope.error?.code, "APPROVAL_REQUIRED");
    assert.match(missingScope.error?.message ?? "", /files\.write/u);
    assert.equal(writeModeOff.ok, false);
    assert.equal(writeModeOff.error?.code, "APPROVAL_REQUIRED");
    assert.match(writeModeOff.error?.message ?? "", /writeMode docs, patch, or elevated/u);
  });

  it("repo_toolbox proposes and applies approved patches without accepting public roots", async () => {
    initRepo();
    const config = testConfig("patch");
    const toolboxContext = context(config, "files.read files.write");

    const proposal = await repoToolbox(
      {
        action: "propose_patch",
        params: {
          changes: [{ relativePath: "README.md", originalText: "# Test", replacementText: "# Patched" }]
        }
      },
      config,
      toolboxContext
    );
    assert.equal(proposal.ok, true);
    const proposed = proposal.result as { patch: string; proposalId: string; patchHash: string };

    const apply = await repoToolbox(
      {
        action: "apply_approved_patch",
        params: {
          patch: proposed.patch,
          proposalId: proposed.proposalId,
          patchHash: proposed.patchHash
        }
      },
      config,
      toolboxContext
    );
    const rootSmuggle = await repoToolbox(
      {
        action: "propose_patch",
        params: {
          root: auditRoot,
          changes: [{ relativePath: "README.md", originalText: "# Patched", replacementText: "# Smuggled" }]
        }
      },
      config,
      toolboxContext
    );
    const missingScope = await repoToolbox(
      {
        action: "propose_patch",
        params: {
          changes: [{ relativePath: "README.md", originalText: "# Patched", replacementText: "# No Scope" }]
        }
      },
      config,
      context(config, "files.read")
    );
    const docsApply = await repoToolbox(
      {
        action: "apply_approved_patch",
        params: {
          patch: proposed.patch,
          proposalId: proposed.proposalId,
          patchHash: proposed.patchHash
        }
      },
      testConfig("docs"),
      context(testConfig("docs"), "files.read files.write")
    );

    assert.equal(apply.ok, true);
    assert.equal(fs.readFileSync(path.join(tempRoot, "README.md"), "utf8").replace(/\r\n/gu, "\n"), "# Patched\n");
    assert.equal(rootSmuggle.ok, false);
    assert.equal(rootSmuggle.error?.code, "INVALID_INPUT");
    assert.equal(missingScope.ok, false);
    assert.equal(missingScope.error?.code, "APPROVAL_REQUIRED");
    assert.equal(docsApply.ok, false);
    assert.equal(docsApply.error?.code, "APPROVAL_REQUIRED");
    assert.match(docsApply.error?.message ?? "", /writeMode patch or elevated/u);
  });

  it("repo_toolbox apply_approved_patch is denied without consuming proposals when patch workflow is disabled", async () => {
    initRepo();
    const enabledConfig: AppConfig = {
      ...testConfig("patch"),
      workspaces: [
        {
          workspaceId: "patch_locked",
          label: "Patch Locked",
          root: tempRoot,
          source: "configured"
        }
      ],
      defaultWorkspaceId: "patch_locked",
      defaultWorkspaceIdSource: "local-file"
    };
    const disabledConfig: AppConfig = {
      ...enabledConfig,
      workspaces: [
        {
          workspaceId: "patch_locked",
          label: "Patch Locked",
          root: tempRoot,
          source: "configured",
          workspaceCapabilities: {
            patchWorkflow: "disabled"
          }
        }
      ]
    };
    const enabledContext = context(enabledConfig, "files.read files.write");
    const disabledContext = context(disabledConfig, "files.read files.write");
    const proposal = await repoToolbox(
      {
        action: "propose_patch",
        workspaceId: "patch_locked",
        params: {
          changes: [{ relativePath: "README.md", originalText: "# Test", replacementText: "# Locked Patch" }]
        }
      },
      enabledConfig,
      enabledContext
    );
    assert.equal(proposal.ok, true);
    const proposed = proposal.result as { patch: string; proposalId: string; patchHash: string };
    const beforeStore = readPendingPatchStore(disabledConfig.repoRoot);
    const beforeStatus = git(["status", "--short", "--untracked-files=all"]);
    const beforeContent = fs.readFileSync(path.join(tempRoot, "README.md"), "utf8");

    const apply = await repoToolbox(
      {
        action: "apply_approved_patch",
        workspaceId: "patch_locked",
        params: {
          patch: proposed.patch,
          proposalId: proposed.proposalId,
          patchHash: proposed.patchHash
        }
      },
      disabledConfig,
      disabledContext
    );

    assert.equal(apply.ok, false);
    assert.equal(apply.error?.code, "WORKSPACE_POLICY_DENIED");
    assert.equal(fs.readFileSync(path.join(tempRoot, "README.md"), "utf8"), beforeContent);
    assert.deepEqual(readPendingPatchStore(disabledConfig.repoRoot), beforeStore);
    assert.equal(git(["status", "--short", "--untracked-files=all"]), beforeStatus);
  });

  it("integration_toolbox lists supported services and rejects unknown services", async () => {
    initRepo();
    const config = testConfig("off");
    const list = await integrationToolbox({ action: "list_supported_services" }, config, context(config, "files.read"));
    const unknown = await integrationToolbox(
      { action: "get_service_status", params: { serviceId: "unknown_service" } },
      config,
      context(config, "files.read")
    );

    assert.equal(list.ok, true);
    assert.ok((list.result as { supportedServices?: string[] }).supportedServices?.includes("figma"));
    assert.equal(unknown.ok, false);
    assert.equal(unknown.error?.code, "INVALID_INPUT");
    assert.ok(Array.isArray(unknown.error?.details?.supportedServices));
  });

  it("integration_toolbox returns static Figma broker placeholders", async () => {
    initRepo();
    const config = testConfig("off");
    const toolboxContext = context(config, "files.read");

    const status = await integrationToolbox(
      { action: "get_service_status", params: { serviceId: "figma" } },
      config,
      toolboxContext
    );
    const capabilities = await integrationToolbox(
      { action: "list_service_capabilities", params: { serviceId: "figma_make" } },
      config,
      toolboxContext
    );
    const validation = await integrationToolbox(
      { action: "validate_service_configuration", params: { serviceId: "figma" } },
      config,
      toolboxContext
    );

    assert.equal(status.ok, true);
    assert.deepEqual(status.result, {
      serviceId: "figma",
      status: "broker_not_implemented",
      governedBrokerOnly: true,
      arbitraryUpstreamMcpPassthrough: false,
      legacyDirectFigmaToolsRemoved: true
    });
    assert.equal(capabilities.ok, true);
    assert.equal((capabilities.result as { safetyModel?: { arbitraryUpstreamToolNameAccepted?: boolean } }).safetyModel?.arbitraryUpstreamToolNameAccepted, false);
    assert.equal((capabilities.result as { safetyModel?: { legacyDirectFigmaToolsRemoved?: boolean } }).safetyModel?.legacyDirectFigmaToolsRemoved, true);
    assert.equal(validation.ok, true);
    assert.equal((validation.result as { status?: string }).status, "broker_not_implemented");
    assert.equal((validation.result as { rawTokenAccepted?: boolean }).rawTokenAccepted, false);
  });

  it("artifact_toolbox no longer supports obsolete Codex handoff prompt creation", async () => {
    initRepo();
    const config = testConfig("docs");
    const result = await artifactToolbox(
      { action: "create_codex_handoff_prompt", params: { handoffPath: "design/figma-handoff", targetFile: "docs/handoffs/out.md" } },
      config,
      context(config, "files.read files.write")
    );

    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "INVALID_INPUT");
    assert.ok((result.error?.details?.supportedActions as string[] | undefined)?.includes("local_package_summary"));
    assert.equal((result.error?.details?.supportedActions as string[] | undefined)?.includes("create_codex_handoff_prompt"), false);
  });

  it("artifact_toolbox no longer supports handoff output submission", async () => {
    initRepo();
    const config = testConfig("docs");
    const result = await artifactToolbox(
      {
        action: "submit_handoff_outputs",
        params: { handoffKind: "architect-interview", outputs: { architectInterviewMarkdown: "# Architect Interview\n" } }
      },
      config,
      context(config, "files.read files.write")
    );

    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "INVALID_INPUT");
    assert.equal((result.error?.details?.supportedActions as string[] | undefined)?.includes("submit_handoff_outputs"), false);
  });

  it("integration_toolbox rejects arbitrary upstream MCP tool names", async () => {
    initRepo();
    const config = testConfig("off");
    const result = await integrationToolbox(
      { action: "list_service_capabilities", params: { serviceId: "figma", upstreamToolName: "tools/call-anything" } },
      config,
      context(config, "files.read")
    );

    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "INVALID_INPUT");
  });

  it("browser_toolbox returns constrained capabilities and rejects arbitrary URL browsing", async () => {
    initRepo();
    const config = testConfig("off");
    const capabilities = await browserToolbox({ action: "get_browser_capabilities" }, config);
    const arbitraryUrl = await browserToolbox({ action: "validate_public_endpoint", params: { url: "https://example.com" } }, config);

    assert.equal(capabilities.ok, true);
    assert.equal((capabilities.result as { arbitraryBrowsingSupported?: boolean }).arbitraryBrowsingSupported, false);
    assert.equal(arbitraryUrl.ok, false);
    assert.equal(arbitraryUrl.error?.code, "INVALID_INPUT");
  });

  it("knowledge_toolbox returns safe capabilities and rejects arbitrary external fetch params", async () => {
    initRepo();
    const config = testConfig("off");
    const sources = await knowledgeToolbox({ action: "list_supported_sources" }, config);
    const externalFetch = await knowledgeToolbox({ action: "get_reference_capabilities", params: { url: "https://example.com" } }, config);

    assert.equal(sources.ok, true);
    assert.equal((sources.result as { arbitraryWebFetchSupported?: boolean }).arbitraryWebFetchSupported, false);
    assert.equal(externalFetch.ok, false);
    assert.equal(externalFetch.error?.code, "INVALID_INPUT");
  });
});
