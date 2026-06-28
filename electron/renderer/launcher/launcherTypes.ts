// launcherTypes.ts
// All runtime data types for the ChampCity MCP Launcher UI.
// Wire these props from your Electron preload/IPC layer to replace preview data.

export type ServerState = "running" | "stopped" | "starting" | "stopping" | "error" | "unknown";
export type WriteMode = "off" | "docs" | "patch" | "elevated";
export type Screen = "dashboard" | "connection" | "logs" | "tools" | "troubleshoot" | "settings";
export type BadgeStatus = "pass" | "warn" | "fail" | "running" | "stopped" | "unknown" | "info";
export type IssueSeverity = "error" | "warn" | "info";
export type LogLevel = "info" | "warn" | "error" | "debug";
export type ReadinessState = "ready" | "blocked" | "unknown";
export type PublicReachabilityStatus = "reachable" | "unreachable" | "unknown" | "degraded";
export type TunnelRuntimeStatus = "active" | "inactive" | "unknown";
export type TunnelPersistenceStatus = "confirmed" | "not_confirmed" | "unknown" | "not_configured";
export type OverallTunnelReadiness =
  | "ready"
  | "current_ready_persistence_unconfirmed"
  | "blocked_down"
  | "unknown";
export type OAuthWriteReadiness =
  | "granted_current_request"
  | "last_observed_granted"
  | "not_granted"
  | "unknown"
  | "stale_error"
  | "no_active_stored_token";

export interface ServerStatus {
  state: ServerState;
  pid?: number;
  localEndpoint: string;
  healthEndpoint: string;
  publicEndpoint: string;
  publicHealthEndpoint: string;
}

export interface OAuthStatus {
  issuer: string;
  adminConfigured: boolean;
  registeredClients: number;
  registeredChatGptClients: number;
  registeredDoctorProbeClients: number;
  registeredOtherClients: number;
  activeTokens: number;
  unauthLocalEnabled: boolean;
  pkceEnabled: boolean;
  filesWriteGranted: boolean | "unknown";
  dcrEnabled: boolean;
  writeMode: string;
  mcpEndpoint: string;
  oauthMetadata: string;
  registrationEndpoint: string;
  tunnelReadiness: string;
  clientRegistry: string;
  lastAuthorizeError?: string;
  pkceMethodReceived?: string;
  internalTools?: string;
  exposedTools?: string;
  lastAuthorizeErrorStale?: boolean;
}

export interface OAuthSession {
  activeClients: number;
  activeRefreshSessions: number;
  expiredSessions: number;
  revokedSessions: number;
  accessTokenTtl: string;
  refreshTokenTtl: string;
}

export interface TunnelStatus {
  readiness: BadgeStatus;
  publicDomain: string;
  autoRestartConfirmed: boolean;
  publicReachability: PublicReachabilityStatus;
  publicReachabilityDetail: string;
  publicReachabilityEvidence: string[];
  runtime: TunnelRuntimeStatus;
  runtimeDetail: string;
  persistence: TunnelPersistenceStatus;
  persistenceDetail: string;
  overallReadiness: OverallTunnelReadiness;
  overallReadinessLabel: string;
  overallReadinessDetail: string;
}

export interface WriteStatus {
  mode: WriteMode;
  docsAllowed: boolean;
  patchAllowed: boolean;
  elevatedAllowed: boolean;
  pendingPatches: number;
  tokenConfigured: boolean;
  tokenSource?: string;
  oauthFilesWriteGranted: boolean | "unknown";
  readiness: BadgeStatus;
  localReadiness: ReadinessState;
  localReadinessReason: string;
  localReadinessSource: string;
  oauthWriteReadiness: OAuthWriteReadiness;
  oauthWriteReadinessLabel: string;
  oauthWriteReadinessDetail: string;
  oauthWriteReadinessSeverity: BadgeStatus;
  oauthWriteEvidenceAt?: string;
  oauthWriteEvidenceSource: string;
  overallReadiness: ReadinessState;
  overallReadinessReason: string;
  configPath?: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
}

export interface McpTool {
  name: string;
  description: string;
  status: "active" | "inactive" | "error";
  tested: boolean;
  errorNote?: string;
}

export interface DiagnosticIssue {
  id: string;
  severity: IssueSeverity;
  title: string;
  what: string;
  detected: string;
  fix: string;
  actionLabel?: string;
  actionScreen?: Screen;
}

export interface DoctorCheck {
  label: string;
  status: BadgeStatus;
  detail?: string;
}

export interface McpDiscovery {
  timestamp?: string;
  requestPath?: string;
  jsonRpcMethods?: string;
  authSubject?: string;
  oauthScopes?: string;
  toolCounts?: string;
  finalTools?: string;
  filteredTools?: string;
  schemaNotes?: string;
  response?: string;
  transportRoute?: string;
  recentMethods?: string;
}

export interface AllowedRoot {
  path: string;
}

export interface RuntimeInfo {
  mode?: string;
  configDir?: string;
  logsDir?: string;
  generatedDir?: string;
  serverRuntime?: string;
  serverEntrypoint?: string;
  nodeVersion?: string;
  appVersion?: string;
}

export interface FigmaStatus {
  tokenConfigured: boolean;
  tokenSource?: string;
  configPath?: string;
  makeToolStatus?: string;
  mcpEndpoint?: string;
  mcpMode?: string;
  mcpConnection?: string;
  mcpAuth?: string;
  makeAvailability?: string;
  lastParsedNode?: string;
}

export interface GeneratedNotes {
  chatgpt?: string;
  generic?: string;
  codex?: string;
  claude?: string;
}

export interface LauncherState {
  server: ServerStatus;
  oauth: OAuthStatus;
  oauthSession: OAuthSession;
  tunnel: TunnelStatus;
  write: WriteStatus;
  logs: LogEntry[];
  tools: McpTool[];
  issues: DiagnosticIssue[];
  doctorChecks: DoctorCheck[];
  discovery: McpDiscovery;
  roots: AllowedRoot[];
  runtime: RuntimeInfo;
  figma: FigmaStatus;
  requireGitRoot: boolean;
  auditLogPath: string;
  allowedCommands: string;
  generatedNotes: GeneratedNotes;
}

export interface LauncherHandlers {
  onStartServer?: () => void;
  onStopServer?: () => void;
  onRestartServer?: () => void;
  onOpenHealth?: () => void;
  onCopyText?: (text: string) => void;
  onRunDoctor?: () => void;
  onClearLogs?: () => void;
  onCopyLogs?: () => void;
  onExportLogs?: () => void;
  onOpenAuthModal?: () => void;
  onOpenOAuthModal?: () => void;
  onOpenWriteTokenModal?: () => void;
  onSetWriteMode?: (mode: WriteMode) => void;
  onClearPendingPatchProposals?: () => void;
  onResetOAuthClients?: () => void;
  onRevokeOAuthTokens?: () => void;
  onRevokeAllSessions?: () => void;
  onClearExpiredSessions?: () => void;
  onAddRoot?: () => void;
  onRemoveRoot?: (path: string) => void;
  onSaveConfig?: () => void;
  onResetRoots?: () => void;
  onSaveRequireGitRoot?: (value: boolean) => void;
  onSaveAuditLogPath?: (value: string) => void;
  onSaveAllowedCommands?: (value: string) => void;
  onOpenSetupWizard?: () => void;
  onGenerateNotes?: () => void;
  onOpenCloudflareGuide?: () => void;
  onOpenChatGptGuide?: () => void;
  onValidateTools?: () => void;
  onSaveFigmaToken?: (token: string) => void;
  onClearFigmaToken?: () => void;
  onTestFigmaConnection?: () => void;
  onOpenAuditLog?: () => void;
  onOpenLogsFolder?: () => void;
  onOpenGeneratedFolder?: () => void;
  onCopyGenericConfig?: () => void;
  onOpenDocs?: () => void;
  onResetSetupWizard?: () => void;
}
