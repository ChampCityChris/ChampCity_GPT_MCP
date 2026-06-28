import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  createServerStartCommand,
  getPackagedServerEntrypoint,
  resolveRuntimePathInfo,
  SERVER_ENTRYPOINT_RELATIVE,
  validateRuntimePaths
} from "../src/runtimePaths.js";

let tempRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-runtime-"));
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function existingPathSet(paths: string[]): (filePath: string) => boolean {
  const normalized = new Set(paths.map((entry) => path.resolve(entry).toLowerCase()));
  return (filePath) => normalized.has(path.resolve(filePath).toLowerCase());
}

describe("runtime path resolution", () => {
  it("resolves development server entrypoint under repo dist/src/index.js", () => {
    const nodeExecutable = path.join(tempRoot, "node.exe");
    const paths = resolveRuntimePathInfo({
      mode: "development",
      appRoot: tempRoot,
      nodeExecutable,
      pathExists: existingPathSet([nodeExecutable])
    });

    assert.equal(paths.mode, "development");
    assert.equal(paths.serverRuntime, "in-process");
    assert.equal(paths.appRoot, path.resolve(tempRoot));
    assert.equal(paths.serverEntrypoint, path.join(tempRoot, SERVER_ENTRYPOINT_RELATIVE));
  });

  it("can use durable userData config directories in development desktop mode", () => {
    const userDataDir = path.join(tempRoot, "userData");
    const paths = resolveRuntimePathInfo({
      mode: "development",
      appRoot: tempRoot,
      userDataDir,
      useUserDataConfigInDevelopment: true
    });

    assert.equal(paths.configDir, path.join(userDataDir, "config"));
    assert.equal(paths.logsDir, path.join(userDataDir, "logs"));
    assert.equal(paths.generatedDir, path.join(userDataDir, "generated"));
    assert.equal(paths.serverEntrypoint, path.join(tempRoot, SERVER_ENTRYPOINT_RELATIVE));
  });

  it("resolves packaged server entrypoint under resources and not process execPath", () => {
    const resourcesPath = path.join(tempRoot, "resources");
    const nodeExecutable = "C:\\Program Files\\nodejs\\node.exe";
    const launcherExe = path.join(tempRoot, "ChampCity GPT MCP Launcher.exe");
    const serverEntrypoint = path.join(resourcesPath, "app.asar.unpacked", SERVER_ENTRYPOINT_RELATIVE);
    const paths = resolveRuntimePathInfo({
      mode: "portable",
      appRoot: path.join(resourcesPath, "app.asar"),
      resourcesPath,
      exeDir: tempRoot,
      nodeExecutable,
      pathExists: existingPathSet([nodeExecutable, launcherExe, serverEntrypoint])
    });

    assert.equal(paths.serverEntrypoint, serverEntrypoint);
    assert.notEqual(path.resolve(paths.serverEntrypoint), path.resolve(launcherExe));
    assert.notEqual(path.resolve(paths.nodeExecutable), path.resolve(launcherExe));
  });

  it("falls back to a controlled packaged entrypoint path when missing", () => {
    const resourcesPath = path.join(tempRoot, "resources");
    const expected = path.join(resourcesPath, "app.asar.unpacked", SERVER_ENTRYPOINT_RELATIVE);

    assert.equal(getPackagedServerEntrypoint(resourcesPath, () => false), expected);
  });

  it("does not require external node or CLI entrypoint for packaged in-process runtime", () => {
    const paths = resolveRuntimePathInfo({
      mode: "installed",
      appRoot: path.join(tempRoot, "resources", "app.asar"),
      resourcesPath: path.join(tempRoot, "resources"),
      userDataDir: path.join(tempRoot, "userData"),
      nodeExecutable: path.join(tempRoot, "missing-node.exe"),
      pathExists: () => false
    });

    const result = validateRuntimePaths(paths, { pathExists: () => false });

    assert.equal(result.ok, true);
    assert.equal(paths.serverRuntime, "in-process");
  });

  it("reports a missing server entrypoint as validation errors when developer CLI validation is requested", () => {
    const nodeExecutable = path.join(tempRoot, "node.exe");
    const paths = resolveRuntimePathInfo({
      mode: "installed",
      appRoot: path.join(tempRoot, "resources", "app.asar"),
      resourcesPath: path.join(tempRoot, "resources"),
      userDataDir: path.join(tempRoot, "userData"),
      nodeExecutable,
      pathExists: existingPathSet([nodeExecutable])
    });

    const result = validateRuntimePaths(paths, {
      pathExists: existingPathSet([nodeExecutable]),
      requireNodeExecutable: true,
      requireServerEntrypoint: true
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /Packaged MCP server entrypoint was not found/i);
  });

  it("builds a start command with node executable and server entrypoint as first arg", () => {
    const nodeExecutable = "C:\\Program Files\\nodejs\\node.exe";
    const serverEntrypoint = path.join(tempRoot, "resources", "app.asar.unpacked", SERVER_ENTRYPOINT_RELATIVE);
    const paths = resolveRuntimePathInfo({
      mode: "portable",
      appRoot: path.join(tempRoot, "resources", "app.asar"),
      resourcesPath: path.join(tempRoot, "resources"),
      exeDir: tempRoot,
      nodeExecutable,
      pathExists: existingPathSet([nodeExecutable, serverEntrypoint])
    });
    const command = createServerStartCommand(paths, {
      host: "127.0.0.1",
      port: 3333,
      env: {},
      extraEnv: { CHAMPCITY_GPT_WRITE_MODE: "off" }
    });

    assert.equal(command.command, nodeExecutable);
    assert.equal(command.args[0], serverEntrypoint);
    assert.deepEqual(command.args.slice(1), ["--transport", "http", "--host", "127.0.0.1", "--port", "3333"]);
    assert.notEqual(command.args[0], "C:\\Temp\\ChampCity GPT MCP Launcher.exe");
    assert.equal(command.env.CHAMPCITY_GPT_CONFIG_DIR, paths.configDir);
    assert.equal(command.env.CHAMPCITY_GPT_LOG_DIR, paths.logsDir);
    assert.equal(command.env.CHAMPCITY_GPT_GENERATED_DIR, paths.generatedDir);
  });
});
