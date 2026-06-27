import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  createClientConfigPreviews,
  DEFAULT_ALLOWED_COMMANDS,
  findStaleEntrypointReferences,
  getAuditLogPath,
  getEntrypointPath,
  getLauncherOAuthStatus,
  getSetupStatePath,
  isAllowedLauncherCommand,
  readSetupState,
  resetSetupState,
  writeSetupState,
  writeClientConfigFiles,
  writeLocalConfig
} from "../electron/launcherCore.js";
import { writeOAuthClientStore, writeOAuthTokenStore } from "../src/oauth.js";
import { saveWriteApprovalToken } from "../src/writeAccess.js";

let tempRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-launcher-"));
});

afterEach(() => {
  delete process.env.CHAMPCITY_GPT_CONFIG_DIR;
  delete process.env.CHAMPCITY_GPT_LOG_DIR;
  delete process.env.CHAMPCITY_GPT_GENERATED_DIR;
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("launcher client config generation", () => {
  it("uses the dist/src/index.js MCP entrypoint in every generated preview", () => {
    writeLocalConfig(tempRoot, {
      allowedRoots: [tempRoot],
      requireGitRoot: true,
      auditLog: getAuditLogPath(tempRoot),
      allowedCommands: DEFAULT_ALLOWED_COMMANDS
    });

    const previews = createClientConfigPreviews(tempRoot);
    const expectedEntrypoint = getEntrypointPath(tempRoot);
    const expectedEntrypointJson = expectedEntrypoint.replaceAll("\\", "\\\\");

    for (const content of [previews.generic, previews.codex, previews.claude]) {
      assert.match(content, /dist(?:\\\\|\\|\/)src(?:\\\\|\\|\/)index\.js/u);
      assert.doesNotMatch(content, /dist(?:\\\\|\\|\/)index\.js/u);
      assert.ok(content.includes(expectedEntrypoint) || content.includes(expectedEntrypointJson));
    }

    assert.match(previews.chatgptNotes, /https:\/\/mcp\.example\.com\/mcp/u);
    assert.doesNotMatch(previews.chatgptNotes, /dist(?:\\\\|\\|\/)index\.js/u);
  });

  it("writes the expected generated example files", () => {
    writeLocalConfig(tempRoot, {
      allowedRoots: [tempRoot],
      requireGitRoot: true,
      auditLog: getAuditLogPath(tempRoot),
      allowedCommands: DEFAULT_ALLOWED_COMMANDS
    });

    const result = writeClientConfigFiles(tempRoot);

    assert.ok(fs.existsSync(path.join(result.directory, "generic-stdio-mcp-config.example.json")));
    assert.ok(fs.existsSync(path.join(result.directory, "codex-mcp-config.example.json")));
    assert.ok(fs.existsSync(path.join(result.directory, "claude-desktop-mcp-config.example.json")));
    assert.ok(fs.existsSync(path.join(result.directory, "chatgpt-connection-notes.md")));
    assert.ok(fs.existsSync(path.join(result.directory, "chatgpt-champcity-net-setup.md")));
  });

  it("does not include the auth token file or raw token in generated notes", () => {
    writeLocalConfig(tempRoot, {
      allowedRoots: [tempRoot],
      requireGitRoot: true,
      auditLog: getAuditLogPath(tempRoot),
      allowedCommands: DEFAULT_ALLOWED_COMMANDS
    });
    fs.mkdirSync(path.join(tempRoot, "config"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "config", "http-auth.local.json"), JSON.stringify({ httpAuthToken: "raw-test-token" }), "utf8");

    const result = writeClientConfigFiles(tempRoot);
    const setupNotes = fs.readFileSync(path.join(result.directory, "chatgpt-champcity-net-setup.md"), "utf8");

    assert.match(setupNotes, /Legacy\/manual bearer auth configured: yes \(local-file\)/u);
    assert.doesNotMatch(setupNotes, /raw-test-token/u);
    assert.doesNotMatch(setupNotes, /http-auth\.local\.json/u);
  });

  it("does not include OAuth admin passwords or tokens in generated notes", () => {
    writeLocalConfig(tempRoot, {
      allowedRoots: [tempRoot],
      requireGitRoot: true,
      auditLog: getAuditLogPath(tempRoot),
      allowedCommands: DEFAULT_ALLOWED_COMMANDS
    });
    fs.mkdirSync(path.join(tempRoot, "config"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "config", "oauth-admin.local.json"), JSON.stringify({ adminPasswordHash: "raw-admin-secret", createdAt: new Date().toISOString() }), "utf8");
    fs.writeFileSync(path.join(tempRoot, "config", "oauth-tokens.local.json"), JSON.stringify({ accessTokens: [{ tokenHash: "raw-token-secret", client_id: "client", scope: "files.read", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() }] }), "utf8");

    const result = writeClientConfigFiles(tempRoot);
    const setupNotes = fs.readFileSync(path.join(result.directory, "chatgpt-champcity-net-setup.md"), "utf8");

    assert.match(setupNotes, /OAuth admin password configured: yes/u);
    assert.doesNotMatch(setupNotes, /raw-admin-secret/u);
    assert.doesNotMatch(setupNotes, /raw-token-secret/u);
    assert.doesNotMatch(setupNotes, /oauth-admin\.local\.json/u);
    assert.doesNotMatch(setupNotes, /oauth-tokens\.local\.json/u);
  });

  it("does not include raw write approval tokens in generated notes", () => {
    writeLocalConfig(tempRoot, {
      allowedRoots: [tempRoot],
      requireGitRoot: true,
      auditLog: getAuditLogPath(tempRoot),
      allowedCommands: DEFAULT_ALLOWED_COMMANDS
    });
    saveWriteApprovalToken(tempRoot, "raw-write-token-for-notes");

    const previews = createClientConfigPreviews(tempRoot);

    assert.match(previews.chatgptNotes, /Elevated approval token configured: yes/u);
    assert.match(previews.chatgptNotes, /Elevated approval token value: not displayed or written/u);
    assert.doesNotMatch(previews.chatgptNotes, /raw-write-token-for-notes/u);
    assert.doesNotMatch(previews.chatgptNotes, /writeApprovalTokenHash/u);
  });

  it("reports OAuth session status without exposing token hashes or raw tokens", () => {
    writeOAuthClientStore(tempRoot, {
      clients: [
        {
          client_id: "client-1",
          redirect_uris: ["https://chatgpt.com/connector/oauth/test"],
          client_name: "ChatGPT",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          scope: "files.read",
          created_at: new Date().toISOString()
        }
      ]
    });
    writeOAuthTokenStore(tempRoot, {
      accessTokens: [
        {
          tokenHash: "hashed-access-secret",
          client_id: "client-1",
          scope: "files.read",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 7200_000).toISOString()
        }
      ],
      refreshTokens: [
        {
          refreshTokenHash: "hashed-refresh-secret",
          client_id: "client-1",
          scope: "files.read",
          issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 2592000_000).toISOString(),
          revoked: false,
          lastUsedAt: "raw-token-should-not-appear"
        }
      ]
    });

    const status = getLauncherOAuthStatus(tempRoot);
    const serialized = JSON.stringify(status);

    assert.equal(status.activeOAuthClientsCount, 1);
    assert.equal(status.activeRefreshSessionsCount, 1);
    assert.equal(status.accessTokenTtlLabel, "2 hours");
    assert.equal(status.refreshTokenTtlLabel, "30 days");
    assert.doesNotMatch(serialized, /hashed-access-secret/u);
    assert.doesNotMatch(serialized, /hashed-refresh-secret/u);
    assert.doesNotMatch(serialized, /raw-token-should-not-appear/u);
  });

  it("does not use browser prompt in Electron source files", () => {
    const electronDir = path.join(process.cwd(), "electron");
    const filesToScan: string[] = [];

    function walk(target: string): void {
      for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
        const fullPath = path.join(target, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (/\.(ts|html|css)$/iu.test(entry.name)) {
          filesToScan.push(fullPath);
        }
      }
    }

    walk(electronDir);

    for (const file of filesToScan) {
      assert.doesNotMatch(fs.readFileSync(file, "utf8"), /\bprompt\s*\(/u, file);
    }
  });

  it("finds stale top-level dist index references", () => {
    fs.writeFileSync(path.join(tempRoot, "README.md"), "node dist/index.js\n", "utf8");

    const staleReferences = findStaleEntrypointReferences(tempRoot);

    assert.equal(staleReferences.length, 1);
  });
});

describe("launcher first-run setup state", () => {
  it("is incomplete when setup.local.json is missing", () => {
    const setup = readSetupState(tempRoot);

    assert.equal(setup.setupComplete, false);
    assert.equal(fs.existsSync(getSetupStatePath(tempRoot)), false);
  });

  it("writes setup.local.json to CHAMPCITY_GPT_CONFIG_DIR", () => {
    const runtimeConfigDir = path.join(tempRoot, "runtime-config");
    process.env.CHAMPCITY_GPT_CONFIG_DIR = runtimeConfigDir;

    const saved = writeSetupState(tempRoot, {
      setupComplete: true,
      appVersion: "0.1.0",
      publicBaseUrl: "https://mcp.example.com",
      cloudflareChoice: "skip"
    });

    assert.equal(saved.setupComplete, true);
    assert.equal(getSetupStatePath(tempRoot), path.join(runtimeConfigDir, "setup.local.json"));
    assert.equal(fs.existsSync(path.join(runtimeConfigDir, "setup.local.json")), true);
    assert.equal(fs.existsSync(path.join(tempRoot, "config", "setup.local.json")), false);
    assert.equal(readSetupState(tempRoot).publicBaseUrl, "https://mcp.example.com");
  });

  it("reset setup wizard does not delete other runtime-local config", () => {
    const runtimeConfigDir = path.join(tempRoot, "runtime-config");
    process.env.CHAMPCITY_GPT_CONFIG_DIR = runtimeConfigDir;
    writeSetupState(tempRoot, { setupComplete: true, appVersion: "0.1.0" });
    fs.writeFileSync(path.join(runtimeConfigDir, "oauth-tokens.local.json"), JSON.stringify({ accessTokens: [], refreshTokens: [] }), "utf8");

    resetSetupState(tempRoot);

    assert.equal(readSetupState(tempRoot).setupComplete, false);
    assert.equal(fs.existsSync(path.join(runtimeConfigDir, "oauth-tokens.local.json")), true);
  });
});

describe("launcher command allowlist", () => {
  it("allows only exact launcher commands", () => {
    assert.equal(isAllowedLauncherCommand("npm.cmd", ["install"], tempRoot), true);
    assert.equal(isAllowedLauncherCommand("npm", ["run", "build"], tempRoot), true);
    assert.equal(isAllowedLauncherCommand("node", [getEntrypointPath(tempRoot)], tempRoot), true);
    assert.equal(
      isAllowedLauncherCommand("node", [getEntrypointPath(tempRoot), "--transport", "http", "--host", "127.0.0.1", "--port", "3333"], tempRoot),
      true
    );
  });

  it("rejects arbitrary commands and extra args", () => {
    assert.equal(isAllowedLauncherCommand("cmd.exe", ["/c", "dir"], tempRoot), false);
    assert.equal(isAllowedLauncherCommand("npm", ["run", "build", "--", "--watch"], tempRoot), false);
    assert.equal(isAllowedLauncherCommand("node", ["some-other-file.js"], tempRoot), false);
  });
});

