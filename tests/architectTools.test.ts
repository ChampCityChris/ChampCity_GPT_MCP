import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { type AppConfig } from "../src/config.js";
import { createToolboxRuntimeContext } from "../src/server/registerTools.js";
import { runFixedProcess } from "../src/tools/architect/common.js";
import { validatePackagedElectronStartup } from "../src/tools/architect/electronDiagnostics.js";
import { runGitInspection } from "../src/tools/architect/gitInspection.js";
import { buildMcpToolInventory, runMcpServerStartupDiagnostic, validateMcpToolRegistration } from "../src/tools/architect/mcpDiagnostics.js";
import { runProjectValidation } from "../src/tools/architect/projectValidation.js";
import { runSourceAnalysis } from "../src/tools/architect/sourceAnalysis.js";
import { diagnosticsToolbox, gitToolbox, knowledgeToolbox } from "../src/tools/domainToolboxes.js";

let root: string;

function run(command: string, args: string[], cwd = root): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", shell: false, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function git(args: string[]): string {
  return run(process.platform === "win32" ? "git.exe" : "git", args);
}

function write(relativePath: string, content: string | Buffer): void {
  const target = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function initializeFixture(): void {
  git(["init"]);
  git(["config", "user.email", "architect-tools@example.com"]);
  git(["config", "user.name", "Architect Tools"]);
  git(["checkout", "-b", "main"]);
  write(
    "package.json",
    `${JSON.stringify({ name: "architect-tools-fixture", version: "9.9.9", scripts: { typecheck: "node -e \"console.log('fixture typecheck passed')\"" } }, null, 2)}\n`
  );
  write("electron-builder.json", `${JSON.stringify({ productName: "Fixture", directories: { output: "release" }, win: { artifactName: "${productName}-${version}-${arch}.${ext}" } }, null, 2)}\n`);
  write(
    "tsconfig.json",
    `${JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true }, include: ["src/**/*.ts"] }, null, 2)}\n`
  );
  write(
    "src/a.ts",
    `import { target } from "./b.js";\nexport function caller(): string { return target(); }\nexport const tools = [{ name: "fixture_tool", description: "Fixture", inputSchema: { type: "object", properties: {} } }, { name: "fixture_tool", description: "Duplicate", inputSchema: { type: "object", properties: {} } }];\n`
  );
  write("src/b.ts", `import type { Marker } from "./c.js";\nimport("./a.js");\nexport interface MarkerUse extends Marker {}\nexport function target(): string { return "ok"; }\n`);
  write("src/c.ts", `import { caller } from "./a.js";\nexport interface Marker { value: string }\nexport const cycle = caller;\n`);
  write("README.md", "# fixture\nfirst line\n");
  git(["add", "."]);
  git(["commit", "-m", "initial fixture"]);
  git(["checkout", "-b", "feature"]);
  write("README.md", "# fixture\nsecond line\n");
  write("asset.bin", Buffer.from([0, 1, 2, 3, 4]));
  git(["add", "."]);
  git(["commit", "-m", "feature fixture"]);
}

function config(): AppConfig {
  return {
    repoRoot: root,
    allowedRoots: [root],
    defaultWorkspaceRoot: root,
    defaultWorkspaceRootSource: "repoRoot",
    auditLogPath: path.join(root, "audit.log"),
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

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-architect-tools-"));
  initializeFixture();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("purpose-built architect tools", () => {
  it("runs only the fixed typecheck validation and reports its lane and repository state", async () => {
    const result = await runProjectValidation(root, "typecheck");
    assert.equal(result.ok, process.platform === "win32");
    assert.equal(result.data?.operation, "typecheck");
    assert.equal(result.data?.executionLane, "normal_windows");
    assert.deepEqual(result.data?.safeFixedArguments.slice(-2), ["run", "typecheck"]);
    if (process.platform === "win32") {
      assert.equal(result.data?.exitCode, 0);
      assert.match(result.data?.stdout ?? "", /fixture typecheck passed/u);
    }
  });

  it("rejects command, argument, cwd, environment, and timeout injection before validation execution", async () => {
    const cfg = config();
    for (const injected of [
      { operation: "typecheck", command: "whoami" },
      { operation: "typecheck", arguments: ["--watch"] },
      { operation: "typecheck", cwd: ".." },
      { operation: "typecheck", env: { SECRET: "value" } },
      { operation: "typecheck", timeoutMs: 1 }
    ]) {
      const result = await diagnosticsToolbox(
        { action: "project_validation", params: injected },
        cfg,
        createToolboxRuntimeContext(cfg, { scope: "files.read" })
      );
      assert.equal(result.ok, false);
      assert.equal(result.error?.code, "INVALID_INPUT");
    }
  });

  it("terminates a fixed child process after timeout and truncates bounded output", async () => {
    const timeout = await runFixedProcess({
      executable: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: root,
      timeoutMs: 100
    });
    assert.equal(timeout.timedOut, true);
    assert.equal(timeout.terminationReason, "timeout");

    const truncated = await runFixedProcess({
      executable: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(5000))"],
      cwd: root,
      timeoutMs: 5000,
      maxStdoutBytes: 100
    });
    assert.equal(truncated.exitCode, 0);
    assert.equal(truncated.stdoutTruncated, true);
    assert.equal(Buffer.byteLength(truncated.stdout), 100);
  });

  it("validates MCP inventory, duplicates, descriptions, and generic command exposure", () => {
    const definitions = [
      { name: "repo_toolbox", description: "Repo", inputSchema: { type: "object", properties: { action: {} }, required: ["action"] } },
      { name: "repo_toolbox", description: "", inputSchema: { type: "string" } },
      { name: "shell_command", description: "Unsafe", inputSchema: { type: "object", properties: {} } }
    ];
    const inventory = buildMcpToolInventory(definitions);
    const registration = validateMcpToolRegistration(definitions);
    assert.equal(inventory[0]?.requiredInputFields[0], "action");
    assert.deepEqual(registration.duplicateNames, ["repo_toolbox"]);
    assert.deepEqual(registration.missingDescriptions, ["repo_toolbox"]);
    assert.deepEqual(registration.genericCommandTools, ["shell_command"]);
    assert.equal(registration.overallResult, "failed");
  });

  it("starts the MCP server on a fixed ephemeral localhost endpoint and shuts it down cleanly", async () => {
    const startup = await runMcpServerStartupDiagnostic(root);
    assert.equal(startup.ok, true, JSON.stringify(startup.errors));
    assert.equal((startup.data as { healthStatus?: number }).healthStatus, 200);
    assert.equal((startup.data as { shutdownStatus?: string }).shutdownStatus, "clean");

    const cfg = config();
    const registration = await diagnosticsToolbox(
      { action: "mcp_tool_registration" },
      cfg,
      createToolboxRuntimeContext(cfg, { scope: "files.read" })
    );
    const inventory = await diagnosticsToolbox(
      { action: "mcp_tool_inventory" },
      cfg,
      createToolboxRuntimeContext(cfg, { scope: "files.read" })
    );
    assert.equal(registration.ok, true);
    assert.equal(inventory.ok, true);
    assert.match(JSON.stringify(inventory.result), /project_validation/u);
    assert.doesNotMatch(JSON.stringify(inventory.result), /run_allowed_script|shell_command/u);
  });

  it("returns not_packaged and rejects arbitrary Electron diagnostic parameters", async () => {
    const direct = await validatePackagedElectronStartup(root);
    assert.equal(direct.status, "not_packaged");
    const cfg = config();
    const result = await diagnosticsToolbox(
      { action: "electron_packaged_startup", params: { executable: "C:/Windows/notepad.exe", flags: ["--inspect"] } },
      cfg,
      createToolboxRuntimeContext(cfg, { scope: "files.read" })
    );
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "INVALID_INPUT");
  });

  it("performs symbol, reference, import, caller, callee, and MCP registration AST analysis", async () => {
    const symbol = await runSourceAnalysis(root, { operation: "find_symbol", symbol: "target" });
    const references = await runSourceAnalysis(root, { operation: "find_references", symbol: "target" });
    const graph = await runSourceAnalysis(root, { operation: "import_graph", file: "src/a.ts", maxDepth: 5 });
    const callers = await runSourceAnalysis(root, { operation: "get_callers", symbol: "target" });
    const callees = await runSourceAnalysis(root, { operation: "get_callees", symbol: "caller" });
    const registrations = await runSourceAnalysis(root, { operation: "duplicate_mcp_tool_names" });

    assert.equal(symbol.ok, true);
    assert.ok(((symbol.data as { result?: { matches?: unknown[] } }).result?.matches?.length ?? 0) >= 1);
    assert.ok(((references.data as { result?: { matches?: unknown[] } }).result?.matches?.length ?? 0) >= 2);
    assert.ok(((graph.data as { result?: { cycles?: unknown[] } }).result?.cycles?.length ?? 0) >= 1);
    assert.ok(((callers.data as { result?: { matches?: unknown[] } }).result?.matches?.length ?? 0) >= 1);
    assert.ok(((callees.data as { result?: { matches?: unknown[] } }).result?.matches?.length ?? 0) >= 1);
    assert.deepEqual(
      ((registrations.data as { result?: { duplicateToolNames?: Array<{ toolName: string }> } }).result?.duplicateToolNames ?? []).map((entry) => entry.toolName),
      ["fixture_tool"]
    );
  });

  it("enforces source-analysis paths, depth, and unknown parameter rejection", async () => {
    const cfg = config();
    for (const params of [
      { operation: "import_graph", file: "../outside.ts", maxDepth: 2 },
      { operation: "import_graph", file: path.join(root, "src", "a.ts"), maxDepth: 2 },
      { operation: "import_graph", file: "src/a.ts", maxDepth: 6 },
      { operation: "find_symbol", symbol: "target", script: "node evil.js" }
    ]) {
      const result = await knowledgeToolbox({ action: "source_analysis", params }, cfg);
      assert.equal(result.ok, false);
    }
  });

  it("supports all fixed read-only Git inspection operations", async () => {
    const log = await runGitInspection(root, { operation: "log", maxCount: 10 });
    const shown = await runGitInspection(root, { operation: "show_commit", ref: "HEAD" });
    const diff = await runGitInspection(root, { operation: "diff_refs", baseRef: "main", targetRef: "feature" });
    const history = await runGitInspection(root, { operation: "file_history", file: "README.md", maxCount: 10 });
    const blame = await runGitInspection(root, { operation: "blame", file: "README.md", startLine: 1, endLine: 2 });
    const mergeBase = await runGitInspection(root, { operation: "merge_base", baseRef: "main", targetRef: "feature" });
    const ancestry = await runGitInspection(root, { operation: "check_ancestry", ancestorRef: "main", descendantRef: "feature" });
    for (const result of [log, shown, diff, history, blame, mergeBase, ancestry]) {
      assert.equal(result.ok, true, JSON.stringify(result.errors));
    }
    assert.equal((ancestry.data as { isAncestor?: boolean }).isAncestor, true);
    assert.ok(((diff.data as { changedFiles?: unknown[] }).changedFiles?.length ?? 0) >= 1);
  });

  it("rejects unsafe Git refs, options, absolute paths, traversal, and toolbox argument injection", async () => {
    for (const input of [
      { operation: "show_commit", ref: "--help" } as const,
      { operation: "show_commit", ref: "HEAD;whoami" } as const,
      { operation: "diff_refs", baseRef: "HEAD..main", targetRef: "feature" } as const,
      { operation: "file_history", file: "../outside", maxCount: 10 } as const,
      { operation: "file_history", file: path.join(root, "README.md"), maxCount: 10 } as const
    ]) {
      const result = await runGitInspection(root, input);
      assert.equal(result.ok, false);
    }
    const cfg = config();
    const injected = await gitToolbox(
      { action: "inspect_history", params: { operation: "log", maxCount: 5, arguments: ["--exec=evil"] } },
      cfg,
      createToolboxRuntimeContext(cfg, { scope: "files.read" })
    );
    assert.equal(injected.ok, false);
    assert.equal(injected.error?.code, "INVALID_INPUT");
  });
});
