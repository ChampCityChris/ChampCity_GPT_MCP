interface LocalLauncherConfig {
  allowedRoots: string[];
  requireGitRoot: boolean;
  auditLog: string;
  allowedCommands: string[];
}

interface DoctorCheck {
  name: string;
  status: "PASS" | "WARN" | "FAIL";
  detail: string;
}

interface DoctorResult {
  status: "PASS" | "WARN" | "FAIL";
  checks: DoctorCheck[];
  output: string;
  completedAt: string;
}

interface AppStatus {
  appName: string;
  repoRoot: string;
  runtime: {
    mode: "development" | "installed" | "portable";
    configDir: string;
    logsDir: string;
    generatedDir: string;
    resourceRoot: string;
    serverEntrypoint: string;
  };
  entrypoint: string;
  configPath: string;
  configExists: boolean;
  configStatus: string;
  setup: {
    setupComplete: boolean;
    complete: boolean;
    path: string;
    completedAt?: string;
    appVersion?: string;
    publicBaseUrl?: string;
    localOnly?: boolean;
    cloudflareChoice?: "guide" | "skip";
  };
  firstRunRequired: boolean;
  buildExists: boolean;
  diagnosticStatus: {
    state: string;
    pid: number | null;
    detail: string;
  };
  lastDoctorResult: DoctorResult | null;
  generatedPreviews: Record<string, string>;
  http: {
    localEndpoint: string;
    localHealthEndpoint: string;
    publicEndpoint: string;
    publicHealthEndpoint: string;
    oauthIssuer: string;
    oauthAuthorizationServerMetadata: string;
    oauthProtectedResourceMetadata: string;
    oauthAdminPasswordConfigured: boolean;
    oauthRegisteredClientsCount: number;
    oauthActiveClientsCount: number;
    oauthActiveTokensCount: number;
    oauthActiveWriteTokensCount: number;
    oauthActiveRefreshSessionsCount: number;
    oauthExpiredSessionsCount: number;
    oauthRevokedSessionsCount: number;
    oauthAccessTokenTtlSeconds: number;
    oauthRefreshTokenTtlSeconds: number;
    oauthAccessTokenTtlLabel: string;
    oauthRefreshTokenTtlLabel: string;
    oauthLastAuthorizeError?: {
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
    };
    authTokenConfigured: boolean;
    authTokenSource: "env" | "local-file" | "none";
    unauthenticatedLocalHttpAllowed: boolean;
    writeToolsEnabled: boolean;
    localHealthPassing: boolean;
    tunnelReadinessStatus: "READY" | "NOT_READY" | "WARN";
    publicTunnelReady: boolean;
  };
  writeAccess: {
    configPath: string;
    writeMode: "off" | "docs" | "patch" | "elevated";
    writeModeSource: "env" | "local-file" | "legacy-env" | "default";
    docsWritesAllowed: boolean;
    patchWritesAllowed: boolean;
    elevatedOperationsAllowed: boolean;
    legacyApprovalTokenConfigured: boolean;
    legacyApprovalTokenSource: "env" | "local-file" | "none";
    legacyApprovalTokenCreatedAt?: string;
    legacyApprovalTokenUpdatedAt?: string;
    pendingPatchProposalCount: number;
    oauthFilesWriteGranted: boolean;
    publicWriteReadiness: "READY" | "NOT_READY";
    publicWriteReadinessReason: string;
  };
}

interface ReadConfigResult {
  path: string;
  exists: boolean;
  config: LocalLauncherConfig;
}

interface SaveConfigResult {
  ok: boolean;
  requiresConfirmation?: boolean;
  warnings?: string[];
  outsideProjectsRoots?: string[];
  path?: string;
  config?: LocalLauncherConfig;
}

interface OperationResult {
  ok: boolean;
  output: string;
}

interface SetupSaveResult {
  ok: boolean;
  requiresConfirmation?: boolean;
  broadRoots?: string[];
  path?: string;
  setup?: AppStatus["setup"];
  config?: LocalLauncherConfig;
  warnings?: string[];
}

interface HttpAuthStatus {
  configured: boolean;
  source: "env" | "local-file" | "none";
}

interface HttpAuthOperationResult extends OperationResult {
  status: HttpAuthStatus;
}

type WriteAccessStatus = AppStatus["writeAccess"];

interface WriteAccessOperationResult extends OperationResult {
  status: WriteAccessStatus;
}

declare global {
  interface Window {
    champcity: {
      getAppStatus: () => Promise<AppStatus>;
      saveInitialSetup: (payload: {
        allowedRoots: string[];
        confirmedBroadRoots?: boolean;
        oauthAdminPassword: string;
        localOnly: boolean;
        publicBaseUrl?: string;
        cloudflareChoice: "guide" | "skip";
        writeMode: "off" | "docs" | "patch" | "elevated";
      }) => Promise<SetupSaveResult>;
      resetSetupWizard: () => Promise<OperationResult>;
      runDoctor: () => Promise<DoctorResult>;
      installDependencies: () => Promise<OperationResult>;
      buildMcpServer: () => Promise<OperationResult>;
      readLocalConfig: () => Promise<ReadConfigResult>;
      saveLocalConfig: (config: LocalLauncherConfig, confirmedOutsideProjects?: boolean) => Promise<SaveConfigResult>;
      selectFolder: () => Promise<string | null>;
      generateClientConfigs: () => Promise<{ directory: string; previews: Record<string, string> }>;
      configureOAuthAdminPassword: (password: string) => Promise<OperationResult>;
      resetOAuthClients: () => Promise<OperationResult>;
      revokeAllOAuthTokens: () => Promise<OperationResult>;
      revokeChatGptOAuthTokens: () => Promise<OperationResult>;
      clearExpiredOAuthTokens: () => Promise<OperationResult>;
      openOAuthMetadata: () => Promise<string>;
      openProtectedResourceMetadata: () => Promise<string>;
      getOAuthMetadataPreview: () => Promise<string>;
      getProtectedResourceMetadataPreview: () => Promise<string>;
      copyGenericConfig: () => Promise<OperationResult>;
      openGeneratedFolder: () => Promise<string>;
      openAuditLog: () => Promise<string>;
      openLogsFolder: () => Promise<string>;
      openDocs: () => Promise<string>;
      openChatGptGuide: () => Promise<string>;
      openDomainGuide: () => Promise<string>;
      openCloudflareGuide: () => Promise<string>;
      openCloudflareDashboard: () => Promise<string>;
      openCloudflaredConfigTemplate: () => Promise<string>;
      runTunnelReadinessCheck: () => Promise<OperationResult>;
      openLocalHealthCheck: () => Promise<string>;
      copyLocalMcpEndpoint: () => Promise<OperationResult>;
      copyPublicMcpEndpoint: () => Promise<OperationResult>;
      copyPublicHealthEndpoint: () => Promise<OperationResult>;
      setHttpWriteToolsEnabled: (enabled: boolean) => Promise<OperationResult>;
      setWriteMode: (writeMode: "off" | "docs" | "patch" | "elevated") => Promise<WriteAccessOperationResult>;
      clearPendingPatchProposals: () => Promise<WriteAccessOperationResult>;
      getWriteAccessStatus: () => Promise<WriteAccessStatus>;
      saveWriteApprovalToken: (token: string) => Promise<WriteAccessOperationResult>;
      clearWriteApprovalToken: () => Promise<WriteAccessOperationResult>;
      generateWriteApprovalToken: () => Promise<{ ok: boolean; token: string }>;
      copyTemporaryWriteToken: (token: string) => Promise<OperationResult>;
      getHttpAuthStatus: () => Promise<HttpAuthStatus>;
      saveHttpAuthToken: (token: string) => Promise<HttpAuthOperationResult>;
      clearHttpAuthToken: () => Promise<HttpAuthOperationResult>;
      generateHttpAuthToken: () => Promise<{ ok: boolean; token: string }>;
      setUnauthenticatedLocalHttpAllowed: (enabled: boolean) => Promise<OperationResult>;
      startDiagnosticServer: () => Promise<OperationResult>;
      stopDiagnosticServer: () => Promise<OperationResult>;
      getDiagnosticServerStatus: () => Promise<AppStatus["diagnosticStatus"]>;
      onLog: (callback: (line: string) => void) => () => void;
    };
  }
}

const serverStatus = document.querySelector<HTMLSpanElement>("#serverStatus")!;
const localHttpEndpoint = document.querySelector<HTMLSpanElement>("#localHttpEndpoint")!;
const localHealthEndpoint = document.querySelector<HTMLSpanElement>("#localHealthEndpoint")!;
const publicMcpEndpoint = document.querySelector<HTMLSpanElement>("#publicMcpEndpoint")!;
const publicHealthEndpoint = document.querySelector<HTMLSpanElement>("#publicHealthEndpoint")!;
const oauthIssuer = document.querySelector<HTMLSpanElement>("#oauthIssuer")!;
const oauthAdminStatus = document.querySelector<HTMLSpanElement>("#oauthAdminStatus")!;
const oauthClientsStatus = document.querySelector<HTMLSpanElement>("#oauthClientsStatus")!;
const oauthTokensStatus = document.querySelector<HTMLSpanElement>("#oauthTokensStatus")!;
const oauthIssuerInline = document.querySelector<HTMLSpanElement>("#oauthIssuerInline")!;
const oauthMcpEndpointInline = document.querySelector<HTMLSpanElement>("#oauthMcpEndpointInline")!;
const oauthWriteToolsInline = document.querySelector<HTMLSpanElement>("#oauthWriteToolsInline")!;
const oauthFilesWriteInline = document.querySelector<HTMLSpanElement>("#oauthFilesWriteInline")!;
const oauthTunnelInline = document.querySelector<HTMLSpanElement>("#oauthTunnelInline")!;
const oauthDcrRegisteredInline = document.querySelector<HTMLSpanElement>("#oauthDcrRegisteredInline")!;
const oauthLastAuthorizeErrorInline = document.querySelector<HTMLSpanElement>("#oauthLastAuthorizeErrorInline")!;
const oauthPkceReceivedInline = document.querySelector<HTMLSpanElement>("#oauthPkceReceivedInline")!;
const oauthPkceMethodInline = document.querySelector<HTMLSpanElement>("#oauthPkceMethodInline")!;
const oauthActiveClientsInline = document.querySelector<HTMLSpanElement>("#oauthActiveClientsInline")!;
const oauthRefreshSessionsInline = document.querySelector<HTMLSpanElement>("#oauthRefreshSessionsInline")!;
const oauthExpiredSessionsInline = document.querySelector<HTMLSpanElement>("#oauthExpiredSessionsInline")!;
const oauthRevokedSessionsInline = document.querySelector<HTMLSpanElement>("#oauthRevokedSessionsInline")!;
const oauthAccessTtlInline = document.querySelector<HTMLSpanElement>("#oauthAccessTtlInline")!;
const oauthRefreshTtlInline = document.querySelector<HTMLSpanElement>("#oauthRefreshTtlInline")!;
const cloudflarePublicMcpEndpoint = document.querySelector<HTMLSpanElement>("#cloudflarePublicMcpEndpoint")!;
const cloudflarePublicHealthEndpoint = document.querySelector<HTMLSpanElement>("#cloudflarePublicHealthEndpoint")!;
const authTokenStatus = document.querySelector<HTMLSpanElement>("#authTokenStatus")!;
const unauthLocalStatus = document.querySelector<HTMLSpanElement>("#unauthLocalStatus")!;
const publicTunnelStatus = document.querySelector<HTMLSpanElement>("#publicTunnelStatus")!;
const localHealthStatus = document.querySelector<HTMLSpanElement>("#localHealthStatus")!;
const writeToolsStatus = document.querySelector<HTMLSpanElement>("#writeToolsStatus")!;
const writeApprovalTokenStatus = document.querySelector<HTMLSpanElement>("#writeApprovalTokenStatus")!;
const writeReadinessStatus = document.querySelector<HTMLSpanElement>("#writeReadinessStatus")!;
const runtimeModeStatus = document.querySelector<HTMLSpanElement>("#runtimeModeStatus")!;
const runtimeConfigDirStatus = document.querySelector<HTMLSpanElement>("#runtimeConfigDirStatus")!;
const writeAccessToolsEnabled = document.querySelector<HTMLSpanElement>("#writeAccessToolsEnabled")!;
const writeAccessDocsAllowed = document.querySelector<HTMLSpanElement>("#writeAccessDocsAllowed")!;
const writeAccessPatchAllowed = document.querySelector<HTMLSpanElement>("#writeAccessPatchAllowed")!;
const writeAccessElevatedAllowed = document.querySelector<HTMLSpanElement>("#writeAccessElevatedAllowed")!;
const writeAccessPendingPatches = document.querySelector<HTMLSpanElement>("#writeAccessPendingPatches")!;
const writeAccessTokenConfigured = document.querySelector<HTMLSpanElement>("#writeAccessTokenConfigured")!;
const writeAccessTokenSource = document.querySelector<HTMLSpanElement>("#writeAccessTokenSource")!;
const writeAccessOAuthGranted = document.querySelector<HTMLSpanElement>("#writeAccessOAuthGranted")!;
const writeAccessReadiness = document.querySelector<HTMLSpanElement>("#writeAccessReadiness")!;
const writeAccessConfigPath = document.querySelector<HTMLSpanElement>("#writeAccessConfigPath")!;
const checklistMeta = document.querySelector<HTMLSpanElement>("#checklistMeta")!;
const checklist = document.querySelector<HTMLDivElement>("#checklist")!;
const rootsList = document.querySelector<HTMLDivElement>("#rootsList")!;
const requireGitRoot = document.querySelector<HTMLInputElement>("#requireGitRoot")!;
const auditLog = document.querySelector<HTMLInputElement>("#auditLog")!;
const allowedCommands = document.querySelector<HTMLTextAreaElement>("#allowedCommands")!;
const rootWarnings = document.querySelector<HTMLDivElement>("#rootWarnings")!;
const configPath = document.querySelector<HTMLSpanElement>("#configPath")!;
const configPreview = document.querySelector<HTMLPreElement>("#configPreview")!;
const outputLog = document.querySelector<HTMLPreElement>("#outputLog")!;
const authModal = document.querySelector<HTMLDivElement>("#authModal")!;
const authModalStatus = document.querySelector<HTMLSpanElement>("#authModalStatus")!;
const authTokenInput = document.querySelector<HTMLInputElement>("#authTokenInput")!;
const toggleAuthTokenVisibility = document.querySelector<HTMLButtonElement>("#toggleAuthTokenVisibility")!;
const generateAuthToken = document.querySelector<HTMLButtonElement>("#generateAuthToken")!;
const saveAuthToken = document.querySelector<HTMLButtonElement>("#saveAuthToken")!;
const clearAuthToken = document.querySelector<HTMLButtonElement>("#clearAuthToken")!;
const cancelAuthToken = document.querySelector<HTMLButtonElement>("#cancelAuthToken")!;
const writeTokenModal = document.querySelector<HTMLDivElement>("#writeTokenModal")!;
const writeTokenInput = document.querySelector<HTMLInputElement>("#writeTokenInput")!;
const writeTokenModalStatus = document.querySelector<HTMLSpanElement>("#writeTokenModalStatus")!;
const toggleWriteTokenVisibility = document.querySelector<HTMLButtonElement>("#toggleWriteTokenVisibility")!;
const generateWriteTokenInModal = document.querySelector<HTMLButtonElement>("#generateWriteTokenInModal")!;
const copyTemporaryWriteToken = document.querySelector<HTMLButtonElement>("#copyTemporaryWriteToken")!;
const saveWriteToken = document.querySelector<HTMLButtonElement>("#saveWriteToken")!;
const cancelWriteToken = document.querySelector<HTMLButtonElement>("#cancelWriteToken")!;
const oauthModal = document.querySelector<HTMLDivElement>("#oauthModal")!;
const oauthPasswordInput = document.querySelector<HTMLInputElement>("#oauthPasswordInput")!;
const oauthPasswordConfirmInput = document.querySelector<HTMLInputElement>("#oauthPasswordConfirmInput")!;
const oauthModalStatus = document.querySelector<HTMLSpanElement>("#oauthModalStatus")!;
const saveOAuthPassword = document.querySelector<HTMLButtonElement>("#saveOAuthPassword")!;
const cancelOAuthPassword = document.querySelector<HTMLButtonElement>("#cancelOAuthPassword")!;
const setupWizard = document.querySelector<HTMLDivElement>("#setupWizard")!;
const setupProgress = document.querySelector<HTMLSpanElement>("#setupProgress")!;
const setupRuntimeMode = document.querySelector<HTMLSpanElement>("#setupRuntimeMode")!;
const setupConfigDir = document.querySelector<HTMLSpanElement>("#setupConfigDir")!;
const setupLogsDir = document.querySelector<HTMLSpanElement>("#setupLogsDir")!;
const setupGeneratedDir = document.querySelector<HTMLSpanElement>("#setupGeneratedDir")!;
const setupServerEntrypoint = document.querySelector<HTMLSpanElement>("#setupServerEntrypoint")!;
const setupRootsList = document.querySelector<HTMLDivElement>("#setupRootsList")!;
const setupAddRoot = document.querySelector<HTMLButtonElement>("#setupAddRoot")!;
const setupAddExampleRoot = document.querySelector<HTMLButtonElement>("#setupAddExampleRoot")!;
const setupConfirmBroadRoots = document.querySelector<HTMLInputElement>("#setupConfirmBroadRoots")!;
const setupRootWarnings = document.querySelector<HTMLDivElement>("#setupRootWarnings")!;
const setupOAuthPassword = document.querySelector<HTMLInputElement>("#setupOAuthPassword")!;
const setupOAuthPasswordConfirm = document.querySelector<HTMLInputElement>("#setupOAuthPasswordConfirm")!;
const setupLocalOnly = document.querySelector<HTMLInputElement>("#setupLocalOnly")!;
const setupPublicEndpoint = document.querySelector<HTMLInputElement>("#setupPublicEndpoint")!;
const setupPublicBaseUrl = document.querySelector<HTMLInputElement>("#setupPublicBaseUrl")!;
const setupTunnelEndpoint = document.querySelector<HTMLElement>("#setupTunnelEndpoint")!;
const setupCloudflareGuide = document.querySelector<HTMLInputElement>("#setupCloudflareGuide")!;
const setupOpenCloudflareGuide = document.querySelector<HTMLButtonElement>("#setupOpenCloudflareGuide")!;
const setupWriteMode = document.querySelector<HTMLSelectElement>("#setupWriteMode")!;
const setupSummary = document.querySelector<HTMLDivElement>("#setupSummary")!;
const setupStatus = document.querySelector<HTMLParagraphElement>("#setupStatus")!;
const setupBack = document.querySelector<HTMLButtonElement>("#setupBack")!;
const setupNext = document.querySelector<HTMLButtonElement>("#setupNext")!;
const setupFinish = document.querySelector<HTMLButtonElement>("#setupFinish")!;
const resetSetupWizardButton = document.querySelector<HTMLButtonElement>("#resetSetupWizard")!;

let localConfig: LocalLauncherConfig | null = null;
let previews: Record<string, string> = {};
let activePreview = "chatgptNotes";
let currentStatus: AppStatus | null = null;
let setupStep = 0;
let setupRoots: string[] = [];

function getProjectsRootLabel(): string {
  const repoRoot = currentStatus?.repoRoot;
  if (!repoRoot) {
    return "<PROJECTS_ROOT>";
  }

  const separatorIndex = Math.max(repoRoot.lastIndexOf("\\"), repoRoot.lastIndexOf("/"));
  return separatorIndex > 0 ? repoRoot.slice(0, separatorIndex) : repoRoot;
}

function setBusy(button: HTMLButtonElement, busy: boolean): void {
  button.disabled = busy;
  button.classList.toggle("busy", busy);
}

function appendLog(message: string): void {
  outputLog.textContent = `${outputLog.textContent}${message}\n`;
  outputLog.scrollTop = outputLog.scrollHeight;
}

function setStatusClass(element: HTMLElement, status: string): void {
  element.classList.remove("pass", "warn", "fail", "running", "stopped");
  element.classList.add(status.toLowerCase());
}

function renderChecklist(checks: DoctorCheck[] | null): void {
  const fallbackChecks: DoctorCheck[] = [
    { name: "Node.js installed", status: "WARN", detail: "Run doctor to verify." },
    { name: "npm installed", status: "WARN", detail: "Run doctor to verify." },
    { name: "package.json found", status: "WARN", detail: "Run doctor to verify." },
    { name: "Project dependencies installed", status: "WARN", detail: "Run doctor to verify." },
    { name: "MCP server built", status: "WARN", detail: "Run doctor to verify." },
    { name: "config/allowed-roots.local.json exists", status: "WARN", detail: "Run doctor to verify." },
    { name: "allowed roots exist", status: "WARN", detail: "Run doctor to verify." },
    { name: "logs folder exists", status: "WARN", detail: "Run doctor to verify." },
    { name: "stale dist/index.js references absent", status: "WARN", detail: "Run doctor to verify." },
    { name: "MCP entrypoint can start without module-not-found", status: "WARN", detail: "Run doctor to verify." }
  ];

  checklist.replaceChildren();
  for (const check of checks ?? fallbackChecks) {
    const row = document.createElement("div");
    row.className = "check-row";
    const badge = document.createElement("span");
    badge.className = `badge ${check.status.toLowerCase()}`;
    badge.textContent = check.status;
    const content = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = check.name;
    const detail = document.createElement("p");
    detail.textContent = check.detail;
    content.append(title, detail);
    row.append(badge, content);
    checklist.append(row);
  }
}

function renderRoots(): void {
  if (!localConfig) {
    return;
  }

  rootsList.replaceChildren();
  localConfig.allowedRoots.forEach((root, index) => {
    const row = document.createElement("div");
    row.className = "root-row";
    const input = document.createElement("input");
    input.type = "text";
    input.value = root;
    input.addEventListener("input", () => {
      if (localConfig) {
        localConfig.allowedRoots[index] = input.value;
      }
      renderWarnings();
    });
    const remove = document.createElement("button");
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      if (!localConfig) {
        return;
      }
      localConfig.allowedRoots.splice(index, 1);
      renderRoots();
      renderWarnings();
    });
    row.append(input, remove);
    rootsList.append(row);
  });

  requireGitRoot.checked = localConfig.requireGitRoot;
  auditLog.value = localConfig.auditLog;
  allowedCommands.value = localConfig.allowedCommands.join("\n");
  renderWarnings();
}

function isBroadSetupRoot(root: string): boolean {
  const normalized = root.trim().replace(/\//gu, "\\").replace(/\\+$/u, "").toLowerCase();
  if (!normalized) {
    return false;
  }

  return /^[a-z]:$/iu.test(normalized) || /\\users\\[^\\]+$/iu.test(normalized) || /\\users\\[^\\]+\\(desktop|documents)$/iu.test(normalized);
}

function renderSetupRoots(): void {
  setupRootsList.replaceChildren();
  setupRoots.forEach((root, index) => {
    const row = document.createElement("div");
    row.className = "root-row";
    const input = document.createElement("input");
    input.type = "text";
    input.value = root;
    input.addEventListener("input", () => {
      setupRoots[index] = input.value;
      renderSetupWarnings();
      renderSetupSummary();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      setupRoots.splice(index, 1);
      renderSetupRoots();
      renderSetupSummary();
    });
    row.append(input, remove);
    setupRootsList.append(row);
  });
  renderSetupWarnings();
}

function renderSetupWarnings(messages: string[] = []): void {
  const broadRoots = setupRoots.filter(isBroadSetupRoot);
  const warnings = [
    ...broadRoots.map((root) => `WARN Broad allowed root requires confirmation: ${root}`),
    ...messages
  ];
  setupRootWarnings.replaceChildren();
  for (const warning of warnings) {
    const item = document.createElement("p");
    item.textContent = warning;
    setupRootWarnings.append(item);
  }
}

function getSetupPublicBaseUrl(): string {
  return setupPublicBaseUrl.value.trim().replace(/\/+$/u, "");
}

function updateSetupTunnelEndpoint(): void {
  const baseUrl = setupPublicEndpoint.checked ? getSetupPublicBaseUrl() || "https://mcp.example.com" : "local-only";
  setupTunnelEndpoint.textContent = baseUrl === "local-only" ? "local-only; no public /mcp endpoint" : `${baseUrl}/mcp`;
}

function validateCurrentSetupStep(): boolean {
  setupStatus.textContent = "";
  if (setupStep === 2) {
    const roots = setupRoots.map((root) => root.trim()).filter(Boolean);
    if (roots.length === 0) {
      setupStatus.textContent = "Add at least one allowed root.";
      return false;
    }
    if (roots.some(isBroadSetupRoot) && !setupConfirmBroadRoots.checked) {
      setupStatus.textContent = "Confirm broad allowed roots before continuing.";
      return false;
    }
  }

  if (setupStep === 3) {
    if (setupOAuthPassword.value.length < 12) {
      setupStatus.textContent = "Use at least 12 characters for the OAuth admin password.";
      return false;
    }
    if (setupOAuthPassword.value !== setupOAuthPasswordConfirm.value) {
      setupStatus.textContent = "OAuth admin passwords do not match.";
      return false;
    }
  }

  if (setupStep === 4 && setupPublicEndpoint.checked) {
    try {
      const parsed = new URL(getSetupPublicBaseUrl());
      if (parsed.protocol !== "https:") {
        setupStatus.textContent = "Use an HTTPS public base URL.";
        return false;
      }
    } catch {
      setupStatus.textContent = "Enter a valid public base URL.";
      return false;
    }
  }

  return true;
}

function renderSetupSummary(): void {
  updateSetupTunnelEndpoint();
  setupSummary.replaceChildren();
  const rows = [
    ["Allowed roots", String(setupRoots.map((root) => root.trim()).filter(Boolean).length)],
    ["Public endpoint", setupPublicEndpoint.checked ? getSetupPublicBaseUrl() || "https://mcp.example.com" : "local-only"],
    ["OAuth admin configured", setupOAuthPassword.value.length >= 12 && setupOAuthPassword.value === setupOAuthPasswordConfirm.value ? "yes" : "not yet"],
    ["Write mode", setupWriteMode.value],
    ["Config directory", currentStatus?.runtime.configDir ?? "Loading..."]
  ];
  for (const [label, value] of rows) {
    const row = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = `${label}: `;
    row.append(strong, document.createTextNode(value));
    setupSummary.append(row);
  }
}

function renderSetupStep(): void {
  document.querySelectorAll<HTMLElement>(".setup-step").forEach((step) => {
    step.classList.toggle("hidden", step.dataset.step !== String(setupStep));
  });
  setupProgress.textContent = `Step ${setupStep + 1} of 8`;
  setupBack.disabled = setupStep === 0;
  setupNext.classList.toggle("hidden", setupStep === 7);
  setupFinish.classList.toggle("hidden", setupStep !== 7);
  renderSetupSummary();
}

function maybeShowSetupWizard(status: AppStatus): void {
  setupRuntimeMode.textContent = status.runtime.mode;
  setupConfigDir.textContent = status.runtime.configDir;
  setupLogsDir.textContent = status.runtime.logsDir;
  setupGeneratedDir.textContent = status.runtime.generatedDir;
  setupServerEntrypoint.textContent = status.runtime.serverEntrypoint;
  if (setupRoots.length === 0) {
    setupRoots = status.configExists ? [...(localConfig?.allowedRoots ?? [])] : [];
  }
  renderSetupRoots();
  setupWizard.classList.toggle("hidden", !status.firstRunRequired);
  renderSetupStep();
}

function renderWarnings(messages: string[] = []): void {
  if (!localConfig) {
    rootWarnings.textContent = "";
    return;
  }

  const projectsRoot = getProjectsRootLabel();
  const normalizedProjectsRoot = projectsRoot.toLowerCase();
  const localWarnings = localConfig.allowedRoots
    .filter((root) => root && projectsRoot !== "<PROJECTS_ROOT>" && !root.toLowerCase().startsWith(normalizedProjectsRoot))
    .map((root) => `WARN Allowed root is outside ${projectsRoot}: ${root}`);
  const allWarnings = [...localWarnings, ...messages];
  rootWarnings.replaceChildren();
  for (const warning of allWarnings) {
    const item = document.createElement("p");
    item.textContent = warning;
    rootWarnings.append(item);
  }
}

function syncConfigFromInputs(): LocalLauncherConfig {
  if (!localConfig) {
    throw new Error("Config has not loaded yet.");
  }

  localConfig.requireGitRoot = requireGitRoot.checked;
  localConfig.auditLog = auditLog.value;
  localConfig.allowedCommands = allowedCommands.value
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return localConfig;
}

function renderPreview(): void {
  configPreview.textContent = previews[activePreview] ?? "";
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.preview === activePreview);
  });
}

function renderHttpAuthModalStatus(status: HttpAuthStatus): void {
  if (status.source === "env") {
    authModalStatus.textContent = "HTTP auth token configured via environment variable.";
    clearAuthToken.disabled = true;
    return;
  }

  clearAuthToken.disabled = false;
  authModalStatus.textContent = status.configured ? "HTTP auth token configured via local file." : "No HTTP auth token configured.";
}

function renderWriteAccessStatus(status: WriteAccessStatus): void {
  const writeModeText = `${status.writeMode} (${status.writeModeSource})`;
  const tokenText = `${status.legacyApprovalTokenConfigured ? "yes" : "no"} (${status.legacyApprovalTokenSource})`;
  const readinessText = status.publicWriteReadiness === "READY" ? "READY" : `NOT READY - ${status.publicWriteReadinessReason}`;

  writeToolsStatus.textContent = writeModeText;
  writeApprovalTokenStatus.textContent = tokenText;
  writeReadinessStatus.textContent = readinessText;
  writeAccessToolsEnabled.textContent = writeModeText;
  writeAccessDocsAllowed.textContent = status.docsWritesAllowed ? "allowed" : "blocked";
  writeAccessPatchAllowed.textContent = status.patchWritesAllowed ? "allowed" : "blocked";
  writeAccessElevatedAllowed.textContent = status.elevatedOperationsAllowed ? "allowed" : "blocked";
  writeAccessPendingPatches.textContent = String(status.pendingPatchProposalCount);
  writeAccessTokenConfigured.textContent = status.legacyApprovalTokenConfigured ? "yes" : "no";
  writeAccessTokenSource.textContent = status.legacyApprovalTokenSource;
  writeAccessOAuthGranted.textContent = status.oauthFilesWriteGranted ? "yes" : "no/unknown";
  writeAccessReadiness.textContent = readinessText;
  writeAccessConfigPath.textContent = status.configPath;
  oauthFilesWriteInline.textContent = status.oauthFilesWriteGranted ? "yes" : "no/unknown";

  setStatusClass(writeToolsStatus, status.writeMode === "off" ? "pass" : status.writeMode === "elevated" ? "warn" : "running");
  setStatusClass(writeApprovalTokenStatus, status.legacyApprovalTokenConfigured ? "pass" : "warn");
  setStatusClass(writeReadinessStatus, status.publicWriteReadiness === "READY" ? "pass" : "fail");
  setStatusClass(writeAccessToolsEnabled, status.writeMode === "off" ? "pass" : status.writeMode === "elevated" ? "warn" : "running");
  setStatusClass(writeAccessDocsAllowed, status.docsWritesAllowed ? "pass" : "warn");
  setStatusClass(writeAccessPatchAllowed, status.patchWritesAllowed ? "pass" : "warn");
  setStatusClass(writeAccessElevatedAllowed, status.elevatedOperationsAllowed ? "warn" : "pass");
  setStatusClass(writeAccessPendingPatches, status.pendingPatchProposalCount > 0 ? "warn" : "pass");
  setStatusClass(writeAccessTokenConfigured, status.legacyApprovalTokenConfigured ? "pass" : "warn");
  setStatusClass(writeAccessOAuthGranted, status.oauthFilesWriteGranted ? "pass" : "warn");
  setStatusClass(writeAccessReadiness, status.publicWriteReadiness === "READY" ? "pass" : "fail");
}

function renderWriteTokenModalStatus(status: WriteAccessStatus): void {
  if (status.legacyApprovalTokenSource === "env") {
    writeTokenModalStatus.textContent = "Elevated approval token configured via environment variable.";
    copyTemporaryWriteToken.disabled = true;
    return;
  }

  copyTemporaryWriteToken.disabled = writeTokenInput.value.trim() === "";
  writeTokenModalStatus.textContent = status.legacyApprovalTokenConfigured ? "Local elevated approval token hash is configured." : "No local elevated approval token configured.";
}

async function openAuthModal(): Promise<void> {
  authTokenInput.value = "";
  authTokenInput.type = "password";
  toggleAuthTokenVisibility.textContent = "Show";
  renderHttpAuthModalStatus(await window.champcity.getHttpAuthStatus());
  authModal.classList.remove("hidden");
  authTokenInput.focus();
}

function closeAuthModal(): void {
  authTokenInput.value = "";
  authModal.classList.add("hidden");
}

function openOAuthModal(): void {
  oauthPasswordInput.value = "";
  oauthPasswordConfirmInput.value = "";
  oauthModalStatus.textContent = "Local password hash only";
  oauthModal.classList.remove("hidden");
  oauthPasswordInput.focus();
}

function closeOAuthModal(): void {
  oauthPasswordInput.value = "";
  oauthPasswordConfirmInput.value = "";
  oauthModal.classList.add("hidden");
}

async function openWriteTokenModal(generateFirst = false): Promise<void> {
  writeTokenInput.value = "";
  writeTokenInput.type = "password";
  toggleWriteTokenVisibility.textContent = "Show";
  renderWriteTokenModalStatus(await window.champcity.getWriteAccessStatus());
  writeTokenModal.classList.remove("hidden");
  if (generateFirst) {
    await generateWriteTokenForModal();
  } else {
    writeTokenInput.focus();
  }
}

function closeWriteTokenModal(): void {
  writeTokenInput.value = "";
  writeTokenModal.classList.add("hidden");
}

async function generateWriteTokenForModal(): Promise<void> {
  const result = await window.champcity.generateWriteApprovalToken();
  writeTokenInput.value = result.token;
  writeTokenInput.type = "text";
  toggleWriteTokenVisibility.textContent = "Hide";
  copyTemporaryWriteToken.disabled = false;
  writeTokenModalStatus.textContent = "Generated token is shown once. Save it somewhere temporary before saving the hash.";
  writeTokenInput.focus();
  writeTokenInput.select();
}

async function refreshStatus(): Promise<void> {
  const status = await window.champcity.getAppStatus();
  currentStatus = status;
  serverStatus.textContent = status.diagnosticStatus.detail;
  localHttpEndpoint.textContent = status.http.localEndpoint;
  localHealthEndpoint.textContent = status.http.localHealthEndpoint;
  publicMcpEndpoint.textContent = status.http.publicEndpoint;
  publicHealthEndpoint.textContent = status.http.publicHealthEndpoint;
  oauthIssuer.textContent = status.http.oauthIssuer;
  oauthAdminStatus.textContent = status.http.oauthAdminPasswordConfigured ? "yes" : "no";
  oauthClientsStatus.textContent = String(status.http.oauthRegisteredClientsCount);
  oauthTokensStatus.textContent = String(status.http.oauthActiveTokensCount);
  oauthIssuerInline.textContent = status.http.oauthIssuer;
  oauthMcpEndpointInline.textContent = status.http.publicEndpoint;
  oauthWriteToolsInline.textContent = status.writeAccess.writeMode;
  oauthTunnelInline.textContent = status.http.tunnelReadinessStatus;
  oauthDcrRegisteredInline.textContent = status.http.oauthRegisteredClientsCount > 0 ? "yes" : "no";
  oauthActiveClientsInline.textContent = String(status.http.oauthActiveClientsCount);
  oauthRefreshSessionsInline.textContent = String(status.http.oauthActiveRefreshSessionsCount);
  oauthExpiredSessionsInline.textContent = String(status.http.oauthExpiredSessionsCount);
  oauthRevokedSessionsInline.textContent = String(status.http.oauthRevokedSessionsCount);
  oauthAccessTtlInline.textContent = `${status.http.oauthAccessTokenTtlLabel} (${status.http.oauthAccessTokenTtlSeconds} seconds)`;
  oauthRefreshTtlInline.textContent = `${status.http.oauthRefreshTokenTtlLabel} (${status.http.oauthRefreshTokenTtlSeconds} seconds)`;
  if (status.http.oauthLastAuthorizeError) {
    const lastError = status.http.oauthLastAuthorizeError;
    oauthLastAuthorizeErrorInline.textContent = `${lastError.error} at ${lastError.occurredAt}`;
    oauthPkceReceivedInline.textContent = lastError.requiredFieldsPresent.code_challenge ? "yes" : "no";
    oauthPkceMethodInline.textContent = lastError.codeChallengeMethod ?? "missing";
  } else {
    oauthLastAuthorizeErrorInline.textContent = "none recorded";
    oauthPkceReceivedInline.textContent = "unknown";
    oauthPkceMethodInline.textContent = "unknown";
  }
  cloudflarePublicMcpEndpoint.textContent = status.http.publicEndpoint;
  cloudflarePublicHealthEndpoint.textContent = status.http.publicHealthEndpoint;
  runtimeModeStatus.textContent = status.runtime.mode;
  runtimeConfigDirStatus.textContent = status.runtime.configDir;
  authTokenStatus.textContent = `${status.http.authTokenConfigured ? "yes" : "no"} (${status.http.authTokenSource})`;
  unauthLocalStatus.textContent = status.http.unauthenticatedLocalHttpAllowed ? "yes - LOCAL TEST ONLY - DO NOT TUNNEL" : "no";
  if (status.http.tunnelReadinessStatus === "READY") {
    publicTunnelStatus.textContent = "READY";
  } else if (status.http.tunnelReadinessStatus === "WARN") {
    publicTunnelStatus.textContent = `WARN - write mode ${status.writeAccess.writeMode}`;
  } else if (!status.http.oauthAdminPasswordConfigured) {
    publicTunnelStatus.textContent = "NOT READY - OAuth admin password missing";
  } else if (status.http.unauthenticatedLocalHttpAllowed) {
    publicTunnelStatus.textContent = "NOT READY - unauthenticated local mode enabled";
  } else if (!status.http.localHealthPassing) {
    publicTunnelStatus.textContent = "NOT READY - local health failed";
  } else {
    publicTunnelStatus.textContent = "NOT READY";
  }
  localHealthStatus.textContent = status.http.localHealthPassing ? "yes" : "no";
  renderWriteAccessStatus(status.writeAccess);
  setStatusClass(serverStatus, status.diagnosticStatus.state);
  setStatusClass(oauthAdminStatus, status.http.oauthAdminPasswordConfigured ? "pass" : "warn");
  setStatusClass(oauthTunnelInline, status.http.tunnelReadinessStatus === "READY" ? "pass" : status.http.tunnelReadinessStatus === "WARN" ? "warn" : "fail");
  setStatusClass(authTokenStatus, status.http.authTokenConfigured ? "pass" : "warn");
  setStatusClass(unauthLocalStatus, status.http.unauthenticatedLocalHttpAllowed ? "warn" : "pass");
  setStatusClass(publicTunnelStatus, status.http.tunnelReadinessStatus === "READY" ? "pass" : status.http.tunnelReadinessStatus === "WARN" ? "warn" : "fail");
  setStatusClass(localHealthStatus, status.http.localHealthPassing ? "pass" : "fail");
  if (status.lastDoctorResult) {
    checklistMeta.textContent = `Completed ${status.lastDoctorResult.completedAt}`;
    renderChecklist(status.lastDoctorResult.checks);
  } else {
    checklistMeta.textContent = `Repo: ${status.repoRoot}`;
    renderChecklist(null);
  }
  previews = status.generatedPreviews;
  renderPreview();
  maybeShowSetupWizard(status);
}

async function loadConfig(): Promise<void> {
  const result = await window.champcity.readLocalConfig();
  localConfig = result.config;
  configPath.textContent = result.path;
  renderRoots();
}

function bindButton(id: string, handler: (button: HTMLButtonElement) => Promise<void>): void {
  const button = document.querySelector<HTMLButtonElement>(id)!;
  button.addEventListener("click", async () => {
    setBusy(button, true);
    try {
      await handler(button);
      await refreshStatus();
    } catch (error) {
      appendLog(`ERROR ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(button, false);
    }
  });
}

setupAddRoot.addEventListener("click", async () => {
  try {
    const selected = await window.champcity.selectFolder();
    if (selected && !setupRoots.includes(selected)) {
      setupRoots.push(selected);
      renderSetupRoots();
      renderSetupSummary();
    }
  } catch (error) {
    setupStatus.textContent = error instanceof Error ? error.message : String(error);
  }
});

setupAddExampleRoot.addEventListener("click", () => {
  const example = "C:\\Users\\<you>\\Projects\\<project>";
  if (!setupRoots.includes(example)) {
    setupRoots.push(example);
    renderSetupRoots();
    renderSetupSummary();
  }
});

setupBack.addEventListener("click", () => {
  setupStep = Math.max(0, setupStep - 1);
  setupStatus.textContent = "";
  renderSetupStep();
});

setupNext.addEventListener("click", () => {
  if (!validateCurrentSetupStep()) {
    return;
  }
  setupStep = Math.min(7, setupStep + 1);
  renderSetupStep();
});

setupOpenCloudflareGuide.addEventListener("click", async () => {
  const result = await window.champcity.openCloudflareGuide();
  if (result) {
    appendLog(result);
  }
});

setupPublicBaseUrl.addEventListener("input", renderSetupSummary);
setupPublicEndpoint.addEventListener("change", renderSetupSummary);
setupLocalOnly.addEventListener("change", renderSetupSummary);
setupOAuthPassword.addEventListener("input", renderSetupSummary);
setupOAuthPasswordConfirm.addEventListener("input", renderSetupSummary);
setupWriteMode.addEventListener("change", renderSetupSummary);
setupConfirmBroadRoots.addEventListener("change", () => renderSetupWarnings());

setupFinish.addEventListener("click", async () => {
  if (!validateCurrentSetupStep()) {
    return;
  }

  setBusy(setupFinish, true);
  try {
    const payload = {
      allowedRoots: setupRoots.map((root) => root.trim()).filter(Boolean),
      confirmedBroadRoots: setupConfirmBroadRoots.checked,
      oauthAdminPassword: setupOAuthPassword.value,
      localOnly: setupLocalOnly.checked,
      publicBaseUrl: setupPublicEndpoint.checked ? getSetupPublicBaseUrl() : undefined,
      cloudflareChoice: setupCloudflareGuide.checked ? "guide" as const : "skip" as const,
      writeMode: setupWriteMode.value as "off" | "docs" | "patch" | "elevated"
    };
    const result = await window.champcity.saveInitialSetup(payload);
    if (result.requiresConfirmation) {
      setupStatus.textContent = `Confirm broad roots before saving: ${(result.broadRoots ?? []).join(", ")}`;
      setupConfirmBroadRoots.focus();
      return;
    }
    if (!result.ok) {
      setupStatus.textContent = "Setup save failed.";
      return;
    }
    appendLog(`Saved first-run setup to ${result.path}`);
    setupWizard.classList.add("hidden");
    await loadConfig();
    await refreshStatus();
  } catch (error) {
    setupStatus.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    setBusy(setupFinish, false);
  }
});

resetSetupWizardButton.addEventListener("click", async () => {
  const confirmed = window.confirm("Reset the setup wizard? Existing tokens/config are not deleted.");
  if (!confirmed) {
    appendLog("Setup wizard reset canceled.");
    return;
  }

  const result = await window.champcity.resetSetupWizard();
  appendLog(result.output);
  setupStep = 0;
  await refreshStatus();
});

bindButton("#runDoctor", async () => {
  const result = await window.champcity.runDoctor();
  appendLog(result.output);
  checklistMeta.textContent = `Completed ${result.completedAt}`;
  renderChecklist(result.checks);
});

bindButton("#installDeps", async () => {
  const result = await window.champcity.installDependencies();
  appendLog(result.output || `Install completed: ${result.ok}`);
});

bindButton("#buildServer", async () => {
  const result = await window.champcity.buildMcpServer();
  appendLog(result.output || `Build completed: ${result.ok}`);
});

bindButton("#generateConfigs", async () => {
  const result = await window.champcity.generateClientConfigs();
  previews = result.previews;
  activePreview = "chatgptNotes";
  renderPreview();
  appendLog(`Generated ChatGPT setup notes and MCP client configs in ${result.directory}`);
});

bindButton("#generateOAuthNotes", async () => {
  const result = await window.champcity.generateClientConfigs();
  previews = result.previews;
  activePreview = "chatgptNotes";
  renderPreview();
  appendLog(`Generated ChatGPT OAuth setup notes in ${result.directory}`);
});

bindButton("#configureOAuthAdmin", async () => {
  openOAuthModal();
});

bindButton("#resetOAuthClients", async () => {
  const confirmed = window.confirm("Reset locally registered OAuth clients? ChatGPT will need to register again.");
  if (!confirmed) {
    appendLog("OAuth client reset canceled.");
    return;
  }

  const result = await window.champcity.resetOAuthClients();
  appendLog(result.output);
});

bindButton("#revokeOAuthTokens", async () => {
  const confirmed = window.confirm("Revoke all locally stored OAuth access tokens? ChatGPT will need to reconnect.");
  if (!confirmed) {
    appendLog("OAuth token revocation canceled.");
    return;
  }

  const result = await window.champcity.revokeAllOAuthTokens();
  appendLog(result.output);
});

bindButton("#revokeAllOAuthSessions", async () => {
  const confirmed = window.confirm("Revoke all local OAuth sessions? ChatGPT will need to reconnect.");
  if (!confirmed) {
    appendLog("OAuth session revocation canceled.");
    return;
  }

  const result = await window.champcity.revokeAllOAuthTokens();
  appendLog(result.output);
});

bindButton("#revokeChatGptOAuthSessions", async () => {
  const confirmed = window.confirm("Revoke ChatGPT OAuth sessions? ChatGPT will need to reconnect.");
  if (!confirmed) {
    appendLog("ChatGPT OAuth session revocation canceled.");
    return;
  }

  const result = await window.champcity.revokeChatGptOAuthTokens();
  appendLog(result.output);
});

bindButton("#clearExpiredOAuthSessions", async () => {
  const result = await window.champcity.clearExpiredOAuthTokens();
  appendLog(result.output);
});

bindButton("#openOAuthSessionDocs", async () => {
  const result = await window.champcity.openChatGptGuide();
  if (result) {
    appendLog(result);
  }
});

bindButton("#openOAuthMetadata", async () => {
  const result = await window.champcity.openOAuthMetadata();
  if (result) {
    appendLog(result);
  }
});

bindButton("#openProtectedResourceMetadata", async () => {
  const result = await window.champcity.openProtectedResourceMetadata();
  if (result) {
    appendLog(result);
  }
});

bindButton("#copyOAuthMcpUrl", async () => {
  const result = await window.champcity.copyPublicMcpEndpoint();
  appendLog(result.output);
});

bindButton("#copyGeneric", async () => {
  const result = await window.champcity.copyGenericConfig();
  appendLog(result.output);
});

bindButton("#openGenerated", async () => {
  const result = await window.champcity.openGeneratedFolder();
  if (result) {
    appendLog(result);
  }
});

bindButton("#openAudit", async () => {
  const result = await window.champcity.openAuditLog();
  if (result) {
    appendLog(result);
  }
});

bindButton("#openLogs", async () => {
  const result = await window.champcity.openLogsFolder();
  if (result) {
    appendLog(result);
  }
});

bindButton("#startServer", async () => {
  if (!currentStatus?.http.oauthAdminPasswordConfigured && !currentStatus?.http.authTokenConfigured && !currentStatus?.http.unauthenticatedLocalHttpAllowed) {
    appendLog("OAuth admin password is required. Configure OAuth Admin Password, use legacy HTTP auth token, or explicitly enable local unauthenticated test mode.");
    return;
  }

  if (currentStatus.http.oauthAdminPasswordConfigured) {
    appendLog("Starting OAuth-protected local HTTP MCP server.");
  } else if (currentStatus.http.authTokenConfigured) {
    appendLog("Starting legacy bearer-authenticated local HTTP MCP server.");
  } else if (currentStatus.http.unauthenticatedLocalHttpAllowed) {
    appendLog("LOCAL TEST ONLY - DO NOT TUNNEL.");
  }

  const result = await window.champcity.startDiagnosticServer();
  appendLog(result.output);
});

bindButton("#stopServer", async () => {
  const result = await window.champcity.stopDiagnosticServer();
  appendLog(result.output);
});

bindButton("#openDocs", async () => {
  const result = await window.champcity.openDocs();
  if (result) {
    appendLog(result);
  }
});

bindButton("#openHealth", async () => {
  const result = await window.champcity.openLocalHealthCheck();
  if (result) {
    appendLog(result);
  }
});

bindButton("#copyLocalEndpoint", async () => {
  const result = await window.champcity.copyLocalMcpEndpoint();
  appendLog(result.output);
});

bindButton("#copyPublicEndpoint", async () => {
  const result = await window.champcity.copyPublicMcpEndpoint();
  appendLog(result.output);
});

bindButton("#copyPublicHealthEndpoint", async () => {
  const result = await window.champcity.copyPublicHealthEndpoint();
  appendLog(result.output);
});

bindButton("#runTunnelReadiness", async () => {
  const result = await window.champcity.runTunnelReadinessCheck();
  appendLog(result.output);
});

bindButton("#openCloudflareGuide", async () => {
  const result = await window.champcity.openCloudflareGuide();
  if (result) {
    appendLog(result);
  }
});

bindButton("#openCloudflareDashboard", async () => {
  const result = await window.champcity.openCloudflareDashboard();
  if (result) {
    appendLog(result);
  }
});

bindButton("#openCloudflaredConfig", async () => {
  const result = await window.champcity.openCloudflaredConfigTemplate();
  if (result) {
    appendLog(result);
  }
});

bindButton("#openChatGptGuide", async () => {
  const result = await window.champcity.openChatGptGuide();
  if (result) {
    appendLog(result);
  }
});

bindButton("#openDomainGuide", async () => {
  const result = await window.champcity.openDomainGuide();
  if (result) {
    appendLog(result);
  }
});

async function setWriteModeWithWarning(writeMode: "off" | "docs" | "patch" | "elevated", warning: string): Promise<void> {
  const confirmed = writeMode === "off" || window.confirm(`${warning}\n\nRestart the local HTTP server for a running process to pick it up.`);
  if (!confirmed) {
    appendLog(`Write mode ${writeMode} canceled.`);
    return;
  }

  const result = await window.champcity.setWriteMode(writeMode);
  appendLog(result.output);
}

bindButton("#setWriteModeOff", async () => {
  await setWriteModeWithWarning("off", "No writes will be allowed.");
});

bindButton("#setWriteModeDocs", async () => {
  await setWriteModeWithWarning("docs", "ChatGPT can create Markdown files inside allowed roots when OAuth files.write is granted.");
});

bindButton("#setWriteModePatch", async () => {
  await setWriteModeWithWarning("patch", "ChatGPT can apply only patches it previously proposed and that still match the stored patch hash.");
});

bindButton("#setWriteModeElevated", async () => {
  await setWriteModeWithWarning("elevated", "High-risk mode. Allows elevated operations such as scripts when local elevated approval is supplied.");
});

bindButton("#clearPendingPatchProposals", async () => {
  const result = await window.champcity.clearPendingPatchProposals();
  appendLog(result.output);
});

bindButton("#configureWriteToken", async () => {
  await openWriteTokenModal(false);
});

bindButton("#rotateWriteToken", async () => {
  await openWriteTokenModal(true);
});

bindButton("#generateWriteToken", async () => {
  await openWriteTokenModal(true);
});

bindButton("#clearWriteToken", async () => {
  if (currentStatus?.writeAccess.legacyApprovalTokenSource === "env") {
    appendLog("Elevated approval token is configured via CHAMPCITY_GPT_WRITE_APPROVAL_TOKEN. Change the environment variable outside the app.");
    return;
  }

  const confirmed = window.confirm("Clear the locally saved elevated approval token hash?");
  if (!confirmed) {
    appendLog("Elevated approval token clear canceled.");
    return;
  }

  const result = await window.champcity.clearWriteApprovalToken();
  appendLog(result.output);
});

bindButton("#configureAuthToken", async () => {
  await openAuthModal();
});

generateAuthToken.addEventListener("click", async () => {
  try {
    const result = await window.champcity.generateHttpAuthToken();
    authTokenInput.value = result.token;
    authTokenInput.focus();
  } catch (error) {
    appendLog(`ERROR ${error instanceof Error ? error.message : String(error)}`);
  }
});

saveAuthToken.addEventListener("click", async () => {
  const token = authTokenInput.value.trim();
  if (!token) {
    appendLog("HTTP auth token is required.");
    authTokenInput.focus();
    return;
  }

  try {
    const result = await window.champcity.saveHttpAuthToken(token);
    appendLog(result.output);
    renderHttpAuthModalStatus(result.status);
    closeAuthModal();
    await refreshStatus();
  } catch (error) {
    appendLog(`ERROR ${error instanceof Error ? error.message : String(error)}`);
  }
});

clearAuthToken.addEventListener("click", async () => {
  const confirmed = window.confirm("Clear the locally saved HTTP auth token?");
  if (!confirmed) {
    appendLog("HTTP auth token clear canceled.");
    return;
  }

  try {
    const result = await window.champcity.clearHttpAuthToken();
    appendLog(result.output);
    renderHttpAuthModalStatus(result.status);
    if (result.ok) {
      closeAuthModal();
    }
    await refreshStatus();
  } catch (error) {
    appendLog(`ERROR ${error instanceof Error ? error.message : String(error)}`);
  }
});

cancelAuthToken.addEventListener("click", () => {
  appendLog("HTTP auth token update canceled.");
  closeAuthModal();
});

generateWriteTokenInModal.addEventListener("click", async () => {
  try {
    await generateWriteTokenForModal();
  } catch (error) {
    appendLog(`ERROR ${error instanceof Error ? error.message : String(error)}`);
  }
});

copyTemporaryWriteToken.addEventListener("click", async () => {
  const token = writeTokenInput.value.trim();
  if (!token) {
    writeTokenModalStatus.textContent = "Generate or enter a token before copying.";
    writeTokenInput.focus();
    return;
  }

  try {
    const result = await window.champcity.copyTemporaryWriteToken(token);
    appendLog(result.output);
  } catch (error) {
    appendLog(`ERROR ${error instanceof Error ? error.message : String(error)}`);
  }
});

saveWriteToken.addEventListener("click", async () => {
  const token = writeTokenInput.value.trim();
  if (token.length < 16) {
    writeTokenModalStatus.textContent = "Use at least 16 characters.";
    writeTokenInput.focus();
    return;
  }

  try {
    const result = await window.champcity.saveWriteApprovalToken(token);
    appendLog(result.output);
    renderWriteTokenModalStatus(result.status);
    closeWriteTokenModal();
    await refreshStatus();
  } catch (error) {
    writeTokenModalStatus.textContent = error instanceof Error ? error.message : String(error);
  }
});

cancelWriteToken.addEventListener("click", () => {
  appendLog("Elevated approval token update canceled.");
  closeWriteTokenModal();
});

saveOAuthPassword.addEventListener("click", async () => {
  const password = oauthPasswordInput.value;
  const confirmation = oauthPasswordConfirmInput.value;
  if (password.length < 12) {
    oauthModalStatus.textContent = "Use at least 12 characters.";
    oauthPasswordInput.focus();
    return;
  }

  if (password !== confirmation) {
    oauthModalStatus.textContent = "Passwords do not match.";
    oauthPasswordConfirmInput.focus();
    return;
  }

  try {
    const result = await window.champcity.configureOAuthAdminPassword(password);
    appendLog(result.output);
    closeOAuthModal();
    await refreshStatus();
  } catch (error) {
    oauthModalStatus.textContent = error instanceof Error ? error.message : String(error);
  }
});

cancelOAuthPassword.addEventListener("click", () => {
  appendLog("OAuth admin password update canceled.");
  closeOAuthModal();
});

toggleAuthTokenVisibility.addEventListener("click", () => {
  const showing = authTokenInput.type === "text";
  authTokenInput.type = showing ? "password" : "text";
  toggleAuthTokenVisibility.textContent = showing ? "Show" : "Hide";
});

toggleWriteTokenVisibility.addEventListener("click", () => {
  const showing = writeTokenInput.type === "text";
  writeTokenInput.type = showing ? "password" : "text";
  toggleWriteTokenVisibility.textContent = showing ? "Show" : "Hide";
});

writeTokenInput.addEventListener("input", () => {
  copyTemporaryWriteToken.disabled = writeTokenInput.value.trim() === "";
});

bindButton("#enableUnauthLocal", async () => {
  const confirmed = window.confirm("Enable unauthenticated local HTTP mode? This is LOCAL TEST ONLY - DO NOT TUNNEL.");
  if (!confirmed) {
    appendLog("Local unauthenticated test mode enable canceled.");
    return;
  }

  const result = await window.champcity.setUnauthenticatedLocalHttpAllowed(true);
  appendLog(result.output);
});

bindButton("#disableUnauthLocal", async () => {
  const result = await window.champcity.setUnauthenticatedLocalHttpAllowed(false);
  appendLog(result.output);
});

bindButton("#addRoot", async () => {
  const selected = await window.champcity.selectFolder();
  if (selected && localConfig && !localConfig.allowedRoots.includes(selected)) {
    localConfig.allowedRoots.push(selected);
    renderRoots();
  }
});

bindButton("#resetRoots", async () => {
  const status = await window.champcity.getAppStatus();
  localConfig = {
    allowedRoots: [status.repoRoot],
    requireGitRoot: true,
    auditLog: `${status.repoRoot}\\logs\\audit.log`,
    allowedCommands: ["npm test", "npm run lint", "npm run typecheck", "npm run build", "git status", "git diff"]
  };
  renderRoots();
});

bindButton("#saveConfig", async () => {
  const config = syncConfigFromInputs();
  let result = await window.champcity.saveLocalConfig(config, false);
  if (result.requiresConfirmation) {
    const projectsRoot = getProjectsRootLabel();
    const confirmed = window.confirm(
      `One or more roots are outside ${projectsRoot}:\n\n${(result.outsideProjectsRoots ?? []).join("\n")}\n\nSave anyway?`
    );
    if (!confirmed) {
      renderWarnings(result.warnings ?? []);
      appendLog("Config save canceled.");
      return;
    }
    result = await window.champcity.saveLocalConfig(config, true);
  }

  if (result.ok) {
    appendLog(`Saved local config to ${result.path}`);
    localConfig = result.config ?? config;
    renderRoots();
    renderWarnings(result.warnings ?? []);
  } else {
    appendLog(`Config save failed: ${(result.warnings ?? ["Unknown error"]).join("; ")}`);
  }
});

requireGitRoot.addEventListener("change", () => {
  if (localConfig) {
    localConfig.requireGitRoot = requireGitRoot.checked;
  }
});

auditLog.addEventListener("input", () => {
  if (localConfig) {
    localConfig.auditLog = auditLog.value;
  }
});

allowedCommands.addEventListener("input", () => {
  if (localConfig) {
    localConfig.allowedCommands = allowedCommands.value.split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean);
  }
});

document.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    activePreview = tab.dataset.preview ?? "generic";
    renderPreview();
  });
});

window.champcity.onLog((line) => appendLog(line));

await loadConfig();
await refreshStatus();
