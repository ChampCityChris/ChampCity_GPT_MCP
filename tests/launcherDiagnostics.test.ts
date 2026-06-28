import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  createEmptyLauncherState,
  adaptLauncherState,
  type LocalLauncherConfig
} from "../electron/renderer/launcherStateAdapter.js";
import { DashboardScreen } from "../electron/renderer/launcher/screens/DashboardScreen.js";
import { TroubleshootScreen } from "../electron/renderer/launcher/screens/TroubleshootScreen.js";
import { inferLogLevel } from "../electron/renderer/logSeverity.js";
import {
  getPackagedDeveloperCliProbeCheck,
  getLauncherOAuthStatus,
  getLauncherWriteAccessStatus,
  getPublicTunnelDiagnostics,
  setLauncherWriteMode
} from "../electron/launcherCore.js";
import {
  writeLastOAuthAuthorizeError,
  writeOAuthClientStore,
  type OAuthAuthorizeErrorDiagnostic
} from "../src/oauth.js";
import { type McpDiscoveryTrace } from "../src/server/discoveryTrace.js";

let tempRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-launcher-diagnostics-"));
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function discoveryTrace(overrides: Partial<McpDiscoveryTrace> = {}): McpDiscoveryTrace {
  const timestamp = new Date().toISOString();
  return {
    timestamp,
    processId: 123,
    request: {
      httpMethod: "POST",
      path: "/mcp",
      publicBaseUrl: "https://mcp.example.com",
      mcpSessionIdPresent: false
    },
    jsonRpc: {
      isBatch: false,
      methods: ["tools/list"],
      ids: [1],
      hasInitialize: false,
      hasInitializedNotification: false,
      hasToolsList: true,
      hasResourcesList: false,
      hasPromptsList: false
    },
    auth: {
      kind: "oauth",
      subject: "client-1",
      clientId: "client-1",
      scope: "files.read files.write",
      scopes: ["files.read", "files.write"]
    },
    tools: {
      countBeforeFiltering: 2,
      countAfterMcpSchemaValidation: 2,
      countAfterChatGptSchemaSanitization: 2,
      countAfterScopeFiltering: 2,
      finalToolCountReturned: 2,
      finalToolNamesReturned: ["read_project_file", "write_markdown_artifact"],
      invalidToolSchemas: [],
      invalidChatGptToolSchemas: [],
      scopeFilteredTools: [],
      sanitizedToolSchemas: []
    },
    response: {
      statusCode: 200,
      contentType: "application/json; charset=utf-8",
      kind: "json-rpc-response",
      transportRoute: "stateless-compat"
    },
    recentDiscoverySequence: {
      windowSeconds: 600,
      entries: [],
      methodsObserved: ["tools/list"]
    },
    ...overrides
  };
}

function authorizeError(occurredAt: string): OAuthAuthorizeErrorDiagnostic {
  return {
    occurredAt,
    requestPath: "/oauth/authorize",
    error: "Missing client_id.",
    requiredFieldsPresent: {
      response_type: true,
      client_id: false,
      redirect_uri: true,
      code_challenge: true,
      code_challenge_method: true
    },
    codeChallengeMethod: "S256"
  };
}

function appStatus(overrides: Partial<ReturnType<typeof baseAppStatus>> = {}) {
  return {
    ...baseAppStatus(),
    ...overrides
  };
}

function localLauncherConfig(): LocalLauncherConfig {
  return {
    allowedRoots: [tempRoot],
    requireGitRoot: true,
    auditLog: path.join(tempRoot, "logs", "audit.log"),
    allowedCommands: []
  };
}

function baseAppStatus() {
  const writeAccess = getLauncherWriteAccessStatus(tempRoot);
  const oauth = getLauncherOAuthStatus(tempRoot);
  const publicTunnelDiagnostics = getPublicTunnelDiagnostics({
    publicBaseUrl: "https://mcp.example.com",
    localHealthPassing: true,
    lastDiscoveryTrace: null,
    doctorChecks: []
  });
  return {
    appName: "ChampCity GPT MCP Launcher",
    repoRoot: tempRoot,
    runtime: {
      mode: "development" as const,
      serverRuntime: "in-process" as const,
      appRoot: tempRoot,
      configDir: path.join(tempRoot, "config"),
      logsDir: path.join(tempRoot, "logs"),
      generatedDir: path.join(tempRoot, "generated"),
      resourceRoot: tempRoot,
      serverEntrypoint: path.join(tempRoot, "dist", "src", "index.js"),
      nodeExecutable: "node"
    },
    entrypoint: path.join(tempRoot, "dist", "src", "index.js"),
    configPath: path.join(tempRoot, "config", "allowed-roots.local.json"),
    configExists: true,
    configStatus: "ok",
    setup: { setupComplete: true, complete: true, path: path.join(tempRoot, "config", "setup.local.json") },
    firstRunRequired: false,
    buildExists: true,
    diagnosticStatus: {
      state: "running" as const,
      pid: 123,
      detail: "running",
      serverRuntime: "in-process" as const,
      statusFile: path.join(tempRoot, "logs", "status.json"),
      stdoutLog: path.join(tempRoot, "logs", "out.log"),
      stderrLog: path.join(tempRoot, "logs", "err.log")
    },
    lastDoctorResult: null,
    generatedPreviews: {},
    http: {
      serverRuntime: "in-process" as const,
      localEndpoint: "http://127.0.0.1:3333/mcp",
      localHealthEndpoint: "http://127.0.0.1:3333/health",
      publicEndpoint: "https://mcp.example.com/mcp",
      publicHealthEndpoint: "https://mcp.example.com/health",
      oauthIssuer: "https://mcp.example.com",
      oauthAuthorizationServerMetadata: "https://mcp.example.com/.well-known/oauth-authorization-server",
      oauthProtectedResourceMetadata: "https://mcp.example.com/.well-known/oauth-protected-resource",
      oauthRegistrationEndpoint: "https://mcp.example.com/oauth/register",
      oauthDynamicClientRegistrationEnabled: true,
      oauthClientRegistryPath: oauth.clientRegistryPath,
      oauthTokenRegistryPath: oauth.tokenRegistryPath,
      oauthAdminPasswordConfigured: true,
      oauthRegisteredClientsCount: oauth.registeredClientsCount,
      oauthRegisteredChatGptClientsCount: oauth.registeredChatGptClientsCount,
      oauthRegisteredDoctorProbeClientsCount: oauth.registeredDoctorProbeClientsCount,
      oauthRegisteredOtherClientsCount: oauth.registeredOtherClientsCount,
      oauthActiveClientsCount: oauth.activeOAuthClientsCount,
      oauthActiveTokensCount: oauth.activeTokensCount,
      oauthActiveWriteTokensCount: oauth.activeWriteTokensCount,
      oauthActiveRefreshSessionsCount: oauth.activeRefreshSessionsCount,
      oauthExpiredSessionsCount: oauth.expiredSessionsCount,
      oauthRevokedSessionsCount: oauth.revokedSessionsCount,
      oauthAccessTokenTtlSeconds: oauth.accessTokenTtlSeconds,
      oauthRefreshTokenTtlSeconds: oauth.refreshTokenTtlSeconds,
      oauthAccessTokenTtlLabel: oauth.accessTokenTtlLabel,
      oauthRefreshTokenTtlLabel: oauth.refreshTokenTtlLabel,
      oauthLastAuthorizeError: oauth.lastAuthorizeError,
      chatGptReconnectShouldWork: true,
      chatGptDeleteRecreateConnectorRequired: false,
      internalToolNames: [],
      exposedToolNames: [],
      internalRegisteredToolCount: 0,
      schemaValidToolCount: 0,
      schemaValidExposedToolCount: 0,
      scopeFilteredToolCount: 0,
      invalidToolSchemas: [],
      scopeFilteredTools: [],
      serializedToolsListPayload: "{}",
      lastMcpDiscoveryTrace: null,
      writeToolNamesBlockedByLocalMode: [],
      authTokenConfigured: false,
      authTokenSource: "none" as const,
      unauthenticatedLocalHttpAllowed: false,
      writeToolsEnabled: true,
      localHealthPassing: true,
      tunnelReadinessStatus: publicTunnelDiagnostics.legacyTunnelReadinessStatus,
      publicTunnelReady: publicTunnelDiagnostics.overallTunnelReadiness === "ready",
      publicTunnelDiagnostics
    },
    writeAccess,
    figma: {
      configured: false,
      source: "none" as const,
      configPath: path.join(tempRoot, "config", "figma.local.json"),
      makeHandoffToolAvailable: true,
      figmaMcp: {
        endpoint: "http://127.0.0.1:3845/mcp",
        mode: "desktop" as const,
        source: "default" as const,
        connectionStatus: "not-tested" as const,
        authStatus: "unknown" as const,
        makeResourceRetrievalAvailable: "unknown" as const,
        configPath: path.join(tempRoot, "config", "figma-mcp.local.json")
      }
    }
  };
}

describe("launcher OAuth/write readiness diagnostics", () => {
  it("does not treat elevated local write mode plus unknown OAuth scope as confirmed denial", () => {
    setLauncherWriteMode(tempRoot, "elevated");

    const status = getLauncherWriteAccessStatus(tempRoot);

    assert.equal(status.localWriteReadiness, "ready");
    assert.equal(status.oauthFilesWriteGranted, "unknown");
    assert.equal(status.oauthWriteReadiness, "no_active_stored_token");
    assert.equal(status.overallWriteReadiness, "unknown");
    assert.equal(status.publicWriteReadiness, "UNKNOWN");
    assert.doesNotMatch(status.overallWriteReadinessReason, /not granted/i);
  });

  it("uses last observed files.write discovery without turning zero active tokens into failure wording", () => {
    setLauncherWriteMode(tempRoot, "docs");
    const status = getLauncherWriteAccessStatus(tempRoot, process.env, discoveryTrace());

    assert.equal(status.oauthFilesWriteGranted, "unknown");
    assert.equal(status.oauthWriteReadiness, "last_observed_granted");
    assert.equal(status.overallWriteReadiness, "unknown");

    const state = createEmptyLauncherState();
    state.server.localEndpoint = "http://127.0.0.1:3333/mcp";
    state.server.publicEndpoint = "https://mcp.example.com/mcp";
    state.write = {
      ...state.write,
      mode: "docs",
      oauthFilesWriteGranted: status.oauthFilesWriteGranted,
      readiness: "warn",
      localReadiness: status.localWriteReadiness,
      localReadinessReason: status.localWriteReadinessReason,
      localReadinessSource: status.localWriteReadinessSource,
      oauthWriteReadiness: status.oauthWriteReadiness,
      oauthWriteReadinessLabel: status.oauthWriteReadinessLabel,
      oauthWriteReadinessDetail: status.oauthWriteReadinessDetail,
      oauthWriteReadinessSeverity: "info",
      oauthWriteEvidenceSource: status.oauthWriteEvidenceSource,
      oauthWriteEvidenceAt: status.oauthWriteEvidenceAt,
      overallReadiness: status.overallWriteReadiness,
      overallReadinessReason: status.overallWriteReadinessReason
    };
    const html = renderToStaticMarkup(React.createElement(DashboardScreen, {
      state,
      handlers: {},
      onNavigate: () => undefined
    }));

    assert.match(html, /Last authenticated ChatGPT MCP discovery included files\.write/u);
    assert.doesNotMatch(html, /Filesystem write operations will fail/u);
  });

  it("marks confirmed request evidence missing files.write as blocked", () => {
    setLauncherWriteMode(tempRoot, "docs");
    const trace = discoveryTrace({
      auth: {
        kind: "oauth",
        subject: "client-1",
        clientId: "client-1",
        scope: "files.read",
        scopes: ["files.read"]
      },
      tools: {
        ...discoveryTrace().tools,
        scopeFilteredTools: [{ name: "write_markdown_artifact", reason: "missing OAuth scope files.write" }]
      },
      response: {
        statusCode: 403,
        contentType: "application/json; charset=utf-8",
        kind: "wrong-http-status",
        transportRoute: "scope-denied",
        error: "OAuth scope files.write is required to call write_markdown_artifact."
      }
    });

    const status = getLauncherWriteAccessStatus(tempRoot, process.env, trace);

    assert.equal(status.oauthFilesWriteGranted, false);
    assert.equal(status.oauthWriteReadiness, "not_granted");
    assert.equal(status.overallWriteReadiness, "blocked");
    assert.equal(status.publicWriteReadiness, "NOT_READY");
  });

  it("labels an old Missing client_id authorize error as stale after newer successful discovery", () => {
    const errorTime = new Date(Date.now() - 60_000).toISOString();
    writeLastOAuthAuthorizeError(tempRoot, authorizeError(errorTime));
    const newerTrace = discoveryTrace({ timestamp: new Date().toISOString() });

    const oauthStatus = getLauncherOAuthStatus(tempRoot, newerTrace);
    const writeStatus = getLauncherWriteAccessStatus(tempRoot, process.env, newerTrace);

    assert.equal(oauthStatus.lastAuthorizeError?.stale, true);
    assert.match(oauthStatus.lastAuthorizeError?.displayLabel ?? "", /^stale:/u);
    assert.equal(writeStatus.oauthWriteReadiness, "last_observed_granted");
  });

  it("counts doctor DCR probe clients separately from ChatGPT clients", () => {
    writeOAuthClientStore(tempRoot, {
      clients: [
        {
          client_id: "chatgpt-client",
          redirect_uris: ["https://chatgpt.com/connector/oauth/real"],
          client_name: "ChatGPT",
          grant_types: ["authorization_code"],
          response_types: ["code"],
          scope: "files.read files.write",
          created_at: new Date().toISOString()
        },
        {
          client_id: "doctor-probe",
          redirect_uris: ["https://chatgpt.com/connector/oauth/champcity-doctor"],
          client_name: "ChampCity Doctor DCR Probe",
          grant_types: ["authorization_code"],
          response_types: ["code"],
          scope: "files.read",
          created_at: new Date().toISOString()
        }
      ]
    });

    const status = getLauncherOAuthStatus(tempRoot);

    assert.equal(status.registeredClientsCount, 2);
    assert.equal(status.registeredChatGptClientsCount, 1);
    assert.equal(status.registeredDoctorProbeClientsCount, 1);
    assert.equal(status.registeredOtherClientsCount, 0);
  });

  it("maps unknown OAuth write readiness to a warning issue instead of confirmed not granted", () => {
    setLauncherWriteMode(tempRoot, "docs");
    const state = adaptLauncherState(appStatus(), localLauncherConfig(), []);
    const issue = state.issues.find((entry) => entry.id === "files-write-unknown");

    assert.ok(issue);
    assert.equal(issue.severity, "warn");
    assert.doesNotMatch(issue.what, /not granted/i);
    assert.equal(state.issues.some((entry) => entry.id === "files-write-not-granted"), false);
  });

  it("shows auto-start warning instead of public tunnel outage when current endpoint evidence is reachable", () => {
    const trace = discoveryTrace({
      jsonRpc: {
        ...discoveryTrace().jsonRpc,
        methods: ["initialize"],
        hasInitialize: true
      }
    });
    const diagnostics = getPublicTunnelDiagnostics({
      publicBaseUrl: "https://public.example.test",
      localHealthPassing: true,
      lastDiscoveryTrace: trace,
      doctorChecks: [
        { name: "Public OAuth metadata status", status: "PASS", detail: "HTTP 200" },
        { name: "Public protected resource metadata status", status: "PASS", detail: "HTTP 200" },
        { name: "Public Dynamic Client Registration status", status: "PASS", detail: "HTTP 201" }
      ]
    });
    const base = appStatus();
    const status = {
      ...base,
      http: {
        ...base.http,
        lastMcpDiscoveryTrace: trace,
        tunnelReadinessStatus: diagnostics.legacyTunnelReadinessStatus,
        publicTunnelReady: diagnostics.overallTunnelReadiness === "ready",
        publicTunnelDiagnostics: diagnostics
      }
    };
    const state = adaptLauncherState(status, localLauncherConfig(), []);
    const html = renderToStaticMarkup(React.createElement(TroubleshootScreen, {
      state,
      handlers: {},
      onNavigate: () => undefined
    }));

    assert.equal(diagnostics.publicReachability, "reachable");
    assert.equal(state.issues.some((entry) => entry.title === "Public tunnel is not ready"), false);
    assert.equal(state.issues.some((entry) => entry.title === "Public endpoint is unreachable"), false);
    assert.ok(state.issues.find((entry) => entry.title === "Cloudflare tunnel auto-start is not confirmed"));
    assert.match(html, /Cloudflare tunnel auto-start is not confirmed/u);
    assert.doesNotMatch(html, /Public tunnel is not ready/u);
  });

  it("shows a blocking public endpoint issue when public reachability fails", () => {
    const diagnostics = getPublicTunnelDiagnostics({
      publicBaseUrl: "https://public.example.test",
      localHealthPassing: true,
      lastDiscoveryTrace: null,
      doctorChecks: [
        { name: "Public OAuth metadata status", status: "FAIL", detail: "request failed" },
        { name: "Public protected resource metadata status", status: "FAIL", detail: "request failed" },
        { name: "Public Dynamic Client Registration status", status: "FAIL", detail: "request failed" }
      ]
    });
    const base = appStatus();
    const state = adaptLauncherState({
      ...base,
      http: {
        ...base.http,
        tunnelReadinessStatus: diagnostics.legacyTunnelReadinessStatus,
        publicTunnelReady: diagnostics.overallTunnelReadiness === "ready",
        publicTunnelDiagnostics: diagnostics
      }
    }, localLauncherConfig(), []);
    const issue = state.issues.find((entry) => entry.id === "public-endpoint-unreachable");

    assert.equal(diagnostics.publicReachability, "unreachable");
    assert.ok(issue);
    assert.equal(issue.severity, "error");
    assert.equal(issue.title, "Public endpoint is unreachable");
  });

  it("classifies passing metadata, protected resource, DCR, and ChatGPT discovery evidence as reachable", () => {
    const diagnostics = getPublicTunnelDiagnostics({
      publicBaseUrl: "https://public.example.test",
      localHealthPassing: true,
      lastDiscoveryTrace: discoveryTrace({
        jsonRpc: {
          ...discoveryTrace().jsonRpc,
          methods: ["initialize"],
          hasInitialize: true
        }
      }),
      doctorChecks: [
        { name: "Public OAuth metadata status", status: "PASS", detail: "HTTP 200" },
        { name: "Public protected resource metadata status", status: "PASS", detail: "HTTP 200" },
        { name: "Public Dynamic Client Registration status", status: "PASS", detail: "HTTP 201" }
      ]
    });

    assert.equal(diagnostics.publicReachability, "reachable");
    assert.equal(diagnostics.overallTunnelReadiness, "current_ready_persistence_unconfirmed");
    assert.equal(diagnostics.legacyTunnelReadinessStatus, "WARN");
  });

  it("infers warn, not error, for doctor output with PASS and WARN checks but no FAIL checks", () => {
    const output = [
      "WARN Doctor summary: 3 checks completed.",
      "PASS Last OAuth error: none recorded",
      "PASS Public OAuth metadata status: HTTP 200",
      "WARN ChatGPT delete/recreate connector required: advisory only"
    ].join("\n");

    assert.equal(inferLogLevel(output), "warn");
    assert.equal(inferLogLevel("PASS Last OAuth error: none recorded"), "info");
    assert.equal(inferLogLevel("FAIL Public OAuth metadata status: request failed"), "error");
  });

  it("marks packaged runtime developer CLI probe skips as expected instead of user-facing warnings", () => {
    const check = getPackagedDeveloperCliProbeCheck();

    assert.equal(check.name, "Developer CLI entrypoint probe");
    assert.equal(check.status, "PASS");
    assert.match(check.detail, /Skipped in packaged runtime as expected/u);
  });
});
