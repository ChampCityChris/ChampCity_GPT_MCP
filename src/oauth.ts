import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { URLSearchParams } from "node:url";

import { getRuntimeConfigFilePath } from "./runtimePaths.js";

export const DEFAULT_OAUTH_PUBLIC_BASE_URL = "https://mcp.example.com";
export const CHATGPT_OAUTH_PUBLIC_BASE_URL = normalizeOAuthPublicBaseUrl(
  process.env.CHAMPCITY_GPT_PUBLIC_BASE_URL ?? "https://mcp.example.com"
);
export const OAUTH_PUBLIC_ISSUER = CHATGPT_OAUTH_PUBLIC_BASE_URL;
export const OAUTH_PUBLIC_MCP_URL = `${OAUTH_PUBLIC_ISSUER}/mcp`;
export const OAUTH_SCOPES = ["files.read", "files.write"] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

export interface OAuthClient {
  client_id: string;
  redirect_uris: string[];
  client_name?: string;
  client_uri?: string;
  grant_types: string[];
  response_types: string[];
  scope: string;
  created_at: string;
}

export interface OAuthAccessTokenRecord {
  tokenHash: string;
  client_id: string;
  scope: string;
  createdAt: string;
  expiresAt: string;
  revoked?: boolean;
}

export interface OAuthRefreshTokenRecord {
  refreshTokenHash: string;
  client_id: string;
  scope: string;
  issuedAt: string;
  expiresAt: string;
  revoked: boolean;
  rotatedFrom?: string;
  lastUsedAt?: string;
}

export interface OAuthClientStore {
  clients: OAuthClient[];
}

export interface OAuthTokenStore {
  accessTokens: OAuthAccessTokenRecord[];
  refreshTokens: OAuthRefreshTokenRecord[];
}

export interface OAuthAdminConfig {
  adminPasswordHash: string;
  createdAt: string;
}

export interface AuthorizationCodeRecord {
  codeHash: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: "S256";
  scope: string;
  expiresAt: string;
  used: boolean;
  state?: string;
}

export interface OAuthStatus {
  adminPasswordConfigured: boolean;
  registeredClientsCount: number;
  activeOAuthClientsCount: number;
  activeTokensCount: number;
  activeWriteTokensCount: number;
  activeRefreshSessionsCount: number;
  expiredSessionsCount: number;
  revokedSessionsCount: number;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  clientRegistryPath: string;
  tokenRegistryPath: string;
  adminConfigPath: string;
  authorizeErrorPath: string;
  authorizationServerMetadataPath: string;
  protectedResourceMetadataPath: string;
  registrationEndpointPath: string;
  dynamicClientRegistrationEnabled: boolean;
  lastAuthorizeError?: OAuthAuthorizeErrorDiagnostic;
}

export interface OAuthAuthorizeErrorDiagnostic {
  occurredAt: string;
  requestPath: string;
  error: string;
  requiredFieldsPresent: {
    response_type: boolean;
    client_id: boolean;
    redirect_uri: boolean;
    code_challenge: boolean;
    code_challenge_method: boolean;
  };
  codeChallengeMethod?: string;
  clientIdPrefix?: string;
  redirectUriLocation?: string;
}

const CLIENTS_FILE = "oauth-clients.local.json";
const TOKENS_FILE = "oauth-tokens.local.json";
const ADMIN_FILE = "oauth-admin.local.json";
const AUTHORIZE_ERROR_FILE = "oauth-authorize-last-error.local.json";
const AUTHORIZATION_CODES = new Map<string, AuthorizationCodeRecord>();
export const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 7200;
export const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 2592000;
const AUTHORIZATION_CODE_SECONDS = 600;

function nowIso(): string {
  return new Date().toISOString();
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${filePath}: ${detail}`);
  }

  return parsed as T;
}

function writeJsonFile(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function tokenHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export function getOAuthAccessTokenTtlSeconds(env: NodeJS.ProcessEnv = process.env): number {
  return parsePositiveInteger(env.CHAMPCITY_GPT_ACCESS_TOKEN_TTL_SECONDS, DEFAULT_ACCESS_TOKEN_TTL_SECONDS);
}

export function getOAuthRefreshTokenTtlSeconds(env: NodeJS.ProcessEnv = process.env): number {
  return parsePositiveInteger(env.CHAMPCITY_GPT_REFRESH_TOKEN_TTL_SECONDS, DEFAULT_REFRESH_TOKEN_TTL_SECONDS);
}

export function formatOAuthDuration(seconds: number): string {
  if (seconds % 86400 === 0) {
    const days = seconds / 86400;
    return `${days} ${days === 1 ? "day" : "days"}`;
  }

  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }

  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }

  return `${seconds} seconds`;
}

function normalizeScope(scope: unknown): string {
  const raw = typeof scope === "string" ? scope : "files.read";
  const requested = raw.split(/\s+/u).filter(Boolean);
  const allowed = requested.filter((entry): entry is OAuthScope => OAUTH_SCOPES.includes(entry as OAuthScope));
  return [...new Set(allowed.length > 0 ? allowed : ["files.read"])].join(" ");
}

export function normalizeOAuthScope(scope: unknown): string {
  return normalizeScope(scope);
}

function assertStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    throw new Error(`${label} must be a non-empty array of strings.`);
  }

  return value.map((entry) => entry.trim());
}

function assertRedirectUriArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== "string" || entry === "")) {
    throw new Error("redirect_uris must be a non-empty array of strings.");
  }

  return [...(value as string[])];
}

export function normalizeOAuthPublicBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/u, "");
  if (!normalized) {
    return DEFAULT_OAUTH_PUBLIC_BASE_URL;
  }

  return normalized;
}

export function getOAuthPublicBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return normalizeOAuthPublicBaseUrl(env.CHAMPCITY_GPT_PUBLIC_BASE_URL ?? DEFAULT_OAUTH_PUBLIC_BASE_URL);
}

export function getOAuthPublicMcpUrl(publicBaseUrl = getOAuthPublicBaseUrl()): string {
  return `${normalizeOAuthPublicBaseUrl(publicBaseUrl)}/mcp`;
}

export function getOAuthClientsPath(repoRoot: string): string {
  return getRuntimeConfigFilePath(repoRoot, CLIENTS_FILE);
}

export function getOAuthTokensPath(repoRoot: string): string {
  return getRuntimeConfigFilePath(repoRoot, TOKENS_FILE);
}

export function getOAuthAdminPath(repoRoot: string): string {
  return getRuntimeConfigFilePath(repoRoot, ADMIN_FILE);
}

export function getOAuthAuthorizeErrorPath(repoRoot: string): string {
  return getRuntimeConfigFilePath(repoRoot, AUTHORIZE_ERROR_FILE);
}

export function createAuthorizationServerMetadata(publicBaseUrl = getOAuthPublicBaseUrl()) {
  const issuer = normalizeOAuthPublicBaseUrl(publicBaseUrl);
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: OAUTH_SCOPES
  };
}

export function getOAuthEndpointPaths(publicBaseUrl = getOAuthPublicBaseUrl()) {
  const issuer = normalizeOAuthPublicBaseUrl(publicBaseUrl);
  return {
    issuer,
    mcp: `${issuer}/mcp`,
    authorizationServerMetadata: `${issuer}/.well-known/oauth-authorization-server`,
    authorizationServerMetadataForMcp: `${issuer}/.well-known/oauth-authorization-server/mcp`,
    protectedResourceMetadata: `${issuer}/.well-known/oauth-protected-resource`,
    protectedResourceMetadataForMcp: `${issuer}/.well-known/oauth-protected-resource/mcp`,
    registrationEndpoint: `${issuer}/oauth/register`,
    authorizationEndpoint: `${issuer}/oauth/authorize`,
    tokenEndpoint: `${issuer}/oauth/token`
  };
}

export function createProtectedResourceMetadata(publicBaseUrl = getOAuthPublicBaseUrl()) {
  const issuer = normalizeOAuthPublicBaseUrl(publicBaseUrl);
  return {
    resource: getOAuthPublicMcpUrl(issuer),
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: OAUTH_SCOPES,
    resource_name: "ChampCity GPT MCP"
  };
}

export function readOAuthClientStore(repoRoot: string): OAuthClientStore {
  const store = readJsonFile<OAuthClientStore>(getOAuthClientsPath(repoRoot), { clients: [] });
  if (!Array.isArray(store.clients)) {
    throw new Error(`${getOAuthClientsPath(repoRoot)} must contain a clients array.`);
  }
  return store;
}

export function writeOAuthClientStore(repoRoot: string, store: OAuthClientStore): void {
  writeJsonFile(getOAuthClientsPath(repoRoot), store);
}

export function resetOAuthClients(repoRoot: string): void {
  fs.rmSync(getOAuthClientsPath(repoRoot), { force: true });
}

export function readOAuthTokenStore(repoRoot: string): OAuthTokenStore {
  const store = readJsonFile<OAuthTokenStore>(getOAuthTokensPath(repoRoot), { accessTokens: [], refreshTokens: [] });
  if (!Array.isArray(store.accessTokens)) {
    throw new Error(`${getOAuthTokensPath(repoRoot)} must contain an accessTokens array.`);
  }
  if (!Array.isArray(store.refreshTokens)) {
    store.refreshTokens = [];
  }
  return store;
}

export function writeOAuthTokenStore(repoRoot: string, store: OAuthTokenStore): void {
  writeJsonFile(getOAuthTokensPath(repoRoot), store);
}

export function revokeAllOAuthTokens(repoRoot: string): void {
  const store = readOAuthTokenStore(repoRoot);
  const revokedAt = nowIso();
  for (const token of store.accessTokens) {
    token.revoked = true;
  }
  for (const token of store.refreshTokens) {
    token.revoked = true;
    token.lastUsedAt = token.lastUsedAt ?? revokedAt;
  }
  writeOAuthTokenStore(repoRoot, store);
}

function matchesChatGptClient(client: OAuthClient): boolean {
  const haystack = [
    client.client_name,
    client.client_uri,
    ...client.redirect_uris
  ].filter((value): value is string => typeof value === "string").join(" ").toLowerCase();
  return haystack.includes("chatgpt") || haystack.includes("chat.openai.com") || haystack.includes("openai.com");
}

export function revokeChatGptOAuthTokens(repoRoot: string): void {
  const clients = readOAuthClientStore(repoRoot).clients.filter(matchesChatGptClient);
  const clientIds = new Set(clients.map((client) => client.client_id));
  if (clientIds.size === 0) {
    return;
  }

  const store = readOAuthTokenStore(repoRoot);
  const revokedAt = nowIso();
  for (const token of store.accessTokens) {
    if (clientIds.has(token.client_id)) {
      token.revoked = true;
    }
  }
  for (const token of store.refreshTokens) {
    if (clientIds.has(token.client_id)) {
      token.revoked = true;
      token.lastUsedAt = token.lastUsedAt ?? revokedAt;
    }
  }
  writeOAuthTokenStore(repoRoot, store);
}

export function clearExpiredOAuthTokens(repoRoot: string): void {
  const now = Date.now();
  const store = readOAuthTokenStore(repoRoot);
  writeOAuthTokenStore(repoRoot, {
    accessTokens: store.accessTokens.filter((token) => Date.parse(token.expiresAt) > now),
    refreshTokens: store.refreshTokens.filter((token) => Date.parse(token.expiresAt) > now)
  });
}

export function registerOAuthClient(repoRoot: string, payload: Record<string, unknown>): OAuthClient {
  const redirectUris = assertRedirectUriArray(payload.redirect_uris);
  const tokenEndpointAuthMethod = typeof payload.token_endpoint_auth_method === "string" ? payload.token_endpoint_auth_method : "none";
  if (tokenEndpointAuthMethod !== "none") {
    throw new Error("token_endpoint_auth_method must be none for ChatGPT public PKCE clients.");
  }

  const client: OAuthClient = {
    client_id: `champcity_${randomBytes(18).toString("base64url")}`,
    redirect_uris: redirectUris,
    client_name: typeof payload.client_name === "string" ? payload.client_name : undefined,
    client_uri: typeof payload.client_uri === "string" ? payload.client_uri : undefined,
    grant_types: Array.isArray(payload.grant_types) ? assertStringArray(payload.grant_types, "grant_types") : ["authorization_code"],
    response_types: Array.isArray(payload.response_types) ? assertStringArray(payload.response_types, "response_types") : ["code"],
    scope: normalizeScope(payload.scope),
    created_at: nowIso()
  };

  const store = readOAuthClientStore(repoRoot);
  store.clients.push(client);
  writeOAuthClientStore(repoRoot, store);
  return client;
}

export function findOAuthClient(repoRoot: string, clientId: string): OAuthClient | undefined {
  return readOAuthClientStore(repoRoot).clients.find((client) => client.client_id === clientId);
}

export function hashAdminPassword(password: string): string {
  const normalized = password.trim();
  if (normalized.length < 12) {
    throw new Error("OAuth admin password must be at least 12 characters.");
  }

  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(normalized, salt, 32).toString("base64url");
  return `scrypt:${salt}:${hash}`;
}

export function saveOAuthAdminPassword(repoRoot: string, password: string): void {
  const config: OAuthAdminConfig = {
    adminPasswordHash: hashAdminPassword(password),
    createdAt: nowIso()
  };
  writeJsonFile(getOAuthAdminPath(repoRoot), config);
}

export function readOAuthAdminConfig(repoRoot: string): OAuthAdminConfig | undefined {
  if (!fs.existsSync(getOAuthAdminPath(repoRoot))) {
    return undefined;
  }

  const config = readJsonFile<OAuthAdminConfig>(getOAuthAdminPath(repoRoot), {} as OAuthAdminConfig);
  if (typeof config.adminPasswordHash !== "string" || typeof config.createdAt !== "string") {
    throw new Error(`${getOAuthAdminPath(repoRoot)} must contain adminPasswordHash and createdAt.`);
  }
  return config;
}

export function verifyOAuthAdminPassword(repoRoot: string, password: string): boolean {
  const config = readOAuthAdminConfig(repoRoot);
  if (!config) {
    return false;
  }

  const [scheme, salt, expectedHash] = config.adminPasswordHash.split(":");
  if (scheme !== "scrypt" || !salt || !expectedHash) {
    return false;
  }

  const candidate = scryptSync(password.trim(), salt, 32);
  const expected = Buffer.from(expectedHash, "base64url");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function issueAuthorizationCode(input: {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method?: "S256";
  scope: string;
  state?: string;
}): string {
  const code = randomBytes(32).toString("base64url");
  const record: AuthorizationCodeRecord = {
    codeHash: tokenHash(code),
    client_id: input.client_id,
    redirect_uri: input.redirect_uri,
    code_challenge: input.code_challenge,
    code_challenge_method: input.code_challenge_method ?? "S256",
    scope: normalizeScope(input.scope),
    expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_SECONDS * 1000).toISOString(),
    used: false,
    state: input.state
  };
  AUTHORIZATION_CODES.set(record.codeHash, record);
  return code;
}

function issueAccessToken(store: OAuthTokenStore, input: { client_id: string; scope: string }, env: NodeJS.ProcessEnv = process.env): string {
  const accessToken = randomBytes(32).toString("base64url");
  const accessTokenTtlSeconds = getOAuthAccessTokenTtlSeconds(env);
  store.accessTokens.push({
    tokenHash: tokenHash(accessToken),
    client_id: input.client_id,
    scope: input.scope,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + accessTokenTtlSeconds * 1000).toISOString(),
    revoked: false
  });
  return accessToken;
}

function issueRefreshToken(store: OAuthTokenStore, input: { client_id: string; scope: string; rotatedFrom?: string }, env: NodeJS.ProcessEnv = process.env): string {
  const refreshToken = randomBytes(48).toString("base64url");
  const issuedAt = nowIso();
  store.refreshTokens.push({
    refreshTokenHash: tokenHash(refreshToken),
    client_id: input.client_id,
    scope: input.scope,
    issuedAt,
    expiresAt: new Date(Date.now() + getOAuthRefreshTokenTtlSeconds(env) * 1000).toISOString(),
    revoked: false,
    rotatedFrom: input.rotatedFrom
  });
  return refreshToken;
}

export function exchangeAuthorizationCode(repoRoot: string, input: {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_verifier: string;
}, env: NodeJS.ProcessEnv = process.env): { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string } | undefined {
  const codeHash = tokenHash(input.code);
  const record = AUTHORIZATION_CODES.get(codeHash);
  if (!record || record.used || Date.parse(record.expiresAt) <= Date.now()) {
    return undefined;
  }

  const expectedChallenge = sha256Base64Url(input.code_verifier);
  if (
    record.client_id !== input.client_id ||
    record.redirect_uri !== input.redirect_uri ||
    record.code_challenge_method !== "S256" ||
    record.code_challenge !== expectedChallenge
  ) {
    return undefined;
  }

  if (!findOAuthClient(repoRoot, input.client_id)) {
    return undefined;
  }

  record.used = true;
  AUTHORIZATION_CODES.delete(codeHash);

  const tokenStore = readOAuthTokenStore(repoRoot);
  const accessToken = issueAccessToken(tokenStore, record, env);
  const refreshToken = issueRefreshToken(tokenStore, record, env);
  writeOAuthTokenStore(repoRoot, tokenStore);

  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: getOAuthAccessTokenTtlSeconds(env),
    refresh_token: refreshToken,
    scope: record.scope
  };
}

export function refreshOAuthAccessToken(repoRoot: string, input: {
  refresh_token: string;
  client_id: string;
}, env: NodeJS.ProcessEnv = process.env): { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string } | undefined {
  if (!findOAuthClient(repoRoot, input.client_id)) {
    return undefined;
  }

  const hash = tokenHash(input.refresh_token);
  const store = readOAuthTokenStore(repoRoot);
  const record = store.refreshTokens.find((entry) => entry.refreshTokenHash === hash);
  if (!record || record.client_id !== input.client_id || record.revoked || Date.parse(record.expiresAt) <= Date.now()) {
    return undefined;
  }

  const usedAt = nowIso();
  record.revoked = true;
  record.lastUsedAt = usedAt;
  const accessToken = issueAccessToken(store, record, env);
  const refreshToken = issueRefreshToken(store, {
    client_id: record.client_id,
    scope: record.scope,
    rotatedFrom: record.refreshTokenHash
  }, env);
  writeOAuthTokenStore(repoRoot, store);

  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: getOAuthAccessTokenTtlSeconds(env),
    refresh_token: refreshToken,
    scope: record.scope
  };
}

export function validateOAuthAccessToken(repoRoot: string, accessToken: string): OAuthAccessTokenRecord | undefined {
  const hash = tokenHash(accessToken);
  const store = readOAuthTokenStore(repoRoot);
  const record = store.accessTokens.find((entry) => entry.tokenHash === hash);
  if (!record || record.revoked || Date.parse(record.expiresAt) <= Date.now()) {
    return undefined;
  }

  return record;
}

export function getOAuthStatus(repoRoot: string): OAuthStatus {
  const endpointPaths = getOAuthEndpointPaths();
  const clients = readOAuthClientStore(repoRoot).clients.length;
  const tokenStore = readOAuthTokenStore(repoRoot);
  const now = Date.now();
  const activeTokens = tokenStore.accessTokens.filter((token) => !token.revoked && Date.parse(token.expiresAt) > now);
  const activeRefreshTokens = tokenStore.refreshTokens.filter((token) => !token.revoked && Date.parse(token.expiresAt) > now);
  const expiredSessionsCount =
    tokenStore.accessTokens.filter((token) => Date.parse(token.expiresAt) <= now).length +
    tokenStore.refreshTokens.filter((token) => Date.parse(token.expiresAt) <= now).length;
  const revokedSessionsCount =
    tokenStore.accessTokens.filter((token) => token.revoked).length +
    tokenStore.refreshTokens.filter((token) => token.revoked).length;
  return {
    adminPasswordConfigured: Boolean(readOAuthAdminConfig(repoRoot)),
    registeredClientsCount: clients,
    activeOAuthClientsCount: new Set(activeRefreshTokens.map((token) => token.client_id)).size,
    activeTokensCount: activeTokens.length,
    activeWriteTokensCount: activeTokens.filter((token) => scopeIncludes(token.scope, "files.write")).length,
    activeRefreshSessionsCount: activeRefreshTokens.length,
    expiredSessionsCount,
    revokedSessionsCount,
    accessTokenTtlSeconds: getOAuthAccessTokenTtlSeconds(),
    refreshTokenTtlSeconds: getOAuthRefreshTokenTtlSeconds(),
    clientRegistryPath: getOAuthClientsPath(repoRoot),
    tokenRegistryPath: getOAuthTokensPath(repoRoot),
    adminConfigPath: getOAuthAdminPath(repoRoot),
    authorizeErrorPath: getOAuthAuthorizeErrorPath(repoRoot),
    authorizationServerMetadataPath: endpointPaths.authorizationServerMetadata,
    protectedResourceMetadataPath: endpointPaths.protectedResourceMetadata,
    registrationEndpointPath: endpointPaths.registrationEndpoint,
    dynamicClientRegistrationEnabled: true,
    lastAuthorizeError: readLastOAuthAuthorizeError(repoRoot)
  };
}

export function writeLastOAuthAuthorizeError(repoRoot: string, diagnostic: OAuthAuthorizeErrorDiagnostic): void {
  writeJsonFile(getOAuthAuthorizeErrorPath(repoRoot), diagnostic);
}

export function readLastOAuthAuthorizeError(repoRoot: string): OAuthAuthorizeErrorDiagnostic | undefined {
  if (!fs.existsSync(getOAuthAuthorizeErrorPath(repoRoot))) {
    return undefined;
  }

  return readJsonFile<OAuthAuthorizeErrorDiagnostic | undefined>(getOAuthAuthorizeErrorPath(repoRoot), undefined);
}

export function formUrlEncode(data: Record<string, string>): string {
  return new URLSearchParams(data).toString();
}

export function scopeIncludes(scope: string, required: OAuthScope): boolean {
  return scope.split(/\s+/u).includes(required);
}
