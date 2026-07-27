import fs from "node:fs";
import path from "node:path";

import { type AppConfig } from "../config.js";
import {
  sanitizeDiagnosticEndpoint,
  sanitizeDiagnosticJsonRpcId,
  sanitizeDiagnosticRoute,
  sanitizeDiagnosticText
} from "../security/diagnosticRedaction.js";

export interface McpDiscoveryTraceRequest {
  httpMethod: string;
  path: string;
  publicBaseUrl: string;
  host?: string;
  forwardedHost?: string;
  forwardedProto?: string;
  cfRay?: string;
  userAgent?: string;
  accept?: string;
  normalizedAccept?: string;
  contentType?: string;
  mcpSessionIdPresent: boolean;
}

export interface McpDiscoveryTraceAuth {
  kind: "oauth" | "legacy" | "local-unauth" | "unauthenticated";
  subject: string;
  clientId?: string;
  scope: string;
  scopes: string[];
}

export interface McpDiscoveryTraceTools {
  countBeforeFiltering: number;
  countAfterMcpSchemaValidation: number;
  countAfterChatGptSchemaSanitization: number;
  countAfterScopeFiltering: number;
  finalToolCountReturned: number;
  finalToolNamesReturned: string[];
  invalidToolSchemas: Array<{ name: string; reason: string }>;
  invalidChatGptToolSchemas: Array<{ name: string; reason: string }>;
  scopeFilteredTools: Array<{ name: string; reason: string }>;
  sanitizedToolSchemas: Array<{ name: string; removedKeywords: string[] }>;
}

export interface McpDiscoveryTraceResponse {
  statusCode: number;
  contentType: string;
  kind: "json-rpc-response" | "sse-event-stream-response" | "empty-accepted-response" | "wrong-content-type" | "wrong-http-status";
  transportRoute: "stateful-session" | "stateless-compat" | "auth-denied" | "scope-denied" | "bad-request" | "server-error";
  error?: string;
}

export interface McpDiscoverySequenceEntry {
  timestamp: string;
  methods: string[];
  responseStatusCode: number;
  responseKind: McpDiscoveryTraceResponse["kind"];
}

export interface McpDiscoveryTrace {
  timestamp: string;
  processId: number;
  request: McpDiscoveryTraceRequest;
  jsonRpc: {
    isBatch: boolean;
    methods: string[];
    ids: Array<string | number | null>;
    hasInitialize: boolean;
    hasInitializedNotification: boolean;
    hasToolsList: boolean;
    hasResourcesList: boolean;
    hasPromptsList: boolean;
  };
  auth: McpDiscoveryTraceAuth;
  tools: McpDiscoveryTraceTools;
  response: McpDiscoveryTraceResponse;
  recentDiscoverySequence: {
    windowSeconds: number;
    entries: McpDiscoverySequenceEntry[];
    methodsObserved: string[];
  };
}

export function getMcpDiscoveryTracePaths(config: AppConfig): { lastTracePath: string; historyPath: string } {
  const logsDir = path.dirname(config.auditLogPath);
  return {
    lastTracePath: path.join(logsDir, "last-chatgpt-mcp-discovery.local.json"),
    historyPath: path.join(logsDir, "chatgpt-mcp-discovery.ndjson")
  };
}

function readRecentHistory(historyPath: string, subject: string, windowSeconds: number): McpDiscoverySequenceEntry[] {
  if (!fs.existsSync(historyPath)) {
    return [];
  }

  const cutoff = Date.now() - windowSeconds * 1000;
  const lines = fs.readFileSync(historyPath, "utf8").split(/\r?\n/u).filter(Boolean).slice(-100);
  const entries: McpDiscoverySequenceEntry[] = [];
  for (const line of lines) {
    try {
      const trace = sanitizeDiscoveryTrace(JSON.parse(line) as McpDiscoveryTrace);
      if (trace.auth.subject !== subject || Date.parse(trace.timestamp) < cutoff) {
        continue;
      }

      entries.push({
        timestamp: trace.timestamp,
        methods: trace.jsonRpc.methods,
        responseStatusCode: trace.response.statusCode,
        responseKind: trace.response.kind
      });
    } catch {
      // Ignore corrupt historical diagnostic lines.
    }
  }

  return entries;
}

function safeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? sanitizeDiagnosticText(value) : undefined;
}

function safeTextArray(values: unknown): string[] {
  return Array.isArray(values) ? values.map(safeText).filter((value): value is string => Boolean(value)) : [];
}

function sanitizeDiscoveryTrace(trace: Omit<McpDiscoveryTrace, "recentDiscoverySequence"> | McpDiscoveryTrace): McpDiscoveryTrace {
  const request = trace.request;
  const response = trace.response;
  return {
    ...trace,
    request: {
      httpMethod: safeText(request.httpMethod) ?? "UNKNOWN",
      path: sanitizeDiagnosticRoute(request.path) ?? "/mcp",
      publicBaseUrl: sanitizeDiagnosticEndpoint(request.publicBaseUrl) ?? "<REDACTED_ENDPOINT>",
      host: sanitizeDiagnosticEndpoint(request.host),
      forwardedHost: sanitizeDiagnosticEndpoint(request.forwardedHost),
      forwardedProto: safeText(request.forwardedProto),
      cfRay: safeText(request.cfRay),
      userAgent: safeText(request.userAgent),
      accept: safeText(request.accept),
      normalizedAccept: safeText(request.normalizedAccept),
      contentType: safeText(request.contentType),
      mcpSessionIdPresent: Boolean(request.mcpSessionIdPresent)
    },
    jsonRpc: {
      ...trace.jsonRpc,
      methods: safeTextArray(trace.jsonRpc.methods),
      ids: trace.jsonRpc.ids
        .map((id) => sanitizeDiagnosticJsonRpcId(id))
        .map((id) => id === undefined ? null : id)
    },
    auth: {
      kind: trace.auth.kind,
      subject: safeText(trace.auth.subject) ?? "unknown",
      clientId: safeText(trace.auth.clientId),
      scope: safeText(trace.auth.scope) ?? "",
      scopes: safeTextArray(trace.auth.scopes)
    },
    tools: {
      ...trace.tools,
      finalToolNamesReturned: safeTextArray(trace.tools.finalToolNamesReturned),
      invalidToolSchemas: trace.tools.invalidToolSchemas.map((entry) => ({
        name: safeText(entry.name) ?? "unknown",
        reason: safeText(entry.reason) ?? ""
      })),
      invalidChatGptToolSchemas: trace.tools.invalidChatGptToolSchemas.map((entry) => ({
        name: safeText(entry.name) ?? "unknown",
        reason: safeText(entry.reason) ?? ""
      })),
      scopeFilteredTools: trace.tools.scopeFilteredTools.map((entry) => ({
        name: safeText(entry.name) ?? "unknown",
        reason: safeText(entry.reason) ?? ""
      })),
      sanitizedToolSchemas: trace.tools.sanitizedToolSchemas.map((entry) => ({
        name: safeText(entry.name) ?? "unknown",
        removedKeywords: safeTextArray(entry.removedKeywords)
      }))
    },
    response: {
      ...response,
      contentType: safeText(response.contentType) ?? "",
      transportRoute: sanitizeDiagnosticRoute(response.transportRoute) as McpDiscoveryTraceResponse["transportRoute"] ?? "server-error",
      error: safeText(response.error)
    },
    recentDiscoverySequence: "recentDiscoverySequence" in trace
      ? {
          ...trace.recentDiscoverySequence,
          entries: trace.recentDiscoverySequence.entries.map((entry) => ({
            timestamp: entry.timestamp,
            methods: safeTextArray(entry.methods),
            responseStatusCode: entry.responseStatusCode,
            responseKind: entry.responseKind
          })),
          methodsObserved: safeTextArray(trace.recentDiscoverySequence.methodsObserved)
        }
      : {
          windowSeconds: 600,
          entries: [],
          methodsObserved: []
        }
  };
}

export function writeMcpDiscoveryTrace(config: AppConfig, trace: Omit<McpDiscoveryTrace, "recentDiscoverySequence">): void {
  const paths = getMcpDiscoveryTracePaths(config);
  const windowSeconds = 600;
  const sanitizedTrace = sanitizeDiscoveryTrace(trace);
  const recentEntries = [
    ...readRecentHistory(paths.historyPath, sanitizedTrace.auth.subject, windowSeconds),
    {
      timestamp: sanitizedTrace.timestamp,
      methods: sanitizedTrace.jsonRpc.methods,
      responseStatusCode: sanitizedTrace.response.statusCode,
      responseKind: sanitizedTrace.response.kind
    }
  ];
  const methodsObserved = [...new Set(recentEntries.flatMap((entry) => entry.methods))];
  const traceWithSequence: McpDiscoveryTrace = {
    ...sanitizedTrace,
    recentDiscoverySequence: {
      windowSeconds,
      entries: recentEntries,
      methodsObserved
    }
  };

  fs.mkdirSync(path.dirname(paths.lastTracePath), { recursive: true });
  fs.writeFileSync(paths.lastTracePath, `${JSON.stringify(traceWithSequence, null, 2)}\n`, "utf8");
  fs.appendFileSync(paths.historyPath, `${JSON.stringify(traceWithSequence)}\n`, "utf8");
}

export function readLastMcpDiscoveryTrace(config: AppConfig): McpDiscoveryTrace | null {
  const { lastTracePath } = getMcpDiscoveryTracePaths(config);
  if (!fs.existsSync(lastTracePath)) {
    return null;
  }

  return sanitizeDiscoveryTrace(JSON.parse(fs.readFileSync(lastTracePath, "utf8")) as McpDiscoveryTrace);
}
