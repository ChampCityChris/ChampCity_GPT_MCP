import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMcpServer, installDependencies } from "../electron/runtimeOperations.js";
import { WINDOWS_COMMON_NPM_CMD_PATH, type RuntimeCommandResult, type RuntimeCommandRunner, type RuntimeDetectionResult } from "../electron/runtimeDetection.js";

const detectedRuntime: RuntimeDetectionResult = {
  node: {
    found: true,
    path: "C:\\Program Files\\nodejs\\node.exe",
    version: "v24.16.0",
    source: "commonPath"
  },
  npm: {
    found: true,
    path: WINDOWS_COMMON_NPM_CMD_PATH,
    version: "11.3.0",
    source: "commonPath"
  },
  errors: []
};

const missingNpmRuntime: RuntimeDetectionResult = {
  node: detectedRuntime.node,
  npm: {
    found: false,
    path: null,
    version: null,
    source: null
  },
  errors: []
};

function ok(stdout = ""): RuntimeCommandResult {
  return { ok: true, stdout, stderr: "", exitCode: 0 };
}

describe("runtime npm operations", () => {
  it("installDependencies refuses to run if npm is missing", async () => {
    let commandRan = false;
    const result = await installDependencies({
      repoRoot: "C:\\Projects\\example",
      detectRuntime: async () => missingNpmRuntime,
      commandRunner: async () => {
        commandRan = true;
        return ok();
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.exitCode, null);
    assert.equal(commandRan, false);
    assert.match(result.output, /npm not found/i);
  });

  it("installDependencies uses the detected npm path when present", async () => {
    const calls: Array<{ command: string; args: string[]; cwd?: string; shell?: boolean }> = [];
    const runner: RuntimeCommandRunner = async (command, args, options) => {
      calls.push({ command, args, cwd: options?.cwd, shell: options?.shell });
      return ok("installed\n");
    };

    const result = await installDependencies({
      repoRoot: "C:\\Projects\\example",
      detectRuntime: async () => detectedRuntime,
      commandRunner: runner,
      platform: "win32"
    });

    assert.equal(result.ok, true);
    assert.deepEqual(calls, [
      {
        command: WINDOWS_COMMON_NPM_CMD_PATH,
        args: ["install"],
        cwd: "C:\\Projects\\example",
        shell: true
      }
    ]);
  });

  it("buildMcpServer uses the detected npm path when present", async () => {
    const calls: Array<{ command: string; args: string[]; cwd?: string; shell?: boolean }> = [];
    const runner: RuntimeCommandRunner = async (command, args, options) => {
      calls.push({ command, args, cwd: options?.cwd, shell: options?.shell });
      return ok("built\n");
    };

    const result = await buildMcpServer({
      repoRoot: "C:\\Projects\\example",
      detectRuntime: async () => detectedRuntime,
      commandRunner: runner,
      platform: "win32"
    });

    assert.equal(result.ok, true);
    assert.deepEqual(calls, [
      {
        command: WINDOWS_COMMON_NPM_CMD_PATH,
        args: ["run", "build"],
        cwd: "C:\\Projects\\example",
        shell: true
      }
    ]);
  });
});

