import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { type AppConfig } from "../src/config.js";
import { createToolboxRuntimeContext } from "../src/server/registerTools.js";
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
  const result = spawnSync("git", args, {
    cwd: tempRoot,
    encoding: "utf8",
    shell: false,
    windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function writeFile(relativePath: string, content: string): void {
  const absolutePath = path.join(tempRoot, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf8");
}

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
    assert.equal((repoStatus.result as { branch?: string }).branch, "dev");
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
    assert.equal(unknownWorkspace.error?.code, "INVALID_INPUT");
    assert.equal(rootParamSmuggle.ok, false);
    assert.equal(rootParamSmuggle.error?.code, "INVALID_INPUT");
    assert.equal(legacyRead.relativePath, "README.md");
    assert.equal(legacyGit.branch, "dev");
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
