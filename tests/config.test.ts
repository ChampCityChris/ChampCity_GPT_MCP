import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { DEFAULT_ALLOWED_COMMANDS, ensureConfiguredRootsExist, loadConfig } from "../src/config.js";
import { getHttpAuthTokenConfig } from "../src/httpAuthConfig.js";
import { saveWriteApprovalToken, verifyWriteApprovalTokenHash, readWriteAccessLocalConfig } from "../src/writeAccess.js";

let tempRoot: string;
let localRoot: string;
let envRoot: string;

function writeLocalConfig(config: unknown): void {
  fs.mkdirSync(path.join(tempRoot, "config"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "config", "allowed-roots.local.json"), JSON.stringify(config, null, 2), "utf8");
}

function writeRuntimeConfig(configDir: string, config: unknown): void {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "allowed-roots.local.json"), JSON.stringify(config, null, 2), "utf8");
}

function writeLocalHttpAuthConfig(token: string): void {
  fs.mkdirSync(path.join(tempRoot, "config"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "config", "http-auth.local.json"), JSON.stringify({ httpAuthToken: token }, null, 2), "utf8");
}

function writeLocalWriteAccessConfig(config: unknown): void {
  fs.mkdirSync(path.join(tempRoot, "config"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "config", "write-access.local.json"), JSON.stringify(config, null, 2), "utf8");
}

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-config-"));
  localRoot = path.join(tempRoot, "local-root");
  envRoot = path.join(tempRoot, "env-root");
  fs.mkdirSync(localRoot, { recursive: true });
  fs.mkdirSync(envRoot, { recursive: true });
});

describe("HTTP auth token config loading", () => {
  it("loads HTTP token from environment", () => {
    const config = getHttpAuthTokenConfig(tempRoot, { CHAMPCITY_GPT_HTTP_AUTH_TOKEN: "env-secret" });

    assert.equal(config.configured, true);
    assert.equal(config.source, "env");
    assert.equal(config.token, "env-secret");
  });

  it("loads HTTP token from config/http-auth.local.json", () => {
    writeLocalHttpAuthConfig("local-secret");

    const config = getHttpAuthTokenConfig(tempRoot, {});

    assert.equal(config.configured, true);
    assert.equal(config.source, "local-file");
    assert.equal(config.token, "local-secret");
  });

  it("lets environment HTTP token override local token file", () => {
    writeLocalHttpAuthConfig("local-secret");

    const config = getHttpAuthTokenConfig(tempRoot, { CHAMPCITY_GPT_HTTP_AUTH_TOKEN: "env-secret" });

    assert.equal(config.configured, true);
    assert.equal(config.source, "env");
    assert.equal(config.token, "env-secret");
  });
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("config loading", () => {
  it("loads safe defaults when local config and env vars are absent", () => {
    const config = loadConfig({}, tempRoot);

    assert.deepEqual(config.allowedRoots, [path.resolve(tempRoot)]);
    assert.equal(config.auditLogPath, path.join(path.resolve(tempRoot), "logs", "audit.log"));
    assert.equal(config.requireGitRoot, true);
    assert.deepEqual(config.allowedCommands, DEFAULT_ALLOWED_COMMANDS);
    assert.equal(config.writeMode, "off");
    assert.equal(config.writeToolsEnabled, false);
    assert.equal(config.writeToolsEnabledSource, "default");
    assert.equal(config.writeApprovalToken.source, "none");
  });

  it("lets local config override defaults", () => {
    const auditLog = path.join(tempRoot, "logs", "custom-audit.log");
    writeLocalConfig({
      allowedRoots: [localRoot],
      requireGitRoot: false,
      auditLog,
      allowedCommands: ["git status"]
    });

    const config = loadConfig({}, tempRoot);

    assert.deepEqual(config.allowedRoots, [path.resolve(localRoot)]);
    assert.equal(config.auditLogPath, auditLog);
    assert.equal(config.requireGitRoot, false);
    assert.deepEqual(config.allowedCommands, ["git status"]);
    assert.equal(config.writeMode, "off");
    assert.equal(config.writeToolsEnabled, false);
    assert.equal(config.writeToolsEnabledSource, "default");
    assert.doesNotThrow(() => ensureConfiguredRootsExist(config));
  });

  it("loads runtime config directory when CHAMPCITY_GPT_CONFIG_DIR is set", () => {
    const runtimeConfigDir = path.join(tempRoot, "runtime-config");
    const runtimeRoot = path.join(tempRoot, "runtime-root");
    fs.mkdirSync(runtimeRoot, { recursive: true });
    writeRuntimeConfig(runtimeConfigDir, {
      allowedRoots: [runtimeRoot],
      requireGitRoot: false,
      auditLog: path.join(tempRoot, "logs", "runtime-audit.log"),
      allowedCommands: ["git diff"]
    });
    writeLocalConfig({
      allowedRoots: [localRoot],
      requireGitRoot: true,
      auditLog: path.join(tempRoot, "logs", "repo-audit.log"),
      allowedCommands: ["git status"]
    });

    const config = loadConfig({ CHAMPCITY_GPT_CONFIG_DIR: runtimeConfigDir }, tempRoot);

    assert.deepEqual(config.allowedRoots, [path.resolve(runtimeRoot)]);
    assert.equal(config.auditLogPath, path.join(tempRoot, "logs", "runtime-audit.log"));
    assert.equal(config.requireGitRoot, false);
    assert.deepEqual(config.allowedCommands, ["git diff"]);
  });

  it("does not fall back to repo config when runtime config dir is set", () => {
    const runtimeConfigDir = path.join(tempRoot, "empty-runtime-config");
    writeLocalConfig({
      allowedRoots: [localRoot],
      requireGitRoot: false,
      auditLog: path.join(tempRoot, "logs", "repo-audit.log"),
      allowedCommands: ["git status"]
    });

    const config = loadConfig({ CHAMPCITY_GPT_CONFIG_DIR: runtimeConfigDir }, tempRoot);

    assert.deepEqual(config.allowedRoots, [path.resolve(tempRoot)]);
    assert.equal(config.requireGitRoot, true);
    assert.deepEqual(config.allowedCommands, DEFAULT_ALLOWED_COMMANDS);
  });

  it("lets environment variables override runtime config", () => {
    const runtimeConfigDir = path.join(tempRoot, "runtime-config");
    writeRuntimeConfig(runtimeConfigDir, {
      allowedRoots: [localRoot],
      requireGitRoot: true,
      auditLog: path.join(tempRoot, "logs", "runtime-audit.log"),
      allowedCommands: ["git status"]
    });

    const config = loadConfig(
      {
        CHAMPCITY_GPT_CONFIG_DIR: runtimeConfigDir,
        CHAMPCITY_GPT_ALLOWED_ROOTS: envRoot,
        CHAMPCITY_GPT_REQUIRE_GIT_ROOT: "false",
        CHAMPCITY_GPT_ALLOWED_COMMANDS: "npm test"
      },
      tempRoot
    );

    assert.deepEqual(config.allowedRoots, [path.resolve(envRoot)]);
    assert.equal(config.requireGitRoot, false);
    assert.deepEqual(config.allowedCommands, ["npm test"]);
  });

  it("lets environment variables override local config", () => {
    writeLocalConfig({
      allowedRoots: [localRoot],
      requireGitRoot: true,
      auditLog: path.join(tempRoot, "logs", "local-audit.log"),
      allowedCommands: ["git status"]
    });

    const config = loadConfig(
      {
        CHAMPCITY_GPT_ALLOWED_ROOTS: envRoot,
        CHAMPCITY_GPT_AUDIT_LOG: path.join(tempRoot, "logs", "env-audit.log"),
        CHAMPCITY_GPT_REQUIRE_GIT_ROOT: "false",
        CHAMPCITY_GPT_ALLOWED_COMMANDS: "npm test;git diff"
      },
      tempRoot
    );

    assert.deepEqual(config.allowedRoots, [path.resolve(envRoot)]);
    assert.equal(config.auditLogPath, path.join(tempRoot, "logs", "env-audit.log"));
    assert.equal(config.requireGitRoot, false);
    assert.deepEqual(config.allowedCommands, ["npm test", "git diff"]);
    assert.equal(config.writeMode, "off");
    assert.equal(config.writeToolsEnabled, false);
  });

  it("keeps write tools disabled by default in HTTP mode", () => {
    const config = loadConfig({}, tempRoot, { defaultWriteToolsEnabled: false });

    assert.equal(config.writeMode, "off");
    assert.equal(config.writeToolsEnabled, false);
    assert.equal(config.writeToolsEnabledSource, "default");
  });

  it("loads local writeMode docs", () => {
    writeLocalWriteAccessConfig({ writeMode: "docs" });

    const config = loadConfig({}, tempRoot, { defaultWriteToolsEnabled: false });

    assert.equal(config.writeMode, "docs");
    assert.equal(config.writeToolsEnabled, true);
    assert.equal(config.writeToolsEnabledSource, "local-file");
    assert.equal(config.docsWritesAllowed, true);
    assert.equal(config.patchWritesAllowed, false);
  });

  it("migrates legacy httpWriteToolsEnabled true to docs mode", () => {
    writeLocalWriteAccessConfig({ httpWriteToolsEnabled: true });

    const config = loadConfig({}, tempRoot, { defaultWriteToolsEnabled: false });

    assert.equal(config.writeMode, "docs");
    assert.equal(config.writeModeSource, "local-file");
  });

  it("lets CHAMPCITY_GPT_WRITE_MODE override local write-access config", () => {
    writeLocalWriteAccessConfig({ writeMode: "docs" });

    const config = loadConfig({ CHAMPCITY_GPT_WRITE_MODE: "patch" }, tempRoot, { defaultWriteToolsEnabled: false });

    assert.equal(config.writeMode, "patch");
    assert.equal(config.patchWritesAllowed, true);
    assert.equal(config.writeToolsEnabledSource, "env");
  });

  it("maps legacy CHAMPCITY_GPT_ENABLE_WRITE_TOOLS=true to docs mode", () => {
    const config = loadConfig({ CHAMPCITY_GPT_ENABLE_WRITE_TOOLS: "true" }, tempRoot);

    assert.equal(config.writeMode, "docs");
    assert.equal(config.writeToolsEnabled, true);
    assert.equal(config.writeToolsEnabledSource, "legacy-env");
  });

  it("allows legacy environment to disable write tools", () => {
    const config = loadConfig({ CHAMPCITY_GPT_ENABLE_WRITE_TOOLS: "false" }, tempRoot);

    assert.equal(config.writeMode, "off");
    assert.equal(config.writeToolsEnabled, false);
    assert.equal(config.writeToolsEnabledSource, "legacy-env");
  });

  it("fails closed for invalid write mode", () => {
    assert.throws(() => loadConfig({ CHAMPCITY_GPT_WRITE_MODE: "banana" }, tempRoot), /write_mode|writeMode|off, docs, patch, or elevated/i);
  });

  it("validates a hashed local write approval token", () => {
    saveWriteApprovalToken(tempRoot, "correct-write-token");
    const localConfig = readWriteAccessLocalConfig(tempRoot);

    assert.ok(localConfig.legacyApprovalTokenHash);
    assert.equal(verifyWriteApprovalTokenHash("correct-write-token", localConfig.legacyApprovalTokenHash), true);
    assert.equal(verifyWriteApprovalTokenHash("wrong-write-token", localConfig.legacyApprovalTokenHash), false);

    const config = loadConfig({}, tempRoot);
    assert.equal(config.writeApprovalToken.source, "local-file");
    assert.equal(config.writeApprovalToken.tokenHash, localConfig.legacyApprovalTokenHash);
  });

  it("lets environment write approval token override local hashed token", () => {
    saveWriteApprovalToken(tempRoot, "local-write-token");

    const config = loadConfig({ CHAMPCITY_GPT_WRITE_APPROVAL_TOKEN: "env-write-token" }, tempRoot);

    assert.equal(config.writeApprovalToken.source, "env");
    assert.equal(config.writeApprovalToken.token, "env-write-token");
  });

  it("fails clearly when local config contains invalid JSON", () => {
    fs.mkdirSync(path.join(tempRoot, "config"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "config", "allowed-roots.local.json"), "{ nope", "utf8");

    assert.throws(() => loadConfig({}, tempRoot), /Invalid JSON.*allowed-roots\.local\.json/i);
  });
});
