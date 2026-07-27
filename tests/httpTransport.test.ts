import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
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
import { assertWriteToolEnabled, getToolExposureDiagnostics, PUBLIC_TOOL_NAMES } from "../src/server/registerTools.js";
import { writeAuditLog } from "../src/security/auditLog.js";
import { sanitizeDiagnosticText } from "../src/security/diagnosticRedaction.js";
import {
  getCurrentToolCallTraceContext,
  getToolCallTracePaths,
  isToolCallTraceIdentityMismatchError,
  readRecentToolCalls,
  recordToolCallTrace,
  runWithToolCallTraceGroupContext,
  toolCallTraceRequestIdKey,
  runWithToolCallTraceRequestId
} from "../src/server/toolCallTrace.js";
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
const publicWriteScopedToolNames = [...PUBLIC_TOOL_NAMES];

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

function toolboxActionFromArguments(args: unknown): string | undefined {
  return args && typeof args === "object" && !Array.isArray(args) && typeof (args as { action?: unknown }).action === "string"
    ? (args as { action: string }).action
    : undefined;
}

function createTraceEchoServerFactory(
  config: AppConfig,
  options: { waitForRelease?: (requestId: string | number) => Promise<void>; onDispatch?: (context: ReturnType<typeof getCurrentToolCallTraceContext>) => void } = {}
) {
  return () => {
    const server = new Server(
      { name: "champcity-trace-fixture", version: "0.1.0-test" },
      { capabilities: { tools: {} } }
    );

    server.setRequestHandler(CallToolRequestSchema, async (request, extra) =>
      runWithToolCallTraceRequestId(extra.requestId, async () => {
        const action = toolboxActionFromArguments(request.params.arguments);
        recordToolCallTrace(config, {
          stage: "dispatch_started",
          publicTool: request.params.name,
          action,
          result: "allow"
        });
        const context = getCurrentToolCallTraceContext();
        options.onDispatch?.(context);
        if (options.waitForRelease) {
          await options.waitForRelease(extra.requestId);
        }
        recordToolCallTrace(config, {
          stage: "tool_result_returned",
          publicTool: request.params.name,
          action,
          result: "allow"
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                sdkRequestId: extra.requestId,
                selectedCorrelationId: context?.correlationId,
                selectedJsonRpcId: context?.jsonRpcId
              })
            }
          ]
        };
      })
    );

    return server;
  };
}

function createTraceIdentityMismatchServerFactory(config: AppConfig) {
  return () => {
    const server = new Server(
      { name: "champcity-trace-mismatch-fixture", version: "0.1.0-test" },
      { capabilities: { tools: {} } }
    );

    server.setRequestHandler(CallToolRequestSchema, async () => {
      try {
        return await runWithToolCallTraceRequestId("unknown https://evil.example/mcp?access_token=secret C:\\Private\\file.md /etc/secret", async () => ({
          content: [{ type: "text" as const, text: "unreachable" }]
        }));
      } catch (error) {
        if (isToolCallTraceIdentityMismatchError(error)) {
          await writeAuditLog(config.auditLogPath, {
            toolName: "http_mcp_trace_identity",
            requestedPath: "tools/call",
            result: "deny",
            reason: sanitizeDiagnosticText(error.message)
          });
        }
        throw error;
      }
    });

    return server;
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
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
    const parsed = JSON.parse(text) as unknown;
    return (Array.isArray(parsed) ? parsed : [parsed]) as Array<Record<string, unknown>>;
  }

  return text
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter(Boolean)
    .map((data) => JSON.parse(data) as Record<string, unknown>);
}

async function postMcp(url: string, body: unknown, headers: Record<string, string> = {}): Promise<McpPostResult> {
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

function firstResult(messages: Array<Record<string, unknown>>, id: string | number): Record<string, unknown> {
  const message = messages.find((entry) => entry.id === id);
  assert.ok(message, `Expected MCP response for id ${id}`);
  assert.ok(!("error" in message), `Expected MCP result for id ${id}, received error ${JSON.stringify(message)}`);
  assert.ok(message.result && typeof message.result === "object");
  return message.result as Record<string, unknown>;
}

function textResultPayload(messages: Array<Record<string, unknown>>, id: string | number): Record<string, unknown> {
  const result = firstResult(messages, id);
  const content = result.content;
  assert.ok(Array.isArray(content));
  const textContent = content.find((entry): entry is { type: string; text: string } =>
    Boolean(entry && typeof entry === "object" && (entry as { type?: unknown }).type === "text" && typeof (entry as { text?: unknown }).text === "string")
  );
  assert.ok(textContent);
  return JSON.parse(textContent.text) as Record<string, unknown>;
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

  it("preserves pre-pass direct legacy call rejection behavior", async () => {
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
      const legacyDiff = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: {
            name: "git_diff",
            arguments: {
              root: tempRoot
            }
          }
        },
        sessionHeaders
      );
      const unknown = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: {
            name: "not_a_real_tool",
            arguments: {}
          }
        },
        sessionHeaders
      );

      assert.equal(legacyRead.response.status, 200);
      assert.match(JSON.stringify(legacyRead.messages), /not exposed on the public toolbox surface/u);
      assert.doesNotMatch(JSON.stringify(legacyRead.messages), /LEGACY_TOOL_REMOVED/u);
      assert.equal(legacyScript.response.status, 200);
      assert.match(JSON.stringify(legacyScript.messages), /not exposed on the public toolbox surface/u);
      assert.doesNotMatch(JSON.stringify(legacyScript.messages), /LEGACY_TOOL_REMOVED/u);
      assert.equal(legacyDiff.response.status, 200);
      assert.match(JSON.stringify(legacyDiff.messages), /not exposed on the public toolbox surface/u);
      assert.doesNotMatch(JSON.stringify(legacyDiff.messages), /LEGACY_TOOL_REMOVED/u);
      assert.equal(unknown.response.status, 200);
      assert.match(JSON.stringify(unknown.messages), /not exposed on the public toolbox surface/u);
      assert.doesNotMatch(JSON.stringify(unknown.messages), /LEGACY_TOOL_REMOVED/u);
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
      assert.deepEqual(toolNames, publicWriteScopedToolNames);
      assert.equal((toolNames as string[]).includes("run_figma_make_file_handoff"), false);
      assert.equal((toolNames as string[]).includes("safe_stage_changes"), false);
    } finally {
      await handle.close();
    }
  });

  it("records correlated successful repo_toolbox.read_file lifecycle and helper audit events", async () => {
    fs.writeFileSync(path.join(tempRoot, "alpha.md"), "# Alpha\nsecret access_token=should-not-appear\n", "utf8");
    const config = testConfig({ writeMode: "off" });
    const handle = await runHttpTransport(createScopedMcpServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const sessionHeaders = await initializeOAuthMcpSession(handle.url, "files.read");
      const read = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "repo_toolbox",
            arguments: {
              action: "read_file",
              params: {
                relativePath: "alpha.md"
              }
            }
          }
        },
        sessionHeaders
      );

      assert.equal(read.response.status, 200);
      firstResult(read.messages, 2);
      const calls = readRecentToolCalls(config, { publicToolName: "repo_toolbox" }).calls;
      assert.equal(calls.length, 1);
      const call = calls[0];
      assert.equal(call.classification, "RESPONSE_COMPLETED");
      assert.deepEqual(new Set(call.stages), new Set([
        "http_received",
        "dispatch_started",
        "toolbox_entered",
        "helper_started",
        "helper_allowed",
        "tool_result_returned",
        "http_response_completed"
      ]));
      assert.equal(new Set(call.events.map((event) => event.correlationId)).size, 1);
      const serializedTrace = JSON.stringify(call);
      assert.doesNotMatch(serializedTrace, /# Alpha|should-not-appear/u);
      assert.doesNotMatch(serializedTrace, new RegExp(tempRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
      assert.doesNotMatch(serializedTrace, /access_token=should-not-appear/u);

      const auditEntries = fs.readFileSync(config.auditLogPath, "utf8").trim().split(/\r?\n/u).map((line) => JSON.parse(line) as { toolName?: string; correlationId?: string; result?: string });
      assert.ok(auditEntries.some((entry) => entry.toolName === "read_project_file" && entry.correlationId === call.correlationId && entry.result === "allow"));
    } finally {
      await handle.close();
    }
  });

  it("traces every tools/call in a mixed JSON-RPC batch independently", async () => {
    fs.writeFileSync(path.join(tempRoot, "alpha.md"), "# Alpha\n", "utf8");
    const config = testConfig({ writeMode: "off" });
    const handle = await runHttpTransport(createScopedMcpServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const sessionHeaders = await initializeOAuthMcpSession(handle.url, "files.read");
      const since = new Date(Date.now() - 1_000).toISOString();
      const batch = await postMcp(
        handle.url,
        [
          {
            jsonrpc: "2.0",
            id: 11,
            method: "tools/list"
          },
          {
            jsonrpc: "2.0",
            method: "notifications/initialized"
          },
          {
            jsonrpc: "2.0",
            id: 12,
            method: "tools/call",
            params: {
              name: "repo_toolbox",
              arguments: {
                action: "read_file",
                params: {
                  relativePath: "alpha.md"
                }
              }
            }
          },
          {
            jsonrpc: "2.0",
            id: 13,
            method: "tools/call",
            params: {
              name: "browser_toolbox",
              arguments: {
                action: "get_browser_capabilities"
              }
            }
          }
        ],
        sessionHeaders
      );

      assert.equal(batch.response.status, 200);
      firstResult(batch.messages, 12);
      firstResult(batch.messages, 13);

      const calls = readRecentToolCalls(config, { since }).calls.filter((call) => call.publicTool !== "diagnostics_toolbox");
      assert.equal(calls.length, 2);
      assert.equal(new Set(calls.map((call) => call.correlationId)).size, 2);
      assert.deepEqual(new Set(calls.map((call) => call.publicTool)), new Set(["repo_toolbox", "browser_toolbox"]));
      assert.deepEqual(
        new Set(calls.flatMap((call) => call.events.map((event) => event.jsonRpcId)).filter((id) => id !== undefined)),
        new Set([12, 13])
      );
      assert.ok(calls.every((call) => call.classification === "RESPONSE_COMPLETED"));
      assert.ok(calls.every((call) => call.stages.includes("http_received")));
      assert.ok(calls.every((call) => call.stages.includes("dispatch_started")));
    } finally {
      await handle.close();
    }
  });

  it("records http_received evidence for malformed tools/call variants before SDK rejection", async () => {
    const config = testConfig({ writeMode: "off" });
    const handle = await runHttpTransport(createScopedMcpServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: true
    });

    try {
      const since = new Date(Date.now() - 1_000).toISOString();
      const malformed = [
        { jsonrpc: "2.0", id: "missing-params", method: "tools/call" },
        { jsonrpc: "2.0", id: "null-params", method: "tools/call", params: null },
        { jsonrpc: "2.0", id: "scalar-params", method: "tools/call", params: "nope" },
        { jsonrpc: "2.0", id: "array-params", method: "tools/call", params: [] },
        { jsonrpc: "2.0", id: "missing-name", method: "tools/call", params: { arguments: { action: "status" } } },
        { jsonrpc: "2.0", id: "non-string-name", method: "tools/call", params: { name: 123, arguments: { action: "status" } } },
        { jsonrpc: "2.0", id: "missing-arguments", method: "tools/call", params: { name: "repo_toolbox" } },
        { jsonrpc: "2.0", id: "null-arguments", method: "tools/call", params: { name: "repo_toolbox", arguments: null } },
        { jsonrpc: "2.0", id: "scalar-arguments", method: "tools/call", params: { name: "repo_toolbox", arguments: "nope" } },
        { jsonrpc: "2.0", id: "array-arguments", method: "tools/call", params: { name: "repo_toolbox", arguments: [] } }
      ];

      await postMcp(handle.url, malformed);

      const calls = readRecentToolCalls(config, { since, limit: 50 }).calls;
      const byId = new Map(calls.map((call) => [call.events[0]?.jsonRpcId, call]));
      for (const request of malformed) {
        const call = byId.get(request.id);
        assert.ok(call, `Expected trace evidence for ${request.id}`);
        assert.ok(call.stages.includes("http_received"), `Expected http_received for ${request.id}`);
      }
      assert.equal(new Set(calls.map((call) => call.correlationId)).size, malformed.length);
      assert.equal(byId.get("missing-params")?.publicTool, undefined);
      assert.equal(byId.get("array-params")?.publicTool, undefined);
      assert.equal(byId.get("missing-arguments")?.publicTool, "repo_toolbox");
      const schemaRejected = byId.get("scalar-arguments");
      assert.ok(schemaRejected);
      assert.equal(schemaRejected.classification, "RECEIVED_NOT_DISPATCHED");
      assert.equal(schemaRejected.stages.includes("dispatch_started"), false);
      assert.equal(schemaRejected.stages.includes("toolbox_entered"), false);
    } finally {
      await handle.close();
    }
  });

  it("redacts denied absolute requestedPath values in recent_tool_calls", async () => {
    const config = testConfig({ writeMode: "off" });
    const handle = await runHttpTransport(createScopedMcpServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: true
    });

    try {
      const denied = await postMcp(handle.url, {
        jsonrpc: "2.0",
        id: "absolute-path-denied",
        method: "tools/call",
        params: {
          name: "repo_toolbox",
          arguments: {
            action: "read_file",
            params: { relativePath: "/etc/passwd" }
          }
        }
      });
      assert.equal(denied.response.status, 200);

      const call = readRecentToolCalls(config, { publicToolName: "repo_toolbox" }).calls.find((entry) => entry.events.some((event) => event.jsonRpcId === "absolute-path-denied"));
      assert.ok(call);
      assert.equal(call.classification, "APP_POLICY_DENIED");
      const serialized = JSON.stringify(call);
      assert.doesNotMatch(serialized, /\/etc\/passwd/u);
      assert.match(serialized, /<REDACTED_PATH>/u);
    } finally {
      await handle.close();
    }
  });

  it("classifies missing files.read HTTP scope denial as APP_POLICY_DENIED without dispatch stages", async () => {
    const config = testConfig({ writeMode: "off" });
    const handle = await runHttpTransport(createScopedMcpServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const accessToken = await issueTestAccessToken(handle.url, "files.write");
      const denied = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: "missing-read-scope",
          method: "tools/call",
          params: {
            name: "repo_toolbox",
            arguments: {
              action: "read_file",
              params: { relativePath: "README.md" }
            }
          }
        },
        { authorization: `Bearer ${accessToken}` }
      );
      assert.equal(denied.response.status, 403);

      const call = readRecentToolCalls(config, { publicToolName: "repo_toolbox" }).calls[0];
      assert.equal(call.classification, "APP_POLICY_DENIED");
      assert.deepEqual(new Set(call.stages), new Set(["http_received", "http_response_completed"]));
      assert.ok(call.events.some((event) => event.errorCode === "OAUTH_SCOPE_DENIED" && event.result === "deny"));
      assert.equal(call.stages.includes("dispatch_started"), false);
      assert.equal(call.stages.includes("toolbox_entered"), false);
      assert.equal(call.stages.includes("tool_result_returned"), false);
    } finally {
      await handle.close();
    }
  });

  it("classifies missing files.write HTTP scope denial for workspace_write_attached_image", async () => {
    const config = testConfig({ writeMode: "docs" });
    const handle = await runHttpTransport(createScopedMcpServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const accessToken = await issueTestAccessToken(handle.url, "files.read");
      const denied = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: "missing-write-scope-image",
          method: "tools/call",
          params: {
            name: "workspace_write_attached_image",
            arguments: {
              workspaceId: "default",
              relativePath: "images/out.png",
              image: {
                download_url: "https://example.com/file.png",
                file_id: "file-test"
              }
            }
          }
        },
        { authorization: `Bearer ${accessToken}` }
      );
      assert.equal(denied.response.status, 403);

      const call = readRecentToolCalls(config, { publicToolName: "workspace_write_attached_image" }).calls[0];
      assert.equal(call.classification, "APP_POLICY_DENIED");
      assert.deepEqual(new Set(call.stages), new Set(["http_received", "http_response_completed"]));
      assert.ok(call.events.some((event) => event.errorCode === "OAUTH_SCOPE_DENIED"));
    } finally {
      await handle.close();
    }
  });

  it("denies repo, git, and integration toolbox write actions before dispatch with files.read only", async () => {
    const config = testConfig({ writeMode: "elevated" });
    const handle = await runHttpTransport(createScopedMcpServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const accessToken = await issueTestAccessToken(handle.url, "files.read");
      const cases = [
        {
          id: "repo-write-scope",
          name: "repo_toolbox",
          arguments: {
            action: "write_markdown_artifact",
            params: { relativePath: "new.md", content: "# New\n" }
          }
        },
        {
          id: "git-write-scope",
          name: "git_toolbox",
          arguments: {
            action: "stage_paths",
            params: { paths: ["README.md"] }
          }
        },
        {
          id: "integration-write-scope",
          name: "integration_toolbox",
          arguments: {
            action: "prepare_external_handoff",
            params: { serviceId: "github", targetFile: "docs/handoffs/GITHUB_HANDOFF.md" }
          }
        }
      ];

      for (const testCase of cases) {
        const denied = await postMcp(
          handle.url,
          {
            jsonrpc: "2.0",
            id: testCase.id,
            method: "tools/call",
            params: {
              name: testCase.name,
              arguments: testCase.arguments
            }
          },
          { authorization: `Bearer ${accessToken}` }
        );
        assert.equal(denied.response.status, 403);

        const call = readRecentToolCalls(config, { publicToolName: testCase.name }).calls.find((entry) => entry.events.some((event) => event.jsonRpcId === testCase.id));
        assert.ok(call);
        assert.equal(call.classification, "APP_POLICY_DENIED");
        assert.deepEqual(new Set(call.stages), new Set(["http_received", "http_response_completed"]));
        assert.ok(call.events.some((event) => event.errorCode === "OAUTH_SCOPE_DENIED" && /files\.write/u.test(String(event.errorMessage))));
      }
    } finally {
      await handle.close();
    }
  });

  it("records truthful mixed-batch evidence for an authorized read sibling and denied write sibling", async () => {
    const config = testConfig({ writeMode: "docs" });
    const handle = await runHttpTransport(createScopedMcpServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const accessToken = await issueTestAccessToken(handle.url, "files.read");
      const since = new Date(Date.now() - 1_000).toISOString();
      const denied = await postMcp(
        handle.url,
        [
          {
            jsonrpc: "2.0",
            id: "batch-read-authorized",
            method: "tools/call",
            params: {
              name: "repo_toolbox",
              arguments: {
                action: "read_file",
                params: { relativePath: "README.md" }
              }
            }
          },
          {
            jsonrpc: "2.0",
            id: "batch-write-denied",
            method: "tools/call",
            params: {
              name: "repo_toolbox",
              arguments: {
                action: "write_markdown_artifact",
                params: { relativePath: "one.md", content: "# One\n" }
              }
            }
          }
        ],
        { authorization: `Bearer ${accessToken}` }
      );
      assert.equal(denied.response.status, 403);

      const calls = readRecentToolCalls(config, { since, limit: 50 }).calls.filter((call) => call.publicTool === "repo_toolbox");
      assert.equal(calls.length, 2);
      assert.equal(new Set(calls.map((call) => call.correlationId)).size, 2);
      const readCall = calls.find((call) => call.events.some((event) => event.jsonRpcId === "batch-read-authorized"));
      const writeCall = calls.find((call) => call.events.some((event) => event.jsonRpcId === "batch-write-denied"));
      assert.ok(readCall);
      assert.ok(writeCall);
      assert.equal(readCall.classification, "RECEIVED_NOT_DISPATCHED");
      assert.equal(writeCall.classification, "APP_POLICY_DENIED");
      assert.equal(readCall.events.some((event) => event.errorCode === "OAUTH_SCOPE_DENIED" || /files\.write/u.test(String(event.errorMessage))), false);
      assert.ok(writeCall.events.some((event) => event.errorCode === "OAUTH_SCOPE_DENIED" && /repo_toolbox\.write_markdown_artifact/u.test(String(event.errorMessage))));
      assert.ok(calls.every((call) => !call.stages.includes("dispatch_started")));
    } finally {
      await handle.close();
    }
  });

  it("keeps call-specific scope messages for two separately denied calls", async () => {
    const config = testConfig({ writeMode: "docs" });
    const handle = await runHttpTransport(createScopedMcpServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const accessToken = await issueTestAccessToken(handle.url, "files.read");
      const since = new Date(Date.now() - 1_000).toISOString();
      const denied = await postMcp(
        handle.url,
        [
          {
            jsonrpc: "2.0",
            id: "repo-write-denied-message",
            method: "tools/call",
            params: {
              name: "repo_toolbox",
              arguments: {
                action: "write_markdown_artifact",
                params: { relativePath: "one.md", content: "# One\n" }
              }
            }
          },
          {
            jsonrpc: "2.0",
            id: "image-write-denied-message",
            method: "tools/call",
            params: {
              name: "workspace_write_attached_image",
              arguments: {
                workspaceId: "default",
                relativePath: "images/one.png",
                image: { download_url: "https://example.com/one.png", file_id: "file-one" }
              }
            }
          }
        ],
        { authorization: `Bearer ${accessToken}` }
      );
      assert.equal(denied.response.status, 403);

      const calls = readRecentToolCalls(config, { since, limit: 50 }).calls;
      const repoCall = calls.find((call) => call.events.some((event) => event.jsonRpcId === "repo-write-denied-message"));
      const imageCall = calls.find((call) => call.events.some((event) => event.jsonRpcId === "image-write-denied-message"));
      assert.ok(repoCall);
      assert.ok(imageCall);
      const repoMessage = String(repoCall.events.find((event) => event.errorCode === "OAUTH_SCOPE_DENIED")?.errorMessage);
      const imageMessage = String(imageCall.events.find((event) => event.errorCode === "OAUTH_SCOPE_DENIED")?.errorMessage);
      assert.match(repoMessage, /repo_toolbox\.write_markdown_artifact/u);
      assert.match(imageMessage, /workspace_write_attached_image/u);
      assert.notEqual(repoMessage, imageMessage);
    } finally {
      await handle.close();
    }
  });

  it("rejects duplicate string request IDs before dispatch with per-call invalid-input evidence", async () => {
    const config = testConfig({ writeMode: "off" });
    const handle = await runHttpTransport(createScopedMcpServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: true
    });

    try {
      const since = new Date(Date.now() - 1_000).toISOString();
      const result = await postMcp(handle.url, [
        {
          jsonrpc: "2.0",
          id: "duplicate-string-id",
          method: "tools/call",
          params: { name: "browser_toolbox", arguments: { action: "get_browser_capabilities" } }
        },
        {
          jsonrpc: "2.0",
          id: "duplicate-string-id",
          method: "tools/call",
          params: { name: "knowledge_toolbox", arguments: { action: "list_supported_sources" } }
        }
      ]);
      assert.equal(result.response.status, 400);

      const calls = readRecentToolCalls(config, { since, limit: 50 }).calls.filter((call) => call.events.some((event) => event.jsonRpcId === "duplicate-string-id"));
      assert.equal(calls.length, 2);
      assert.ok(calls.every((call) => call.classification === "APP_POLICY_DENIED"));
      assert.ok(calls.every((call) => call.stages.includes("http_received")));
      assert.ok(calls.every((call) => call.stages.includes("http_response_completed")));
      assert.ok(calls.every((call) => call.events.some((event) => event.errorCode === "INVALID_INPUT" && event.errorMessage === "Duplicate JSON-RPC request ID in batch.")));
      assert.ok(calls.every((call) => !call.stages.includes("dispatch_started") && !call.stages.includes("toolbox_entered") && !call.stages.includes("tool_result_returned")));
    } finally {
      await handle.close();
    }
  });

  it("rejects duplicate numeric request IDs before dispatch", async () => {
    const config = testConfig({ writeMode: "off" });
    const handle = await runHttpTransport(createScopedMcpServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: true
    });

    try {
      const since = new Date(Date.now() - 1_000).toISOString();
      const result = await postMcp(handle.url, [
        {
          jsonrpc: "2.0",
          id: 77,
          method: "tools/call",
          params: { name: "browser_toolbox", arguments: { action: "get_browser_capabilities" } }
        },
        {
          jsonrpc: "2.0",
          id: 77,
          method: "tools/call",
          params: { name: "knowledge_toolbox", arguments: { action: "list_supported_sources" } }
        }
      ]);
      assert.equal(result.response.status, 400);

      const calls = readRecentToolCalls(config, { since, limit: 50 }).calls.filter((call) => call.events.some((event) => event.jsonRpcId === 77));
      assert.equal(calls.length, 2);
      assert.ok(calls.every((call) => call.classification === "APP_POLICY_DENIED"));
      assert.ok(calls.every((call) => call.events.some((event) => event.errorCode === "INVALID_INPUT" && event.errorMessage === "Duplicate JSON-RPC request ID in batch.")));
      assert.ok(calls.every((call) => !call.stages.includes("dispatch_started") && !call.stages.includes("toolbox_entered") && !call.stages.includes("tool_result_returned")));
    } finally {
      await handle.close();
    }
  });

  it("keeps a unique authorized sibling receipt-only when duplicate IDs reject a batch", async () => {
    const config = testConfig({ writeMode: "off" });
    const handle = await runHttpTransport(createScopedMcpServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: true
    });

    try {
      const since = new Date(Date.now() - 1_000).toISOString();
      const result = await postMcp(handle.url, [
        {
          jsonrpc: "2.0",
          id: "duplicate-with-sibling",
          method: "tools/call",
          params: { name: "browser_toolbox", arguments: { action: "get_browser_capabilities" } }
        },
        {
          jsonrpc: "2.0",
          id: "duplicate-with-sibling",
          method: "tools/call",
          params: { name: "knowledge_toolbox", arguments: { action: "list_supported_sources" } }
        },
        {
          jsonrpc: "2.0",
          id: "unique-authorized-sibling",
          method: "tools/call",
          params: { name: "repo_toolbox", arguments: { action: "status" } }
        }
      ]);
      assert.equal(result.response.status, 400);

      const calls = readRecentToolCalls(config, { since, limit: 50 }).calls;
      const duplicateCalls = calls.filter((call) => call.events.some((event) => event.jsonRpcId === "duplicate-with-sibling"));
      const uniqueCall = calls.find((call) => call.events.some((event) => event.jsonRpcId === "unique-authorized-sibling"));
      assert.equal(duplicateCalls.length, 2);
      assert.ok(uniqueCall);
      assert.ok(duplicateCalls.every((call) => call.classification === "APP_POLICY_DENIED"));
      assert.equal(uniqueCall.classification, "RECEIVED_NOT_DISPATCHED");
      assert.equal(uniqueCall.events.some((event) => event.errorCode === "INVALID_INPUT" || /Duplicate JSON-RPC request ID/u.test(String(event.errorMessage))), false);
      assert.ok(calls.every((call) => !call.stages.includes("dispatch_started") && !call.stages.includes("toolbox_entered") && !call.stages.includes("tool_result_returned")));
    } finally {
      await handle.close();
    }
  });

  it("preserves separate scope-denial evidence for a nonduplicate sibling in a duplicate-ID batch", async () => {
    const config = testConfig({ writeMode: "docs" });
    const handle = await runHttpTransport(createScopedMcpServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const accessToken = await issueTestAccessToken(handle.url, "files.read");
      const since = new Date(Date.now() - 1_000).toISOString();
      const result = await postMcp(
        handle.url,
        [
          {
            jsonrpc: "2.0",
            id: "duplicate-plus-denied",
            method: "tools/call",
            params: { name: "browser_toolbox", arguments: { action: "get_browser_capabilities" } }
          },
          {
            jsonrpc: "2.0",
            id: "duplicate-plus-denied",
            method: "tools/call",
            params: { name: "knowledge_toolbox", arguments: { action: "list_supported_sources" } }
          },
          {
            jsonrpc: "2.0",
            id: "scope-denied-sibling",
            method: "tools/call",
            params: {
              name: "repo_toolbox",
              arguments: { action: "write_markdown_artifact", params: { relativePath: "new.md", content: "# New\n" } }
            }
          }
        ],
        { authorization: `Bearer ${accessToken}` }
      );
      assert.equal(result.response.status, 400);

      const calls = readRecentToolCalls(config, { since, limit: 50 }).calls;
      const duplicateCalls = calls.filter((call) => call.events.some((event) => event.jsonRpcId === "duplicate-plus-denied"));
      const scopeCall = calls.find((call) => call.events.some((event) => event.jsonRpcId === "scope-denied-sibling"));
      assert.equal(duplicateCalls.length, 2);
      assert.ok(scopeCall);
      assert.ok(duplicateCalls.every((call) => call.events.some((event) => event.errorCode === "INVALID_INPUT" && event.errorMessage === "Duplicate JSON-RPC request ID in batch.")));
      assert.ok(scopeCall.events.some((event) => event.errorCode === "OAUTH_SCOPE_DENIED" && /repo_toolbox\.write_markdown_artifact/u.test(String(event.errorMessage))));
      assert.equal(scopeCall.events.some((event) => event.errorCode === "INVALID_INPUT" || /Duplicate JSON-RPC request ID/u.test(String(event.errorMessage))), false);
      assert.ok(calls.every((call) => !call.stages.includes("dispatch_started") && !call.stages.includes("toolbox_entered") && !call.stages.includes("tool_result_returned")));
    } finally {
      await handle.close();
    }
  });

  it("redacts malicious duplicate string IDs from trace and discovery persistence", async () => {
    const config = testConfig({ writeMode: "off" });
    const handle = await runHttpTransport(createScopedMcpServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: true
    });

    try {
      const maliciousId = "dup https://evil.example/mcp?access_token=secret C:\\Private\\file.md /etc/shadow prompt=PRIVATE";
      const result = await postMcp(handle.url, [
        { jsonrpc: "2.0", id: maliciousId, method: "tools/call", params: { name: "browser_toolbox", arguments: { action: "get_browser_capabilities" } } },
        { jsonrpc: "2.0", id: maliciousId, method: "tools/call", params: { name: "knowledge_toolbox", arguments: { action: "list_supported_sources" } } },
        { jsonrpc: "2.0", id: "discovery-sibling", method: "tools/list" }
      ]);
      assert.equal(result.response.status, 400);

      const serializedTrace = JSON.stringify(readRecentToolCalls(config, { limit: 50 }).calls);
      const serializedDiscovery = JSON.stringify(readLastMcpDiscoveryTrace(config));
      const auditLog = fs.readFileSync(config.auditLogPath, "utf8");
      for (const serialized of [serializedTrace, serializedDiscovery, auditLog, JSON.stringify(result.messages)]) {
        assert.doesNotMatch(serialized, /evil\.example|access_token=secret|C:\\Private|\/etc\/shadow|PRIVATE/u);
      }
      assert.match(serializedTrace, /Duplicate JSON-RPC request ID in batch/u);
    } finally {
      await handle.close();
    }
  });

  it("keeps correct JSON-RPC IDs for two identical valid batch calls", async () => {
    const config = testConfig({ writeMode: "off" });
    const handle = await runHttpTransport(createScopedMcpServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const sessionHeaders = await initializeOAuthMcpSession(handle.url, "files.read");
      const since = new Date(Date.now() - 1_000).toISOString();
      const request = (id: string) => ({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name: "browser_toolbox",
          arguments: {
            action: "get_browser_capabilities"
          }
        }
      });
      const batch = await postMcp(handle.url, [request("duplicate-two-a"), request("duplicate-two-b")], sessionHeaders);
      assert.equal(batch.response.status, 200);
      firstResult(batch.messages, "duplicate-two-a");
      firstResult(batch.messages, "duplicate-two-b");

      const calls = readRecentToolCalls(config, { since, limit: 50 }).calls.filter((call) => call.publicTool === "browser_toolbox");
      assert.equal(calls.length, 2);
      assert.equal(new Set(calls.map((call) => call.correlationId)).size, 2);
      for (const id of ["duplicate-two-a", "duplicate-two-b"]) {
        const call = calls.find((entry) => entry.events.some((event) => event.jsonRpcId === id));
        assert.ok(call, `Expected call for ${id}`);
        assert.ok(call.events.every((event) => event.jsonRpcId === id));
        assert.equal(call.classification, "RESPONSE_COMPLETED");
      }
    } finally {
      await handle.close();
    }
  });

  it("keeps correct JSON-RPC IDs for three identical valid batch calls", async () => {
    const config = testConfig({ writeMode: "off" });
    const handle = await runHttpTransport(createScopedMcpServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const sessionHeaders = await initializeOAuthMcpSession(handle.url, "files.read");
      const since = new Date(Date.now() - 1_000).toISOString();
      const batch = ["triplicate-a", "triplicate-b", "triplicate-c"].map((id) => ({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name: "knowledge_toolbox",
          arguments: {
            action: "list_supported_sources"
          }
        }
      }));
      const result = await postMcp(handle.url, batch, sessionHeaders);
      assert.equal(result.response.status, 200);

      const calls = readRecentToolCalls(config, { since, limit: 50 }).calls.filter((call) => call.publicTool === "knowledge_toolbox");
      assert.equal(calls.length, 3);
      assert.equal(new Set(calls.map((call) => call.correlationId)).size, 3);
      for (const id of ["triplicate-a", "triplicate-b", "triplicate-c"]) {
        const call = calls.find((entry) => entry.events.some((event) => event.jsonRpcId === id));
        assert.ok(call, `Expected call for ${id}`);
        assert.ok(call.events.every((event) => event.jsonRpcId === id));
        assert.equal(call.classification, "RESPONSE_COMPLETED");
      }
    } finally {
      await handle.close();
    }
  });

  it("binds two identical calls to the correlation matching the SDK request and response IDs", async () => {
    const config = testConfig({ writeMode: "off" });
    const handle = await runHttpTransport(createTraceEchoServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: true
    });

    try {
      const since = new Date(Date.now() - 1_000).toISOString();
      const request = (id: string) => ({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name: "trace_echo",
          arguments: { action: "same", params: { relativePath: "same.md" } }
        }
      });
      const batch = await postMcp(handle.url, [request("cross-two-a"), request("cross-two-b")]);
      assert.equal(batch.response.status, 200);

      const calls = readRecentToolCalls(config, { since, limit: 50 }).calls.filter((call) => call.publicTool === "trace_echo");
      for (const id of ["cross-two-a", "cross-two-b"]) {
        const payload = textResultPayload(batch.messages, id);
        assert.equal(payload.sdkRequestId, id);
        assert.equal(payload.selectedJsonRpcId, id);
        const call = calls.find((entry) => entry.correlationId === payload.selectedCorrelationId);
        assert.ok(call, `Expected persisted trace for ${id}`);
        assert.ok(call.events.every((event) => event.jsonRpcId === id));
        assert.equal(call.classification, "RESPONSE_COMPLETED");
      }
    } finally {
      await handle.close();
    }
  });

  it("binds three identical calls correctly even when completion order is varied", async () => {
    const config = testConfig({ writeMode: "off" });
    const releases = new Map<string, ReturnType<typeof deferred>>();
    const handle = await runHttpTransport(
      createTraceEchoServerFactory(config, {
        waitForRelease: async (requestId) => {
          const gate = deferred();
          releases.set(String(requestId), gate);
          await gate.promise;
        }
      }),
      config,
      {
        host: "127.0.0.1",
        port: 0,
        version: "0.1.0-test",
        allowNonlocalHttp: false,
        allowUnauthLocalHttp: true
      }
    );

    try {
      const since = new Date(Date.now() - 1_000).toISOString();
      const ids = ["cross-three-a", "cross-three-b", "cross-three-c"];
      const pending = postMcp(handle.url, ids.map((id) => ({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name: "trace_echo",
          arguments: { action: "same", params: { relativePath: "same.md" } }
        }
      })));

      while (releases.size < ids.length) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      releases.get("cross-three-c")?.resolve();
      releases.get("cross-three-b")?.resolve();
      releases.get("cross-three-a")?.resolve();

      const batch = await pending;
      assert.equal(batch.response.status, 200);
      const calls = readRecentToolCalls(config, { since, limit: 50 }).calls.filter((call) => call.publicTool === "trace_echo");
      assert.equal(calls.length, 3);
      assert.equal(new Set(calls.map((call) => call.correlationId)).size, 3);
      for (const id of ids) {
        const payload = textResultPayload(batch.messages, id);
        assert.equal(payload.sdkRequestId, id);
        assert.equal(payload.selectedJsonRpcId, id);
        const call = calls.find((entry) => entry.correlationId === payload.selectedCorrelationId);
        assert.ok(call, `Expected persisted trace for ${id}`);
        assert.ok(call.events.every((event) => event.jsonRpcId === id));
        assert.equal(call.classification, "RESPONSE_COMPLETED");
      }
    } finally {
      await handle.close();
    }
  });

  it("does not let an unknown SDK request ID steal an existing context", () => {
    assert.throws(
      () =>
        runWithToolCallTraceGroupContext(
          {
            requestGroupId: "group",
            toolCalls: [
              {
                correlationId: "known-correlation",
                startedAt: Date.now(),
                jsonRpcId: "known-request-id",
                requestIdKey: toolCallTraceRequestIdKey("known-request-id")
              }
            ]
          },
          () => runWithToolCallTraceRequestId("unknown-request-id", () => "unreachable")
        ),
      /HTTP tool-call trace identity mismatch/u
    );
  });

  it("isolates an HTTP SDK request-ID mismatch without marking siblings as transport errors", async () => {
    const config = testConfig({ writeMode: "off" });
    const handle = await runHttpTransport(createTraceIdentityMismatchServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: true
    });

    try {
      const since = new Date(Date.now() - 1_000).toISOString();
      const result = await postMcp(handle.url, [
        {
          jsonrpc: "2.0",
          id: "mismatch-request",
          method: "tools/call",
          params: { name: "trace_echo", arguments: { action: "mismatch" } }
        },
        {
          jsonrpc: "2.0",
          id: "mismatch-sibling",
          method: "tools/call",
          params: { name: "trace_echo", arguments: { action: "mismatch" } }
        }
      ]);
      assert.equal(result.response.status, 200);
      assert.ok(result.messages.some((message) => "error" in message));

      const calls = readRecentToolCalls(config, { since, limit: 50 }).calls.filter((call) => call.publicTool === "trace_echo");
      assert.equal(calls.length, 2);
      assert.ok(calls.every((call) => call.classification === "RECEIVED_NOT_DISPATCHED"));
      assert.ok(calls.every((call) => call.stages.includes("http_received")));
      assert.ok(calls.every((call) => call.stages.includes("http_response_completed")));
      assert.ok(calls.every((call) => !call.stages.includes("transport_error")));
      assert.ok(calls.every((call) => !call.stages.includes("dispatch_started") && !call.stages.includes("tool_result_returned")));

      const serializedTrace = JSON.stringify(calls);
      const auditLog = fs.readFileSync(config.auditLogPath, "utf8");
      assert.match(auditLog, /http_mcp_trace_identity/u);
      for (const serialized of [serializedTrace, auditLog, JSON.stringify(result.messages)]) {
        assert.doesNotMatch(serialized, /evil\.example|access_token=secret|C:\\Private|\/etc\/secret|PRIVATE/u);
        assert.doesNotMatch(serialized, /unknown https:\/\/evil/u);
        assert.doesNotMatch(serialized, /ToolCallTraceIdentityMismatchError|at .*toolCallTrace/u);
      }
    } finally {
      await handle.close();
    }
  });

  it("observes an actual in-flight HTTP call as DISPATCHED_NOT_EXECUTED", async () => {
    const config = testConfig({ writeMode: "off" });
    const release = deferred();
    let dispatchedCorrelationId: string | undefined;
    const handle = await runHttpTransport(
      createTraceEchoServerFactory(config, {
        onDispatch: (context) => {
          dispatchedCorrelationId = context?.correlationId;
        },
        waitForRelease: async () => release.promise
      }),
      config,
      {
        host: "127.0.0.1",
        port: 0,
        version: "0.1.0-test",
        allowNonlocalHttp: false,
        allowUnauthLocalHttp: true
      }
    );

    try {
      const pending = postMcp(handle.url, {
        jsonrpc: "2.0",
        id: "in-flight-dispatched",
        method: "tools/call",
        params: {
          name: "trace_echo",
          arguments: { action: "pause" }
        }
      });

      while (!dispatchedCorrelationId) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const call = readRecentToolCalls(config, { correlationId: dispatchedCorrelationId }).calls[0];
      assert.equal(call.classification, "DISPATCHED_NOT_EXECUTED");
      assert.deepEqual(call.stages, ["http_received", "dispatch_started"]);
      assert.equal(call.events[0].jsonRpcId, "in-flight-dispatched");

      release.resolve();
      const completed = await pending;
      assert.equal(completed.response.status, 200);
    } finally {
      release.resolve();
      await handle.close();
    }
  });

  it("assigns distinct correlation IDs to concurrent tool calls", async () => {
    const config = testConfig({ writeMode: "off" });
    const handle = await runHttpTransport(createScopedMcpServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const sessionHeaders = await initializeOAuthMcpSession(handle.url, "files.read");
      const since = new Date(Date.now() - 1_000).toISOString();
      const [first, second] = await Promise.all([
        postMcp(
          handle.url,
          {
            jsonrpc: "2.0",
            id: 21,
            method: "tools/call",
            params: {
              name: "browser_toolbox",
              arguments: {
                action: "get_browser_capabilities"
              }
            }
          },
          sessionHeaders
        ),
        postMcp(
          handle.url,
          {
            jsonrpc: "2.0",
            id: 22,
            method: "tools/call",
            params: {
              name: "knowledge_toolbox",
              arguments: {
                action: "list_supported_sources"
              }
            }
          },
          sessionHeaders
        )
      ]);

      assert.equal(first.response.status, 200);
      assert.equal(second.response.status, 200);
      const calls = readRecentToolCalls(config, { since }).calls;
      const concurrentCalls = calls.filter((call) => call.publicTool === "browser_toolbox" || call.publicTool === "knowledge_toolbox");
      assert.equal(concurrentCalls.length, 2);
      assert.equal(new Set(concurrentCalls.map((call) => call.correlationId)).size, 2);
      assert.ok(concurrentCalls.every((call) => call.classification === "RESPONSE_COMPLETED"));
    } finally {
      await handle.close();
    }
  });

  it("classifies validation denials and enforces diagnostic filters", async () => {
    const config = testConfig({ writeMode: "off" });
    const handle = await runHttpTransport(createScopedMcpServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const sessionHeaders = await initializeOAuthMcpSession(handle.url, "files.read");
      const since = new Date(Date.now() - 1_000).toISOString();
      const invalid = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "repo_toolbox",
            arguments: {
              action: "does_not_exist",
              params: {}
            }
          }
        },
        sessionHeaders
      );
      assert.equal(invalid.response.status, 200);
      assert.match(JSON.stringify(invalid.messages), /Unsupported toolbox action/u);

      const invalidCall = readRecentToolCalls(config, { publicToolName: "repo_toolbox", since }).calls[0];
      assert.equal(invalidCall.classification, "APP_POLICY_DENIED");

      const diagnostic = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "diagnostics_toolbox",
            arguments: {
              action: "recent_tool_calls",
              params: {
                correlationId: invalidCall.correlationId,
                publicToolName: "repo_toolbox",
                since,
                limit: 50
              }
            }
          }
        },
        sessionHeaders
      );
      const diagnosticResult = firstResult(diagnostic.messages, 3);
      const diagnosticText = JSON.parse((diagnosticResult.content as Array<{ text: string }>)[0].text) as { result: { calls: Array<{ classification: string; correlationId: string }> } };
      assert.deepEqual(diagnosticText.result.calls.map((call) => call.correlationId), [invalidCall.correlationId]);
      assert.equal(diagnosticText.result.calls[0].classification, "APP_POLICY_DENIED");

      const invalidQuery = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: {
            name: "diagnostics_toolbox",
            arguments: {
              action: "recent_tool_calls",
              params: {
                publicTool: "repo_toolbox"
              }
            }
          }
        },
        sessionHeaders
      );
      assert.match(JSON.stringify(invalidQuery.messages), /Toolbox action parameters failed validation/u);

      const missing = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: {
            name: "diagnostics_toolbox",
            arguments: {
              action: "recent_tool_calls",
              params: {
                correlationId: "missing-correlation-id"
              }
            }
          }
        },
        sessionHeaders
      );
      const missingResult = firstResult(missing.messages, 5);
      const missingText = JSON.parse((missingResult.content as Array<{ text: string }>)[0].text) as { result: { calls: Array<{ classification: string; explanation: string }> } };
      assert.equal(missingText.result.calls[0].classification, "NO_SERVER_RECEIPT_EVIDENCE");
      assert.match(missingText.result.calls[0].explanation, /no matching server receipt evidence/i);
      assert.doesNotMatch(missingText.result.calls[0].explanation, /blocked by ChatGPT|OpenAI blocked/iu);

      const aboveLimit = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 6,
          method: "tools/call",
          params: {
            name: "diagnostics_toolbox",
            arguments: {
              action: "recent_tool_calls",
              params: {
                limit: 51
              }
            }
          }
        },
        sessionHeaders
      );
      assert.match(JSON.stringify(aboveLimit.messages), /Toolbox action parameters failed validation/u);

      const invalidSince = await postMcp(
        handle.url,
        {
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: {
            name: "diagnostics_toolbox",
            arguments: {
              action: "recent_tool_calls",
              params: {
                since: "July 26 2026"
              }
            }
          }
        },
        sessionHeaders
      );
      assert.match(JSON.stringify(invalidSince.messages), /strict ISO-8601 timestamp/u);
    } finally {
      await handle.close();
    }
  });

  it("classifies transport exceptions with sanitized trace output", async () => {
    const config = testConfig({ writeMode: "off" });
    const handle = await runHttpTransport(
      () => {
        throw new Error(
          [
            `forced transport failure access_token=secret-value ${path.join(tempRoot, "private")}`,
            "D:\\ProgramData\\Private\\file.md",
            "\\\\server\\share\\private\\file.md",
            "/etc/private/config"
          ].join(" ")
        );
      },
      config,
      {
        host: "127.0.0.1",
        port: 0,
        version: "0.1.0-test",
        allowNonlocalHttp: false,
        allowUnauthLocalHttp: true
      }
    );

    try {
      const response = await postMcp(handle.url, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "repo_toolbox",
          arguments: {
            action: "status"
          }
        }
      });
      assert.equal(response.response.status, 500);
      const call = readRecentToolCalls(config, { publicToolName: "repo_toolbox" }).calls[0];
      assert.equal(call.classification, "TRANSPORT_ERROR");
      const serialized = JSON.stringify(call);
      assert.doesNotMatch(serialized, /secret-value/u);
      assert.doesNotMatch(serialized, new RegExp(tempRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
      assert.doesNotMatch(serialized, /ProgramData|server\\share|\/etc\/private/u);
      const auditLog = fs.readFileSync(config.auditLogPath, "utf8");
      assert.doesNotMatch(auditLog, /secret-value|ProgramData|server\\share|\/etc\/private/u);
    } finally {
      await handle.close();
    }
  });

  it("does not fail a successful tool call when trace writing fails", async () => {
    const logParentFile = path.join(tempRoot, "log-parent-is-file");
    fs.writeFileSync(logParentFile, "not a directory", "utf8");
    const config = testConfig({ writeMode: "off", auditLogPath: path.join(logParentFile, "audit.log") });
    const handle = await runHttpTransport(createScopedMcpServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: true
    });

    try {
      const result = await postMcp(handle.url, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "browser_toolbox",
          arguments: {
            action: "get_browser_capabilities"
          }
        }
      });
      assert.equal(result.response.status, 200);
      firstResult(result.messages, 2);
    } finally {
      await handle.close();
    }
  });

  it("does not fail a successful HTTP tool call when post-append trace compaction fails", async () => {
    const config = testConfig({ writeMode: "off" });
    const { tracePath } = getToolCallTracePaths(config);
    fs.mkdirSync(path.dirname(tracePath), { recursive: true });
    for (let index = 0; index < 2_000; index += 1) {
      recordToolCallTrace(config, {
        correlationId: `prefill-${index}`,
        stage: "http_received"
      });
    }
    const handle = await runHttpTransport(createScopedMcpServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: true
    });

    const originalRenameSync = fs.renameSync;
    fs.renameSync = (() => {
      throw new Error("forced compaction replacement failure");
    }) as typeof fs.renameSync;
    try {
      const result = await postMcp(handle.url, {
        jsonrpc: "2.0",
        id: "compaction-failure-call",
        method: "tools/call",
        params: {
          name: "browser_toolbox",
          arguments: {
            action: "get_browser_capabilities"
          }
        }
      });
      assert.equal(result.response.status, 200);
      firstResult(result.messages, "compaction-failure-call");
    } finally {
      fs.renameSync = originalRenameSync;
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
      assert.deepEqual(toolNames, publicWriteScopedToolNames);

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
      assert.deepEqual(trace.tools.scopeFilteredTools, [
        {
          name: "workspace_write_attached_image",
          reason: "missing OAuth scope files.write"
        }
      ]);
    } finally {
      await handle.close();
    }
  });

  it("redacts malicious string IDs in both discovery and tool-call traces for mixed batches", async () => {
    const config = testConfig({ writeMode: "off" });
    const handle = await runHttpTransport(createScopedMcpServerFactory(config), config, {
      host: "127.0.0.1",
      port: 0,
      version: "0.1.0-test",
      allowNonlocalHttp: false,
      allowUnauthLocalHttp: false
    });

    try {
      const accessToken = await issueTestAccessToken(handle.url, "files.read");
      const maliciousId = "id /etc/private/config https://example.com/mcp?access_token=secret";
      const since = new Date(Date.now() - 1_000).toISOString();
      const mixed = await postMcp(
        handle.url,
        [
          { jsonrpc: "2.0", id: "discover-ok", method: "tools/list" },
          {
            jsonrpc: "2.0",
            id: maliciousId,
            method: "tools/call",
            params: {
              name: "browser_toolbox",
              arguments: { action: "get_browser_capabilities" }
            }
          }
        ],
        { authorization: `Bearer ${accessToken}` }
      );
      assert.equal(mixed.response.status, 200);

      const discoveryTrace = readLastMcpDiscoveryTrace(config);
      assert.ok(discoveryTrace);
      const toolCall = readRecentToolCalls(config, { since, publicToolName: "browser_toolbox" }).calls[0];
      const serialized = JSON.stringify({ discoveryTrace, toolCall });
      assert.doesNotMatch(serialized, /\/etc\/private|example\.com|access_token=secret/u);
      assert.match(serialized, /<REDACTED_PATH>|<REDACTED_URL>|<REDACTED_ENDPOINT>/u);
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
      assert.equal(write.response.status, 403);
      assert.match(JSON.stringify(write.messages), /files\.write/u);
      const call = readRecentToolCalls(config, { publicToolName: "repo_toolbox" }).calls.find((entry) => entry.events.some((event) => event.jsonRpcId === 2));
      assert.ok(call);
      assert.equal(call.classification, "APP_POLICY_DENIED");
      assert.equal(call.stages.includes("dispatch_started"), false);
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
      assert.deepEqual(parsedToolText.result.files.filter((entry) => !entry.startsWith("logs/")), ["alpha.md"]);
      assert.equal(parsedToolText.result.truncated, false);
    } finally {
      await handle.close();
    }
  });
});

