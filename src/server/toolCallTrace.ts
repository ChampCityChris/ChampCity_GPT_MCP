import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { type AppConfig } from "../config.js";
import {
  sanitizeDiagnosticJsonRpcId,
  sanitizeDiagnosticRoute,
  sanitizeDiagnosticText
} from "../security/diagnosticRedaction.js";
import { isPolicyDeniedErrorCode } from "../utils/errorClassification.js";

export type ToolCallTraceStage =
  | "http_received"
  | "dispatch_started"
  | "toolbox_entered"
  | "helper_started"
  | "helper_allowed"
  | "helper_denied"
  | "tool_result_returned"
  | "http_response_completed"
  | "transport_error";

export type ToolCallClassification =
  | "NO_SERVER_RECEIPT_EVIDENCE"
  | "RECEIVED_NOT_DISPATCHED"
  | "DISPATCHED_NOT_EXECUTED"
  | "APP_POLICY_DENIED"
  | "APP_EXECUTION_ERROR"
  | "RESULT_RETURNED"
  | "RESPONSE_COMPLETED"
  | "TRANSPORT_ERROR";

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
}

export interface RecentToolCallSummary {
  correlationId: string;
  classification: ToolCallClassification;
  explanation: string;
  startedAt: string;
  lastEventAt: string;
  publicTool?: string;
  action?: string;
  workspaceId?: string;
  eventCount: number;
  stages: ToolCallTraceStage[];
  events: ToolCallTraceEvent[];
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
    result: event.result,
    errorCode: safeString(event.errorCode),
    errorMessage: safeString(event.errorMessage),
    httpStatus: typeof event.httpStatus === "number" ? event.httpStatus : undefined,
    durationMs: typeof event.durationMs === "number" && Number.isFinite(event.durationMs) ? Math.max(0, Math.round(event.durationMs)) : undefined,
    responseRoute: sanitizeDiagnosticRoute(event.responseRoute),
    responseKind: safeString(event.responseKind)
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

function readTraceEvents(config: AppConfig): ToolCallTraceEvent[] {
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

function classify(events: ToolCallTraceEvent[]): { classification: ToolCallClassification; explanation: string } {
  const stages = new Set(events.map((event) => event.stage));
  const errorCodes = new Set(events.map((event) => event.errorCode).filter((code): code is string => Boolean(code)));
  const hasErroredResult = events.some((event) => event.stage === "tool_result_returned" && (event.result === "deny" || event.result === "error"));

  // Classification is intentionally deepest-server-stage first, with policy/error
  // outcomes taking precedence over normal HTTP completion.
  if (stages.has("transport_error")) {
    return { classification: "TRANSPORT_ERROR", explanation: "The MCP server received the request and recorded a transport error." };
  }

  if ([...errorCodes].some((code) => isPolicyDeniedErrorCode(code))) {
    return { classification: "APP_POLICY_DENIED", explanation: "The MCP application denied the call through validation, scope, path, write-mode, or action policy." };
  }

  if (hasErroredResult) {
    return { classification: "APP_EXECUTION_ERROR", explanation: "The MCP application returned an error result after dispatch." };
  }

  if (stages.has("dispatch_started")) {
    if (stages.has("tool_result_returned") && stages.has("http_response_completed")) {
      return { classification: "RESPONSE_COMPLETED", explanation: "The MCP server returned a response for the received call." };
    }
    if (stages.has("tool_result_returned")) {
      return { classification: "RESULT_RETURNED", explanation: "The public tool handler returned a result, but response completion was not recorded." };
    }
    return { classification: "DISPATCHED_NOT_EXECUTED", explanation: "The MCP dispatcher started, but toolbox/helper execution did not complete." };
  }

  if (stages.has("http_response_completed")) {
    return { classification: "RECEIVED_NOT_DISPATCHED", explanation: "The HTTP request was received, but MCP dispatch was not observed." };
  }

  return { classification: "RECEIVED_NOT_DISPATCHED", explanation: "The HTTP request was received, but MCP dispatch was not observed." };
}

export function readRecentToolCalls(config: AppConfig, query: RecentToolCallQuery = {}): { calls: RecentToolCallSummary[]; warnings?: string[] } {
  if (query.since && Number.isNaN(Date.parse(query.since))) {
    throw new Error("recent_tool_calls since must be a strict ISO-8601 timestamp.");
  }

  const limit = Math.min(Math.max(query.limit ?? 20, 1), 50);
  const matchingEvents = readTraceEvents(config).filter((event) => eventMatchesFilter(event, query));
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
      const classification = classify(orderedEvents);
      const firstEvent = orderedEvents[0];
      const lastEvent = orderedEvents[orderedEvents.length - 1];
      const publicTool = [...orderedEvents].reverse().find((event) => event.publicTool)?.publicTool;
      const action = [...orderedEvents].reverse().find((event) => event.action)?.action;
      const workspaceId = [...orderedEvents].reverse().find((event) => event.workspaceId)?.workspaceId;
      return {
        correlationId,
        ...classification,
        startedAt: firstEvent.timestamp,
        lastEventAt: lastEvent.timestamp,
        publicTool,
        action,
        workspaceId,
        eventCount: orderedEvents.length,
        stages: [...new Set(orderedEvents.map((event) => event.stage))],
        events: orderedEvents
      };
    })
    .sort((left, right) => Date.parse(right.lastEventAt) - Date.parse(left.lastEventAt))
    .slice(0, limit);

  return { calls };
}
