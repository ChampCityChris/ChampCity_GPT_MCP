import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  detectRuntimes,
  WINDOWS_COMMON_NODE_PATH,
  WINDOWS_COMMON_NPM_CMD_PATH,
  WINDOWS_COMMON_NPM_PATH,
  type RuntimeCommandResult,
  type RuntimeCommandRunner
} from "../electron/runtimeDetection.js";

function ok(stdout: string): RuntimeCommandResult {
  return { ok: true, stdout, stderr: "", exitCode: 0 };
}

function fail(stderr = "not found"): RuntimeCommandResult {
  return { ok: false, stdout: "", stderr, exitCode: 1 };
}

describe("runtime detection", () => {
  it("prefers npm.cmd on Windows when both npm and npm.cmd are present", async () => {
    const runner: RuntimeCommandRunner = async (command, args) => {
      if (command === "where.exe" && args[0] === "node") {
        return ok(`${WINDOWS_COMMON_NODE_PATH}\r\n`);
      }
      if (command === "where.exe" && args[0] === "npm") {
        return ok(`${WINDOWS_COMMON_NPM_PATH}\r\n${WINDOWS_COMMON_NPM_CMD_PATH}\r\n`);
      }
      if (command === WINDOWS_COMMON_NODE_PATH && args[0] === "--version") {
        return ok("v24.16.0\r\n");
      }
      if (command === WINDOWS_COMMON_NPM_CMD_PATH && args[0] === "--version") {
        return ok("11.3.0\r\n");
      }
      return fail();
    };

    const result = await detectRuntimes({
      platform: "win32",
      runner,
      fileExists: () => false
    });

    assert.equal(result.node.found, true);
    assert.equal(result.node.path, WINDOWS_COMMON_NODE_PATH);
    assert.equal(result.node.version, "v24.16.0");
    assert.equal(result.npm.found, true);
    assert.equal(result.npm.path, WINDOWS_COMMON_NPM_CMD_PATH);
    assert.equal(result.npm.version, "11.3.0");
  });

  it("accepts npm at the common Windows npm.cmd path", async () => {
    const existing = new Set([WINDOWS_COMMON_NODE_PATH.toLowerCase(), WINDOWS_COMMON_NPM_CMD_PATH.toLowerCase()]);
    const runner: RuntimeCommandRunner = async (command, args) => {
      if (command === "where.exe") {
        return fail();
      }
      if (command === WINDOWS_COMMON_NODE_PATH && args[0] === "--version") {
        return ok("v24.16.0\r\n");
      }
      if (command === WINDOWS_COMMON_NPM_CMD_PATH && args[0] === "--version") {
        return ok("11.3.0\r\n");
      }
      if (command === "powershell.exe") {
        return fail();
      }
      return fail();
    };

    const result = await detectRuntimes({
      platform: "win32",
      runner,
      fileExists: (filePath) => existing.has(filePath.toLowerCase())
    });

    assert.equal(result.npm.found, true);
    assert.equal(result.npm.path, WINDOWS_COMMON_NPM_CMD_PATH);
    assert.equal(result.npm.source, "commonPath");
  });
});
