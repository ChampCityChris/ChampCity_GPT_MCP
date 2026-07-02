import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { LATEST_PROTOCOL_VERSION, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";

import { type AppConfig, loadConfig } from "../src/config.js";
import {
  createAuthorizationServerMetadata,
  createProtectedResourceMetadata,
  formUrlEncode,
  getOAuthClientsPath,
  readLastOAuthAuthorizeError,
  readOAuthClientStore,
  readOAuthTokenStore,
  saveOAuthAdminPassword,
  writeOAuthTokenStore
} from "../src/oauth.js";
import { createMcpServer } from "../src/server/createMcpServer.js";
import { readLastMcpDiscoveryTrace } from "../src/server/discoveryTrace.js";
import { assertWriteToolEnabled, getToolExposureDiagnostics } from "../src/server/registerTools.js";
import { runHttpTransport, validateHttpBinding } from "../src/transports/httpTransport.js";

let tempRoot: string;
const originalPublicBaseUrl = process.env.CHAMPCITY_GPT_PUBLIC_BASE_URL;
const toolboxToolNames = [
  "repo_toolbox",
  "git_toolbox",
  "artifact_toolbox",
  "diagnostics_toolbox",
  "integration_toolbox",
  "browser_toolbox",
  "knowledge_toolbox"
] as const;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-http-"));
  delete process.env.CHAMPCITY_GPT_PUBLIC_BASE_URL;
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  if (originalPublicBaseUrl === undefined) {
    delete process.env.CHAMPCITY_GPT_PUBLIC_BASE_URL;
  } else {
    process.env.CHAMPCITY_GPT_PUBLIC_BASE_URL = originalPublicBaseUrl;
  }
});

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const writeMode =
    overrides.writeMode ?? (overrides.writeToolsEnabled === true ? "docs" : overrides.writeToolsEnabled === false ? "off" : "off");
  return {
    repoRoot: tempRoot,
    allowedRoots: [tempRoot],
    auditLogPath: path.join(tempRoot, "logs", "audit.log"),
    requireGitRoot: false,
    allowedCommands: [],
    writeToolsEnabled: writeMode !== "off",
    writeToolsEnabledSource: "default",
    writeMode,
    writeModeSource: "default",
    docsWritesAllowed: writeMode === "docs" || writeMode === "patch" || writeMode === "elevated",
    patchWritesAllowed: writeMode === "patch" || writeMode === "elevated",
    elevatedOperationsAllowed: writeMode === "elevated",
    writeApprovalToken: { source: "env", token: "test-write-token" },
    ...overrides
  };
}

function createScopedMcpServerFactory(config: AppConfig) {
  return (auth?: { scope: string }) => createMcpServer(config, "0.1.0-test", { scope: auth?.scope });
}

interface McpPostResult {
  response: Response;
  messages: Array<Record<string, unknown>>;
}

function mcpHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    "accept": "application/json, text/event-stream",
    "mcp-protocol-version": LATEST_PROTOCOL_VERSION,
    ...extra
  };
}

function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function parseMcpMessages(response: Response): Promise<Array<Record<string, unknown>>> {
  if (response.status === 202 || response.status === 401) {
    return [];
  }

  const text = await response.text();
  if (!text.trim()) {
    return [];
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    return [JSON.parse(text) as Record<string, unknown>];
  }

  return text
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter(Boolean)
    .map((data) => JSON.parse(data) as Record<string, unknown>);
}

async function postMcp(url: string, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<McpPostResult> {
  const response = await fetch(url, {
    method: "POST",
    headers: mcpHeaders(headers),
    body: JSON.stringify(body)
  });

  const messages = await parseMcpMessages(response);
  return {
    response,
    messages
  };
}

async function issueTestTokenPair(handleUrl: string, scope: string): Promise<{ accessToken: string; refreshToken: string; clientId: string }> {
  const redirectUri = "https://chat.openai.com/aip/callback";
  const adminPassword = "test-admin-password";
  saveOAuthAdminPassword(tempRoot, adminPassword);

  const registration = await fetch(new URL("/oauth/register", handleUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      client_name: "ChatGPT",
      scope
    })
  });
  assert.equal(registration.status, 201);
  const client = (await registration.json()) as { client_id: string };

  const verifier = "test-code-verifier-with-enough-entropy";
  const challenge = sha256Base64Url(verifier);
  const authorization = await fetch(new URL("/oauth/authorize", handleUrl), {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: formUrlEncode({
      client_id: client.client_id,
      redirect_uri: redirectUri,
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope,
      state: "test-state",
      admin_password: adminPassword
    })
  });
  assert.equal(authorization.status, 302);
  const location = authorization.headers.get("location");
  assert.ok(location);
  const code = new URL(location).searchParams.get("code");
  assert.ok(code);

  const token = await fetch(new URL("/oauth/token", handleUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: formUrlEncode({
      grant_type: "authorization_code",
      code,
      client_id: client.client_id,
      redirect_uri: redirectUri,
      code_verifier: verifier
    })
  });
  assert.equal(token.status, 200);
  const tokenJson = (await token.json()) as { access_token: string; refresh_token: string; token_type: string; expires_in: number; scope: string };
  assert.equal(tokenJson.token_type, "Bearer");
  assert.equal(tokenJson.expires_in, 7200);
  assert.equal(tokenJson.scope, scope);
  return {
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token,
    clientId: client.client_id
  };
}

async function issueTestAccessToken(handleUrl: string, scope: string): Promise<string> {
  return (await issueTestTokenPair(handleUrl, scope)).accessToken;
}

function firstResult(messages: Array<Record<string, unknown>>, id: number): Record<string, unknown> {
  const message = messages.find((entry) => entry.id === id);
  assert.ok(message, `Expected MCP response for id ${id}`);
  assert.ok(!("error" in message), `Expected MCP result for id ${id}, received error ${JSON.stringify(message)}`);
  assert.ok(message.result && typeof message.result === "object");
  return message.result as Record<string, unknown>;
}

async function initializeOAuthMcpSession(handleUrl: string, scope: string): Promise<Record<string, string>> {
  const accessToken = await issueTestAccessToken(handleUrl, scope);
  const authHeader = { authorization: `Bearer ${accessToken}` };
  const initialize = await postMcp(
    handleUrl,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "champcity-http-test", version: "0.0.0" }
      }
    },
    authHeader
  );
  assert.equal(initialize.response.status, 200);
  firstResult(initialize.messages, 1);
  const sessionId = initialize.response.headers.get("mcp-session-id");
  assert.ok(sessionId);
  return {
    ...authHeader,
    "mcp-session-id": sessionId
  };
}

describe("HTTP MCP transport safety", () => {
  it("refuses nonlocal hosts unless explicitly allowed", () => {
    assert.throws(
      () => validateHttpBinding({ host: "0.0.0.0", allowNonlocalHttp: false, allowUnauthLocalHttp: false, authToken: "secret" }),
      /Refusing to bind HTTP MCP server/i
    );
  });

  it("rejects unauthenticated local test mode on nonlocal hosts", () => {
    assert.throws(
      () => validateHttpBinding({ host: "0.0.0.0", allowNonlocalHttp: true, allowUnauthLocalHttp: true }),
      /Unauthenticated HTTP mode is only allowed/i
    );
  });

  it("allows OAuth-only local HTTP binding by default", () => {
    assert.doesNotThrow(() => validateHttpBinding({ host: "127.0.0.1", allowNonlocalHttp: false, allowUnauthLocalHttp: false }));
  });

  it("allows unauthenticated local HTTP mode only with explicit opt-in", async () => {
    const config = testConfig({ writeToolsEnabled: false });
    const handle = await runHttpTransport(() => createMcpServer(config, "0.1.0-test"), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: true
    });

    await handle.close();
  });

  it("starts OAuth-only HTTP mode without a legacy bearer token", async () => {
    const config = testConfig({ writeToolsEnabled: false });
    const handle = await runHttpTransport(() => createMcpServer(config, "0.1.0-test"), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    await handle.close();
  });

  it("requires explicit nonlocal allowance for nonlocal HTTP mode", () => {
    assert.throws(
      () => validateHttpBinding({ host: "0.0.0.0", allowNonlocalHttp: false, allowUnauthLocalHttp: false, authToken: "secret" }),
      /Refusing to bind HTTP MCP server/i
    );
    assert.doesNotThrow(() =>
      validateHttpBinding({ host: "0.0.0.0", allowNonlocalHttp: true, allowUnauthLocalHttp: false })
    );
  });

  it("defaults write tools off for HTTP mode", () => {
    const config = loadConfig({}, tempRoot, { defaultWriteToolsEnabled: false });
    assert.equal(config.writeToolsEnabled, false);
  });

  it("refuses guarded write tools when write mode is insufficient", () => {
    assert.throws(() => assertWriteToolEnabled("apply_approved_patch", testConfig()), /writeMode patch or elevated/i);
    assert.throws(() => assertWriteToolEnabled("write_markdown_artifact", testConfig()), /writeMode docs, patch, or elevated/i);
    assert.throws(() => assertWriteToolEnabled("write_json_artifact", testConfig()), /writeMode docs, patch, or elevated/i);
    assert.throws(() => assertWriteToolEnabled("run_allowed_script", testConfig()), /writeMode elevated/i);
    assert.throws(() => assertWriteToolEnabled("safe_stage_changes", testConfig()), /writeMode elevated/i);
    assert.throws(() => assertWriteToolEnabled("commit_validated_changes", testConfig()), /writeMode elevated/i);
    assert.throws(() => assertWriteToolEnabled("push_current_branch", testConfig()), /writeMode elevated/i);
    assert.doesNotThrow(() => assertWriteToolEnabled("read_project_file", testConfig()));
  });

  it("serves expected health JSON", async () => {
    const config = testConfig({ writeToolsEnabled: false });
    const handle = await runHttpTransport(() => createMcpServer(config, "0.1.0-test"), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: true
    });

    try {
      const response = await fetch(handle.healthUrl);
      assert.equal(response.status, 200);
      const json = (await response.json()) as Record<string, unknown>;
      assert.equal(json.status, "ok");
      assert.equal(json.app, "ChampCity GPT MCP");
      assert.equal(json.transport, "http");
      assert.equal(json.version, "0.1.0-test");
      assert.equal(json.allowedRootCount, 1);
      assert.equal(json.writeToolsEnabled, false);
      assert.equal(json.writeMode, "off");
      assert.equal(json.writeModeSource, "default");
      assert.equal(json.docsWritesAllowed, false);
      assert.equal(json.patchWritesAllowed, false);
      assert.equal(json.elevatedOperationsAllowed, false);
      assert.equal(json.host, "127.0.0.1");
      assert.equal(json.port, Number(new URL(handle.healthUrl).port));
      assert.equal("authToken" in json, false);
    } finally {
      await handle.close();
    }
  });

  it("rejects /mcp without Authorization", async () => {
    const config = testConfig({ writeToolsEnabled: false });
    const handle = await runHttpTransport(() => createMcpServer(config, "0.1.0-test"), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const { response } = await postMcp(handle.url, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "champcity-http-test", version: "0.0.0" }
        }
      });
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("www-authenticate"), 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"');
    } finally {
      await handle.close();
    }
  });

  it("serves all OAuth metadata endpoints with the placeholder public issuer by default", async () => {
    const config = testConfig({ writeToolsEnabled: false });
    const handle = await runHttpTransport(() => createMcpServer(config, "0.1.0-test"), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const baseUrl = new URL(handle.url);
      for (const path of ["/.well-known/oauth-authorization-server", "/.well-known/oauth-authorization-server/mcp"]) {
        const authorizationServer = await fetch(new URL(path, baseUrl));
        assert.equal(authorizationServer.status, 200);
        const metadata = await authorizationServer.json();
        assert.deepEqual(metadata, createAuthorizationServerMetadata("https://mcp.example.com"));
        assert.deepEqual((metadata as { grant_types_supported: string[] }).grant_types_supported, ["authorization_code", "refresh_token"]);
        assert.equal((metadata as { registration_endpoint: string }).registration_endpoint, "https://mcp.example.com/oauth/register");
      }

      for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
        const protectedResource = await fetch(new URL(path, baseUrl));
        assert.equal(protectedResource.status, 200);
        assert.deepEqual(await protectedResource.json(), createProtectedResourceMetadata("https://mcp.example.com"));
      }
    } finally {
      await handle.close();
    }
  });

  it("uses CHAMPCITY_GPT_PUBLIC_BASE_URL in OAuth metadata and WWW-Authenticate", async () => {
    process.env.CHAMPCITY_GPT_PUBLIC_BASE_URL = "https://mcp.example.com";
    const config = testConfig({ writeToolsEnabled: false });
    const handle = await runHttpTransport(() => createMcpServer(config, "0.1.0-test"), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const baseUrl = new URL(handle.url);
      const authorizationServer = await fetch(new URL("/.well-known/oauth-authorization-server/mcp", baseUrl));
      assert.equal(authorizationServer.status, 200);
      assert.deepEqual(await authorizationServer.json(), createAuthorizationServerMetadata("https://mcp.example.com"));

      const protectedResource = await fetch(new URL("/.well-known/oauth-protected-resource", baseUrl));
      assert.equal(protectedResource.status, 200);
      assert.deepEqual(await protectedResource.json(), createProtectedResourceMetadata("https://mcp.example.com"));

      const { response } = await postMcp(handle.url, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "champcity-http-test", version: "0.0.0" }
        }
      });
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("www-authenticate"), 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"');
    } finally {
      await handle.close();
    }
  });

  it("falls back to safe OAuth metadata when the public base URL is invalid", async () => {
    const invalidPublicBaseUrl = ["C:", "Users", "fixture", "Private", "local-value"].join("\\");
    process.env.CHAMPCITY_GPT_PUBLIC_BASE_URL = invalidPublicBaseUrl;
    const config = testConfig({ writeToolsEnabled: false });
    const handle = await runHttpTransport(() => createMcpServer(config, "0.1.0-test"), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const authorizationServer = await fetch(new URL("/.well-known/oauth-authorization-server", handle.url));
      assert.equal(authorizationServer.status, 200);
      const metadata = await authorizationServer.json();
      assert.deepEqual(metadata, createAuthorizationServerMetadata("https://mcp.example.com"));
      assert.doesNotMatch(JSON.stringify(metadata), /Users|Private|local-value/u);

      const { response } = await postMcp(handle.url, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "champcity-http-test", version: "0.0.0" }
        }
      });
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("www-authenticate"), 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"');
    } finally {
      await handle.close();
    }
  });

  it("dynamically registers an OAuth client", async () => {
    const config = testConfig({ writeToolsEnabled: false });
    const handle = await runHttpTransport(() => createMcpServer(config, "0.1.0-test"), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const response = await fetch(new URL("/oauth/register", handle.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["https://chatgpt.com/connector/oauth/test"],
          client_name: "ChatGPT Test",
          grant_types: ["authorization_code"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          scope: "files.read"
        })
      });
      assert.equal(response.status, 201);
      const json = (await response.json()) as Record<string, unknown>;
      assert.equal(typeof json.client_id, "string");
      assert.equal(typeof json.client_id_issued_at, "number");
      assert.deepEqual(json.redirect_uris, ["https://chatgpt.com/connector/oauth/test"]);
      assert.deepEqual(json.grant_types, ["authorization_code"]);
      assert.deepEqual(json.response_types, ["code"]);
      assert.equal(json.scope, "files.read");
      assert.equal(json.token_endpoint_auth_method, "none");
      assert.equal(fs.existsSync(getOAuthClientsPath(tempRoot)), true);
      assert.equal(readOAuthClientStore(tempRoot).clients[0]?.client_id, json.client_id);
    } finally {
      await handle.close();
    }
  });

  it("rejects unsafe or unsupported Dynamic Client Registration metadata safely", async () => {
    const config = testConfig({ writeToolsEnabled: false });
    const handle = await runHttpTransport(() => createMcpServer(config, "0.1.0-test"), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    async function postRegistration(body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown>; text: string }> {
      const response = await fetch(new URL("/oauth/register", handle.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const text = await response.text();
      return {
        status: response.status,
        json: JSON.parse(text) as Record<string, unknown>,
        text
      };
    }

    try {
      const unsafeRedirectUri = ["file://", "C:", "Users", "fixture", "local-callback"].join("/");
      const localFileRedirect = await postRegistration({
        redirect_uris: [unsafeRedirectUri],
        token_endpoint_auth_method: "none"
      });
      assert.equal(localFileRedirect.status, 400);
      assert.equal(localFileRedirect.json.error, "invalid_client_metadata");
      assert.doesNotMatch(localFileRedirect.text, /Users|local-callback/u);

      const unsupportedGrant = await postRegistration({
        redirect_uris: ["https://chatgpt.com/connector/oauth/test"],
        grant_types: ["client_credentials"],
        response_types: ["code"],
        token_endpoint_auth_method: "none"
      });
      assert.equal(unsupportedGrant.status, 400);
      assert.equal(unsupportedGrant.json.error, "invalid_client_metadata");
      assert.match(String(unsupportedGrant.json.error_description), /unsupported value/i);

      const confidentialClient = await postRegistration({
        redirect_uris: ["https://chatgpt.com/connector/oauth/test"],
        token_endpoint_auth_method: "client_secret_post"
      });
      assert.equal(confidentialClient.status, 400);
      assert.equal(confidentialClient.json.error, "invalid_client_metadata");
      assert.match(String(confidentialClient.json.error_description), /must be none/i);

      fs.mkdirSync(path.dirname(getOAuthClientsPath(tempRoot)), { recursive: true });
      fs.writeFileSync(getOAuthClientsPath(tempRoot), "{broken", "utf8");
      const corruptLocalStore = await postRegistration({
        redirect_uris: ["https://chatgpt.com/connector/oauth/test"],
        token_endpoint_auth_method: "none"
      });
      assert.equal(corruptLocalStore.status, 400);
      assert.equal(corruptLocalStore.json.error, "invalid_client_metadata");
      assert.doesNotMatch(corruptLocalStore.text, new RegExp(tempRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
      assert.doesNotMatch(corruptLocalStore.text, /access_token|refresh_token|client_secret|authorization_code/iu);
    } finally {
      await handle.close();
    }
  });

  it("keeps a dynamically registered client_id valid after a simulated restart", async () => {
    const config = testConfig({ writeToolsEnabled: false });
    const firstHandle = await runHttpTransport(() => createMcpServer(config, "0.1.0-test"), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    const redirectUri = "https://chatgpt.com/connector/oauth/restart-test";
    let clientId = "";
    try {
      const response = await fetch(new URL("/oauth/register", firstHandle.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          redirect_uris: [redirectUri],
          client_name: "ChatGPT Restart Test",
          token_endpoint_auth_method: "none",
          scope: "files.read"
        })
      });
      assert.equal(response.status, 201);
      clientId = ((await response.json()) as { client_id: string }).client_id;
      assert.equal(readOAuthClientStore(tempRoot).clients.some((client) => client.client_id === clientId), true);
    } finally {
      await firstHandle.close();
    }

    const secondHandle = await runHttpTransport(() => createMcpServer(config, "0.1.0-test"), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const authorization = await fetch(new URL(`/oauth/authorize?${new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        code_challenge: "a".repeat(43),
        code_challenge_method: "S256",
        scope: "files.read"
      })}`, secondHandle.url));
      assert.equal(authorization.status, 503);
      assert.match(await authorization.text(), /OAuth admin password is not configured/i);
    } finally {
      await secondHandle.close();
    }
  });

  it("rejects authorization requests with invalid client_id or missing PKCE", async () => {
    const config = testConfig({ writeToolsEnabled: false });
    const handle = await runHttpTransport(() => createMcpServer(config, "0.1.0-test"), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const base = new URL(handle.url);
      const invalidClient = await fetch(new URL("/oauth/authorize?client_id=missing&redirect_uri=https%3A%2F%2Fchat.openai.com%2Faip%2Fcallback&response_type=code&code_challenge=abc&code_challenge_method=S256", base));
      assert.equal(invalidClient.status, 400);
      assert.deepEqual(await invalidClient.json(), {
        error: "invalid_request",
        error_description: "Invalid client_id."
      });

      const registration = await fetch(new URL("/oauth/register", base), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redirect_uris: ["https://chat.openai.com/aip/callback"] })
      });
      const client = (await registration.json()) as { client_id: string };
      const missingPkce = await fetch(new URL(`/oauth/authorize?client_id=${client.client_id}&redirect_uri=https%3A%2F%2Fchat.openai.com%2Faip%2Fcallback&response_type=code`, base));
      assert.equal(missingPkce.status, 400);
    } finally {
      await handle.close();
    }
  });

  it("handles a ChatGPT-like OAuth authorization code PKCE flow", async () => {
    const redirectUri = "https://chatgpt.com/connector/oauth/test-callback";
    const adminPassword = "test-admin-password";
    const verifier = "test-chatgpt-code-verifier-with-enough-entropy";
    const challenge = sha256Base64Url(verifier);
    const config = testConfig({ writeToolsEnabled: false });
    saveOAuthAdminPassword(tempRoot, adminPassword);
    const handle = await runHttpTransport(() => createMcpServer(config, "0.1.0-test"), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const registration = await fetch(new URL("/oauth/register", handle.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          redirect_uris: [redirectUri],
          client_name: "ChatGPT",
          grant_types: ["authorization_code"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          scope: "files.read"
        })
      });
      assert.equal(registration.status, 201);
      const client = (await registration.json()) as { client_id: string; redirect_uris: string[]; scope: string };
      assert.deepEqual(client.redirect_uris, [redirectUri]);
      assert.deepEqual(readOAuthClientStore(tempRoot).clients[0]?.redirect_uris, [redirectUri]);

      const base = new URL(handle.url);
      const validAuthorizeParams = new URLSearchParams({
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: redirectUri,
        scope: "files.read",
        state: "abc",
        code_challenge: challenge,
        code_challenge_method: "S256"
      });

      const missingPkce = await fetch(new URL(`/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: redirectUri,
        scope: "files.read"
      })}`, base));
      assert.equal(missingPkce.status, 400);
      assert.equal(readLastOAuthAuthorizeError(tempRoot)?.requiredFieldsPresent.code_challenge, false);

      const plainPkce = await fetch(new URL(`/oauth/authorize?${new URLSearchParams({
        ...Object.fromEntries(validAuthorizeParams.entries()),
        code_challenge_method: "plain"
      })}`, base));
      assert.equal(plainPkce.status, 400);
      const plainDiagnostic = readLastOAuthAuthorizeError(tempRoot);
      assert.equal(plainDiagnostic?.requiredFieldsPresent.code_challenge, true);
      assert.equal(plainDiagnostic?.codeChallengeMethod, "plain");
      assert.equal(plainDiagnostic?.clientIdPrefix, client.client_id.slice(0, 8));
      assert.equal(plainDiagnostic?.redirectUriLocation, "https://chatgpt.com/connector/oauth/test-callback");

      const authorize = await fetch(new URL(`/oauth/authorize?${validAuthorizeParams}`, base));
      assert.equal(authorize.status, 200);
      assert.match(await authorize.text(), /Authorize ChatGPT/u);

      const approval = await fetch(new URL("/oauth/authorize", handle.url), {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: formUrlEncode({
          client_id: client.client_id,
          redirect_uri: redirectUri,
          response_type: "code",
          code_challenge: challenge,
          code_challenge_method: "S256",
          scope: "files.read",
          state: "abc",
          admin_password: adminPassword
        })
      });
      assert.equal(approval.status, 302);
      const location = approval.headers.get("location");
      assert.ok(location);
      const redirect = new URL(location);
      assert.equal(`${redirect.origin}${redirect.pathname}`, redirectUri);
      assert.equal(redirect.searchParams.get("state"), "abc");
      const code = redirect.searchParams.get("code");
      assert.ok(code);

      const invalidVerifier = await fetch(new URL("/oauth/token", handle.url), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: formUrlEncode({
          grant_type: "authorization_code",
          code,
          client_id: client.client_id,
          redirect_uri: redirectUri,
          code_verifier: "wrong-code-verifier-with-enough-entropy"
        })
      });
      assert.equal(invalidVerifier.status, 400);
      assert.equal(((await invalidVerifier.json()) as { error: string }).error, "invalid_grant");

      const token = await fetch(new URL("/oauth/token", handle.url), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: formUrlEncode({
          grant_type: "authorization_code",
          code,
          client_id: client.client_id,
          redirect_uri: redirectUri,
          code_verifier: verifier
        })
      });
      assert.equal(token.status, 200);
      const tokenJson = (await token.json()) as { access_token: string; refresh_token: string; token_type: string; expires_in: number; scope: string };
      assert.equal(tokenJson.token_type, "Bearer");
      assert.equal(tokenJson.expires_in, 7200);
      assert.equal(typeof tokenJson.refresh_token, "string");
      assert.ok(tokenJson.refresh_token.length > 20);
      assert.equal(tokenJson.scope, "files.read");

      const reused = await fetch(new URL("/oauth/token", handle.url), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: formUrlEncode({
          grant_type: "authorization_code",
          code,
          client_id: client.client_id,
          redirect_uri: redirectUri,
          code_verifier: verifier
        })
      });
      assert.equal(reused.status, 400);

      const initialize = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: LATEST_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "chatgpt-pkce-test", version: "0.0.0" }
          }
        },
        { authorization: `Bearer ${tokenJson.access_token}` }
      );
      assert.equal(initialize.response.status, 200);
      const sessionId = initialize.response.headers.get("mcp-session-id");
      assert.ok(sessionId);

      const toolsList = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list"
        },
        {
          authorization: `Bearer ${tokenJson.access_token}`,
          "mcp-session-id": sessionId
        }
      );
      assert.equal(toolsList.response.status, 200);
      firstResult(toolsList.messages, 2);
    } finally {
      await handle.close();
    }
  });

  it("rejects invalid authorization codes at the token endpoint", async () => {
    const config = testConfig({ writeToolsEnabled: false });
    const handle = await runHttpTransport(() => createMcpServer(config, "0.1.0-test"), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const response = await fetch(new URL("/oauth/token", handle.url), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: formUrlEncode({
          grant_type: "authorization_code",
          code: "invalid",
          client_id: "missing",
          redirect_uri: "https://chat.openai.com/aip/callback",
          code_verifier: "verifier"
        })
      });
      assert.equal(response.status, 400);
      const json = (await response.json()) as Record<string, unknown>;
      assert.equal(json.error, "invalid_grant");
    } finally {
      await handle.close();
    }
  });

  it("accepts a valid authorization code with PKCE and returns a bearer access token", async () => {
    const config = testConfig({ writeToolsEnabled: false });
    const handle = await runHttpTransport(() => createMcpServer(config, "0.1.0-test"), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const accessToken = await issueTestAccessToken(handle.url, "files.read");
      assert.equal(typeof accessToken, "string");
      assert.ok(accessToken.length > 20);
    } finally {
      await handle.close();
    }
  });

  it("refresh_token grant returns a rotated refresh token and a new access token", async () => {
    const config = testConfig({ writeToolsEnabled: false });
    const handle = await runHttpTransport(() => createMcpServer(config, "0.1.0-test"), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const pair = await issueTestTokenPair(handle.url, "files.read");
      const response = await fetch(new URL("/oauth/token", handle.url), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: formUrlEncode({
          grant_type: "refresh_token",
          refresh_token: pair.refreshToken,
          client_id: pair.clientId
        })
      });
      assert.equal(response.status, 200);
      const json = (await response.json()) as { access_token: string; refresh_token: string; token_type: string; expires_in: number; scope: string };
      assert.equal(json.token_type, "Bearer");
      assert.equal(json.expires_in, 7200);
      assert.equal(json.scope, "files.read");
      assert.notEqual(json.access_token, pair.accessToken);
      assert.notEqual(json.refresh_token, pair.refreshToken);
    } finally {
      await handle.close();
    }
  });

  it("rejects rotated refresh token reuse", async () => {
    const config = testConfig({ writeToolsEnabled: false });
    const handle = await runHttpTransport(() => createMcpServer(config, "0.1.0-test"), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const pair = await issueTestTokenPair(handle.url, "files.read");
      const body = formUrlEncode({
        grant_type: "refresh_token",
        refresh_token: pair.refreshToken,
        client_id: pair.clientId
      });
      const first = await fetch(new URL("/oauth/token", handle.url), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body
      });
      assert.equal(first.status, 200);

      const reused = await fetch(new URL("/oauth/token", handle.url), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body
      });
      assert.equal(reused.status, 400);
      assert.deepEqual(await reused.json(), {
        error: "invalid_grant",
        error_description: "Refresh token is invalid or expired."
      });
    } finally {
      await handle.close();
    }
  });

  it("rejects expired refresh tokens", async () => {
    const config = testConfig({ writeToolsEnabled: false });
    const handle = await runHttpTransport(() => createMcpServer(config, "0.1.0-test"), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const pair = await issueTestTokenPair(handle.url, "files.read");
      const store = readOAuthTokenStore(tempRoot);
      store.refreshTokens[0].expiresAt = new Date(Date.now() - 1000).toISOString();
      writeOAuthTokenStore(tempRoot, store);

      const response = await fetch(new URL("/oauth/token", handle.url), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: formUrlEncode({
          grant_type: "refresh_token",
          refresh_token: pair.refreshToken,
          client_id: pair.clientId
        })
      });
      assert.equal(response.status, 400);
      assert.equal(((await response.json()) as { error: string }).error, "invalid_grant");
    } finally {
      await handle.close();
    }
  });

  it("rejects revoked refresh tokens", async () => {
    const config = testConfig({ writeToolsEnabled: false });
    const handle = await runHttpTransport(() => createMcpServer(config, "0.1.0-test"), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const pair = await issueTestTokenPair(handle.url, "files.read");
      const store = readOAuthTokenStore(tempRoot);
      store.refreshTokens[0].revoked = true;
      writeOAuthTokenStore(tempRoot, store);

      const response = await fetch(new URL("/oauth/token", handle.url), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: formUrlEncode({
          grant_type: "refresh_token",
          refresh_token: pair.refreshToken,
          client_id: pair.clientId
        })
      });
      assert.equal(response.status, 400);
      assert.equal(((await response.json()) as { error: string }).error, "invalid_grant");
    } finally {
      await handle.close();
    }
  });

  it("rejects refresh tokens with an invalid client_id", async () => {
    const config = testConfig({ writeToolsEnabled: false });
    const handle = await runHttpTransport(() => createMcpServer(config, "0.1.0-test"), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const pair = await issueTestTokenPair(handle.url, "files.read");
      const response = await fetch(new URL("/oauth/token", handle.url), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: formUrlEncode({
          grant_type: "refresh_token",
          refresh_token: pair.refreshToken,
          client_id: "wrong-client"
        })
      });
      assert.equal(response.status, 400);
      assert.equal(((await response.json()) as { error: string }).error, "invalid_grant");
    } finally {
      await handle.close();
    }
  });

  it("does not store refresh tokens in plaintext", async () => {
    const config = testConfig({ writeToolsEnabled: false });
    const handle = await runHttpTransport(() => createMcpServer(config, "0.1.0-test"), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const pair = await issueTestTokenPair(handle.url, "files.read");
      const stored = fs.readFileSync(path.join(tempRoot, "config", "oauth-tokens.local.json"), "utf8");
      assert.doesNotMatch(stored, new RegExp(pair.refreshToken, "u"));
      assert.match(stored, /refreshTokenHash/u);
      assert.doesNotMatch(stored, /"refresh_token"/u);
    } finally {
      await handle.close();
    }
  });

  it("rejects /mcp with invalid or expired OAuth tokens", async () => {
    const config = testConfig({ writeToolsEnabled: false });
    writeOAuthTokenStore(tempRoot, {
      accessTokens: [
        {
          tokenHash: sha256Hex("expired-token"),
          client_id: "client",
          scope: "files.read",
          createdAt: new Date(Date.now() - 7200_000).toISOString(),
          expiresAt: new Date(Date.now() - 3600_000).toISOString()
        }
      ],
      refreshTokens: []
    });
    const handle = await runHttpTransport(() => createMcpServer(config, "0.1.0-test"), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const invalid = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: LATEST_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "champcity-http-test", version: "0.0.0" }
          }
        },
        { authorization: "Bearer invalid-token" }
      );
      assert.equal(invalid.response.status, 401);

      const expired = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "initialize",
          params: {
            protocolVersion: LATEST_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "champcity-http-test", version: "0.0.0" }
          }
        },
        { authorization: "Bearer expired-token" }
      );
      assert.equal(expired.response.status, 401);
    } finally {
      await handle.close();
    }
  });

  it("accepts valid files.read OAuth tokens for tools/list and read tools", async () => {
    fs.writeFileSync(path.join(tempRoot, "alpha.md"), "# Alpha\n", "utf8");
    const config = testConfig({ writeToolsEnabled: false });
    const handle = await runHttpTransport(createScopedMcpServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const accessToken = await issueTestAccessToken(handle.url, "files.read");
      const authHeader = { authorization: `Bearer ${accessToken}` };
      const initialize = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: LATEST_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "champcity-http-test", version: "0.0.0" }
          }
        },
        authHeader
      );
      assert.equal(initialize.response.status, 200);
      firstResult(initialize.messages, 1);

      const sessionId = initialize.response.headers.get("mcp-session-id");
      assert.ok(sessionId);
      const sessionHeaders = {
        ...authHeader,
        "mcp-session-id": sessionId
      };

      const toolsList = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list"
        },
        sessionHeaders
      );
      assert.equal(toolsList.response.status, 200);
      const toolsResult = firstResult(toolsList.messages, 2);
      assert.doesNotThrow(() => ListToolsResultSchema.parse(toolsResult));
      const toolNames = (toolsResult.tools as Array<{ name: string }>).map((entry) => entry.name);
      assert.deepEqual(toolNames, [...toolboxToolNames]);
      assert.equal((toolNames as string[]).includes("write_markdown_artifact"), false);

      const read = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "repo_toolbox",
            arguments: {
              action: "read_file",
              params: {
                relativePath: "alpha.md",
                maxBytes: 1000
              }
            }
          }
        },
        sessionHeaders
      );
      assert.equal(read.response.status, 200);
      firstResult(read.messages, 3);
    } finally {
      await handle.close();
    }
  });

  it("does not hide read-only tools when an OAuth token lacks files.write", async () => {
    const config = testConfig({ writeMode: "docs" });
    const handle = await runHttpTransport(createScopedMcpServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const sessionHeaders = await initializeOAuthMcpSession(handle.url, "files.read");
      const toolsList = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list"
        },
        sessionHeaders
      );
      assert.equal(toolsList.response.status, 200);
      const toolsResult = firstResult(toolsList.messages, 2);
      assert.doesNotThrow(() => ListToolsResultSchema.parse(toolsResult));
      const toolNames = (toolsResult.tools as Array<{ name: string }>).map((entry) => entry.name);

      assert.deepEqual(toolNames, [...toolboxToolNames]);
      assert.equal((toolNames as string[]).includes("write_markdown_artifact"), false);
      assert.equal((toolNames as string[]).includes("run_figma_make_file_handoff"), false);
    } finally {
      await handle.close();
    }
  });

  it("rejects direct legacy public tool calls after toolbox consolidation", async () => {
    fs.writeFileSync(path.join(tempRoot, "alpha.md"), "# Alpha\n", "utf8");
    const config = testConfig({ writeMode: "docs" });
    const handle = await runHttpTransport(createScopedMcpServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const sessionHeaders = await initializeOAuthMcpSession(handle.url, "files.read files.write");
      const legacyRead = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "read_project_file",
            arguments: {
              root: tempRoot,
              relativePath: "alpha.md"
            }
          }
        },
        sessionHeaders
      );
      const legacyScript = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "run_allowed_script",
            arguments: {
              root: tempRoot,
              command: "npm test",
              approvalToken: "test-write-token"
            }
          }
        },
        sessionHeaders
      );

      assert.equal(legacyRead.response.status, 200);
      assert.match(JSON.stringify(legacyRead.messages), /not exposed on the public toolbox surface/u);
      assert.equal(legacyScript.response.status, 200);
      assert.match(JSON.stringify(legacyScript.messages), /not exposed on the public toolbox surface|writeMode elevated/u);
    } finally {
      await handle.close();
    }
  });

  it("exposes expected ChatGPT-facing tools for OAuth files.read files.write", async () => {
    const config = testConfig({ writeMode: "docs" });
    const handle = await runHttpTransport(createScopedMcpServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const sessionHeaders = await initializeOAuthMcpSession(handle.url, "files.read files.write");
      const toolsList = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list"
        },
        sessionHeaders
      );
      assert.equal(toolsList.response.status, 200);
      const toolsResult = firstResult(toolsList.messages, 2);
      assert.doesNotThrow(() => ListToolsResultSchema.parse(toolsResult));
      const toolNames = (toolsResult.tools as Array<{ name: string }>).map((entry) => entry.name);
      const diagnostics = getToolExposureDiagnostics(config, { scope: "files.read files.write" });

      assert.deepEqual(toolNames, diagnostics.exposedToolNames);
      assert.deepEqual(toolNames, [...toolboxToolNames]);
      assert.equal((toolNames as string[]).includes("run_figma_make_file_handoff"), false);
      assert.equal((toolNames as string[]).includes("safe_stage_changes"), false);
    } finally {
      await handle.close();
    }
  });

  it("supports ChatGPT-compatible no-session tools/list discovery with application/json Accept", async () => {
    const config = testConfig({ writeMode: "docs" });
    const handle = await runHttpTransport(createScopedMcpServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const pair = await issueTestTokenPair(handle.url, "files.read files.write");
      const toolsList = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 22,
          method: "tools/list"
        },
        {
          authorization: `Bearer ${pair.accessToken}`,
          accept: "application/json"
        }
      );
      assert.equal(toolsList.response.status, 200);
      assert.match(toolsList.response.headers.get("content-type") ?? "", /application\/json/u);
      const toolsResult = firstResult(toolsList.messages, 22);
      assert.doesNotThrow(() => ListToolsResultSchema.parse(toolsResult));
      const toolNames = (toolsResult.tools as Array<{ name: string }>).map((entry) => entry.name);
      assert.deepEqual(toolNames, [...toolboxToolNames]);

      const trace = readLastMcpDiscoveryTrace(config);
      assert.ok(trace);
      assert.equal(trace.request.path, "/mcp");
      assert.deepEqual(trace.jsonRpc.methods, ["tools/list"]);
      assert.equal(trace.auth.kind, "oauth");
      assert.equal(trace.auth.clientId, pair.clientId);
      assert.equal(trace.auth.scope, "files.read files.write");
      assert.equal(trace.response.transportRoute, "stateless-compat");
      assert.equal(trace.response.kind, "json-rpc-response");
      assert.equal(trace.tools.finalToolCountReturned, toolNames.length);
      assert.deepEqual(trace.tools.finalToolNamesReturned, toolNames);
    } finally {
      await handle.close();
    }
  });

  it("traces initialize, initialized, resources/list, prompts/list, and tools/list discovery sequence", async () => {
    const config = testConfig({ writeMode: "docs" });
    const handle = await runHttpTransport(createScopedMcpServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const pair = await issueTestTokenPair(handle.url, "files.read");
      const authHeader = { authorization: `Bearer ${pair.accessToken}` };
      const initialize = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: LATEST_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "champcity-http-test", version: "0.0.0" }
          }
        },
        authHeader
      );
      assert.equal(initialize.response.status, 200);
      const sessionId = initialize.response.headers.get("mcp-session-id");
      assert.ok(sessionId);
      const sessionHeaders = {
        ...authHeader,
        "mcp-session-id": sessionId
      };

      const initialized = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          method: "notifications/initialized"
        },
        sessionHeaders
      );
      assert.equal(initialized.response.status, 202);

      const resources = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "resources/list"
        },
        sessionHeaders
      );
      assert.equal(resources.response.status, 200);
      assert.deepEqual(firstResult(resources.messages, 2), { resources: [] });

      const prompts = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 3,
          method: "prompts/list"
        },
        sessionHeaders
      );
      assert.equal(prompts.response.status, 200);
      assert.deepEqual(firstResult(prompts.messages, 3), { prompts: [] });

      const toolsList = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/list"
        },
        sessionHeaders
      );
      assert.equal(toolsList.response.status, 200);

      const trace = readLastMcpDiscoveryTrace(config);
      assert.ok(trace);
      assert.equal(trace.request.path, "/mcp");
      assert.deepEqual(trace.jsonRpc.methods, ["tools/list"]);
      assert.deepEqual(trace.recentDiscoverySequence.methodsObserved, [
        "initialize",
        "notifications/initialized",
        "resources/list",
        "prompts/list",
        "tools/list"
      ]);
      assert.deepEqual(trace.tools.finalToolNamesReturned, [...toolboxToolNames]);
      assert.equal((trace.tools.finalToolNamesReturned as string[]).includes("write_markdown_artifact"), false);
      assert.deepEqual(trace.tools.scopeFilteredTools, []);
    } finally {
      await handle.close();
    }
  });

  it("refuses write tool calls without files.write scope", async () => {
    const config = testConfig({ writeToolsEnabled: true });
    const handle = await runHttpTransport(createScopedMcpServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const accessToken = await issueTestAccessToken(handle.url, "files.read");
      const authHeader = { authorization: `Bearer ${accessToken}` };
      const initialize = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: LATEST_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "champcity-http-test", version: "0.0.0" }
          }
        },
        authHeader
      );
      const sessionId = initialize.response.headers.get("mcp-session-id");
      assert.ok(sessionId);

      const write = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "repo_toolbox",
            arguments: {
              action: "write_markdown_artifact",
              params: {
                relativePath: "new.md",
                content: "# New\n"
              }
            }
          }
        },
        {
          ...authHeader,
          "mcp-session-id": sessionId
        }
      );
      assert.equal(write.response.status, 200);
      assert.match(JSON.stringify(write.messages), /files\.write/u);
    } finally {
      await handle.close();
    }
  });

  it("refuses write tool calls when write mode is off even with files.write scope", async () => {
    const config = testConfig({ writeToolsEnabled: false });
    const handle = await runHttpTransport(() => createMcpServer(config, "0.1.0-test"), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const accessToken = await issueTestAccessToken(handle.url, "files.read files.write");
      const authHeader = { authorization: `Bearer ${accessToken}` };
      const initialize = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: LATEST_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "champcity-http-test", version: "0.0.0" }
          }
        },
        authHeader
      );
      const sessionId = initialize.response.headers.get("mcp-session-id");
      assert.ok(sessionId);

      const write = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "repo_toolbox",
            arguments: {
              action: "write_markdown_artifact",
              params: {
                relativePath: "new.md",
                content: "# New\n"
              }
            }
          }
        },
        {
          ...authHeader,
          "mcp-session-id": sessionId
        }
      );
      assert.equal(write.response.status, 200);
      assert.match(JSON.stringify(write.messages), /writeMode docs, patch, or elevated/u);
    } finally {
      await handle.close();
    }
  });

  it("allows Markdown writes in docs mode without requiring approvalToken", async () => {
    const config = testConfig({ writeMode: "docs" });
    const handle = await runHttpTransport(() => createMcpServer(config, "0.1.0-test"), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const accessToken = await issueTestAccessToken(handle.url, "files.read files.write");
      const authHeader = { authorization: `Bearer ${accessToken}` };
      const initialize = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: LATEST_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "champcity-http-test", version: "0.0.0" }
          }
        },
        authHeader
      );
      const sessionId = initialize.response.headers.get("mcp-session-id");
      assert.ok(sessionId);

      const write = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "repo_toolbox",
            arguments: {
              action: "write_markdown_artifact",
              params: {
                relativePath: "new.md",
                content: "# New\n"
              }
            }
          }
        },
        {
          ...authHeader,
          "mcp-session-id": sessionId
        }
      );
      assert.equal(write.response.status, 200);
      firstResult(write.messages, 2);
      assert.equal(fs.readFileSync(path.join(tempRoot, "new.md"), "utf8"), "# New\n");
    } finally {
      await handle.close();
    }
  });

  it("allows Markdown write tool calls with files.write scope and docs mode", async () => {
    const config = testConfig({ writeMode: "docs" });
    const handle = await runHttpTransport(() => createMcpServer(config, "0.1.0-test"), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const accessToken = await issueTestAccessToken(handle.url, "files.read files.write");
      const authHeader = { authorization: `Bearer ${accessToken}` };
      const initialize = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: LATEST_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "champcity-http-test", version: "0.0.0" }
          }
        },
        authHeader
      );
      const sessionId = initialize.response.headers.get("mcp-session-id");
      assert.ok(sessionId);

      const write = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "repo_toolbox",
            arguments: {
              action: "write_markdown_artifact",
              params: {
                relativePath: "new.md",
                content: "# New\n"
              }
            }
          }
        },
        {
          ...authHeader,
          "mcp-session-id": sessionId
        }
      );
      assert.equal(write.response.status, 200);
      firstResult(write.messages, 2);
      assert.equal(fs.readFileSync(path.join(tempRoot, "new.md"), "utf8"), "# New\n");
    } finally {
      await handle.close();
    }
  });

  it("accepts /mcp with Authorization when an auth token is configured", async () => {
    const config = testConfig({ writeToolsEnabled: false });
    const handle = await runHttpTransport(() => createMcpServer(config, "0.1.0-test"), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      authToken: "test-token",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const { response, messages } = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: LATEST_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "champcity-http-test", version: "0.0.0" }
          }
        },
        { authorization: "Bearer test-token" }
      );
      assert.equal(response.status, 200);
      assert.notEqual(response.status, 500);
      firstResult(messages, 1);
      assert.ok(response.headers.get("mcp-session-id"));
    } finally {
      await handle.close();
    }
  });

  it("runs an end-to-end Streamable HTTP MCP tool flow without HTTP 500", async () => {
    fs.writeFileSync(path.join(tempRoot, "alpha.md"), "# Alpha\n", "utf8");
    const config = testConfig({ writeToolsEnabled: false });
    const handle = await runHttpTransport(() => createMcpServer(config, "0.1.0-test"), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: true
    });

    try {
      const initialize = await postMcp(handle.url, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "champcity-http-test", version: "0.0.0" }
        }
      });
      assert.equal(initialize.response.status, 200);
      assert.notEqual(initialize.response.status, 500);
      firstResult(initialize.messages, 1);

      const sessionId = initialize.response.headers.get("mcp-session-id");
      assert.ok(sessionId);
      const sessionHeaders = {
        "mcp-session-id": sessionId
      };

      const initialized = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          method: "notifications/initialized"
        },
        sessionHeaders
      );
      assert.equal(initialized.response.status, 202);
      assert.notEqual(initialized.response.status, 500);

      const toolsList = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list"
        },
        sessionHeaders
      );
      assert.equal(toolsList.response.status, 200);
      assert.notEqual(toolsList.response.status, 500);
      const toolsResult = firstResult(toolsList.messages, 2);
      assert.ok(Array.isArray(toolsResult.tools));
      const toolNames = toolsResult.tools.map((tool) => (tool as { name: string }).name);
      assert.deepEqual(toolNames, [...toolboxToolNames]);

      const callResult = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "repo_toolbox",
            arguments: {
              action: "list_files",
              params: {
                relativePath: ".",
                glob: "**/*",
                maxResults: 10
              }
            }
          }
        },
        sessionHeaders
      );
      assert.equal(callResult.response.status, 200);
      assert.notEqual(callResult.response.status, 500);
      const toolResult = firstResult(callResult.messages, 3);
      assert.ok(Array.isArray(toolResult.content));
      const text = (toolResult.content[0] as { text: string }).text;
      const parsedToolText = JSON.parse(text) as { ok: boolean; result: { files: string[]; truncated: boolean } };
      assert.equal(parsedToolText.ok, true);
      assert.deepEqual(parsedToolText.result.files, ["alpha.md"]);
      assert.equal(parsedToolText.result.truncated, false);
    } finally {
      await handle.close();
    }
  });
});

