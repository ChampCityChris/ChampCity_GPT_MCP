import fs from "node:fs";
import path from "node:path";

import { getHttpAuthStatus, type HttpAuthTokenSource } from "../src/httpAuthConfig.js";
import {
  createAuthorizationServerMetadata,
  createProtectedResourceMetadata,
  clearExpiredOAuthTokens,
  formatOAuthDuration,
  getOAuthAccessTokenTtlSeconds,
  getOAuthEndpointPaths,
  getOAuthPublicBaseUrl,
  getOAuthPublicMcpUrl,
  getOAuthRefreshTokenTtlSeconds,
  getOAuthStatus,
  readOAuthClientStore,
  resetOAuthClients,
  revokeChatGptOAuthTokens,
  revokeAllOAuthTokens,
  saveOAuthAdminPassword,
  scopeIncludes,
  type OAuthAuthorizeErrorDiagnostic,
  type OAuthClient
} from "../src/oauth.js";
import {
  clearWriteApprovalToken,
  generateWriteApprovalToken,
  getWriteAccessConfigPath,
  getWriteAccessStatus,
  saveWriteApprovalToken,
  setHttpWriteToolsEnabled,
  setWriteMode,
  type WriteApprovalTokenSource,
  type WriteMode,
  type WriteModeSource
} from "../src/writeAccess.js";
import { clearPendingPatchProposals, getPendingPatchProposalCount } from "../src/pendingPatches.js";
import { type McpDiscoveryTrace } from "../src/server/discoveryTrace.js";
import { getRuntimeConfigFilePath, getRuntimeGeneratedDir, getRuntimeLogDir, getRuntimeServerEntrypoint } from "../src/runtimePaths.js";

export const DEFAULT_REPO_ROOT = path.resolve(process.cwd());
export const PROJECTS_ROOT = path.dirname(DEFAULT_REPO_ROOT);
export const MCP_ENTRYPOINT_RELATIVE = path.join("dist", "src", "index.js");
export const LOCAL_CONFIG_FILE = "allowed-roots.local.json";
export const SETUP_CONFIG_FILE = "setup.local.json";
export const GENERATED_RELATIVE = "generated";
export const LOGS_RELATIVE = "logs";
export const AUDIT_LOG_FILE = "audit.log";
export const LOCAL_HTTP_HOST = "127.0.0.1";
export const LOCAL_HTTP_PORT = 3333;
export const LOCAL_HTTP_MCP_ENDPOINT = `http://${LOCAL_HTTP_HOST}:${LOCAL_HTTP_PORT}/mcp`;
export const LOCAL_HTTP_HEALTH_ENDPOINT = `http://${LOCAL_HTTP_HOST}:${LOCAL_HTTP_PORT}/health`;
export const CLOUDFLARE_TUNNEL_GUIDE_RELATIVE = path.join("docs", "CLOUDFLARE_TUNNEL_SETUP.md");
export const CLOUDFLARED_CONFIG_TEMPLATE_RELATIVE = path.join("examples", "cloudflared-config.example.yml");
export const TUNNEL_READINESS_SCRIPT_RELATIVE = path.join("scripts", "tunnel-readiness.ps1");

export const DEFAULT_ALLOWED_ROOTS = [DEFAULT_REPO_ROOT];

export const DEFAULT_ALLOWED_COMMANDS = [
  "npm test",
  "npm run lint",
  "npm run typecheck",
  "npm run build",
  "git status",
  "git diff"
];

export interface LocalLauncherConfig {
  allowedRoots: string[];
  requireGitRoot: boolean;
  auditLog: string;
  allowedCommands: string[];
}

export interface SetupState {
  setupComplete: boolean;
  completedAt?: string;
  appVersion?: string;
  publicBaseUrl?: string;
  localOnly?: boolean;
  cloudflareChoice?: "guide" | "skip";
}

export interface ConfigWriteValidation {
  config: LocalLauncherConfig;
  warnings: string[];
  outsideProjectsRoots: string[];
}

export interface GeneratedClientConfigs {
  generic: string;
  codex: string;
  claude: string;
  chatgptNotes: string;
}

export interface GeneratedClientConfigFiles {
  directory: string;
  files: Record<string, string>;
  previews: GeneratedClientConfigs;
}

export interface LauncherHttpAuthStatus {
  configured: boolean;
  source: HttpAuthTokenSource;
}

export interface LauncherOAuthStatus {
  adminPasswordConfigured: boolean;
  registeredClientsCount: number;
  registeredChatGptClientsCount: number;
  registeredDoctorProbeClientsCount: number;
  registeredOtherClientsCount: number;
  activeOAuthClientsCount: number;
  activeTokensCount: number;
  activeWriteTokensCount: number;
  activeRefreshSessionsCount: number;
  expiredSessionsCount: number;
  revokedSessionsCount: number;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  accessTokenTtlLabel: string;
  refreshTokenTtlLabel: string;
  clientRegistryPath: string;
  tokenRegistryPath: string;
  adminConfigPath: string;
  authorizeErrorPath: string;
  authorizationServerMetadataPath: string;
  protectedResourceMetadataPath: string;
  registrationEndpointPath: string;
  dynamicClientRegistrationEnabled: boolean;
  lastAuthorizeError?: LauncherAuthorizeErrorDiagnostic;
}

export interface LauncherAuthorizeErrorDiagnostic extends OAuthAuthorizeErrorDiagnostic {
  stale: boolean;
  staleReason?: string;
  newerEvidenceAt?: string;
  displayLabel: string;
  displaySeverity: "warn" | "info";
}

export type LauncherReadinessState = "ready" | "blocked" | "unknown";
export type LauncherReadinessSeverity = "pass" | "warn" | "fail" | "info" | "unknown";
export type LauncherOAuthWriteReadiness =
  | "granted_current_request"
  | "last_observed_granted"
  | "not_granted"
  | "unknown"
  | "stale_error"
  | "no_active_stored_token";

export type PublicReachabilityStatus = "reachable" | "unreachable" | "unknown" | "degraded";
export type TunnelRuntimeStatus = "active" | "inactive" | "unknown";
export type TunnelPersistenceStatus = "confirmed" | "not_confirmed" | "unknown" | "not_configured";
export type OverallTunnelReadiness =
  | "ready"
  | "current_ready_persistence_unconfirmed"
  | "blocked_down"
  | "unknown";
export type LegacyTunnelReadinessStatus = "READY" | "NOT_READY" | "WARN";
export type FigmaConfigSource = "env" | "local-file" | "dev-local-file" | "none";
export type FigmaMcpMode = "desktop" | "remote";
export type FigmaMcpConfigSource = "env" | "local-file" | "default";
export type FigmaMcpConnectionStatus = "not-tested";
export type FigmaMcpAuthStatus = "unknown" | "not-required" | "required" | "configured";
export type FigmaMcpMakeResourceAvailability = "unknown";

export interface LauncherDoctorCheckEvidence {
  name: string;
  status: "PASS" | "WARN" | "FAIL";
  detail: string;
}

export interface PublicTunnelDiagnostics {
  publicReachability: PublicReachabilityStatus;
  publicReachabilityDetail: string;
  publicReachabilityEvidence: string[];
  tunnelRuntime: TunnelRuntimeStatus;
  tunnelRuntimeDetail: string;
  tunnelPersistence: TunnelPersistenceStatus;
  tunnelPersistenceDetail: string;
  overallTunnelReadiness: OverallTunnelReadiness;
  overallTunnelReadinessLabel: string;
  overallTunnelReadinessDetail: string;
  legacyTunnelReadinessStatus: LegacyTunnelReadinessStatus;
}

export interface LauncherWriteAccessStatus {
  writeMode: WriteMode;
  writeModeSource: WriteModeSource;
  docsWritesAllowed: boolean;
  patchWritesAllowed: boolean;
  elevatedOperationsAllowed: boolean;
  legacyApprovalTokenConfigured: boolean;
  legacyApprovalTokenSource: WriteApprovalTokenSource;
  legacyApprovalTokenCreatedAt?: string;
  legacyApprovalTokenUpdatedAt?: string;
  pendingPatchProposalCount: number;
  oauthFilesWriteGranted: boolean | "unknown";
  localWriteReadiness: LauncherReadinessState;
  localWriteReadinessReason: string;
  localWriteReadinessSource: string;
  oauthWriteReadiness: LauncherOAuthWriteReadiness;
  oauthWriteReadinessLabel: string;
  oauthWriteReadinessDetail: string;
  oauthWriteReadinessSeverity: LauncherReadinessSeverity;
  oauthWriteEvidenceAt?: string;
  oauthWriteEvidenceSource: string;
  overallWriteReadiness: LauncherReadinessState;
  overallWriteReadinessReason: string;
  publicWriteReadiness: "READY" | "NOT_READY" | "UNKNOWN";
  publicWriteReadinessReason: string;
  configPath: string;
}

export interface LauncherFigmaStatus {
  configured: boolean;
  source: FigmaConfigSource;
  configPath: string;
  makeHandoffToolAvailable: boolean;
  figmaMcp: FigmaMcpStatus;
}

export interface FigmaMcpStatus {
  endpoint: string;
  mode: FigmaMcpMode;
  source: FigmaMcpConfigSource;
  connectionStatus: FigmaMcpConnectionStatus;
  authStatus: FigmaMcpAuthStatus;
  makeResourceRetrievalAvailable: FigmaMcpMakeResourceAvailability;
  configPath: string;
  governedBrokerOnly: true;
  arbitraryUpstreamMcpPassthrough: false;
  legacyDirectFigmaToolsRemoved: true;
}

export function repoPath(...parts: string[]): string {
  return path.join(DEFAULT_REPO_ROOT, ...parts);
}

export function getEntrypointPath(repoRoot: string): string {
  return getRuntimeServerEntrypoint(repoRoot);
}

export function getLocalConfigPath(repoRoot: string): string {
  return getRuntimeConfigFilePath(repoRoot, LOCAL_CONFIG_FILE);
}

export function getGeneratedDir(repoRoot: string): string {
  return getRuntimeGeneratedDir(repoRoot);
}

export function getLogsDir(repoRoot: string): string {
  return getRuntimeLogDir(repoRoot);
}

export function getAuditLogPath(repoRoot: string): string {
  return path.join(getLogsDir(repoRoot), AUDIT_LOG_FILE);
}

export function getSetupStatePath(repoRoot: string): string {
  return getRuntimeConfigFilePath(repoRoot, SETUP_CONFIG_FILE);
}

export function getPublicOAuthIssuer(): string {
  return getOAuthPublicBaseUrl();
}

export function getPublicMcpEndpoint(): string {
  return getOAuthPublicMcpUrl(getPublicOAuthIssuer());
}

export function getPublicOAuthAuthorizationServerMetadata(): string {
  return `${getPublicOAuthIssuer()}/.well-known/oauth-authorization-server`;
}

export function getPublicOAuthProtectedResourceMetadata(): string {
  return `${getPublicOAuthIssuer()}/.well-known/oauth-protected-resource`;
}

export function getPublicHealthEndpoint(): string {
  return `${getPublicOAuthIssuer()}/health`;
}

export function getPublicOAuthRegistrationEndpoint(): string {
  return getOAuthEndpointPaths(getPublicOAuthIssuer()).registrationEndpoint;
}

export function readSetupState(repoRoot: string): SetupState {
  const setupPath = getSetupStatePath(repoRoot);
  if (!fs.existsSync(setupPath)) {
    return { setupComplete: false };
  }

  const parsed = JSON.parse(fs.readFileSync(setupPath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { setupComplete: false };
  }

  const state = parsed as Partial<SetupState>;
  return {
    setupComplete: state.setupComplete === true,
    completedAt: typeof state.completedAt === "string" ? state.completedAt : undefined,
    appVersion: typeof state.appVersion === "string" ? state.appVersion : undefined,
    publicBaseUrl: typeof state.publicBaseUrl === "string" ? state.publicBaseUrl : undefined,
    localOnly: state.localOnly === true,
    cloudflareChoice: state.cloudflareChoice === "guide" || state.cloudflareChoice === "skip" ? state.cloudflareChoice : undefined
  };
}

export function writeSetupState(repoRoot: string, state: SetupState): SetupState {
  const setupPath = getSetupStatePath(repoRoot);
  const persisted: SetupState = {
    ...state,
    setupComplete: true,
    completedAt: state.completedAt ?? new Date().toISOString()
  };
  fs.mkdirSync(path.dirname(setupPath), { recursive: true });
  fs.writeFileSync(setupPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
  return persisted;
}

export function resetSetupState(repoRoot: string): void {
  fs.rmSync(getSetupStatePath(repoRoot), { force: true });
}

export function normalizeWindowsPathForConfig(value: string): string {
  return path.resolve(value);
}

export function isUnderProjectsRoot(value: string): boolean {
  const normalized = normalizeWindowsPathForConfig(value).toLowerCase();
  const projectsRoot = path.resolve(PROJECTS_ROOT).toLowerCase();
  return normalized === projectsRoot || normalized.startsWith(`${projectsRoot}${path.sep}`);
}

export function createDefaultLocalConfig(repoRoot: string): LocalLauncherConfig {
  return {
    allowedRoots: DEFAULT_ALLOWED_ROOTS.map(normalizeWindowsPathForConfig),
    requireGitRoot: true,
    auditLog: getAuditLogPath(repoRoot),
    allowedCommands: [...DEFAULT_ALLOWED_COMMANDS]
  };
}

function assertStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${label} must be an array of strings.`);
  }

  return value;
}

export function validateLocalConfig(rawConfig: unknown, repoRoot: string): ConfigWriteValidation {
  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    throw new Error("Local config must be a JSON object.");
  }

  const input = rawConfig as Record<string, unknown>;
  const allowedRoots = assertStringArray(input.allowedRoots, "allowedRoots").map((root) => {
    if (!path.isAbsolute(root)) {
      throw new Error(`Allowed root must be absolute: ${root}`);
    }

    return normalizeWindowsPathForConfig(root);
  });

  if (typeof input.requireGitRoot !== "boolean") {
    throw new Error("requireGitRoot must be a boolean.");
  }

  if (typeof input.auditLog !== "string" || !path.isAbsolute(input.auditLog)) {
    throw new Error("auditLog must be an absolute path.");
  }

  const allowedCommands = assertStringArray(input.allowedCommands, "allowedCommands");
  const outsideProjectsRoots = allowedRoots.filter((root) => !isUnderProjectsRoot(root));
  const warnings = [
    ...outsideProjectsRoots.map((root) => `Allowed root is outside ${PROJECTS_ROOT}: ${root}`),
    ...allowedRoots.filter((root) => !fs.existsSync(root)).map((root) => `Allowed root does not exist: ${root}`)
  ];

  return {
    config: {
      allowedRoots,
      requireGitRoot: input.requireGitRoot,
      auditLog: normalizeWindowsPathForConfig(input.auditLog),
      allowedCommands: [...allowedCommands]
    },
    warnings,
    outsideProjectsRoots
  };
}

export function readLocalConfig(repoRoot: string): LocalLauncherConfig {
  const configPath = getLocalConfigPath(repoRoot);
  if (!fs.existsSync(configPath)) {
    return createDefaultLocalConfig(repoRoot);
  }

  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
  return validateLocalConfig(parsed, repoRoot).config;
}

export function writeLocalConfig(repoRoot: string, rawConfig: unknown): ConfigWriteValidation {
  const validation = validateLocalConfig(rawConfig, repoRoot);
  const configPath = getLocalConfigPath(repoRoot);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(validation.config, null, 2)}\n`, "utf8");
  return validation;
}

function configObject(repoRoot: string): Record<string, unknown> {
  const localConfig = readLocalConfig(repoRoot);
  return {
    command: "node",
    args: [getEntrypointPath(repoRoot)],
    cwd: repoRoot,
    env: {
      CHAMPCITY_GPT_ALLOWED_ROOTS: localConfig.allowedRoots.join(";"),
      CHAMPCITY_GPT_REQUIRE_GIT_ROOT: String(localConfig.requireGitRoot)
    }
  };
}

export function getLauncherHttpAuthStatus(repoRoot: string, env: NodeJS.ProcessEnv = process.env): LauncherHttpAuthStatus {
  return getHttpAuthStatus(repoRoot, env);
}

export function isHttpAuthTokenConfigured(repoRoot: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return getLauncherHttpAuthStatus(repoRoot, env).configured;
}

export function isUnauthenticatedLocalHttpAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.CHAMPCITY_GPT_ALLOW_UNAUTH_LOCAL_HTTP ?? "").trim().toLowerCase() === "true";
}

export function isHttpWriteToolsEnabled(repoRoot = DEFAULT_REPO_ROOT, env: NodeJS.ProcessEnv = process.env): boolean {
  return getWriteAccessStatus(repoRoot, env).writeMode !== "off";
}

export function isPublicTunnelReady(repoRoot: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return getLauncherOAuthStatus(repoRoot).adminPasswordConfigured && !isUnauthenticatedLocalHttpAllowed(env) && !isHttpWriteToolsEnabled(repoRoot, env);
}

const PUBLIC_REACHABILITY_CHECK_NAMES = new Set([
  "Public health status",
  "Public OAuth metadata status",
  "Public protected resource metadata status",
  "Public Dynamic Client Registration status"
]);

function isDefaultExamplePublicBaseUrl(publicBaseUrl: string): boolean {
  return /(^|\.)mcp\.example\.com$/iu.test(new URL(publicBaseUrl).hostname);
}

function publicCheckSummary(check: LauncherDoctorCheckEvidence): string {
  return `${check.name}=${check.status}`;
}

function isSuccessfulMcpReachabilityTrace(trace: McpDiscoveryTrace | null | undefined): trace is McpDiscoveryTrace {
  return Boolean(
    trace &&
    trace.request.path === "/mcp" &&
    trace.auth.kind === "oauth" &&
    trace.response.statusCode >= 200 &&
    trace.response.statusCode < 300 &&
    trace.response.kind === "json-rpc-response"
  );
}

export function getPublicTunnelDiagnostics(options: {
  publicBaseUrl: string;
  localHealthPassing: boolean;
  lastDiscoveryTrace?: McpDiscoveryTrace | null;
  doctorChecks?: LauncherDoctorCheckEvidence[] | null;
  persistenceConfirmed?: boolean;
}): PublicTunnelDiagnostics {
  const publicChecks = (options.doctorChecks ?? []).filter((check) => PUBLIC_REACHABILITY_CHECK_NAMES.has(check.name));
  const passingChecks = publicChecks.filter((check) => check.status === "PASS");
  const failingChecks = publicChecks.filter((check) => check.status === "FAIL");
  const successfulDiscovery = isSuccessfulMcpReachabilityTrace(options.lastDiscoveryTrace);
  const successfulDiscoveryTrace = successfulDiscovery ? options.lastDiscoveryTrace : null;
  const evidence = [
    ...publicChecks.map(publicCheckSummary),
    successfulDiscoveryTrace
      ? `Last ChatGPT MCP discovery=PASS HTTP ${successfulDiscoveryTrace.response.statusCode} ${successfulDiscoveryTrace.response.kind}`
      : undefined,
    !options.localHealthPassing ? "Local health=FAIL" : "Local health=PASS"
  ].filter((value): value is string => Boolean(value));

  let publicReachability: PublicReachabilityStatus = "unknown";
  if (!options.localHealthPassing && passingChecks.length === 0 && !successfulDiscovery) {
    publicReachability = "unreachable";
  } else if (successfulDiscovery || passingChecks.some((check) => check.name === "Public Dynamic Client Registration status") || passingChecks.length >= 2) {
    publicReachability = failingChecks.length > 0 ? "degraded" : "reachable";
  } else if (passingChecks.length > 0 && failingChecks.length > 0) {
    publicReachability = "degraded";
  } else if (failingChecks.length > 0) {
    publicReachability = "unreachable";
  }

  const publicReachabilityDetail = publicReachability === "reachable"
    ? "Public endpoint evidence is currently passing."
    : publicReachability === "degraded"
    ? "Some public endpoint evidence is passing, but at least one public check failed."
    : publicReachability === "unreachable"
    ? "Current evidence indicates the public endpoint is unreachable."
    : "No current public endpoint probe or successful ChatGPT MCP discovery is available.";

  const tunnelRuntime: TunnelRuntimeStatus = publicReachability === "reachable" || publicReachability === "degraded"
    ? "active"
    : publicReachability === "unreachable"
    ? "inactive"
    : "unknown";
  const tunnelRuntimeDetail = tunnelRuntime === "active"
    ? "Successful public endpoint evidence is indirect proof that a tunnel path is active."
    : tunnelRuntime === "inactive"
    ? "Public endpoint evidence is failing, so the tunnel path is not currently serving the launcher."
    : "No cloudflared process or successful public endpoint evidence confirms runtime state.";

  const tunnelPersistence: TunnelPersistenceStatus = options.persistenceConfirmed
    ? "confirmed"
    : isDefaultExamplePublicBaseUrl(options.publicBaseUrl)
    ? "not_configured"
    : "not_confirmed";
  const tunnelPersistenceDetail = tunnelPersistence === "confirmed"
    ? "Cloudflare tunnel auto-start persistence is confirmed."
    : tunnelPersistence === "not_configured"
    ? "The public base URL is still the example hostname, so production tunnel persistence is not configured."
    : "The launcher has not confirmed that cloudflared is installed as an auto-starting service after reboot.";

  const overallTunnelReadiness: OverallTunnelReadiness = publicReachability === "unreachable"
    ? "blocked_down"
    : publicReachability === "reachable" && tunnelPersistence === "confirmed"
    ? "ready"
    : publicReachability === "reachable"
    ? "current_ready_persistence_unconfirmed"
    : "unknown";
  const legacyTunnelReadinessStatus: LegacyTunnelReadinessStatus = overallTunnelReadiness === "ready"
    ? "READY"
    : overallTunnelReadiness === "blocked_down"
    ? "NOT_READY"
    : "WARN";

  const overallTunnelReadinessLabel = overallTunnelReadiness === "ready"
    ? "ready"
    : overallTunnelReadiness === "current_ready_persistence_unconfirmed"
    ? "current endpoint reachable; auto-start unconfirmed"
    : overallTunnelReadiness === "blocked_down"
    ? "public endpoint unreachable"
    : "unknown";
  const overallTunnelReadinessDetail = overallTunnelReadiness === "current_ready_persistence_unconfirmed"
    ? "The public endpoint is currently reachable, but the launcher has not confirmed that the tunnel will restart automatically after reboot."
    : overallTunnelReadiness === "blocked_down"
    ? "The current public endpoint evidence is failing; treat this as a current outage until public checks pass."
    : overallTunnelReadiness === "ready"
    ? "The public endpoint is reachable and tunnel persistence is confirmed."
    : "The launcher does not yet have enough evidence to classify public tunnel readiness.";

  return {
    publicReachability,
    publicReachabilityDetail,
    publicReachabilityEvidence: evidence,
    tunnelRuntime,
    tunnelRuntimeDetail,
    tunnelPersistence,
    tunnelPersistenceDetail,
    overallTunnelReadiness,
    overallTunnelReadinessLabel,
    overallTunnelReadinessDetail,
    legacyTunnelReadinessStatus
  };
}

export function getPackagedDeveloperCliProbeCheck(): LauncherDoctorCheckEvidence {
  return {
    name: "Developer CLI entrypoint probe",
    status: "PASS",
    detail: "Skipped in packaged runtime as expected. The packaged app uses the in-process server path; CLI probing is for build-from-source diagnostics."
  };
}

function isDoctorProbeOAuthClient(client: OAuthClient): boolean {
  const haystack = [
    client.client_name,
    client.client_uri,
    ...client.redirect_uris
  ].filter((value): value is string => typeof value === "string").join(" ").toLowerCase();

  return haystack.includes("champcity doctor dcr probe") || haystack.includes("champcity-doctor");
}

function isChatGptOAuthClient(client: OAuthClient): boolean {
  if (isDoctorProbeOAuthClient(client)) {
    return false;
  }

  const haystack = [
    client.client_name,
    client.client_uri,
    ...client.redirect_uris
  ].filter((value): value is string => typeof value === "string").join(" ").toLowerCase();

  return haystack.includes("chatgpt") || haystack.includes("chat.openai.com") || haystack.includes("openai.com");
}

function parsedTime(value: string | undefined): number {
  if (!value) {
    return Number.NaN;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function isSuccessfulOAuthDiscovery(trace: McpDiscoveryTrace | null | undefined): trace is McpDiscoveryTrace {
  return Boolean(
    trace &&
    trace.auth.kind === "oauth" &&
    trace.response.statusCode >= 200 &&
    trace.response.statusCode < 300
  );
}

function hasFilesWriteScope(trace: McpDiscoveryTrace | null | undefined): boolean {
  return Boolean(trace && scopeIncludes(trace.auth.scope, "files.write"));
}

function isFilesWriteDeniedTrace(trace: McpDiscoveryTrace | null | undefined): boolean {
  if (!trace || trace.auth.kind !== "oauth" || scopeIncludes(trace.auth.scope, "files.write")) {
    return false;
  }

  return (
    trace.response.transportRoute === "scope-denied" &&
    /files\.write/u.test(trace.response.error ?? "")
  ) || trace.tools.scopeFilteredTools.some((tool) => /files\.write/u.test(tool.reason));
}

function decorateAuthorizeError(
  error: OAuthAuthorizeErrorDiagnostic,
  clients: OAuthClient[],
  lastDiscoveryTrace?: McpDiscoveryTrace | null
): LauncherAuthorizeErrorDiagnostic {
  const errorAt = parsedTime(error.occurredAt);
  const newerClient = clients
    .filter((client) => parsedTime(client.created_at) > errorAt)
    .sort((a, b) => parsedTime(b.created_at) - parsedTime(a.created_at))[0];
  const newerDiscoveryAt = isSuccessfulOAuthDiscovery(lastDiscoveryTrace) && parsedTime(lastDiscoveryTrace.timestamp) > errorAt
    ? lastDiscoveryTrace.timestamp
    : undefined;
  const newerEvidenceAt = newerDiscoveryAt ?? newerClient?.created_at;
  const staleReason = newerDiscoveryAt
    ? "newer authenticated MCP discovery succeeded"
    : newerClient
    ? `${isDoctorProbeOAuthClient(newerClient) ? "newer doctor DCR probe" : "newer OAuth client registration"} succeeded`
    : undefined;
  const stale = Boolean(newerEvidenceAt);

  return {
    ...error,
    stale,
    staleReason,
    newerEvidenceAt,
    displayLabel: stale
      ? `stale: ${error.error} at ${error.occurredAt}; ${staleReason}`
      : `${error.error} at ${error.occurredAt}`,
    displaySeverity: stale ? "info" : "warn"
  };
}

export function getLauncherOAuthStatus(repoRoot: string, lastDiscoveryTrace?: McpDiscoveryTrace | null): LauncherOAuthStatus {
  const status = getOAuthStatus(repoRoot);
  const clients = readOAuthClientStore(repoRoot).clients;
  const registeredDoctorProbeClientsCount = clients.filter(isDoctorProbeOAuthClient).length;
  const registeredChatGptClientsCount = clients.filter(isChatGptOAuthClient).length;
  const registeredOtherClientsCount = Math.max(0, clients.length - registeredDoctorProbeClientsCount - registeredChatGptClientsCount);

  return {
    ...status,
    registeredChatGptClientsCount,
    registeredDoctorProbeClientsCount,
    registeredOtherClientsCount,
    accessTokenTtlLabel: formatOAuthDuration(status.accessTokenTtlSeconds),
    refreshTokenTtlLabel: formatOAuthDuration(status.refreshTokenTtlSeconds),
    lastAuthorizeError: status.lastAuthorizeError
      ? decorateAuthorizeError(status.lastAuthorizeError, clients, lastDiscoveryTrace)
      : undefined
  };
}

function localWriteReadiness(writeStatus: ReturnType<typeof getWriteAccessStatus>): Pick<
  LauncherWriteAccessStatus,
  "localWriteReadiness" | "localWriteReadinessReason" | "localWriteReadinessSource"
> {
  if (!writeStatus.docsWritesAllowed && !writeStatus.patchWritesAllowed && !writeStatus.elevatedOperationsAllowed) {
    return {
      localWriteReadiness: "blocked",
      localWriteReadinessReason: "Local write mode is off.",
      localWriteReadinessSource: `${writeStatus.writeMode} (${writeStatus.writeModeSource})`
    };
  }

  return {
    localWriteReadiness: "ready",
    localWriteReadinessReason: `Local write mode ${writeStatus.writeMode} allows at least one write class.`,
    localWriteReadinessSource: `${writeStatus.writeMode} (${writeStatus.writeModeSource})`
  };
}

function oauthWriteReadiness(
  oauthStatus: LauncherOAuthStatus,
  lastDiscoveryTrace?: McpDiscoveryTrace | null
): Pick<
  LauncherWriteAccessStatus,
  | "oauthFilesWriteGranted"
  | "oauthWriteReadiness"
  | "oauthWriteReadinessLabel"
  | "oauthWriteReadinessDetail"
  | "oauthWriteReadinessSeverity"
  | "oauthWriteEvidenceAt"
  | "oauthWriteEvidenceSource"
> {
  if (lastDiscoveryTrace?.auth.kind === "oauth" && isFilesWriteDeniedTrace(lastDiscoveryTrace)) {
    return {
      oauthFilesWriteGranted: false,
      oauthWriteReadiness: "not_granted",
      oauthWriteReadinessLabel: "not granted",
      oauthWriteReadinessDetail: "Latest authenticated MCP request evidence is missing files.write.",
      oauthWriteReadinessSeverity: "fail",
      oauthWriteEvidenceAt: lastDiscoveryTrace.timestamp,
      oauthWriteEvidenceSource: "last MCP discovery trace"
    };
  }

  if (isSuccessfulOAuthDiscovery(lastDiscoveryTrace) && hasFilesWriteScope(lastDiscoveryTrace)) {
    return {
      oauthFilesWriteGranted: oauthStatus.activeWriteTokensCount > 0 ? true : "unknown",
      oauthWriteReadiness: "last_observed_granted",
      oauthWriteReadinessLabel: "last observed granted",
      oauthWriteReadinessDetail: "Last authenticated ChatGPT MCP discovery included files.write; the next write request still enforces OAuth per request.",
      oauthWriteReadinessSeverity: "info",
      oauthWriteEvidenceAt: lastDiscoveryTrace.timestamp,
      oauthWriteEvidenceSource: "last MCP discovery trace"
    };
  }

  if (oauthStatus.activeWriteTokensCount > 0) {
    return {
      oauthFilesWriteGranted: true,
      oauthWriteReadiness: "last_observed_granted",
      oauthWriteReadinessLabel: "active stored token has files.write",
      oauthWriteReadinessDetail: "At least one unexpired stored OAuth access token includes files.write; live MCP requests still enforce OAuth per request.",
      oauthWriteReadinessSeverity: "info",
      oauthWriteEvidenceSource: "stored OAuth access-token inventory"
    };
  }

  if (oauthStatus.activeTokensCount > 0) {
    return {
      oauthFilesWriteGranted: false,
      oauthWriteReadiness: "not_granted",
      oauthWriteReadinessLabel: "not granted",
      oauthWriteReadinessDetail: "Active stored OAuth access tokens exist, but none include files.write.",
      oauthWriteReadinessSeverity: "fail",
      oauthWriteEvidenceSource: "stored OAuth access-token inventory"
    };
  }

  if (oauthStatus.lastAuthorizeError?.stale) {
    return {
      oauthFilesWriteGranted: "unknown",
      oauthWriteReadiness: "stale_error",
      oauthWriteReadinessLabel: "unknown - stale OAuth error",
      oauthWriteReadinessDetail: oauthStatus.lastAuthorizeError.displayLabel,
      oauthWriteReadinessSeverity: "warn",
      oauthWriteEvidenceAt: oauthStatus.lastAuthorizeError.newerEvidenceAt,
      oauthWriteEvidenceSource: "stale authorize diagnostic"
    };
  }

  return {
    oauthFilesWriteGranted: "unknown",
    oauthWriteReadiness: "no_active_stored_token",
    oauthWriteReadinessLabel: "unknown - no active stored token",
    oauthWriteReadinessDetail: "No active stored OAuth access token is available; this does not prove files.write is denied.",
    oauthWriteReadinessSeverity: "warn",
    oauthWriteEvidenceSource: "stored OAuth access-token inventory"
  };
}

function overallWriteReadiness(
  local: Pick<LauncherWriteAccessStatus, "localWriteReadiness" | "localWriteReadinessReason">,
  oauth: Pick<LauncherWriteAccessStatus, "oauthWriteReadiness" | "oauthWriteReadinessDetail">
): Pick<LauncherWriteAccessStatus, "overallWriteReadiness" | "overallWriteReadinessReason" | "publicWriteReadiness" | "publicWriteReadinessReason"> {
  if (local.localWriteReadiness === "blocked") {
    return {
      overallWriteReadiness: "blocked",
      overallWriteReadinessReason: local.localWriteReadinessReason,
      publicWriteReadiness: "NOT_READY",
      publicWriteReadinessReason: local.localWriteReadinessReason
    };
  }

  if (oauth.oauthWriteReadiness === "not_granted") {
    return {
      overallWriteReadiness: "blocked",
      overallWriteReadinessReason: oauth.oauthWriteReadinessDetail,
      publicWriteReadiness: "NOT_READY",
      publicWriteReadinessReason: oauth.oauthWriteReadinessDetail
    };
  }

  if (oauth.oauthWriteReadiness === "granted_current_request") {
    return {
      overallWriteReadiness: "ready",
      overallWriteReadinessReason: "Current request has files.write and local write mode allows writes.",
      publicWriteReadiness: "READY",
      publicWriteReadinessReason: "READY"
    };
  }

  return {
    overallWriteReadiness: "unknown",
    overallWriteReadinessReason: oauth.oauthWriteReadinessDetail,
    publicWriteReadiness: "UNKNOWN",
    publicWriteReadinessReason: oauth.oauthWriteReadinessDetail
  };
}

export function getLauncherWriteAccessStatus(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  lastDiscoveryTrace?: McpDiscoveryTrace | null
): LauncherWriteAccessStatus {
  const writeStatus = getWriteAccessStatus(repoRoot, env);
  const oauthStatus = getLauncherOAuthStatus(repoRoot, lastDiscoveryTrace);
  const local = localWriteReadiness(writeStatus);
  const oauth = oauthWriteReadiness(oauthStatus, lastDiscoveryTrace);
  const overall = overallWriteReadiness(local, oauth);

  return {
    ...writeStatus,
    pendingPatchProposalCount: getPendingPatchProposalCount(repoRoot),
    ...local,
    ...oauth,
    ...overall,
    configPath: getWriteAccessConfigPath(repoRoot)
  };
}

function getLegacyFigmaConfigPath(repoRoot: string): string {
  return getRuntimeConfigFilePath(repoRoot, "figma.local.json");
}

function getLegacyFigmaMcpConfigPath(repoRoot: string): string {
  return getRuntimeConfigFilePath(repoRoot, "figma-mcp.local.json");
}

export function getLauncherFigmaStatus(repoRoot: string, _env: NodeJS.ProcessEnv = process.env): LauncherFigmaStatus {
  return {
    configured: false,
    source: "none",
    configPath: getLegacyFigmaConfigPath(repoRoot),
    makeHandoffToolAvailable: false,
    figmaMcp: {
      endpoint: "integration_toolbox",
      mode: "desktop",
      source: "default",
      connectionStatus: "not-tested",
      authStatus: "unknown",
      makeResourceRetrievalAvailable: "unknown",
      configPath: getLegacyFigmaMcpConfigPath(repoRoot),
      governedBrokerOnly: true,
      arbitraryUpstreamMcpPassthrough: false,
      legacyDirectFigmaToolsRemoved: true
    }
  };
}

export function saveLauncherFigmaAccessToken(repoRoot: string, token: string, env: NodeJS.ProcessEnv = process.env): LauncherFigmaStatus {
  void token;
  return getLauncherFigmaStatus(repoRoot, env);
}

export function clearLauncherFigmaAccessToken(repoRoot: string, env: NodeJS.ProcessEnv = process.env): LauncherFigmaStatus {
  return getLauncherFigmaStatus(repoRoot, env);
}

export function parseLauncherFigmaUrl(url: string) {
  void url;
  throw new Error("Legacy direct Figma URL parsing was removed. Future Figma support belongs under integration_toolbox governed broker behavior.");
}

export function setLauncherHttpWriteToolsEnabled(repoRoot: string, enabled: boolean): LauncherWriteAccessStatus {
  setHttpWriteToolsEnabled(repoRoot, enabled);
  return getLauncherWriteAccessStatus(repoRoot);
}

export function setLauncherWriteMode(repoRoot: string, writeMode: WriteMode): LauncherWriteAccessStatus {
  setWriteMode(repoRoot, writeMode);
  return getLauncherWriteAccessStatus(repoRoot);
}

export function clearLauncherPendingPatchProposals(repoRoot: string): LauncherWriteAccessStatus {
  clearPendingPatchProposals(repoRoot);
  return getLauncherWriteAccessStatus(repoRoot);
}

export function saveLauncherWriteApprovalToken(repoRoot: string, token: string): LauncherWriteAccessStatus {
  saveWriteApprovalToken(repoRoot, token);
  return getLauncherWriteAccessStatus(repoRoot);
}

export function clearLauncherWriteApprovalToken(repoRoot: string): LauncherWriteAccessStatus {
  clearWriteApprovalToken(repoRoot);
  return getLauncherWriteAccessStatus(repoRoot);
}

export function generateLauncherWriteApprovalToken(): string {
  return generateWriteApprovalToken();
}

export function configureOAuthAdminPassword(repoRoot: string, password: string): LauncherOAuthStatus {
  saveOAuthAdminPassword(repoRoot, password);
  return getLauncherOAuthStatus(repoRoot);
}

export function resetLauncherOAuthClients(repoRoot: string): LauncherOAuthStatus {
  resetOAuthClients(repoRoot);
  return getLauncherOAuthStatus(repoRoot);
}

export function revokeLauncherOAuthTokens(repoRoot: string): LauncherOAuthStatus {
  revokeAllOAuthTokens(repoRoot);
  return getLauncherOAuthStatus(repoRoot);
}

export function revokeLauncherChatGptOAuthTokens(repoRoot: string): LauncherOAuthStatus {
  revokeChatGptOAuthTokens(repoRoot);
  return getLauncherOAuthStatus(repoRoot);
}

export function clearLauncherExpiredOAuthTokens(repoRoot: string): LauncherOAuthStatus {
  clearExpiredOAuthTokens(repoRoot);
  return getLauncherOAuthStatus(repoRoot);
}

export function createOAuthMetadataPreview(): string {
  return JSON.stringify(createAuthorizationServerMetadata(getPublicOAuthIssuer()), null, 2);
}

export function createProtectedResourceMetadataPreview(): string {
  return JSON.stringify(createProtectedResourceMetadata(getPublicOAuthIssuer()), null, 2);
}

export function createChatGptSetupNotes(repoRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  const localConfig = readLocalConfig(repoRoot);
  const authStatus = getLauncherHttpAuthStatus(repoRoot, env);
  const oauthStatus = getLauncherOAuthStatus(repoRoot);
  const writeAccessStatus = getLauncherWriteAccessStatus(repoRoot, env);
  const unauthLocalAllowed = isUnauthenticatedLocalHttpAllowed(env);
  const writeMode = writeAccessStatus.writeMode;
  const localTunnelPrerequisitesReady = isPublicTunnelReady(repoRoot, env);
  const publicOAuthIssuer = getPublicOAuthIssuer();
  const publicMcpEndpoint = getPublicMcpEndpoint();
  const publicAuthorizationMetadata = getPublicOAuthAuthorizationServerMetadata();
  const publicProtectedResourceMetadata = getPublicOAuthProtectedResourceMetadata();
  const publicRegistrationEndpoint = getPublicOAuthRegistrationEndpoint();
  const publicHealthEndpoint = getPublicHealthEndpoint();

  return `# ChampCity GPT ChatGPT Setup Notes

## Endpoints

- Local MCP endpoint: ${LOCAL_HTTP_MCP_ENDPOINT}
- Local health endpoint: ${LOCAL_HTTP_HEALTH_ENDPOINT}
- MCP Server URL: ${publicMcpEndpoint}
- Public issuer: ${publicOAuthIssuer}
- CHAMPCITY_GPT_PUBLIC_BASE_URL for ChatGPT mode: ${publicOAuthIssuer}
- OAuth authorization server metadata: ${publicAuthorizationMetadata}
- OAuth protected resource metadata: ${publicProtectedResourceMetadata}
- OAuth Dynamic Client Registration endpoint: ${publicRegistrationEndpoint}
- Intended public health endpoint: ${publicHealthEndpoint}

## Authentication

- Authentication: OAuth
- ChatGPT.com custom MCP apps use OAuth. Static bearer tokens were useful for manual testing, but they are not sufficient for ChatGPT's OAuth connector flow.
- Dynamic client registration endpoint: ${publicOAuthIssuer}/oauth/register
- Authorization endpoint: ${publicOAuthIssuer}/oauth/authorize
- Token endpoint: ${publicOAuthIssuer}/oauth/token
- OAuth store paths: not included in generated ChatGPT setup notes.
- Access token TTL: ${formatOAuthDuration(getOAuthAccessTokenTtlSeconds(env))} (${getOAuthAccessTokenTtlSeconds(env)} seconds)
- Refresh token TTL: ${formatOAuthDuration(getOAuthRefreshTokenTtlSeconds(env))} (${getOAuthRefreshTokenTtlSeconds(env)} seconds)
- Refresh tokens keep ChatGPT connected between short-lived access-token renewals and are stored only as local hashes.
- Refresh sessions can be revoked from the launcher.
- During ChatGPT setup, approve only files.read first.
- Do not use unauthenticated mode.
- Do not paste tokens into ChatGPT manually unless the UI requests OAuth setup through the browser flow.
- Legacy/manual bearer auth configured: ${authStatus.configured ? "yes" : "no"} (${authStatus.source}); temporary local/manual fallback only, not the normal public ChatGPT connector path.
- Bearer token value: not displayed or written by the launcher.

## Security State

- OAuth admin password configured: ${oauthStatus.adminPasswordConfigured ? "yes" : "no"}
- Registered OAuth clients: ${oauthStatus.registeredClientsCount} total; ${oauthStatus.registeredChatGptClientsCount} ChatGPT-like; ${oauthStatus.registeredDoctorProbeClientsCount} doctor probe; ${oauthStatus.registeredOtherClientsCount} other
- Dynamic Client Registration advertised: ${oauthStatus.dynamicClientRegistrationEnabled ? "yes" : "no"}
- Registration endpoint path: ${oauthStatus.registrationEndpointPath}
- OAuth client registry path: not included in generated notes.
- Active OAuth tokens: ${oauthStatus.activeTokensCount}
- Active OAuth write tokens: ${oauthStatus.activeWriteTokensCount}
- Active OAuth clients: ${oauthStatus.activeOAuthClientsCount}
- Active refresh sessions: ${oauthStatus.activeRefreshSessionsCount}
- Expired OAuth sessions: ${oauthStatus.expiredSessionsCount}
- Revoked OAuth sessions: ${oauthStatus.revokedSessionsCount}
- OAuth required for public /mcp: yes
- Unauthenticated local HTTP allowed: ${unauthLocalAllowed ? "yes" : "no"}
- Public tunnel local prerequisites: ${localTunnelPrerequisitesReady ? "ready" : "incomplete"}
- Cloudflare tunnel auto-start persistence: not confirmed by generated notes
- ${oauthStatus.adminPasswordConfigured ? "OAuth admin password is configured, but not displayed or written by the launcher." : `Not ready for ${publicOAuthIssuer} tunnel until OAuth admin password is configured.`}
- ${unauthLocalAllowed ? "Local unauthenticated mode is not safe for tunneling." : "Unauthenticated local mode is disabled."}
- Write mode: ${writeMode} (${writeAccessStatus.writeModeSource})
- Docs writes: ${writeAccessStatus.docsWritesAllowed ? "allowed" : "blocked"}
- Patch writes: ${writeAccessStatus.patchWritesAllowed ? "allowed" : "blocked"}
- Elevated operations: ${writeAccessStatus.elevatedOperationsAllowed ? "allowed" : "blocked"}
- Pending patch proposals: ${writeAccessStatus.pendingPatchProposalCount}
- Elevated approval token configured: ${writeAccessStatus.legacyApprovalTokenConfigured ? "yes" : "no"}
- Elevated approval token source: ${writeAccessStatus.legacyApprovalTokenSource}
- Elevated approval token value: not displayed or written by the launcher.
- OAuth files.write readiness: ${writeAccessStatus.oauthWriteReadinessLabel}
- OAuth files.write readiness detail: ${writeAccessStatus.oauthWriteReadinessDetail}
- Overall write readiness: ${writeAccessStatus.overallWriteReadiness} - ${writeAccessStatus.overallWriteReadinessReason}
- In Architect Docs mode, ChatGPT can create Markdown planning artifacts without approvalToken.
- Markdown artifact writes do not require approvalToken in docs, patch, or elevated mode.
- In Controlled Patch mode, ChatGPT must use repo_toolbox.propose_patch first, then repo_toolbox.apply_approved_patch with the matching proposal.
- Elevated operations may still require a local elevated approval token.
- Elevated approval is still required for scripts and elevated fallback operations.
- Write mode off for first ChatGPT test: ${writeMode === "off" ? "yes" : "no - set off before first test"}
- Write mode defaults to off: yes
- Audit log path: not included in generated notes.
- Require git root: ${localConfig.requireGitRoot ? "yes" : "no"}
- Legacy direct Figma tools removed: yes
- Figma broker status: ${getLauncherFigmaStatus(repoRoot, env).figmaMcp.connectionStatus}
- Figma arbitrary upstream MCP passthrough: no

## Scope Mapping

- files.read: tools/list and the seven public toolbox tools: repo_toolbox, git_toolbox, artifact_toolbox, diagnostics_toolbox, integration_toolbox, browser_toolbox, and knowledge_toolbox.
- files.write: required inside toolbox actions that write, including repo_toolbox.write_markdown_artifact, repo_toolbox.write_json_artifact, repo_toolbox.propose_patch, repo_toolbox.apply_approved_patch, integration_toolbox.prepare_external_handoff, and git_toolbox write actions.
- repo_toolbox.write_markdown_artifact and repo_toolbox.write_json_artifact require writeMode docs, patch, or elevated.
- repo_toolbox.apply_approved_patch requires writeMode patch or elevated and a matching pending proposal unless elevated approval is supplied in elevated mode.
- run_allowed_script is not exposed publicly.

## DNS / Tunnel Checklist

- Cloudflare setup guide: docs/CLOUDFLARE_TUNNEL_SETUP.md
- ${new URL(publicOAuthIssuer).hostname} routes to the Cloudflare Tunnel hostname.
- Cloudflare Tunnel service target is http://127.0.0.1:3333.
- Local endpoint stays ${LOCAL_HTTP_MCP_ENDPOINT}; do not bind to 0.0.0.0.
- Public endpoint for ChatGPT registration: ${publicMcpEndpoint}
- Do not tunnel unauthenticated local mode.
- Keep the local server bound to ${LOCAL_HTTP_HOST}.
- Verify metadata in a browser before ChatGPT registration:
  - ${publicProtectedResourceMetadata}
  - ${publicAuthorizationMetadata}

## Allowed Roots

- Allowed root count: ${localConfig.allowedRoots.length}
- Local allowed-root paths are not included in generated ChatGPT setup notes.

## ChatGPT Setup Checklist

1. Configure allowed roots narrowly.
2. Configure the OAuth admin password in the desktop app.
3. Confirm ${LOCAL_HTTP_HEALTH_ENDPOINT} returns status ok.
4. Confirm OAuth metadata endpoints load through ${publicOAuthIssuer}.
5. Configure Cloudflare Tunnel and DNS for ${new URL(publicOAuthIssuer).hostname}.
6. Run .\\scripts\\tunnel-readiness.ps1.
7. In ChatGPT, use Settings -> Connectors -> Create if available.
8. Register ${publicMcpEndpoint}, not the local STDIO command.
9. Approve the OAuth browser flow with files.read first.
10. Keep CHAMPCITY_GPT_WRITE_MODE=off until read-only is validated.
11. Use docs for Markdown planning docs, patch for proposed code patches, and elevated only for rare approval-gated script operations.
`;
}

export function createClientConfigPreviews(repoRoot: string): GeneratedClientConfigs {
  const serverConfig = configObject(repoRoot);
  const generic = JSON.stringify({ mcpServers: { "champcity-gpt": serverConfig } }, null, 2);
  const codex = JSON.stringify({ mcpServers: { "champcity-gpt": serverConfig } }, null, 2);
  const claude = JSON.stringify({ mcpServers: { "champcity-gpt": serverConfig } }, null, 2);
  const chatgptNotes = createChatGptSetupNotes(repoRoot);

  return {
    generic,
    codex,
    claude,
    chatgptNotes
  };
}

export function writeClientConfigFiles(repoRoot: string): GeneratedClientConfigFiles {
  const generatedDir = getGeneratedDir(repoRoot);
  const previews = createClientConfigPreviews(repoRoot);
  const files = {
    "generic-stdio-mcp-config.example.json": previews.generic,
    "codex-mcp-config.example.json": previews.codex,
    "claude-desktop-mcp-config.example.json": previews.claude,
    "chatgpt-connection-notes.md": previews.chatgptNotes,
    "chatgpt-champcity-net-setup.md": previews.chatgptNotes
  };

  fs.mkdirSync(generatedDir, { recursive: true });
  for (const [fileName, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(generatedDir, fileName), `${content.trimEnd()}\n`, "utf8");
  }

  return {
    directory: generatedDir,
    files,
    previews
  };
}

function normalizeCommandName(command: string): string {
  const baseName = path.win32.basename(command).toLowerCase();
  return baseName.endsWith(".cmd") || baseName.endsWith(".exe") ? baseName.replace(/\.(cmd|exe)$/u, "") : baseName;
}

export function isAllowedLauncherCommand(command: string, args: readonly string[], repoRoot: string): boolean {
  const normalizedCommand = normalizeCommandName(command);
  const normalizedArgs = [...args];
  const entrypoint = getEntrypointPath(repoRoot);

  if (normalizedCommand === "npm") {
    return (
      normalizedArgs.length === 1 && normalizedArgs[0] === "--version"
    ) || (
      normalizedArgs.length === 1 && normalizedArgs[0] === "install"
    ) || (
      normalizedArgs.length === 2 && normalizedArgs[0] === "run" && normalizedArgs[1] === "build"
    ) || (
      normalizedArgs.length === 1 && normalizedArgs[0] === "test"
    );
  }

  if (normalizedCommand === "node") {
    return isAllowedNodeEntrypointArgs(normalizedArgs, repoRoot);
  }

  return false;
}

function isAllowedNodeEntrypointArgs(normalizedArgs: string[], repoRoot: string): boolean {
    const httpArgs = [
      getEntrypointPath(repoRoot),
      "--transport",
      "http",
      "--host",
      LOCAL_HTTP_HOST,
      "--port",
      String(LOCAL_HTTP_PORT)
    ];
  const entrypoint = getEntrypointPath(repoRoot);

  return (
    normalizedArgs.length === 1 && normalizedArgs[0] === "--version"
  ) || (
    normalizedArgs.length === 1 && path.resolve(repoRoot, normalizedArgs[0]) === entrypoint
  ) || (
    normalizedArgs.length === httpArgs.length &&
    normalizedArgs.every((arg, index) => (index === 0 ? path.resolve(repoRoot, arg) === httpArgs[index] : arg === httpArgs[index]))
  );
}

export function assertAllowedLauncherCommand(command: string, args: readonly string[], repoRoot: string): void {
  if (!isAllowedLauncherCommand(command, args, repoRoot)) {
    throw new Error(`Refusing to run non-allowlisted launcher command: ${command} ${args.join(" ")}`);
  }
}

export function findStaleEntrypointReferences(repoRoot: string): string[] {
  const staleReferences: string[] = [];
  const rootsToScan = ["README.md", "docs", "examples", "package.json"];
  const staleNeedles = ["dist/index.js", "dist\\index.js"];

  function scanFile(filePath: string): void {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/u);
    lines.forEach((line, index) => {
      if (line.includes("old top-level")) {
        return;
      }

      for (const needle of staleNeedles) {
        if (line.includes(needle)) {
          staleReferences.push(`${filePath}:${index + 1}`);
          break;
        }
      }
    });
  }

  function walk(target: string): void {
    if (!fs.existsSync(target)) {
      return;
    }

    const stats = fs.statSync(target);
    if (stats.isFile()) {
      scanFile(target);
      return;
    }

    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }

      const child = path.join(target, entry.name);
      if (entry.isDirectory()) {
        walk(child);
      } else if (/\.(json|md|ts|html|css)$/iu.test(entry.name)) {
        scanFile(child);
      }
    }
  }

  for (const root of rootsToScan) {
    walk(path.join(repoRoot, root));
  }

  return staleReferences;
}
