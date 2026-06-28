import type {
  BadgeStatus,
  DiagnosticIssue,
  DoctorCheck as LauncherDoctorCheck,
  LauncherState,
  LogEntry,
  McpTool,
  ServerState,
  WriteMode
} from "./launcher/launcherTypes.js";
import { safeHostname } from "./launcher/displayHelpers.js";

type ChampCityApi = Window["champcity"];
type AppStatus = Awaited<ReturnType<ChampCityApi["getAppStatus"]>>;
type ReadConfigResult = Awaited<ReturnType<ChampCityApi["readLocalConfig"]>>;

export type LocalLauncherConfig = ReadConfigResult["config"];

const EMPTY_ENDPOINT = "--";

export const DEFAULT_ALLOWED_COMMANDS = [
  "npm test",
  "npm run lint",
  "npm run typecheck",
  "npm run build",
  "git status",
  "git diff"
] as const;

export function createEmptyLauncherState(logs: LogEntry[] = []): LauncherState {
  return {
    server: {
      state: "unknown",
      localEndpoint: EMPTY_ENDPOINT,
      healthEndpoint: EMPTY_ENDPOINT,
      publicEndpoint: EMPTY_ENDPOINT,
      publicHealthEndpoint: EMPTY_ENDPOINT
    },
    oauth: {
      issuer: EMPTY_ENDPOINT,
      adminConfigured: false,
      registeredClients: 0,
      registeredChatGptClients: 0,
      registeredDoctorProbeClients: 0,
      registeredOtherClients: 0,
      activeTokens: 0,
      unauthLocalEnabled: false,
      pkceEnabled: true,
      filesWriteGranted: "unknown",
      dcrEnabled: false,
      writeMode: "unknown",
      mcpEndpoint: EMPTY_ENDPOINT,
      oauthMetadata: EMPTY_ENDPOINT,
      registrationEndpoint: EMPTY_ENDPOINT,
      tunnelReadiness: "unknown",
      clientRegistry: EMPTY_ENDPOINT
    },
    oauthSession: {
      activeClients: 0,
      activeRefreshSessions: 0,
      expiredSessions: 0,
      revokedSessions: 0,
      accessTokenTtl: EMPTY_ENDPOINT,
      refreshTokenTtl: EMPTY_ENDPOINT
    },
    tunnel: {
      readiness: "unknown",
      publicDomain: EMPTY_ENDPOINT,
      autoRestartConfirmed: false,
      publicReachability: "unknown",
      publicReachabilityDetail: "Public endpoint reachability has not loaded.",
      publicReachabilityEvidence: [],
      runtime: "unknown",
      runtimeDetail: "Tunnel runtime status has not loaded.",
      persistence: "unknown",
      persistenceDetail: "Tunnel persistence status has not loaded.",
      overallReadiness: "unknown",
      overallReadinessLabel: "unknown",
      overallReadinessDetail: "Tunnel readiness has not loaded."
    },
    write: {
      mode: "off",
      docsAllowed: false,
      patchAllowed: false,
      elevatedAllowed: false,
      pendingPatches: 0,
      tokenConfigured: false,
      oauthFilesWriteGranted: "unknown",
      readiness: "unknown",
      localReadiness: "unknown",
      localReadinessReason: "Local write readiness has not loaded.",
      localReadinessSource: "unknown",
      oauthWriteReadiness: "unknown",
      oauthWriteReadinessLabel: "unknown",
      oauthWriteReadinessDetail: "OAuth files.write readiness has not loaded.",
      oauthWriteReadinessSeverity: "unknown",
      oauthWriteEvidenceSource: "unknown",
      overallReadiness: "unknown",
      overallReadinessReason: "Write readiness has not loaded."
    },
    logs,
    tools: [],
    issues: [],
    doctorChecks: [],
    discovery: {},
    roots: [],
    runtime: {},
    figma: {
      tokenConfigured: false
    },
    requireGitRoot: true,
    auditLogPath: EMPTY_ENDPOINT,
    allowedCommands: "",
    generatedNotes: {}
  };
}

export function adaptLauncherState(
  status: AppStatus | null,
  localConfig: LocalLauncherConfig | null,
  logs: LogEntry[],
  serverStateOverride?: ServerState | null
): LauncherState {
  if (!status) {
    return createEmptyLauncherState(logs);
  }

  const serverState = serverStateOverride ?? mapServerState(status.diagnosticStatus.state);
  const oauthFilesWriteGranted = status.writeAccess.oauthFilesWriteGranted;
  const generatedPreviews = status.generatedPreviews ?? {};

  return {
    server: {
      state: serverState,
      pid: status.diagnosticStatus.pid ?? undefined,
      localEndpoint: status.http.localEndpoint || EMPTY_ENDPOINT,
      healthEndpoint: status.http.localHealthEndpoint || EMPTY_ENDPOINT,
      publicEndpoint: status.http.publicEndpoint || EMPTY_ENDPOINT,
      publicHealthEndpoint: status.http.publicHealthEndpoint || EMPTY_ENDPOINT
    },
    oauth: {
      issuer: status.http.oauthIssuer || EMPTY_ENDPOINT,
      adminConfigured: status.http.oauthAdminPasswordConfigured,
      registeredClients: status.http.oauthRegisteredClientsCount,
      registeredChatGptClients: status.http.oauthRegisteredChatGptClientsCount,
      registeredDoctorProbeClients: status.http.oauthRegisteredDoctorProbeClientsCount,
      registeredOtherClients: status.http.oauthRegisteredOtherClientsCount,
      activeTokens: status.http.oauthActiveTokensCount,
      unauthLocalEnabled: status.http.unauthenticatedLocalHttpAllowed,
      pkceEnabled: true,
      filesWriteGranted: oauthFilesWriteGranted,
      dcrEnabled: status.http.oauthDynamicClientRegistrationEnabled,
      writeMode: status.writeAccess.writeMode,
      mcpEndpoint: status.http.publicEndpoint || EMPTY_ENDPOINT,
      oauthMetadata: status.http.oauthAuthorizationServerMetadata || EMPTY_ENDPOINT,
      registrationEndpoint: status.http.oauthRegistrationEndpoint || EMPTY_ENDPOINT,
      tunnelReadiness: status.http.tunnelReadinessStatus,
      clientRegistry: status.http.oauthClientRegistryPath || EMPTY_ENDPOINT,
      lastAuthorizeError: status.http.oauthLastAuthorizeError?.displayLabel ?? status.http.oauthLastAuthorizeError?.error,
      lastAuthorizeErrorStale: status.http.oauthLastAuthorizeError?.stale,
      pkceMethodReceived: status.http.oauthLastAuthorizeError?.codeChallengeMethod,
      internalTools: joinList(status.http.internalToolNames),
      exposedTools: joinList(status.http.exposedToolNames)
    },
    oauthSession: {
      activeClients: status.http.oauthActiveClientsCount,
      activeRefreshSessions: status.http.oauthActiveRefreshSessionsCount,
      expiredSessions: status.http.oauthExpiredSessionsCount,
      revokedSessions: status.http.oauthRevokedSessionsCount,
      accessTokenTtl: status.http.oauthAccessTokenTtlLabel,
      refreshTokenTtl: status.http.oauthRefreshTokenTtlLabel
    },
    tunnel: {
      readiness: mapTunnelReadiness(status.http.publicTunnelDiagnostics.overallTunnelReadiness),
      publicDomain: safeHostname(status.http.publicEndpoint),
      autoRestartConfirmed: status.http.publicTunnelDiagnostics.tunnelPersistence === "confirmed",
      publicReachability: status.http.publicTunnelDiagnostics.publicReachability,
      publicReachabilityDetail: status.http.publicTunnelDiagnostics.publicReachabilityDetail,
      publicReachabilityEvidence: status.http.publicTunnelDiagnostics.publicReachabilityEvidence,
      runtime: status.http.publicTunnelDiagnostics.tunnelRuntime,
      runtimeDetail: status.http.publicTunnelDiagnostics.tunnelRuntimeDetail,
      persistence: status.http.publicTunnelDiagnostics.tunnelPersistence,
      persistenceDetail: status.http.publicTunnelDiagnostics.tunnelPersistenceDetail,
      overallReadiness: status.http.publicTunnelDiagnostics.overallTunnelReadiness,
      overallReadinessLabel: status.http.publicTunnelDiagnostics.overallTunnelReadinessLabel,
      overallReadinessDetail: status.http.publicTunnelDiagnostics.overallTunnelReadinessDetail
    },
    write: {
      mode: mapWriteMode(status.writeAccess.writeMode),
      docsAllowed: status.writeAccess.docsWritesAllowed,
      patchAllowed: status.writeAccess.patchWritesAllowed,
      elevatedAllowed: status.writeAccess.elevatedOperationsAllowed,
      pendingPatches: status.writeAccess.pendingPatchProposalCount,
      tokenConfigured: status.writeAccess.legacyApprovalTokenConfigured,
      tokenSource: status.writeAccess.legacyApprovalTokenSource,
      oauthFilesWriteGranted,
      readiness: mapOverallReadiness(status.writeAccess.overallWriteReadiness),
      localReadiness: status.writeAccess.localWriteReadiness,
      localReadinessReason: status.writeAccess.localWriteReadinessReason,
      localReadinessSource: status.writeAccess.localWriteReadinessSource,
      oauthWriteReadiness: status.writeAccess.oauthWriteReadiness,
      oauthWriteReadinessLabel: status.writeAccess.oauthWriteReadinessLabel,
      oauthWriteReadinessDetail: status.writeAccess.oauthWriteReadinessDetail,
      oauthWriteReadinessSeverity: mapReadinessSeverity(status.writeAccess.oauthWriteReadinessSeverity),
      oauthWriteEvidenceAt: status.writeAccess.oauthWriteEvidenceAt,
      oauthWriteEvidenceSource: status.writeAccess.oauthWriteEvidenceSource,
      overallReadiness: status.writeAccess.overallWriteReadiness,
      overallReadinessReason: status.writeAccess.overallWriteReadinessReason,
      configPath: status.writeAccess.configPath
    },
    logs,
    tools: mapTools(status),
    issues: mapIssues(status),
    doctorChecks: mapDoctorChecks(status),
    discovery: mapDiscovery(status),
    roots: (localConfig?.allowedRoots ?? []).map((path) => ({ path })),
    runtime: {
      mode: status.runtime.mode,
      configDir: status.runtime.configDir,
      logsDir: status.runtime.logsDir,
      generatedDir: status.runtime.generatedDir,
      serverRuntime: status.runtime.serverRuntime,
      serverEntrypoint: status.runtime.serverEntrypoint,
      nodeVersion: status.runtime.nodeExecutable,
      appVersion: status.setup.appVersion
    },
    figma: {
      tokenConfigured: status.figma.configured,
      tokenSource: status.figma.source,
      configPath: status.figma.configPath,
      makeToolStatus: status.figma.makeHandoffToolAvailable ? "available" : "unavailable",
      mcpEndpoint: status.figma.figmaMcp.endpoint,
      mcpMode: status.figma.figmaMcp.mode,
      mcpConnection: status.figma.figmaMcp.connectionStatus,
      mcpAuth: status.figma.figmaMcp.authStatus,
      makeAvailability: status.figma.figmaMcp.makeResourceRetrievalAvailable,
      lastParsedNode: "None"
    },
    requireGitRoot: localConfig?.requireGitRoot ?? true,
    auditLogPath: localConfig?.auditLog ?? EMPTY_ENDPOINT,
    allowedCommands: (localConfig?.allowedCommands ?? []).join("\n"),
    generatedNotes: {
      chatgpt: generatedPreviews.chatgptNotes ?? generatedPreviews.chatgpt,
      generic: generatedPreviews.generic,
      codex: generatedPreviews.codex,
      claude: generatedPreviews.claude
    }
  };
}

function mapServerState(state: AppStatus["diagnosticStatus"]["state"]): ServerState {
  if (state === "running" || state === "stopped") {
    return state;
  }

  return state === "stale" ? "unknown" : "unknown";
}

function mapWriteMode(mode: string): WriteMode {
  return mode === "docs" || mode === "patch" || mode === "elevated" ? mode : "off";
}

function mapTunnelReadiness(status: AppStatus["http"]["publicTunnelDiagnostics"]["overallTunnelReadiness"]): BadgeStatus {
  if (status === "ready") {
    return "pass";
  }

  if (status === "current_ready_persistence_unconfirmed" || status === "unknown") {
    return "warn";
  }

  if (status === "blocked_down") {
    return "fail";
  }

  return "unknown";
}

function mapOverallReadiness(status: AppStatus["writeAccess"]["overallWriteReadiness"]): BadgeStatus {
  if (status === "ready") {
    return "pass";
  }

  if (status === "blocked") {
    return "fail";
  }

  return "warn";
}

function mapReadinessSeverity(status: AppStatus["writeAccess"]["oauthWriteReadinessSeverity"]): BadgeStatus {
  if (status === "pass" || status === "warn" || status === "fail" || status === "info" || status === "unknown") {
    return status;
  }

  return "unknown";
}

function mapDoctorChecks(status: AppStatus): LauncherDoctorCheck[] {
  return (status.lastDoctorResult?.checks ?? []).map((check) => ({
    label: check.name,
    status: check.status === "PASS" ? "pass" : check.status === "WARN" ? "warn" : "fail",
    detail: check.detail
  }));
}

function mapDiscovery(status: AppStatus): LauncherState["discovery"] {
  const trace = status.http.lastMcpDiscoveryTrace;
  if (!trace) {
    return {};
  }

  return {
    timestamp: trace.timestamp,
    requestPath: trace.request.path,
    jsonRpcMethods: joinList(trace.jsonRpc.methods),
    authSubject: trace.auth.subject,
    oauthScopes: joinList(trace.auth.scopes),
    toolCounts: [
      `registered ${trace.tools.countBeforeFiltering}`,
      `schema ${trace.tools.countAfterMcpSchemaValidation}`,
      `scope ${trace.tools.countAfterScopeFiltering}`,
      `returned ${trace.tools.finalToolCountReturned}`
    ].join(" / "),
    finalTools: joinList(trace.tools.finalToolNamesReturned),
    filteredTools: joinDiagnostics(trace.tools.scopeFilteredTools),
    schemaNotes: joinDiagnostics([...trace.tools.invalidToolSchemas, ...trace.tools.invalidChatGptToolSchemas]),
    response: `${trace.response.statusCode} ${trace.response.kind}`,
    transportRoute: trace.response.transportRoute,
    recentMethods: joinList(trace.recentDiscoverySequence.methodsObserved)
  };
}

function mapTools(status: AppStatus): McpTool[] {
  const invalid = new Map(status.http.invalidToolSchemas.map((tool) => [tool.name, tool.reason]));
  const filtered = new Map(status.http.scopeFilteredTools.map((tool) => [tool.name, tool.reason]));
  const exposed = new Set(status.http.exposedToolNames);
  const names = new Set([
    ...status.http.internalToolNames,
    ...status.http.exposedToolNames,
    ...status.http.invalidToolSchemas.map((tool) => tool.name),
    ...status.http.scopeFilteredTools.map((tool) => tool.name)
  ]);

  return [...names].sort((a, b) => a.localeCompare(b)).map((name) => {
    const invalidReason = invalid.get(name);
    const filteredReason = filtered.get(name);
    const isExposed = exposed.has(name);
    return {
      name,
      description: invalidReason
        ? `Invalid schema: ${invalidReason}`
        : filteredReason
        ? `Filtered from current ChatGPT exposure: ${filteredReason}`
        : isExposed
        ? "Exposed by the current MCP tool diagnostics."
        : "Registered internally; not currently exposed by the latest diagnostics.",
      status: invalidReason ? "error" : isExposed ? "active" : "inactive",
      tested: false,
      errorNote: invalidReason ?? undefined
    };
  });
}

function mapIssues(status: AppStatus): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [];

  if (status.firstRunRequired) {
    issues.push({
      id: "first-run-required",
      severity: "warn",
      title: "First-run setup is incomplete",
      what: "The launcher reports that setup is not complete.",
      detected: `setup.complete=${status.setup.complete}`,
      fix: "Review Settings and save the required local configuration.",
      actionLabel: "Open Settings",
      actionScreen: "settings"
    });
  }

  if (!status.http.oauthAdminPasswordConfigured) {
    issues.push({
      id: "oauth-admin-missing",
      severity: "error",
      title: "OAuth admin password is not configured",
      what: "ChatGPT OAuth authorization cannot be approved without the local admin password.",
      detected: "oauthAdminPasswordConfigured=false",
      fix: "Configure the OAuth admin password from the Connection screen.",
      actionLabel: "Open Connection",
      actionScreen: "connection"
    });
  }

  if (status.http.unauthenticatedLocalHttpAllowed) {
    issues.push({
      id: "unauth-local-enabled",
      severity: "warn",
      title: "Unauthenticated local HTTP mode is enabled",
      what: "This mode is for local testing only and must not be exposed through a public tunnel.",
      detected: "unauthenticatedLocalHttpAllowed=true",
      fix: "Disable local unauthenticated mode before tunnel testing.",
      actionLabel: "Open Connection",
      actionScreen: "connection"
    });
  }

  const tunnel = status.http.publicTunnelDiagnostics;
  if (tunnel.overallTunnelReadiness === "blocked_down") {
    issues.push({
      id: "public-endpoint-unreachable",
      severity: "error",
      title: "Public endpoint is unreachable",
      what: "Current public endpoint evidence is failing, so ChatGPT may not be able to reach the MCP server.",
      detected: `publicReachability=${tunnel.publicReachability}; ${tunnel.publicReachabilityDetail}`,
      fix: "Start the local server, run Doctor, and review Cloudflare tunnel routing until public endpoint checks pass.",
      actionLabel: "Open Cloudflare guide"
    });
  } else if (tunnel.overallTunnelReadiness === "current_ready_persistence_unconfirmed") {
    issues.push({
      id: "tunnel-persistence-unconfirmed",
      severity: "warn",
      title: "Cloudflare tunnel auto-start is not confirmed",
      what: "The public endpoint is currently reachable, but the launcher has not confirmed that the tunnel will restart automatically after reboot.",
      detected: `publicReachability=${tunnel.publicReachability}; tunnelPersistence=${tunnel.tunnelPersistence}`,
      fix: "Confirm cloudflared is installed as an auto-starting service or review the Cloudflare guide.",
      actionLabel: "Open Cloudflare guide"
    });
  } else if (tunnel.publicReachability === "degraded" || tunnel.publicReachability === "unknown") {
    issues.push({
      id: "public-endpoint-reachability-unknown",
      severity: "warn",
      title: tunnel.publicReachability === "degraded" ? "Public endpoint evidence is degraded" : "Public endpoint reachability is unknown",
      what: tunnel.publicReachabilityDetail,
      detected: `publicReachability=${tunnel.publicReachability}`,
      fix: "Run Doctor to refresh public metadata, protected-resource, DCR, and ChatGPT MCP discovery evidence.",
      actionLabel: "Open Cloudflare guide"
    });
  }

  if (status.writeAccess.oauthWriteReadiness === "not_granted") {
    issues.push({
      id: "files-write-not-granted",
      severity: "error",
      title: "OAuth files.write is not granted",
      what: "The latest OAuth evidence shows files.write is missing, so write tools will be rejected for that caller.",
      detected: `oauthWriteReadiness=${status.writeAccess.oauthWriteReadiness}; ${status.writeAccess.oauthWriteReadinessDetail}`,
      fix: "Reconnect ChatGPT with the files.write scope after write mode is configured.",
      actionLabel: "Open MCP Tools",
      actionScreen: "tools"
    });
  } else if (
    status.writeAccess.oauthWriteReadiness === "unknown" ||
    status.writeAccess.oauthWriteReadiness === "stale_error" ||
    status.writeAccess.oauthWriteReadiness === "no_active_stored_token"
  ) {
    issues.push({
      id: "files-write-unknown",
      severity: "warn",
      title: "OAuth files.write readiness is unknown",
      what: "No current request evidence proves files.write is granted or denied. Stored token inventory is separate from live ChatGPT authorization.",
      detected: `oauthWriteReadiness=${status.writeAccess.oauthWriteReadiness}; ${status.writeAccess.oauthWriteReadinessDetail}`,
      fix: "Reconnect ChatGPT or make a fresh ChatGPT MCP request, then review the Last MCP Discovery trace.",
      actionLabel: "Open Troubleshoot",
      actionScreen: "troubleshoot"
    });
  }

  if (status.http.invalidToolSchemas.length > 0) {
    issues.push({
      id: "invalid-tool-schemas",
      severity: "error",
      title: "One or more MCP tools have invalid schemas",
      what: "Invalid schemas prevent affected tools from being exposed correctly.",
      detected: joinDiagnostics(status.http.invalidToolSchemas),
      fix: "Run Doctor and inspect the MCP Tools screen.",
      actionLabel: "Open MCP Tools",
      actionScreen: "tools"
    });
  }

  if (status.http.internalRegisteredToolCount > 0 && status.http.exposedToolNames.length === 0) {
    issues.push({
      id: "zero-exposed-tools",
      severity: "error",
      title: "No tools are exposed to ChatGPT",
      what: "The launcher has internal tools, but the current exposure diagnostics returned zero tools.",
      detected: `internal=${status.http.internalRegisteredToolCount}; exposed=0`,
      fix: "Check OAuth scopes and schema diagnostics.",
      actionLabel: "Open Troubleshoot",
      actionScreen: "troubleshoot"
    });
  }

  return issues;
}

function joinList(values: string[] | undefined, fallback = "none"): string {
  return values && values.length > 0 ? values.join(", ") : fallback;
}

function joinDiagnostics(values: Array<{ name: string; reason: string }>, fallback = "none"): string {
  return values.length > 0 ? values.map((value) => `${value.name}: ${value.reason}`).join("; ") : fallback;
}
