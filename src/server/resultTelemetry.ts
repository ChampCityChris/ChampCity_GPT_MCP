import { createHash, randomUUID } from "node:crypto";

import { type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { type AppConfig } from "../config.js";
import { sanitizeDiagnosticKeyName } from "../security/diagnosticRedaction.js";
import { getCurrentToolCallTraceContext, recordToolCallTrace, updateCurrentToolCallTraceContext } from "./toolCallTrace.js";

export const RESULT_TELEMETRY_SCHEMA_VERSION = 1;
export const RESULT_SERIALIZER_NAME = "champcity-tool-response";
export const RESULT_SERIALIZER_VERSION = "1";

const DELIVERY_RECEIPT_META_KEY = "champcityDeliveryReceipt";

interface McpContentResult {
  mcpContent: CallToolResult["content"];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

interface ToolboxResultShape {
  toolbox: string;
  action: string;
  ok: boolean;
  result?: unknown;
  error?: unknown;
  warnings?: unknown;
  recommendedNextSteps?: unknown;
  mcpContent?: CallToolResult["content"];
  structuredContent?: Record<string, unknown>;
}

export interface DeliveryReceipt {
  schemaVersion: number;
  correlationId: string;
  resultAttemptId: string;
  payloadSha256: string;
  acknowledgementRecommended: boolean;
  deliveryStatusAction: "result_delivery_status";
  acknowledgementAction: "acknowledge_tool_result";
  digestDomain: "serialized_call_tool_result_without_delivery_receipt";
}

export interface ResultMeasurement {
  serializerName: string;
  serializerVersion: string;
  contentItemCount: number;
  contentItemTypes: string[];
  structuredContentPresent: boolean;
  payloadBytes: number;
  payloadSha256: string;
  maximumContentItemBytes: number;
  textCharacterCount: number;
  textLineCount: number;
  topLevelResultKeys: string[];
  truncated: boolean;
  chunked: boolean;
  chunkIndex?: number;
  chunkCount?: number;
  sourceSha256?: string;
  sourceRangeStart?: number;
  sourceRangeEnd?: number;
  continuationPresent?: boolean;
}

function hasMcpContent(data: unknown): data is McpContentResult {
  return Boolean(data && typeof data === "object" && Array.isArray((data as { mcpContent?: unknown }).mcpContent));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isToolboxResult(value: unknown): value is ToolboxResultShape {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.toolbox === "string" && typeof value.action === "string" && typeof value.ok === "boolean";
}

function isSuccessfulToolboxResult(value: unknown): value is ToolboxResultShape {
  return isToolboxResult(value) && value.ok === true;
}

export function materializeToolResult(data: unknown): CallToolResult {
  if (hasMcpContent(data)) {
    return {
      content: data.mcpContent,
      ...(data.structuredContent ? { structuredContent: data.structuredContent } : {}),
      ...(data.isError ? { isError: true } : {})
    };
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2)
      }
    ]
  };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function contentItemType(item: unknown): string {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return "unknown";
  }

  const type = (item as { type?: unknown }).type;
  return typeof type === "string" ? sanitizeDiagnosticKeyName(type) ?? "unknown" : "unknown";
}

function textLineCount(text: string): number {
  if (!text) {
    return 0;
  }

  return text.split(/\r\n|\r|\n/u).length;
}

function boundedProjectionDimensions(structuredContent: unknown): Pick<
  ResultMeasurement,
  "truncated" | "chunked" | "chunkIndex" | "chunkCount" | "sourceSha256" | "sourceRangeStart" | "sourceRangeEnd" | "continuationPresent"
> {
  if (!structuredContent || typeof structuredContent !== "object" || Array.isArray(structuredContent)) {
    return { truncated: false, chunked: false };
  }

  const structured = structuredContent as {
    serializer?: { name?: unknown };
    complete?: unknown;
    nextCursor?: unknown;
    chunkIndex?: unknown;
    sourceSha256?: unknown;
    range?: { startByteOffset?: unknown; endByteOffset?: unknown };
  };
  const serializerName = typeof structured.serializer?.name === "string" ? structured.serializer.name : undefined;
  const isBounded = serializerName === "bounded-text-v1" || serializerName === "bounded-markdown-section-v1";
  if (!isBounded) {
    return { truncated: false, chunked: false };
  }

  const complete = structured.complete === true;
  const chunkIndex = typeof structured.chunkIndex === "number" && Number.isInteger(structured.chunkIndex)
    ? structured.chunkIndex
    : undefined;
  const continuationPresent = typeof structured.nextCursor === "string" && structured.nextCursor.length > 0;
  const sourceRangeStart = typeof structured.range?.startByteOffset === "number" && Number.isInteger(structured.range.startByteOffset)
    ? structured.range.startByteOffset
    : undefined;
  const sourceRangeEnd = typeof structured.range?.endByteOffset === "number" && Number.isInteger(structured.range.endByteOffset)
    ? structured.range.endByteOffset
    : undefined;
  const sourceSha256 = typeof structured.sourceSha256 === "string" && /^[a-f0-9]{64}$/u.test(structured.sourceSha256)
    ? structured.sourceSha256
    : undefined;

  return {
    truncated: !complete,
    chunked: !complete || (chunkIndex ?? 0) > 0,
    ...(chunkIndex !== undefined ? { chunkIndex } : {}),
    ...(complete && chunkIndex !== undefined ? { chunkCount: chunkIndex + 1 } : {}),
    ...(sourceSha256 ? { sourceSha256 } : {}),
    ...(sourceRangeStart !== undefined ? { sourceRangeStart } : {}),
    ...(sourceRangeEnd !== undefined ? { sourceRangeEnd } : {}),
    continuationPresent
  };
}

export function measureToolResult(result: CallToolResult): ResultMeasurement {
  const serialized = JSON.stringify(result);
  const content = Array.isArray(result.content) ? result.content : [];
  const structuredContent = (result as { structuredContent?: unknown }).structuredContent;
  const serializer = structuredContent && typeof structuredContent === "object" && !Array.isArray(structuredContent)
    ? (structuredContent as { serializer?: { name?: unknown; version?: unknown } }).serializer
    : undefined;
  const textItems = content
    .map((item) => item && typeof item === "object" && (item as { type?: unknown }).type === "text" ? (item as { text?: unknown }).text : undefined)
    .filter((text): text is string => typeof text === "string");
  const itemByteCounts = content.map((item) => Buffer.byteLength(JSON.stringify(item), "utf8"));
  const boundedDimensions = boundedProjectionDimensions(structuredContent);

  return {
    serializerName: typeof serializer?.name === "string" ? serializer.name : RESULT_SERIALIZER_NAME,
    serializerVersion: typeof serializer?.version === "string" ? serializer.version : RESULT_SERIALIZER_VERSION,
    contentItemCount: content.length,
    contentItemTypes: [...new Set(content.map(contentItemType))].slice(0, 20),
    structuredContentPresent: Boolean(structuredContent),
    payloadBytes: Buffer.byteLength(serialized, "utf8"),
    payloadSha256: sha256Hex(serialized),
    maximumContentItemBytes: itemByteCounts.length > 0 ? Math.max(...itemByteCounts) : 0,
    textCharacterCount: textItems.reduce((total, text) => total + text.length, 0),
    textLineCount: textItems.reduce((total, text) => total + textLineCount(text), 0),
    topLevelResultKeys: Object.keys(result).map((key) => sanitizeDiagnosticKeyName(key)).filter((key): key is string => Boolean(key)).slice(0, 20),
    ...boundedDimensions
  };
}

function shouldRecommendAcknowledgement(action: string | undefined, measurement: ResultMeasurement): boolean {
  if (action === "acknowledge_tool_result" || action === "result_delivery_status") {
    return false;
  }

  return measurement.textCharacterCount > 0 || measurement.structuredContentPresent || measurement.contentItemCount > 0;
}

function isBoundedTextStructuredContent(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value.serializer)) {
    return false;
  }

  const serializerName = value.serializer.name;
  return serializerName === "bounded-text-v1" || serializerName === "bounded-markdown-section-v1";
}

function returnedTextChunk(result: CallToolResult): string | undefined {
  const textItems = result.content
    .map((item) => item && typeof item === "object" && (item as { type?: unknown }).type === "text" ? (item as { text?: unknown }).text : undefined)
    .filter((text): text is string => typeof text === "string");

  return textItems.length >= 2 ? textItems[1] : undefined;
}

function modelVisibleToolboxResult(data: ToolboxResultShape, materialized: CallToolResult): unknown {
  const structuredContent = (materialized as { structuredContent?: unknown }).structuredContent;
  const boundedStructuredContent = isBoundedTextStructuredContent(structuredContent) ? structuredContent : undefined;
  if (!boundedStructuredContent) {
    return data.result;
  }

  const safeResult = isRecord(data.result) ? data.result : boundedStructuredContent;
  return {
    ...boundedStructuredContent,
    ...safeResult,
    content: returnedTextChunk(materialized) ?? ""
  };
}

function toolboxStructuredEnvelope(data: ToolboxResultShape, materialized: CallToolResult): Record<string, unknown> {
  const envelope: Record<string, unknown> = {
    toolbox: data.toolbox,
    action: data.action,
    ok: data.ok
  };

  if ("result" in data) {
    envelope.result = modelVisibleToolboxResult(data, materialized);
  }

  if ("error" in data) {
    envelope.error = data.error;
  }

  if ("warnings" in data) {
    envelope.warnings = data.warnings;
  }

  if ("recommendedNextSteps" in data) {
    envelope.recommendedNextSteps = data.recommendedNextSteps;
  }

  return envelope;
}

function modelVisibleStructuredContent(data: unknown, materialized: CallToolResult, receipt: DeliveryReceipt): Record<string, unknown> {
  const structuredContent = (materialized as { structuredContent?: unknown }).structuredContent;
  const existingStructuredContent = isRecord(structuredContent) ? structuredContent : {};

  if (!isToolboxResult(data)) {
    return {
      ...existingStructuredContent,
      [DELIVERY_RECEIPT_META_KEY]: receipt
    };
  }

  return {
    ...existingStructuredContent,
    ...toolboxStructuredEnvelope(data, materialized),
    [DELIVERY_RECEIPT_META_KEY]: receipt
  };
}

function assertModelVisiblePayloadInvariant(data: unknown, structuredContent: Record<string, unknown>): void {
  if (!isSuccessfulToolboxResult(data)) {
    return;
  }

  if (!("result" in structuredContent) || Object.keys(structuredContent).filter((key) => key !== DELIVERY_RECEIPT_META_KEY).length === 0) {
    throw new Error("Successful toolbox responses must preserve a substantive model-visible structured result beside the delivery receipt.");
  }
}

function withDeliveryReceipt(data: unknown, result: CallToolResult, receipt: DeliveryReceipt): CallToolResult {
  const structuredContent = modelVisibleStructuredContent(data, result, receipt);
  assertModelVisiblePayloadInvariant(data, structuredContent);

  return {
    ...result,
    structuredContent
  };
}

export function createMeasuredToolResponse(config: AppConfig, data: unknown): CallToolResult {
  const context = getCurrentToolCallTraceContext();
  const resultAttemptId = randomUUID();
  const attemptNumber = 1;
  const materialized = materializeToolResult(data);

  updateCurrentToolCallTraceContext({
    resultAttemptId,
    attemptNumber
  });

  recordToolCallTrace(config, {
    stage: "result_materialized",
    resultTelemetrySchemaVersion: RESULT_TELEMETRY_SCHEMA_VERSION,
    resultAttemptId,
    attemptNumber,
    publicTool: context?.publicTool,
    action: context?.action,
    workspaceId: context?.workspaceId,
    requestedPath: context?.requestedPath,
    result: "allow"
  });

  const payloadMeasurement = measureToolResult(materialized);
  const receipt: DeliveryReceipt = {
    schemaVersion: RESULT_TELEMETRY_SCHEMA_VERSION,
    correlationId: context?.correlationId ?? "unknown",
    resultAttemptId,
    payloadSha256: payloadMeasurement.payloadSha256,
    acknowledgementRecommended: shouldRecommendAcknowledgement(context?.action, payloadMeasurement),
    deliveryStatusAction: "result_delivery_status",
    acknowledgementAction: "acknowledge_tool_result",
    digestDomain: "serialized_call_tool_result_without_delivery_receipt"
  };
  const publicResult = withDeliveryReceipt(data, materialized, receipt);
  const finalMeasurement = measureToolResult(publicResult);

  updateCurrentToolCallTraceContext({
    resultAttemptId,
    attemptNumber,
    resultTelemetrySchemaVersion: RESULT_TELEMETRY_SCHEMA_VERSION,
    payloadSha256: payloadMeasurement.payloadSha256
  });

  recordToolCallTrace(config, {
    stage: "result_serialized",
    resultTelemetrySchemaVersion: RESULT_TELEMETRY_SCHEMA_VERSION,
    resultAttemptId,
    attemptNumber,
    publicTool: context?.publicTool,
    action: context?.action,
    workspaceId: context?.workspaceId,
    requestedPath: context?.requestedPath,
    result: "allow",
    ...payloadMeasurement,
    finalPayloadBytes: finalMeasurement.payloadBytes,
    finalPayloadSha256: finalMeasurement.payloadSha256
  });

  return publicResult;
}
