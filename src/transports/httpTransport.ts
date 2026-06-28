import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import { type Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { type AppConfig } from "../config.js";
import {
  createAuthorizationServerMetadata,
  createProtectedResourceMetadata,
  exchangeAuthorizationCode,
  findOAuthClient,
  getOAuthPublicBaseUrl,
  issueAuthorizationCode,
  normalizeOAuthScope,
  registerOAuthClient,
  refreshOAuthAccessToken,
  scopeIncludes,
  validateOAuthAccessToken,
  verifyOAuthAdminPassword,
  readOAuthAdminConfig,
  writeLastOAuthAuthorizeError
} from "../oauth.js";
import { writeAuditLog } from "../security/auditLog.js";
import { writeMcpDiscoveryTrace, type McpDiscoveryTrace, type McpDiscoveryTraceAuth, type McpDiscoveryTraceResponse } from "../server/discoveryTrace.js";
import { getToolExposureDiagnostics, isReadToolName, isWriteToolName } from "../server/registerTools.js";

export interface HttpTransportOptions {
  host: string;
  port: number;
  version: string;
  authToken?: string;
  allowNonlocalHttp: boolean;
  allowUnauthLocalHttp: boolean;
}

export interface HttpTransportHandle {
  server: http.Server;
  url: string;
  healthUrl: string;
  close: () => Promise<void>;
  forceClose: () => Promise<void>;
}

export interface HealthResponse {
  status: "ok";
  app: "ChampCity GPT MCP";
  transport: "http";
  version: string;
  allowedRootCount: number;
  writeToolsEnabled: boolean;
  writeMode: string;
  writeModeSource: string;
  docsWritesAllowed: boolean;
  patchWritesAllowed: boolean;
  elevatedOperationsAllowed: boolean;
  host: string;
  port: number;
}

const LOCAL_HTTP_HOSTS = new Set(["127.0.0.1", "localhost"]);

export function isLocalHttpHost(host: string): boolean {
  return LOCAL_HTTP_HOSTS.has(host.toLowerCase());
}

export function validateHttpBinding(
  options: Pick<HttpTransportOptions, "host" | "authToken" | "allowNonlocalHttp" | "allowUnauthLocalHttp">
): void {
  const localHost = isLocalHttpHost(options.host);
  if (!localHost && !options.allowNonlocalHttp) {
    throw new Error(
      `Refusing to bind HTTP MCP server to ${options.host}. Keep it on 127.0.0.1 or set CHAMPCITY_GPT_ALLOW_NONLOCAL_HTTP=true after a security review.`
    );
  }

  if (options.allowUnauthLocalHttp && !localHost) {
    throw new Error("Unauthenticated HTTP mode is only allowed on 127.0.0.1 or localhost.");
  }
}

export function createHealthResponse(config: AppConfig, options: Pick<HttpTransportOptions, "host" | "port" | "version">): HealthResponse {
  return {
    status: "ok",
    app: "ChampCity GPT MCP",
    transport: "http",
    version: options.version,
    allowedRootCount: config.allowedRoots.length,
    writeToolsEnabled: config.writeToolsEnabled,
    writeMode: config.writeMode,
    writeModeSource: config.writeModeSource,
    docsWritesAllowed: config.docsWritesAllowed,
    patchWritesAllowed: config.patchWritesAllowed,
    elevatedOperationsAllowed: config.elevatedOperationsAllowed,
    host: options.host,
    port: options.port
  };
}

function writeJson(res: ServerResponse, statusCode: number, data: unknown): void {
  const body = `${JSON.stringify(data, null, 2)}\n`;
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function writeHtml(res: ServerResponse, statusCode: number, html: string): void {
  res.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(html);
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, {
    location,
    "cache-control": "no-store"
  });
  res.end();
}

function parseBearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (typeof header !== "string") {
    return undefined;
  }

  const match = /^Bearer\s+(.+)$/iu.exec(header.trim());
  return match ? match[1] : undefined;
}

export interface AuthContext {
  kind: "oauth" | "legacy" | "local-unauth";
  scope: string;
  clientId?: string;
  subject: string;
}

function authenticateMcpRequest(req: IncomingMessage, config: AppConfig, options: HttpTransportOptions): AuthContext | undefined {
  if (!options.authToken && options.allowUnauthLocalHttp && isLocalHttpHost(options.host)) {
    return {
      kind: "local-unauth",
      scope: "files.read files.write",
      subject: "local-unauth"
    };
  }

  const bearerToken = parseBearerToken(req);
  if (!bearerToken) {
    return undefined;
  }

  if (options.authToken && bearerToken === options.authToken) {
    return {
      kind: "legacy",
      scope: "files.read files.write",
      subject: "legacy-bearer-auth"
    };
  }

  const oauthToken = validateOAuthAccessToken(config.repoRoot, bearerToken);
  if (!oauthToken) {
    return undefined;
  }

  return {
    kind: "oauth",
    scope: oauthToken.scope,
    clientId: oauthToken.client_id,
    subject: oauthToken.client_id
  };
}

function unauthorized(res: ServerResponse): void {
  const publicBaseUrl = getOAuthPublicBaseUrl();
  res.writeHead(401, {
    "content-type": "application/json; charset=utf-8",
    "www-authenticate": `Bearer resource_metadata="${publicBaseUrl}/.well-known/oauth-protected-resource"`
  });
  res.end(`${JSON.stringify({ error: "Unauthorized" })}\n`);
}

function forbidden(res: ServerResponse, message: string): void {
  writeJson(res, 403, {
    jsonrpc: "2.0",
    error: {
      code: -32001,
      message
    },
    id: null
  });
}

function methodAllowsMcpBody(method: string | undefined): boolean {
  return method === "POST";
}

async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function readRequestBody(req: IncomingMessage): Promise<unknown> {
  const rawBody = (await readRawBody(req)).trim();
  if (!rawBody) {
    return undefined;
  }

  const contentType = req.headers["content-type"];
  const normalizedContentType = Array.isArray(contentType) ? contentType[0] : contentType ?? "";
  if (normalizedContentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(rawBody).entries());
  }

  return JSON.parse(rawBody) as unknown;
}

function includesInitializeRequest(body: unknown): boolean {
  return Array.isArray(body) ? body.some(isInitializeRequest) : isInitializeRequest(body);
}

function jsonRpcErrorResponse(res: ServerResponse, statusCode: number, message: string): void {
  writeJson(res, statusCode, {
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message
    },
    id: null
  });
}

function jsonRpcId(body: unknown): unknown {
  return body && typeof body === "object" && !Array.isArray(body) && "id" in body ? (body as { id?: unknown }).id ?? null : null;
}

function jsonRpcIds(body: unknown): Array<string | number | null> {
  const requests = Array.isArray(body) ? body : [body];
  return requests.map((request) => {
    if (!request || typeof request !== "object" || !("id" in request)) {
      return null;
    }

    const id = (request as { id?: unknown }).id;
    return typeof id === "string" || typeof id === "number" ? id : null;
  });
}

function jsonRpcMethodNames(body: unknown): string[] {
  const requests = Array.isArray(body) ? body : [body];
  return requests
    .map((request) => request && typeof request === "object" ? (request as { method?: unknown }).method : undefined)
    .filter((method): method is string => typeof method === "string");
}

const DISCOVERY_METHODS = new Set(["initialize", "notifications/initialized", "tools/list", "resources/list", "prompts/list"]);

function isDiscoveryTraceBody(body: unknown): boolean {
  const methods = jsonRpcMethodNames(body);
  return methods.some((method) => DISCOVERY_METHODS.has(method));
}

function stringHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return value;
}

function normalizeMcpAcceptHeader(req: IncomingMessage): { originalAccept?: string; normalizedAccept?: string } {
  const originalAccept = stringHeader(req.headers.accept);
  const acceptParts = (originalAccept ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const normalizedParts = [...acceptParts];

  if (!acceptParts.some((entry) => entry.toLowerCase().includes("application/json"))) {
    normalizedParts.push("application/json");
  }

  if (!acceptParts.some((entry) => entry.toLowerCase().includes("text/event-stream"))) {
    normalizedParts.push("text/event-stream");
  }

  const normalizedAccept = normalizedParts.join(", ");
  req.headers.accept = normalizedAccept;
  const rawAcceptIndex = req.rawHeaders.findIndex((entry) => entry.toLowerCase() === "accept");
  if (rawAcceptIndex >= 0 && rawAcceptIndex + 1 < req.rawHeaders.length) {
    req.rawHeaders[rawAcceptIndex + 1] = normalizedAccept;
  } else {
    req.rawHeaders.push("Accept", normalizedAccept);
  }
  return {
    originalAccept,
    normalizedAccept
  };
}

function responseContentType(res: ServerResponse): string {
  const contentType = res.getHeader("content-type");
  const recordedContentType = Array.isArray(contentType) ? contentType.join(", ") : typeof contentType === "string" ? contentType : "";
  return recordedContentType || (res.statusCode === 200 ? "application/json" : "");
}

function responseKind(statusCode: number, contentType: string): McpDiscoveryTraceResponse["kind"] {
  if (statusCode === 202) {
    return "empty-accepted-response";
  }

  if (statusCode < 200 || statusCode >= 300) {
    return "wrong-http-status";
  }

  const normalizedContentType = contentType.toLowerCase();
  if (normalizedContentType.includes("application/json")) {
    return "json-rpc-response";
  }

  if (normalizedContentType.includes("text/event-stream")) {
    return "sse-event-stream-response";
  }

  return "wrong-content-type";
}

function discoveryAuth(auth: AuthContext | undefined): McpDiscoveryTraceAuth {
  if (!auth) {
    return {
      kind: "unauthenticated",
      subject: "unauthenticated",
      scope: "",
      scopes: []
    };
  }

  return {
    kind: auth.kind,
    subject: auth.subject,
    clientId: auth.clientId,
    scope: auth.scope,
    scopes: auth.scope.split(/\s+/u).filter(Boolean)
  };
}

function recordMcpDiscovery(
  config: AppConfig,
  req: IncomingMessage,
  requestPath: string,
  body: unknown,
  auth: AuthContext | undefined,
  response: McpDiscoveryTraceResponse,
  accept: { originalAccept?: string; normalizedAccept?: string },
  error?: string
): void {
  if (!isDiscoveryTraceBody(body)) {
    return;
  }

  if (auth?.kind === "local-unauth") {
    return;
  }

  const methods = jsonRpcMethodNames(body);
  const diagnostics = auth
    ? getToolExposureDiagnostics(config, { scope: auth.scope, id: jsonRpcId(body) as string | number | null })
    : getToolExposureDiagnostics(config, { scope: "", id: jsonRpcId(body) as string | number | null });
  const trace: Omit<McpDiscoveryTrace, "recentDiscoverySequence"> = {
    timestamp: new Date().toISOString(),
    processId: process.pid,
    request: {
      httpMethod: req.method ?? "UNKNOWN",
      path: requestPath,
      publicBaseUrl: getOAuthPublicBaseUrl(),
      host: stringHeader(req.headers.host),
      forwardedHost: stringHeader(req.headers["x-forwarded-host"]),
      forwardedProto: stringHeader(req.headers["x-forwarded-proto"]),
      cfRay: stringHeader(req.headers["cf-ray"]),
      userAgent: stringHeader(req.headers["user-agent"]),
      accept: accept.originalAccept,
      normalizedAccept: accept.normalizedAccept,
      contentType: stringHeader(req.headers["content-type"]),
      mcpSessionIdPresent: Boolean(stringHeader(req.headers["mcp-session-id"]))
    },
    jsonRpc: {
      isBatch: Array.isArray(body),
      methods,
      ids: jsonRpcIds(body),
      hasInitialize: methods.includes("initialize"),
      hasInitializedNotification: methods.includes("notifications/initialized"),
      hasToolsList: methods.includes("tools/list"),
      hasResourcesList: methods.includes("resources/list"),
      hasPromptsList: methods.includes("prompts/list")
    },
    auth: discoveryAuth(auth),
    tools: {
      countBeforeFiltering: diagnostics.internalRegisteredToolCount,
      countAfterMcpSchemaValidation: diagnostics.schemaValidToolCount,
      countAfterChatGptSchemaSanitization: diagnostics.chatGptCompatibleToolCount,
      countAfterScopeFiltering: diagnostics.schemaValidExposedToolCount,
      finalToolCountReturned: diagnostics.exposedToolNames.length,
      finalToolNamesReturned: diagnostics.exposedToolNames,
      invalidToolSchemas: diagnostics.invalidToolSchemas,
      invalidChatGptToolSchemas: diagnostics.invalidChatGptToolSchemas,
      scopeFilteredTools: diagnostics.scopeFilteredTools,
      sanitizedToolSchemas: diagnostics.sanitizedToolSchemas
    },
    response: {
      ...response,
      error: error ?? response.error
    }
  };

  try {
    writeMcpDiscoveryTrace(config, trace);
  } catch (traceError) {
    const details = errorDetails(traceError);
    console.warn(`Failed to write MCP discovery trace: ${details.message}`);
  }
}

function mcpScopeDenial(body: unknown, auth: AuthContext): string | undefined {
  const requests = Array.isArray(body) ? body : [body];
  for (const request of requests) {
    if (!request || typeof request !== "object") {
      continue;
    }

    const rpc = request as { method?: unknown; params?: { name?: unknown } };
    if (rpc.method === "tools/list" && !scopeIncludes(auth.scope, "files.read")) {
      return "OAuth scope files.read is required to list MCP tools.";
    }

    if (rpc.method !== "tools/call" || !rpc.params || typeof rpc.params.name !== "string") {
      continue;
    }

    const toolName = rpc.params.name;
    if (isWriteToolName(toolName) && !scopeIncludes(auth.scope, "files.write")) {
      return `OAuth scope files.write is required to call ${toolName}.`;
    }

    if (isReadToolName(toolName) && !scopeIncludes(auth.scope, "files.read")) {
      return `OAuth scope files.read is required to call ${toolName}.`;
    }
  }

  return undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const PKCE_S256_CHALLENGE_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/u;

function safeRedirectUriLocation(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "invalid-url";
  }
}

function requiredAuthorizeFieldsPresent(params: URLSearchParams) {
  return {
    response_type: Boolean(text(params.get("response_type"))),
    client_id: Boolean(text(params.get("client_id"))),
    redirect_uri: Boolean(text(params.get("redirect_uri"))),
    code_challenge: Boolean(text(params.get("code_challenge"))),
    code_challenge_method: Boolean(text(params.get("code_challenge_method")))
  };
}

function recordAuthorizeRejection(config: AppConfig, requestPath: string, params: URLSearchParams, error: string): void {
  const clientId = text(params.get("client_id"));
  const redirectUri = text(params.get("redirect_uri"));
  const codeChallengeMethod = text(params.get("code_challenge_method"));
  const diagnostic = {
    occurredAt: new Date().toISOString(),
    requestPath,
    error,
    requiredFieldsPresent: requiredAuthorizeFieldsPresent(params),
    codeChallengeMethod,
    clientIdPrefix: clientId ? clientId.slice(0, 8) : undefined,
    redirectUriLocation: safeRedirectUriLocation(redirectUri)
  };

  console.warn(`OAuth authorize rejected: ${JSON.stringify(diagnostic)}`);

  try {
    writeLastOAuthAuthorizeError(config.repoRoot, diagnostic);
  } catch (diagnosticError) {
    const details = errorDetails(diagnosticError);
    console.warn(`Failed to save OAuth authorize diagnostic: ${details.message}`);
  }
}

function validateAuthorizeParams(config: AppConfig, params: URLSearchParams): { ok: true; data: Record<string, string> } | { ok: false; status: number; error: string } {
  const clientId = text(params.get("client_id"));
  const redirectUri = text(params.get("redirect_uri"));
  const responseType = text(params.get("response_type"));
  const codeChallenge = text(params.get("code_challenge"));
  const codeChallengeMethod = text(params.get("code_challenge_method"));
  const scope = normalizeOAuthScope(text(params.get("scope")) ?? "files.read");
  const state = params.get("state") ?? "";

  if (!clientId) {
    return { ok: false, status: 400, error: "Missing client_id." };
  }

  const client = findOAuthClient(config.repoRoot, clientId);
  if (!client) {
    return { ok: false, status: 400, error: "Invalid client_id." };
  }

  if (!redirectUri || !client.redirect_uris.includes(redirectUri)) {
    return { ok: false, status: 400, error: "Invalid redirect_uri." };
  }

  if (responseType !== "code") {
    return { ok: false, status: 400, error: "Only response_type=code is supported." };
  }

  if (!codeChallenge || codeChallengeMethod !== "S256" || !PKCE_S256_CHALLENGE_PATTERN.test(codeChallenge)) {
    return { ok: false, status: 400, error: "PKCE S256 code_challenge is required." };
  }

  return {
    ok: true,
    data: {
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: responseType,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
      scope,
      state
    }
  };
}

function renderAuthorizationPage(config: AppConfig, data: Record<string, string>): string {
  const client = findOAuthClient(config.repoRoot, data.client_id);
  const appName = htmlEscape(client?.client_name ?? "ChatGPT OAuth Client");
  const scopes = data.scope.split(/\s+/u).filter(Boolean).map(htmlEscape).join(", ");
  const hiddenInputs = Object.entries(data)
    .map(([name, value]) => `<input type="hidden" name="${htmlEscape(name)}" value="${htmlEscape(value)}" />`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Authorize ChampCity GPT MCP</title>
    <style>
      body { margin: 0; font-family: Segoe UI, Arial, sans-serif; color: #17202a; background: #f3f6f8; }
      main { width: min(680px, calc(100% - 32px)); margin: 48px auto; padding: 24px; border: 1px solid #d6dde5; border-radius: 8px; background: #fff; }
      h1 { margin: 0 0 12px; font-size: 1.45rem; }
      p { line-height: 1.45; }
      .warning { padding: 12px; border-left: 4px solid #b6423c; background: #fff2f1; }
      label { display: block; margin: 18px 0 6px; font-weight: 700; }
      input[type=password] { width: 100%; min-height: 38px; padding: 8px; border: 1px solid #c9d2dc; border-radius: 6px; box-sizing: border-box; }
      button { margin-top: 16px; min-height: 38px; padding: 8px 14px; border: 1px solid #1769aa; border-radius: 6px; color: #fff; background: #1769aa; cursor: pointer; }
    </style>
  </head>
  <body>
    <main>
      <h1>Authorize ${appName}</h1>
      <p>Requested scopes: <strong>${scopes || "files.read"}</strong></p>
      <p class="warning">Approving grants access to files under configured ChampCity GPT allowed roots. Start with files.read and only approve files.write after read-only access is validated.</p>
      <form method="post" action="/oauth/authorize">
        ${hiddenInputs}
        <label for="adminPassword">OAuth admin password</label>
        <input id="adminPassword" name="admin_password" type="password" autocomplete="current-password" required />
        <button type="submit">Approve</button>
      </form>
    </main>
  </body>
</html>`;
}

async function handleOAuthRegister(config: AppConfig, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    writeJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  let body: unknown;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    writeJson(res, 400, { error: "invalid_client_metadata", error_description: error instanceof Error ? error.message : String(error) });
    return;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    writeJson(res, 400, { error: "invalid_client_metadata" });
    return;
  }

  try {
    const client = registerOAuthClient(config.repoRoot, body as Record<string, unknown>);
    writeJson(res, 201, {
      client_id: client.client_id,
      client_id_issued_at: Math.floor(Date.parse(client.created_at) / 1000),
      redirect_uris: client.redirect_uris,
      client_name: client.client_name,
      client_uri: client.client_uri,
      grant_types: client.grant_types,
      response_types: client.response_types,
      scope: client.scope,
      token_endpoint_auth_method: "none"
    });
  } catch (error) {
    writeJson(res, 400, { error: "invalid_client_metadata", error_description: error instanceof Error ? error.message : String(error) });
  }
}

async function handleOAuthAuthorize(config: AppConfig, req: IncomingMessage, res: ServerResponse, requestUrl: URL): Promise<void> {
  if (req.method === "GET") {
    const validation = validateAuthorizeParams(config, requestUrl.searchParams);
    if (!validation.ok) {
      recordAuthorizeRejection(config, requestUrl.pathname, requestUrl.searchParams, validation.error);
      writeJson(res, validation.status, { error: "invalid_request", error_description: validation.error });
      return;
    }

    if (!readOAuthAdminConfig(config.repoRoot)) {
      writeHtml(res, 503, "<!doctype html><title>OAuth setup required</title><p>OAuth admin password is not configured. Configure it in the ChampCity GPT Launcher before approving ChatGPT.</p>");
      return;
    }

    writeHtml(res, 200, renderAuthorizationPage(config, validation.data));
    return;
  }

  if (req.method !== "POST") {
    writeJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  let body: unknown;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    writeJson(res, 400, { error: "invalid_request", error_description: error instanceof Error ? error.message : String(error) });
    return;
  }
  const params = new URLSearchParams();
  if (body && typeof body === "object" && !Array.isArray(body)) {
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (typeof value === "string") {
        params.set(key, value);
      }
    }
  }

  const validation = validateAuthorizeParams(config, params);
  if (!validation.ok) {
    recordAuthorizeRejection(config, "/oauth/authorize", params, validation.error);
    writeJson(res, validation.status, { error: "invalid_request", error_description: validation.error });
    return;
  }

  const adminPassword = text(params.get("admin_password"));
  if (!adminPassword || !verifyOAuthAdminPassword(config.repoRoot, adminPassword)) {
    writeHtml(res, 403, "<!doctype html><title>Authorization denied</title><p>Invalid OAuth admin password.</p>");
    return;
  }

  const code = issueAuthorizationCode({
    client_id: validation.data.client_id,
    redirect_uri: validation.data.redirect_uri,
    code_challenge: validation.data.code_challenge,
    code_challenge_method: "S256",
    scope: validation.data.scope,
    state: validation.data.state || undefined
  });
  const redirectUrl = new URL(validation.data.redirect_uri);
  redirectUrl.searchParams.set("code", code);
  if (validation.data.state) {
    redirectUrl.searchParams.set("state", validation.data.state);
  }
  redirect(res, redirectUrl.toString());
}

async function handleOAuthToken(config: AppConfig, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    writeJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  let body: unknown;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    writeJson(res, 400, { error: "invalid_request", error_description: error instanceof Error ? error.message : String(error) });
    return;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    writeJson(res, 400, { error: "invalid_request" });
    return;
  }

  const input = body as Record<string, unknown>;
  if (input.grant_type === "authorization_code") {
    const code = text(input.code);
    const clientId = text(input.client_id);
    const redirectUri = text(input.redirect_uri);
    const codeVerifier = text(input.code_verifier);
    if (!code || !clientId || !redirectUri || !codeVerifier) {
      writeJson(res, 400, { error: "invalid_request" });
      return;
    }

    const token = exchangeAuthorizationCode(config.repoRoot, {
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    });
    if (!token) {
      writeJson(res, 400, { error: "invalid_grant" });
      return;
    }

    writeJson(res, 200, token);
    return;
  }

  if (input.grant_type === "refresh_token") {
    const refreshToken = text(input.refresh_token);
    const clientId = text(input.client_id);
    if (!refreshToken || !clientId) {
      writeJson(res, 400, { error: "invalid_request" });
      return;
    }

    const token = refreshOAuthAccessToken(config.repoRoot, {
      refresh_token: refreshToken,
      client_id: clientId
    });
    if (!token) {
      writeJson(res, 400, {
        error: "invalid_grant",
        error_description: "Refresh token is invalid or expired."
      });
      return;
    }

    writeJson(res, 200, token);
    return;
  }

  writeJson(res, 400, { error: "unsupported_grant_type" });
}

function errorDetails(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack
    };
  }

  return {
    message: String(error)
  };
}

async function logHttpTransportError(config: AppConfig, req: IncomingMessage, requestPath: string, error: unknown): Promise<void> {
  const details = errorDetails(error);
  const method = req.method ?? "UNKNOWN";
  const sanitizedMessage = details.message.replace(/\s+/gu, " ").slice(0, 500);
  const stderrMessage = [
    `HTTP MCP transport error: ${method} ${requestPath}: ${sanitizedMessage}`,
    details.stack ?? sanitizedMessage
  ].join("\n");

  console.error(stderrMessage);

  try {
    await writeAuditLog(config.auditLogPath, {
      toolName: "http_mcp_request",
      requestedPath: `${method} ${requestPath}`,
      result: "deny",
      reason: sanitizedMessage
    });
  } catch (logError) {
    const logDetails = errorDetails(logError);
    console.error(`Failed to write HTTP MCP error to app log: ${logDetails.message}`);
  }
}

export async function runHttpTransport(createServer: (auth?: AuthContext) => Server, config: AppConfig, options: HttpTransportOptions): Promise<HttpTransportHandle> {
  validateHttpBinding(options);

  if (!options.authToken && options.allowUnauthLocalHttp) {
    console.warn("WARNING: ChampCity GPT MCP HTTP mode is running unauthenticated. LOCAL TEST ONLY - DO NOT TUNNEL.");
  }

  if (!isLocalHttpHost(options.host)) {
    console.warn(
      "WARNING: ChampCity GPT MCP HTTP mode is binding to a nonlocal host. Use HTTPS, a private tunnel, a bearer token, narrow allowed roots, audit logs, and read-only mode until validated."
    );
  }

  const sessions = new Map<string, { server: Server; transport: StreamableHTTPServerTransport }>();
  let actualPort = options.port;

  function createTransport(sessionIdGenerator: (() => string) | undefined): StreamableHTTPServerTransport {
    return new StreamableHTTPServerTransport({
      sessionIdGenerator,
      enableJsonResponse: true,
      onsessionclosed: async (sessionId) => {
        const session = sessions.get(sessionId);
        sessions.delete(sessionId);
        await session?.server.close();
      }
    });
  }

  function createSession(auth: AuthContext): { server: Server; transport: StreamableHTTPServerTransport } {
    const sessionServer = createServer(auth);
    const transport = createTransport(() => randomUUID());

    transport.onclose = () => {
      const sessionId = transport.sessionId;
      if (sessionId) {
        const session = sessions.get(sessionId);
        sessions.delete(sessionId);
        void session?.server.close();
      }
    };
    transport.onerror = (error) => {
      console.error(`HTTP MCP transport session error: ${error.message}`);
    };

    return {
      server: sessionServer,
      transport
    };
  }

  async function handleStatelessCompatRequest(auth: AuthContext, req: IncomingMessage, res: ServerResponse, parsedBody: unknown): Promise<void> {
    const requestServer = createServer(auth);
    const transport = createTransport(undefined);
    try {
      await requestServer.connect(transport);
      await transport.handleRequest(req, res, parsedBody);
    } finally {
      await transport.close();
      await requestServer.close();
    }
  }

  const httpServer = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url ?? "/", getOAuthPublicBaseUrl());
    const requestPath = requestUrl.pathname;

    try {
      if (requestPath === "/health") {
        writeJson(res, 200, createHealthResponse(config, { ...options, port: actualPort }));
        return;
      }

      if (requestPath === "/.well-known/oauth-protected-resource" || requestPath === "/.well-known/oauth-protected-resource/mcp") {
        writeJson(res, 200, createProtectedResourceMetadata());
        return;
      }

      if (requestPath === "/.well-known/oauth-authorization-server" || requestPath === "/.well-known/oauth-authorization-server/mcp") {
        writeJson(res, 200, createAuthorizationServerMetadata());
        return;
      }

      if (requestPath === "/oauth/register") {
        await handleOAuthRegister(config, req, res);
        return;
      }

      if (requestPath === "/oauth/authorize") {
        await handleOAuthAuthorize(config, req, res, requestUrl);
        return;
      }

      if (requestPath === "/oauth/token") {
        await handleOAuthToken(config, req, res);
        return;
      }

      if (requestPath === "/mcp") {
        let parsedBody: unknown;
        let accept: { originalAccept?: string; normalizedAccept?: string } = {
          originalAccept: stringHeader(req.headers.accept),
          normalizedAccept: stringHeader(req.headers.accept)
        };
        if (methodAllowsMcpBody(req.method)) {
          try {
            parsedBody = await readRequestBody(req);
          } catch (error) {
            const details = errorDetails(error);
            jsonRpcErrorResponse(res, 400, "Parse error: Invalid JSON");
            recordMcpDiscovery(
              config,
              req,
              requestPath,
              undefined,
              undefined,
              {
                statusCode: res.statusCode,
                contentType: responseContentType(res),
                kind: responseKind(res.statusCode, responseContentType(res)),
                transportRoute: "bad-request",
                error: details.message
              },
              accept,
              details.message
            );
            return;
          }
        }

        const auth = authenticateMcpRequest(req, config, options);
        if (!auth) {
          unauthorized(res);
          recordMcpDiscovery(
            config,
            req,
            requestPath,
            parsedBody,
            undefined,
            {
              statusCode: res.statusCode,
              contentType: responseContentType(res),
              kind: responseKind(res.statusCode, responseContentType(res)),
              transportRoute: "auth-denied"
            },
            accept
          );
          return;
        }

        if (methodAllowsMcpBody(req.method)) {
          const denial = mcpScopeDenial(parsedBody, auth);
          if (denial) {
            await writeAuditLog(config.auditLogPath, {
              toolName: "http_mcp_scope",
              requestedPath: `${req.method ?? "UNKNOWN"} ${requestPath}`,
              result: "deny",
              reason: denial
            });
            forbidden(res, denial);
            recordMcpDiscovery(
              config,
              req,
              requestPath,
              parsedBody,
              auth,
              {
                statusCode: res.statusCode,
                contentType: responseContentType(res),
                kind: responseKind(res.statusCode, responseContentType(res)),
                transportRoute: "scope-denied",
                error: denial
              },
              accept,
              denial
            );
            return;
          }
        }

        accept = normalizeMcpAcceptHeader(req);

        const sessionId = req.headers["mcp-session-id"];
        const normalizedSessionId = Array.isArray(sessionId) ? sessionId[0] : sessionId;
        const existingSession = normalizedSessionId ? sessions.get(normalizedSessionId) : undefined;

        if (existingSession) {
          await existingSession.transport.handleRequest(req, res, parsedBody);
          recordMcpDiscovery(
            config,
            req,
            requestPath,
            parsedBody,
            auth,
            {
              statusCode: res.statusCode,
              contentType: responseContentType(res),
              kind: responseKind(res.statusCode, responseContentType(res)),
              transportRoute: "stateful-session"
            },
            accept
          );
          return;
        }

        if (!normalizedSessionId && includesInitializeRequest(parsedBody)) {
          const session = createSession(auth);
          await session.server.connect(session.transport);
          await session.transport.handleRequest(req, res, parsedBody);
          const initializedSessionId = session.transport.sessionId;
          if (initializedSessionId) {
            sessions.set(initializedSessionId, session);
          }
          recordMcpDiscovery(
            config,
            req,
            requestPath,
            parsedBody,
            auth,
            {
              statusCode: res.statusCode,
              contentType: responseContentType(res),
              kind: responseKind(res.statusCode, responseContentType(res)),
              transportRoute: "stateful-session"
            },
            accept
          );
          return;
        }

        if (!methodAllowsMcpBody(req.method)) {
          jsonRpcErrorResponse(res, normalizedSessionId ? 404 : 400, normalizedSessionId ? "Session not found" : "Bad Request: No valid session ID provided");
          recordMcpDiscovery(
            config,
            req,
            requestPath,
            parsedBody,
            auth,
            {
              statusCode: res.statusCode,
              contentType: responseContentType(res),
              kind: responseKind(res.statusCode, responseContentType(res)),
              transportRoute: "bad-request"
            },
            accept
          );
          return;
        }

        await handleStatelessCompatRequest(auth, req, res, parsedBody);
        recordMcpDiscovery(
          config,
          req,
          requestPath,
          parsedBody,
          auth,
          {
            statusCode: res.statusCode,
            contentType: responseContentType(res),
            kind: responseKind(res.statusCode, responseContentType(res)),
            transportRoute: "stateless-compat"
          },
          accept
        );
        return;
      }

      writeJson(res, 404, { error: "Not found" });
    } catch (error) {
      await logHttpTransportError(config, req, requestPath, error);
      jsonRpcErrorResponse(res, 500, "Internal server error");
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.port, options.host, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });

  const address = httpServer.address();
  actualPort = address && typeof address === "object" ? address.port : options.port;
  const url = `http://${options.host}:${actualPort}/mcp`;
  let closePromise: Promise<void> | null = null;

  async function closeSessions(): Promise<void> {
    await Promise.all([...sessions.values()].map(async (session) => {
      await session.transport.close();
      await session.server.close();
    }));
    sessions.clear();
  }

  function closeHttpServer(force: boolean): Promise<void> {
    if (force) {
      httpServer.closeAllConnections();
    }

    if (!closePromise) {
      closePromise = new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }

    return closePromise;
  }

  return {
    server: httpServer,
    url,
    healthUrl: `http://${options.host}:${actualPort}/health`,
    close: async () => {
      await closeSessions();
      await closeHttpServer(false);
    },
    forceClose: async () => {
      await closeSessions().catch(() => {
        sessions.clear();
      });
      await closeHttpServer(true);
    }
  };
}
