import { type AppConfig } from "../config.js";
import { writeAuditLog } from "../security/auditLog.js";
import { AppError } from "../utils/errors.js";
import {
  classifyToolCallTraceEvents,
  readRecentToolCalls,
  readToolCallTraceEvents,
  recordToolCallTrace,
  type ToolCallTraceEvent
} from "./toolCallTrace.js";

export const ACKNOWLEDGEMENT_CONTEXTS = ["content_consumed", "metadata_consumed", "retry_requested"] as const;
export type AcknowledgementContext = (typeof ACKNOWLEDGEMENT_CONTEXTS)[number];

export interface AcknowledgeToolResultInput {
  correlationId: string;
  resultAttemptId: string;
  payloadSha256: string;
  acknowledgementContext?: AcknowledgementContext;
}

export interface ResultDeliveryStatusInput {
  correlationId?: string;
  resultAttemptId?: string;
}

function isAcknowledgementContext(value: unknown): value is AcknowledgementContext {
  return typeof value === "string" && ACKNOWLEDGEMENT_CONTEXTS.includes(value as AcknowledgementContext);
}

function eventsForAttempt(config: AppConfig, correlationId: string, resultAttemptId: string): ToolCallTraceEvent[] {
  return readToolCallTraceEvents(config).filter((event) => event.correlationId === correlationId && event.resultAttemptId === resultAttemptId);
}

function eventsWithAttemptId(events: readonly ToolCallTraceEvent[], resultAttemptId: string): ToolCallTraceEvent[] {
  return events.filter((event) => event.resultAttemptId === resultAttemptId);
}

function eventsWithCorrelationId(events: readonly ToolCallTraceEvent[], correlationId: string): ToolCallTraceEvent[] {
  return events.filter((event) => event.correlationId === correlationId);
}

function attemptCorrelationIds(events: readonly ToolCallTraceEvent[]): string[] {
  return [...new Set(events.map((event) => event.correlationId))];
}

function attemptEventsForStatus(config: AppConfig, input: ResultDeliveryStatusInput): {
  events: ToolCallTraceEvent[];
  correlationId?: string;
  resultAttemptId?: string;
} {
  if (!input.correlationId && !input.resultAttemptId) {
    throw new AppError("INVALID_INPUT", "result_delivery_status requires correlationId or resultAttemptId.");
  }

  const allEvents = readToolCallTraceEvents(config);

  if (input.resultAttemptId && input.correlationId) {
    const attemptEvents = eventsWithAttemptId(allEvents, input.resultAttemptId);
    const correlationEvents = eventsWithCorrelationId(allEvents, input.correlationId);
    const matchingEvents = attemptEvents.filter((event) => event.correlationId === input.correlationId);

    if (matchingEvents.length === 0 && (attemptEvents.length > 0 || correlationEvents.length > 0)) {
      throw new AppError("INVALID_INPUT", "correlationId and resultAttemptId do not identify the same result attempt.");
    }

    if (matchingEvents.length === 0) {
      return { events: [], correlationId: input.correlationId, resultAttemptId: input.resultAttemptId };
    }

    return {
      events: matchingEvents,
      correlationId: input.correlationId,
      resultAttemptId: input.resultAttemptId
    };
  }

  if (input.resultAttemptId) {
    const attemptEvents = eventsWithAttemptId(allEvents, input.resultAttemptId);
    const correlationIds = attemptCorrelationIds(attemptEvents);
    if (correlationIds.length > 1) {
      throw new AppError("INVALID_INPUT", "resultAttemptId resolves to multiple correlations.");
    }

    return {
      events: attemptEvents,
      correlationId: correlationIds[0],
      resultAttemptId: input.resultAttemptId
    };
  }

  return {
    events: eventsWithCorrelationId(allEvents, input.correlationId as string),
    correlationId: input.correlationId
  };
}

function latestSerializedEvent(events: readonly ToolCallTraceEvent[]): ToolCallTraceEvent | undefined {
  return [...events]
    .filter((event) => event.stage === "result_serialized")
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0];
}

function latestEvent(events: readonly ToolCallTraceEvent[]): ToolCallTraceEvent | undefined {
  return [...events].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0];
}

function dimensions(event: ToolCallTraceEvent | undefined) {
  if (!event) {
    return undefined;
  }

  return {
    schemaVersion: 1,
    resultTelemetrySchemaVersion: event.resultTelemetrySchemaVersion ?? "legacy",
    serializerName: event.serializerName,
    serializerVersion: event.serializerVersion,
    contentItemCount: event.contentItemCount,
    contentItemTypes: event.contentItemTypes,
    structuredContentPresent: event.structuredContentPresent,
    payloadBytes: event.payloadBytes,
    payloadSha256: event.payloadSha256,
    finalPayloadBytes: event.finalPayloadBytes,
    finalPayloadSha256: event.finalPayloadSha256,
    maximumContentItemBytes: event.maximumContentItemBytes,
    textCharacterCount: event.textCharacterCount,
    textLineCount: event.textLineCount,
    topLevelResultKeys: event.topLevelResultKeys,
    truncated: event.truncated,
    chunked: event.chunked,
    chunkIndex: event.chunkIndex,
    chunkCount: event.chunkCount,
    sourceSha256: event.sourceSha256,
    sourceRangeStart: event.sourceRangeStart,
    sourceRangeEnd: event.sourceRangeEnd,
    continuationPresent: event.continuationPresent
  };
}

export async function acknowledgeToolResult(config: AppConfig, input: AcknowledgeToolResultInput) {
  const acknowledgementMethod = isAcknowledgementContext(input.acknowledgementContext) ? input.acknowledgementContext : "content_consumed";
  const events = eventsForAttempt(config, input.correlationId, input.resultAttemptId);
  const serialized = latestSerializedEvent(events);

  if (!serialized) {
    await writeAuditLog(config.auditLogPath, {
      toolName: "diagnostics_toolbox",
      action: "acknowledge_tool_result",
      correlationId: input.correlationId,
      resultAttemptId: input.resultAttemptId,
      result: "deny",
      reason: "result attempt not found"
    });
    return {
      status: "not_found",
      correlationId: input.correlationId,
      resultAttemptId: input.resultAttemptId,
      acknowledgementRecorded: false
    };
  }

  if (serialized.payloadSha256 !== input.payloadSha256) {
    await writeAuditLog(config.auditLogPath, {
      toolName: "diagnostics_toolbox",
      action: "acknowledge_tool_result",
      correlationId: input.correlationId,
      resultAttemptId: input.resultAttemptId,
      result: "deny",
      reason: "payload digest mismatch"
    });
    throw new AppError("INVALID_INPUT", "Result acknowledgement payloadSha256 does not match the recorded result attempt.");
  }

  const acknowledgements = events.filter((event) => event.stage === "client_result_acknowledged");
  const conflicting = acknowledgements.find(
    (event) => event.payloadSha256 !== input.payloadSha256 || event.acknowledgementMethod !== acknowledgementMethod
  );
  if (conflicting) {
    throw new AppError("INVALID_INPUT", "Conflicting acknowledgement already exists for this result attempt.");
  }

  const existing = acknowledgements.find(
    (event) => event.payloadSha256 === input.payloadSha256 && event.acknowledgementMethod === acknowledgementMethod
  );
  if (existing) {
    return {
      status: "already_acknowledged",
      correlationId: input.correlationId,
      resultAttemptId: input.resultAttemptId,
      payloadSha256: input.payloadSha256,
      acknowledgementTimestamp: existing.acknowledgementTimestamp ?? existing.timestamp,
      acknowledgementMethod,
      acknowledgementRecorded: true,
      idempotent: true
    };
  }

  const timestamp = new Date().toISOString();
  recordToolCallTrace(config, {
    correlationId: serialized.correlationId,
    stage: "client_result_acknowledged",
    jsonRpcId: serialized.jsonRpcId,
    resultAttemptId: serialized.resultAttemptId,
    attemptNumber: serialized.attemptNumber,
    resultTelemetrySchemaVersion: serialized.resultTelemetrySchemaVersion,
    publicTool: serialized.publicTool,
    action: serialized.action,
    workspaceId: serialized.workspaceId,
    requestedPath: serialized.requestedPath,
    payloadSha256: input.payloadSha256,
    acknowledgementTimestamp: timestamp,
    acknowledgementMethod,
    result: "allow"
  });
  await writeAuditLog(config.auditLogPath, {
    toolName: "diagnostics_toolbox",
    action: "acknowledge_tool_result",
    correlationId: input.correlationId,
    resultAttemptId: input.resultAttemptId,
    result: "allow",
    reason: "diagnostic result acknowledgement recorded",
    sha256: input.payloadSha256,
    acknowledgementMethod
  });

  return {
    status: "acknowledged",
    correlationId: input.correlationId,
    resultAttemptId: input.resultAttemptId,
    payloadSha256: input.payloadSha256,
    acknowledgementTimestamp: timestamp,
    acknowledgementMethod,
    acknowledgementRecorded: true,
    idempotent: false
  };
}

export function resultDeliveryStatus(config: AppConfig, input: ResultDeliveryStatusInput) {
  const resolved = attemptEventsForStatus(config, input);
  const events = resolved.events;
  if (events.length === 0) {
    return {
      status: "not_found",
      queryScope: input.resultAttemptId ? "result_attempt" : "correlation",
      classification: "NO_SERVER_RECEIPT_EVIDENCE",
      correlationId: resolved.correlationId,
      resultAttemptId: resolved.resultAttemptId,
      lifecycleStages: [],
      acknowledgement: { acknowledged: false }
    };
  }

  const latest = latestEvent(events);
  const serialized = latestSerializedEvent(events);
  const isAttemptQuery = Boolean(input.resultAttemptId);
  const correlationId = latest?.correlationId ?? resolved.correlationId;
  const resultAttemptId = isAttemptQuery ? latest?.resultAttemptId ?? resolved.resultAttemptId : undefined;
  const acknowledgement = [...events]
    .filter((event) => event.stage === "client_result_acknowledged")
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0];
  const attemptEvents = resultAttemptId ? events.filter((event) => event.resultAttemptId === resultAttemptId) : [];
  const classification = isAttemptQuery && resultAttemptId
    ? classifyToolCallTraceEvents(attemptEvents)
    : {
        classification: readRecentToolCalls(config, { correlationId }).calls[0]?.classification ?? "NO_SERVER_RECEIPT_EVIDENCE",
        explanation: "This is a correlation-level aggregate; inspect per-attempt summaries for exact delivery state."
      };
  const aggregate = !isAttemptQuery && correlationId
    ? readRecentToolCalls(config, { correlationId }).calls[0]
    : undefined;

  return {
    status: "found",
    queryScope: isAttemptQuery ? "result_attempt" : "correlation",
    classification: classification.classification,
    explanation: classification.explanation,
    correlationId,
    resultAttemptId,
    attemptNumber: latest?.attemptNumber,
    lifecycleStages: [...new Set(events.map((event) => event.stage))],
    resultDimensions: dimensions(serialized),
    acknowledgement: acknowledgement
      ? {
          acknowledged: true,
          acknowledgementTimestamp: acknowledgement.acknowledgementTimestamp ?? acknowledgement.timestamp,
          acknowledgementMethod: acknowledgement.acknowledgementMethod,
          payloadSha256: acknowledgement.payloadSha256
        }
      : { acknowledged: false },
    publicTool: latest?.publicTool,
    action: latest?.action,
    workspaceId: latest?.workspaceId,
    requestedPath: latest?.requestedPath,
    ...(aggregate?.attempts ? { attempts: aggregate.attempts } : {})
  };
}
