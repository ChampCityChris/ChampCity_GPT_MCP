import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { type AppConfig } from "../config.js";
import {
  sanitizeDiagnosticBoolean,
  sanitizeDiagnosticIdentifier,
  sanitizeDiagnosticInteger,
  sanitizeDiagnosticJsonRpcId,
  sanitizeDiagnosticKeyName,
  sanitizeDiagnosticRoute,
  sanitizeDiagnosticSha256,
  sanitizeDiagnosticStringArray,
  sanitizeDiagnosticText
} from "../security/diagnosticRedaction.js";
import { classifyAppErrorCode } from "../utils/errorClassification.js";

export type ToolCallTraceStage =
  | "http_received"
  | "dispatch_started"
  | "toolbox_entered"
  | "helper_started"
  | "helper_allowed"
  | "helper_denied"
  | "tool_result_returned"
  | "http_response_completed"
  | "result_materialized"
  | "result_serialized"
  | "http_response_finished"
  | "http_connection_closed"
  | "client_result_acknowledged"
  | "transport_error";

export type ToolCallClassification =
  | "NO_SERVER_RECEIPT_EVIDENCE"
  | "RECEIVED_NOT_DISPATCHED"
  | "DISPATCHED_NOT_EXECUTED"
  | "APP_CONTRACT_REJECTED"
  | "APP_POLICY_DENIED"
  | "APP_AUTHORIZATION_DENIED"
  | "APP_EXECUTION_ERROR"
  | "RESULT_MATERIALIZED"
  | "RESULT_SERIALIZED"
  | "RESULT_RETURNED"
  | "RESPONSE_FINISHED_UNACKNOWLEDGED"
  | "RESPONSE_COMPLETED"
  | "CLIENT_ACKNOWLEDGED"
  | "CONNECTION_CLOSED_BEFORE_FINISH"
  | "TRANSPORT_ERROR"
  | "CORRELATION_AGGREGATE";

export interface ToolCallTraceContext {
  correlationId: string;
  startedAt: number;
  httpMethod?: string;
  mcpRoute?: string;
  jsonRpcMethod?: string;
  jsonRpcId?: string | number | null;
  requestIdKey?: string;
  publicTool?: string;
  action?: string;
  workspaceId?: string;
  requestedPath?: string;
  resultAttemptId?: string;
  attemptNumber?: number;
  parentResultAttemptId?: string;
  resultTelemetrySchemaVersion?: number;
  payloadSha256?: string;
}

export interface ToolCallTraceGroupContext {
  requestGroupId: string;
  toolCalls: ToolCallTraceContext[];
}

export interface ToolCallTraceEvent {
  timestamp: string;
  correlationId: string;
  stage: ToolCallTraceStage;
  httpMethod?: string;
  mcpRoute?: string;
  jsonRpcMethod?: string;
  jsonRpcId?: string | number | null;
  publicTool?: string;
  action?: string;
  workspaceId?: string;
  requestedPath?: string;
  result?: "allow" | "deny" | "error";
  errorCode?: string;
  errorMessage?: string;
  httpStatus?: number;
  durationMs?: number;
  responseRoute?: string;
  responseKind?: string;
  resultAttemptId?: string;
  attemptNumber?: number;
  parentResultAttemptId?: string;
  resultTelemetrySchemaVersion?: number;
  serializerName?: string;
  serializerVersion?: string;
  contentItemCount?: number;
  contentItemTypes?: string[];
  structuredContentPresent?: boolean;
  payloadBytes?: number;
  payloadSha256?: string;
  finalPayloadBytes?: number;
  finalPayloadSha256?: string;
  maximumContentItemBytes?: number;
  textCharacterCount?: number;
  textLineCount?: number;
  topLevelResultKeys?: string[];
  truncated?: boolean;
  chunked?: boolean;
  chunkIndex?: number;
  chunkCount?: number;
  sourceSha256?: string;
  sourceRangeStart?: number;
  sourceRangeEnd?: number;
  continuationPresent?: boolean;
  responseContentType?: string;
  contentLengthHeader?: number;
  socketBytesWrittenDelta?: number;
  finishObserved?: boolean;
  closeObserved?: boolean;
  closeBeforeFinish?: boolean;
  transportErrorCode?: string;
  acknowledgementTimestamp?: string;
  acknowledgementMethod?: string;
}

export interface RecentToolCallSummary {
  correlationId: string;
  classification: ToolCallClassification;
  explanation: string;
  queryScope?: "correlation" | "result_attempt";
  startedAt: string;
  lastEventAt: string;
  publicTool?: string;
  action?: string;
  workspaceId?: string;
  eventCount: number;
  stages: ToolCallTraceStage[];
  events: ToolCallTraceEvent[];
  attempts?: RecentToolCallAttemptSummary[];
}

export interface RecentToolCallAttemptSummary {
  correlationId: string;
  resultAttemptId: string;
  attemptNumber?: number;
  classification: ToolCallClassification;
  explanation: string;
  startedAt: string;
  lastEventAt: string;
  eventCount: number;
  stages: ToolCallTraceStage[];
}

export interface RecentToolCallQuery {
  limit?: number;
  since?: string;
  correlationId?: string;
  publicToolName?: string;
}

const traceContext = new AsyncLocalStorage<ToolCallTraceContext | ToolCallTraceGroupContext>();
export const MAX_TRACE_EVENTS = 2_000;

export class ToolCallTraceIdentityMismatchError extends Error {
  constructor() {
    super("HTTP tool-call trace identity mismatch.");
    this.name = "ToolCallTraceIdentityMismatchError";
  }
}

export function isToolCallTraceIdentityMismatchError(error: unknown): error is ToolCallTraceIdentityMismatchError {
  return error instanceof ToolCallTraceIdentityMismatchError
    || (error instanceof Error && error.name === "ToolCallTraceIdentityMismatchError");
}

export function createToolCallCorrelationId(): string {
  return randomUUID();
}

export function runWithToolCallTraceContext<T>(context: ToolCallTraceContext, handler: () => T): T {
  return traceContext.run(context, handler);
}

export function runWithToolCallTraceGroupContext<T>(context: ToolCallTraceGroupContext, handler: () => T): T {
  return traceContext.run(context, handler);
}

export function getCurrentToolCallTraceContext(): ToolCallTraceContext | undefined {
  const context = traceContext.getStore();
  return context && "correlationId" in context ? context : undefined;
}

export function updateCurrentToolCallTraceContext(update: Partial<Omit<ToolCallTraceContext, "correlationId" | "startedAt">>): void {
  const context = traceContext.getStore();
  if (!context) {
    return;
  }

  Object.assign(context, update);
}

export function toolCallTraceRequestIdKey(requestId: unknown): string | undefined {
  if (typeof requestId === "number") {
    return Number.isFinite(requestId) ? `number:${requestId}` : undefined;
  }

  if (typeof requestId === "string") {
    return `string:${createHash("sha256").update(requestId).digest("base64url")}`;
  }

  if (requestId === null) {
    return "null";
  }

  return undefined;
}

export function runWithToolCallTraceRequestId<T>(requestId: unknown, handler: () => T): T {
  const context = traceContext.getStore();
  if (!context || "correlationId" in context) {
    return handler();
  }

  const requestIdKey = toolCallTraceRequestIdKey(requestId);
  const selectedIndex = requestIdKey === undefined ? -1 : context.toolCalls.findIndex((toolCall) => toolCall.requestIdKey === requestIdKey);

  if (selectedIndex < 0) {
    throw new ToolCallTraceIdentityMismatchError();
  }

  const [selected] = context.toolCalls.splice(selectedIndex, 1);
  return traceContext.run(selected, handler);
}

export function getToolCallTracePaths(config: AppConfig): { tracePath: string } {
  return {
    tracePath: path.join(path.dirname(config.auditLogPath), "mcp-tool-call-trace.ndjson")
  };
}

function safeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? sanitizeDiagnosticText(value.trim()) : undefined;
}

function safeJsonRpcId(value: unknown): string | number | null | undefined {
  return sanitizeDiagnosticJsonRpcId(value);
}

function safeInteger(value: unknown): number | undefined {
  return sanitizeDiagnosticInteger(value);
}

function sanitizeEvent(event: Partial<ToolCallTraceEvent>, context?: ToolCallTraceContext): ToolCallTraceEvent {
  const correlationId = safeString(event.correlationId) ?? context?.correlationId ?? createToolCallCorrelationId();
  const eventJsonRpcId = safeJsonRpcId(event.jsonRpcId);
  const contextJsonRpcId = safeJsonRpcId(context?.jsonRpcId);
  return {
    timestamp: event.timestamp ?? new Date().toISOString(),
    correlationId,
    stage: event.stage ?? "transport_error",
    httpMethod: safeString(event.httpMethod) ?? context?.httpMethod,
    mcpRoute: sanitizeDiagnosticRoute(event.mcpRoute) ?? sanitizeDiagnosticRoute(context?.mcpRoute),
    jsonRpcMethod: safeString(event.jsonRpcMethod) ?? context?.jsonRpcMethod,
    jsonRpcId: eventJsonRpcId !== undefined ? eventJsonRpcId : contextJsonRpcId,
    publicTool: safeString(event.publicTool) ?? context?.publicTool,
    action: safeString(event.action) ?? context?.action,
    workspaceId: safeString(event.workspaceId) ?? context?.workspaceId,
    requestedPath: safeString(event.requestedPath) ?? safeString(context?.requestedPath),
    resultAttemptId: sanitizeDiagnosticIdentifier(event.resultAttemptId) ?? context?.resultAttemptId,
    attemptNumber: safeInteger(event.attemptNumber) ?? context?.attemptNumber,
    parentResultAttemptId: sanitizeDiagnosticIdentifier(event.parentResultAttemptId) ?? context?.parentResultAttemptId,
    resultTelemetrySchemaVersion: safeInteger(event.resultTelemetrySchemaVersion) ?? context?.resultTelemetrySchemaVersion,
    result: event.result,
    errorCode: safeString(event.errorCode),
    errorMessage: safeString(event.errorMessage),
    httpStatus: typeof event.httpStatus === "number" ? event.httpStatus : undefined,
    durationMs: typeof event.durationMs === "number" && Number.isFinite(event.durationMs) ? Math.max(0, Math.round(event.durationMs)) : undefined,
    responseRoute: sanitizeDiagnosticRoute(event.responseRoute),
    responseKind: safeString(event.responseKind),
    serializerName: sanitizeDiagnosticKeyName(event.serializerName),
    serializerVersion: sanitizeDiagnosticKeyName(event.serializerVersion),
    contentItemCount: safeInteger(event.contentItemCount),
    contentItemTypes: sanitizeDiagnosticStringArray(event.contentItemTypes),
    structuredContentPresent: sanitizeDiagnosticBoolean(event.structuredContentPresent),
    payloadBytes: safeInteger(event.payloadBytes),
    payloadSha256: sanitizeDiagnosticSha256(event.payloadSha256) ?? context?.payloadSha256,
    finalPayloadBytes: safeInteger(event.finalPayloadBytes),
    finalPayloadSha256: sanitizeDiagnosticSha256(event.finalPayloadSha256),
    maximumContentItemBytes: safeInteger(event.maximumContentItemBytes),
    textCharacterCount: safeInteger(event.textCharacterCount),
    textLineCount: safeInteger(event.textLineCount),
    topLevelResultKeys: sanitizeDiagnosticStringArray(event.topLevelResultKeys),
    truncated: sanitizeDiagnosticBoolean(event.truncated),
    chunked: sanitizeDiagnosticBoolean(event.chunked),
    chunkIndex: safeInteger(event.chunkIndex),
    chunkCount: safeInteger(event.chunkCount),
    sourceSha256: sanitizeDiagnosticSha256(event.sourceSha256),
    sourceRangeStart: safeInteger(event.sourceRangeStart),
    sourceRangeEnd: safeInteger(event.sourceRangeEnd),
    continuationPresent: sanitizeDiagnosticBoolean(event.continuationPresent),
    responseContentType: safeString(event.responseContentType),
    contentLengthHeader: safeInteger(event.contentLengthHeader),
    socketBytesWrittenDelta: safeInteger(event.socketBytesWrittenDelta),
    finishObserved: sanitizeDiagnosticBoolean(event.finishObserved),
    closeObserved: sanitizeDiagnosticBoolean(event.closeObserved),
    closeBeforeFinish: sanitizeDiagnosticBoolean(event.closeBeforeFinish),
    transportErrorCode: safeString(event.transportErrorCode),
    acknowledgementTimestamp: safeString(event.acknowledgementTimestamp),
    acknowledgementMethod: sanitizeDiagnosticKeyName(event.acknowledgementMethod)
  };
}

export function recordToolCallTrace(config: AppConfig, event: Partial<ToolCallTraceEvent> & { stage: ToolCallTraceStage }): void {
  try {
    const context = traceContext.getStore();
    const sanitized = sanitizeEvent(event, context && "correlationId" in context ? context : undefined);
    const { tracePath } = getToolCallTracePaths(config);
    fs.mkdirSync(path.dirname(tracePath), { recursive: true });
    fs.appendFileSync(tracePath, `${JSON.stringify(sanitized)}\n`, "utf8");
    compactTraceFile(tracePath);
  } catch (error) {
    const message = error instanceof Error ? sanitizeDiagnosticText(error.message) : sanitizeDiagnosticText(String(error));
    console.warn(`Failed to write MCP tool-call trace: ${message}`);
  }
}

function parseTraceLine(line: string): ToolCallTraceEvent | undefined {
  try {
    const parsed = JSON.parse(line) as Partial<ToolCallTraceEvent>;
    if (typeof parsed.correlationId !== "string" || typeof parsed.stage !== "string") {
      return undefined;
    }
    return sanitizeEvent(parsed);
  } catch {
    return undefined;
  }
}

function compactTraceFile(tracePath: string): void {
  const lines = fs.readFileSync(tracePath, "utf8").split(/\r?\n/u).filter(Boolean);
  const events = lines.map(parseTraceLine).filter((event): event is ToolCallTraceEvent => Boolean(event));
  if (events.length <= MAX_TRACE_EVENTS && events.length === lines.length) {
    return;
  }

  const newestEvents = events.slice(-MAX_TRACE_EVENTS);
  const tempPath = `${tracePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${newestEvents.map((event) => JSON.stringify(event)).join("\n")}${newestEvents.length ? "\n" : ""}`, "utf8");
  fs.renameSync(tempPath, tracePath);
}

export function readToolCallTraceEvents(config: AppConfig): ToolCallTraceEvent[] {
  const { tracePath } = getToolCallTracePaths(config);
  if (!fs.existsSync(tracePath)) {
    return [];
  }

  return fs.readFileSync(tracePath, "utf8").split(/\r?\n/u).filter(Boolean).map(parseTraceLine).filter((event): event is ToolCallTraceEvent => Boolean(event));
}

function eventMatchesFilter(event: ToolCallTraceEvent, query: RecentToolCallQuery): boolean {
  if (query.correlationId && event.correlationId !== query.correlationId) {
    return false;
  }

  if (query.publicToolName && event.publicTool !== query.publicToolName) {
    return false;
  }

  if (query.since && Date.parse(event.timestamp) < Date.parse(query.since)) {
    return false;
  }

  return true;
}

export function classifyToolCallTraceEvents(events: ToolCallTraceEvent[]): { classification: ToolCallClassification; explanation: string } {
  const stages = new Set(events.map((event) => event.stage));
  const errorCodes = new Set(events.map((event) => event.errorCode).filter((code): code is string => Boolean(code)));
  const hasErroredResult = events.some((event) => event.stage === "tool_result_returned" && (event.result === "deny" || event.result === "error"));
  const classifications = [...errorCodes].map((code) => classifyAppErrorCode(code));

  // Classification is intentionally deepest-server-stage first, with policy/error
  // outcomes taking precedence over normal HTTP completion.
  if (stages.has("transport_error")) {
    return { classification: "TRANSPORT_ERROR", explanation: "The MCP server received the request and recorded a transport error." };
  }

  if (stages.has("http_connection_closed") && events.some((event) => event.closeBeforeFinish)) {
    return { classification: "CONNECTION_CLOSED_BEFORE_FINISH", explanation: "The HTTP connection closed before response finish was observed." };
  }

  if (classifications.includes("authorization")) {
    return { classification: "APP_AUTHORIZATION_DENIED", explanation: "The MCP application denied the call because authorization or OAuth scope was insufficient." };
  }

  if (classifications.includes("policy")) {
    return { classification: "APP_POLICY_DENIED", explanation: "The MCP application denied the call through application safety policy, path, write-mode, or workspace policy." };
  }

  if (classifications.includes("contract")) {
    return { classification: "APP_CONTRACT_REJECTED", explanation: "The MCP application rejected malformed input, unsupported action, or schema-invalid parameters." };
  }

  if (hasErroredResult) {
    return { classification: "APP_EXECUTION_ERROR", explanation: "The MCP application returned an error result after dispatch." };
  }

  if (stages.has("client_result_acknowledged")) {
    return { classification: "CLIENT_ACKNOWLEDGED", explanation: "A later diagnostic acknowledgement matched the result attempt and payload digest." };
  }

  if (stages.has("result_serialized") && (stages.has("http_response_finished") || stages.has("http_response_completed"))) {
    return { classification: "RESPONSE_FINISHED_UNACKNOWLEDGED", explanation: "The MCP server finished the HTTP response, but no explicit client acknowledgement was recorded." };
  }

  if (stages.has("result_serialized")) {
    return { classification: "RESULT_SERIALIZED", explanation: "The public MCP CallToolResult was serialized and measured, but HTTP finish was not recorded." };
  }

  if (stages.has("result_materialized")) {
    return { classification: "RESULT_MATERIALIZED", explanation: "The toolbox result materialized before public MCP serialization." };
  }

  if (stages.has("tool_result_returned") && (stages.has("http_response_finished") || stages.has("http_response_completed"))) {
    return { classification: "RESPONSE_FINISHED_UNACKNOWLEDGED", explanation: "The MCP server finished the HTTP response, but no explicit client acknowledgement was recorded." };
  }

  if (stages.has("tool_result_returned")) {
    return { classification: "RESULT_RETURNED", explanation: "The public tool handler returned a result, but response completion was not recorded." };
  }

  if (stages.has("dispatch_started")) {
    if (stages.has("result_serialized") && (stages.has("http_response_finished") || stages.has("http_response_completed"))) {
      return { classification: "RESPONSE_FINISHED_UNACKNOWLEDGED", explanation: "The MCP server finished the HTTP response, but no explicit client acknowledgement was recorded." };
    }
    if (stages.has("http_response_completed")) {
      return { classification: "RESPONSE_FINISHED_UNACKNOWLEDGED", explanation: "A legacy HTTP response-completed event exists, but no explicit client acknowledgement was recorded." };
    }
    if (stages.has("result_serialized")) {
      return { classification: "RESULT_SERIALIZED", explanation: "The public MCP CallToolResult was serialized and measured, but HTTP finish was not recorded." };
    }
    if (stages.has("result_materialized")) {
      return { classification: "RESULT_MATERIALIZED", explanation: "The toolbox result materialized before public MCP serialization." };
    }
    if (stages.has("tool_result_returned")) {
      return { classification: "RESULT_RETURNED", explanation: "The public tool handler returned a result, but response completion was not recorded." };
    }
    return { classification: "DISPATCHED_NOT_EXECUTED", explanation: "The MCP dispatcher started, but toolbox/helper execution did not complete." };
  }

  if (stages.has("http_response_finished") || stages.has("http_response_completed")) {
    return { classification: "RECEIVED_NOT_DISPATCHED", explanation: "The HTTP request was received, but MCP dispatch was not observed." };
  }

  return { classification: "RECEIVED_NOT_DISPATCHED", explanation: "The HTTP request was received, but MCP dispatch was not observed." };
}

function summarizeAttempt(correlationId: string, resultAttemptId: string, events: ToolCallTraceEvent[]): RecentToolCallAttemptSummary {
  const orderedEvents = [...events].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  const classification = classifyToolCallTraceEvents(orderedEvents);
  const firstEvent = orderedEvents[0];
  const lastEvent = orderedEvents[orderedEvents.length - 1];
  return {
    correlationId,
    resultAttemptId,
    attemptNumber: [...orderedEvents].reverse().find((event) => event.attemptNumber !== undefined)?.attemptNumber,
    ...classification,
    startedAt: firstEvent.timestamp,
    lastEventAt: lastEvent.timestamp,
    eventCount: orderedEvents.length,
    stages: [...new Set(orderedEvents.map((event) => event.stage))]
  };
}

function attemptSummariesForEvents(events: ToolCallTraceEvent[]): RecentToolCallAttemptSummary[] {
  const grouped = new Map<string, ToolCallTraceEvent[]>();
  for (const event of events) {
    if (!event.resultAttemptId) {
      continue;
    }
    const key = `${event.correlationId}\u0000${event.resultAttemptId}`;
    const attemptEvents = grouped.get(key) ?? [];
    attemptEvents.push(event);
    grouped.set(key, attemptEvents);
  }

  return [...grouped.entries()]
    .map(([key, attemptEvents]) => {
      const [correlationId, resultAttemptId] = key.split("\u0000");
      return summarizeAttempt(correlationId, resultAttemptId, attemptEvents);
    })
    .sort((left, right) => Date.parse(right.lastEventAt) - Date.parse(left.lastEventAt));
}

export function readRecentToolCalls(config: AppConfig, query: RecentToolCallQuery = {}): { calls: RecentToolCallSummary[]; warnings?: string[] } {
  if (query.since && Number.isNaN(Date.parse(query.since))) {
    throw new Error("recent_tool_calls since must be a strict ISO-8601 timestamp.");
  }

  const limit = Math.min(Math.max(query.limit ?? 20, 1), 50);
  const matchingEvents = readToolCallTraceEvents(config).filter((event) => eventMatchesFilter(event, query));
  const hasReceiptEvidence = matchingEvents.some((event) => event.stage === "http_received");
  if (matchingEvents.length === 0 && (query.correlationId || query.since)) {
    return {
      calls: [
        {
          correlationId: query.correlationId ?? "NO_MATCHING_CORRELATION_ID",
          classification: "NO_SERVER_RECEIPT_EVIDENCE",
          explanation: "No matching server receipt evidence was found.",
          startedAt: new Date(0).toISOString(),
          lastEventAt: new Date(0).toISOString(),
          eventCount: 0,
          stages: [],
          events: []
        }
      ]
    };
  }

  if (!hasReceiptEvidence && (query.correlationId || query.since)) {
    return {
      calls: [
        {
          correlationId: query.correlationId ?? "NO_MATCHING_CORRELATION_ID",
          classification: "NO_SERVER_RECEIPT_EVIDENCE",
          explanation: "No matching server receipt evidence was found.",
          startedAt: new Date(0).toISOString(),
          lastEventAt: new Date(0).toISOString(),
          eventCount: 0,
          stages: [],
          events: []
        }
      ]
    };
  }

  const grouped = new Map<string, ToolCallTraceEvent[]>();
  for (const event of matchingEvents) {
    const events = grouped.get(event.correlationId) ?? [];
    events.push(event);
    grouped.set(event.correlationId, events);
  }

  const calls = [...grouped.entries()]
    .map(([correlationId, events]) => {
      const orderedEvents = events.sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
      const attempts = attemptSummariesForEvents(orderedEvents);
      const classification = attempts.length > 1
        ? {
            classification: "CORRELATION_AGGREGATE" as const,
            explanation: "This correlation contains multiple result attempts; inspect per-attempt summaries for exact delivery state."
          }
        : attempts[0]
          ? {
              classification: attempts[0].classification,
              explanation: attempts[0].explanation
            }
          : classifyToolCallTraceEvents(orderedEvents);
      const firstEvent = orderedEvents[0];
      const lastEvent = orderedEvents[orderedEvents.length - 1];
      const publicTool = [...orderedEvents].reverse().find((event) => event.publicTool)?.publicTool;
      const action = [...orderedEvents].reverse().find((event) => event.action)?.action;
      const workspaceId = [...orderedEvents].reverse().find((event) => event.workspaceId)?.workspaceId;
      return {
        correlationId,
        ...classification,
        queryScope: "correlation" as const,
        startedAt: firstEvent.timestamp,
        lastEventAt: lastEvent.timestamp,
        publicTool,
        action,
        workspaceId,
        eventCount: orderedEvents.length,
        stages: [...new Set(orderedEvents.map((event) => event.stage))],
        events: orderedEvents,
        ...(attempts.length > 0 ? { attempts } : {})
      };
    })
    .sort((left, right) => Date.parse(right.lastEventAt) - Date.parse(left.lastEventAt))
    .slice(0, limit);

  return { calls };
}
