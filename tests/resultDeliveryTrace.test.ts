import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

import { type AppConfig } from "../src/config.js";
import { acknowledgeToolResult, resultDeliveryStatus } from "../src/server/resultDeliveryTrace.js";
import { createMeasuredToolResponse, materializeToolResult } from "../src/server/resultTelemetry.js";
import {
  readRecentToolCalls,
  readToolCallTraceEvents,
  recordToolCallTrace,
  runWithToolCallTraceContext,
  type ToolCallTraceContext
} from "../src/server/toolCallTrace.js";

let tempRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-result-delivery-"));
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function testConfig(): AppConfig {
  return {
    repoRoot: tempRoot,
    allowedRoots: [tempRoot],
    auditLogPath: path.join(tempRoot, "logs", "audit.log"),
    requireGitRoot: false,
    allowedCommands: [],
    writeToolsEnabled: false,
    writeToolsEnabledSource: "default",
    writeMode: "off",
    writeModeSource: "default",
    docsWritesAllowed: false,
    patchWritesAllowed: false,
    elevatedOperationsAllowed: false,
    writeApprovalToken: { source: "none" }
  };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function context(correlationId: string): ToolCallTraceContext {
  return {
    correlationId,
    startedAt: Date.now(),
    httpMethod: "POST",
    mcpRoute: "/mcp",
    jsonRpcMethod: "tools/call",
    jsonRpcId: correlationId,
    publicTool: "repo_toolbox",
    action: "read_file",
    workspaceId: "default",
    requestedPath: "docs/safe.md"
  };
}

function deliveryReceipt(response: ReturnType<typeof createMeasuredToolResponse>): { correlationId: string; resultAttemptId: string; payloadSha256: string } {
  const structured = response.structuredContent as { champcityDeliveryReceipt?: { correlationId: string; resultAttemptId: string; payloadSha256: string } } | undefined;
  assert.ok(structured?.champcityDeliveryReceipt);
  return structured.champcityDeliveryReceipt;
}

function modelVisibleStructuredPayload(response: ReturnType<typeof createMeasuredToolResponse>): Record<string, unknown> {
  const structured = response.structuredContent;
  assert.ok(structured && typeof structured === "object" && !Array.isArray(structured));
  const payload = structured as Record<string, unknown>;
  assert.notDeepEqual(Object.keys(payload), ["champcityDeliveryReceipt"]);
  assert.ok("result" in payload);
  return payload;
}

function materializeAndSerialize(config: AppConfig, correlationId: string, data: unknown) {
  recordToolCallTrace(config, { ...context(correlationId), stage: "http_received", result: "allow" });
  recordToolCallTrace(config, { ...context(correlationId), stage: "dispatch_started", result: "allow" });
  const response = runWithToolCallTraceContext(context(correlationId), () => createMeasuredToolResponse(config, data));
  const receipt = deliveryReceipt(response);
  recordToolCallTrace(config, {
    correlationId,
    stage: "http_response_finished",
    resultAttemptId: receipt.resultAttemptId,
    payloadSha256: receipt.payloadSha256,
    finishObserved: true,
    result: "allow"
  });
  return response;
}

describe("result delivery trace", () => {
  it("preserves ordinary successful toolbox payloads in model-visible structured content", () => {
    const config = testConfig();
    const data = {
      toolbox: "repo_toolbox",
      action: "read_file",
      ok: true,
      result: {
        relativePath: "docs/safe.md",
        content: "Visible file content",
        sha256: "a".repeat(64)
      },
      warnings: [],
      recommendedNextSteps: []
    };
    const response = materializeAndSerialize(config, "delivery-structured-payload", data);
    const structured = modelVisibleStructuredPayload(response);
    const receipt = deliveryReceipt(response);

    assert.equal(structured.toolbox, "repo_toolbox");
    assert.equal(structured.action, "read_file");
    assert.equal(structured.ok, true);
    assert.deepEqual(structured.result, data.result);
    assert.equal(structured.champcityDeliveryReceipt, receipt);
    assert.deepEqual(JSON.parse((response.content[0] as { text: string }).text), data);
  });

  it("preserves bounded text chunks in the model-visible structured result without changing raw MCP content", () => {
    const config = testConfig();
    const sourceSha256 = "b".repeat(64);
    const data = {
      toolbox: "repo_toolbox",
      action: "read_text_chunk",
      ok: true,
      result: {
        serializer: { name: "bounded-text-v1", version: "1" },
        complete: false,
        nextCursor: "tp1.cursor",
        sourceSha256,
        range: {
          startLine: 2,
          endLine: 3,
          startByteOffset: 8,
          endByteOffset: 21
        }
      },
      mcpContent: [
        { type: "text" as const, text: "Text chunk: docs/safe.md lines 2-3, bytes 8-21." },
        { type: "text" as const, text: "visible chunk" }
      ],
      structuredContent: {
        serializer: { name: "bounded-text-v1", version: "1" },
        complete: false,
        nextCursor: "tp1.cursor",
        sourceSha256,
        range: {
          startLine: 2,
          endLine: 3,
          startByteOffset: 8,
          endByteOffset: 21
        }
      }
    };
    const response = materializeAndSerialize(config, "delivery-structured-bounded", data);
    const structured = modelVisibleStructuredPayload(response);
    const visibleResult = structured.result as Record<string, unknown>;

    assert.deepEqual(response.content, data.mcpContent);
    assert.equal(structured.nextCursor, "tp1.cursor");
    assert.equal(visibleResult.content, "visible chunk");
    assert.equal(visibleResult.nextCursor, "tp1.cursor");
    assert.equal(visibleResult.sourceSha256, sourceSha256);
    assert.deepEqual(visibleResult.range, data.result.range);
  });

  it("preserves image multi-content responses without duplicating binary data into structured content", () => {
    const config = testConfig();
    const base64Data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    const metadata = {
      path: "planning/evidence/example.png",
      workspaceId: "default",
      mimeType: "image/png",
      sizeBytes: 24,
      width: 1,
      height: 1,
      sha256: "c".repeat(64),
      lastModifiedAt: "2026-08-02T00:00:00.000Z"
    };
    const data = {
      toolbox: "artifact_toolbox",
      action: "read_image_artifact",
      ok: true,
      result: metadata,
      mcpContent: [
        { type: "text" as const, text: "Loaded image artifact: planning/evidence/example.png" },
        { type: "image" as const, mimeType: "image/png", data: base64Data }
      ],
      structuredContent: metadata
    };
    const response = materializeAndSerialize(config, "delivery-structured-image", data);
    const structured = modelVisibleStructuredPayload(response);

    assert.doesNotThrow(() => CallToolResultSchema.parse(response));
    assert.deepEqual(response.content, data.mcpContent);
    assert.deepEqual(structured.result, metadata);
    assert.equal(JSON.stringify(structured).includes(base64Data), false);
  });

  it("rejects successful toolbox serialization that would be receipt-only without a substantive result", () => {
    const config = testConfig();

    assert.throws(
      () =>
        runWithToolCallTraceContext(context("delivery-receipt-only"), () =>
          createMeasuredToolResponse(config, {
            toolbox: "repo_toolbox",
            action: "status",
            ok: true,
            mcpContent: [{ type: "text" as const, text: "status text" }],
            structuredContent: {
              champcityDeliveryReceipt: {
                schemaVersion: 1
              }
            }
          })
        ),
      /substantive model-visible structured result/u
    );
  });

  it("records materialized, serialized, HTTP finished, and unacknowledged states without result content", () => {
    const config = testConfig();
    const data = { ok: true, result: { text: "PRIVATE_CONTENT_SHOULD_NOT_BE_TRACED" } };
    const response = materializeAndSerialize(config, "delivery-normal", data);
    const receipt = deliveryReceipt(response);
    const events = readToolCallTraceEvents(config).filter((event) => event.correlationId === "delivery-normal");
    const serializedEvent = events.find((event) => event.stage === "result_serialized");

    assert.ok(receipt.resultAttemptId);
    assert.equal(receipt.correlationId, "delivery-normal");
    assert.equal((response._meta as Record<string, unknown> | undefined)?.champcityDeliveryReceipt, undefined);
    assert.ok(serializedEvent);
    assert.equal(serializedEvent.resultTelemetrySchemaVersion, 1);
    assert.equal(serializedEvent.payloadSha256, sha256Hex(JSON.stringify(materializeToolResult(data))));
    assert.equal(serializedEvent.payloadBytes, Buffer.byteLength(JSON.stringify(materializeToolResult(data)), "utf8"));
    assert.equal(serializedEvent.contentItemCount, 1);
    assert.deepEqual(serializedEvent.contentItemTypes, ["text"]);
    assert.equal(serializedEvent.structuredContentPresent, false);
    assert.ok((serializedEvent.maximumContentItemBytes ?? 0) > 0);
    assert.equal(readRecentToolCalls(config, { correlationId: "delivery-normal" }).calls[0].classification, "RESPONSE_FINISHED_UNACKNOWLEDGED");

    const persisted = JSON.stringify(events);
    assert.doesNotMatch(persisted, /PRIVATE_CONTENT_SHOULD_NOT_BE_TRACED/u);
  });

  it("merges the delivery receipt into existing structured content without changing content", () => {
    const config = testConfig();
    const data = {
      mcpContent: [{ type: "text" as const, text: "visible text" }],
      structuredContent: {
        existingKey: "existing-value",
        nested: { ok: true }
      }
    };
    const response = materializeAndSerialize(config, "delivery-structured", data);
    const receipt = deliveryReceipt(response);

    assert.deepEqual(response.content, data.mcpContent);
    assert.equal((response.structuredContent as Record<string, unknown>).existingKey, "existing-value");
    assert.deepEqual((response.structuredContent as Record<string, unknown>).nested, { ok: true });
    assert.equal((response.structuredContent as Record<string, unknown>).champcityDeliveryReceipt, receipt);
  });

  it("acknowledges a matching result attempt and handles duplicate identical acknowledgement idempotently", async () => {
    const config = testConfig();
    const response = materializeAndSerialize(config, "delivery-ack", { ok: true, result: { status: "ok" } });
    const receipt = deliveryReceipt(response);

    const first = await runWithToolCallTraceContext(
      {
        correlationId: "delivery-ack-request",
        startedAt: Date.now(),
        httpMethod: "POST",
        mcpRoute: "/mcp",
        jsonRpcMethod: "tools/call",
        jsonRpcId: "ack-request-id",
        publicTool: "diagnostics_toolbox",
        action: "acknowledge_tool_result"
      },
      () =>
        acknowledgeToolResult(config, {
          correlationId: "delivery-ack",
          resultAttemptId: receipt.resultAttemptId,
          payloadSha256: receipt.payloadSha256,
          acknowledgementContext: "content_consumed"
        })
    );
    const second = await acknowledgeToolResult(config, {
      correlationId: "delivery-ack",
      resultAttemptId: receipt.resultAttemptId,
      payloadSha256: receipt.payloadSha256,
      acknowledgementContext: "content_consumed"
    });

    assert.equal(first.status, "acknowledged");
    assert.equal(second.status, "already_acknowledged");
    assert.equal(second.idempotent, true);
    assert.equal(readRecentToolCalls(config, { correlationId: "delivery-ack" }).calls[0].classification, "CLIENT_ACKNOWLEDGED");
    const acknowledgement = readToolCallTraceEvents(config).find((event) => event.stage === "client_result_acknowledged");
    assert.ok(acknowledgement);
    assert.equal(acknowledgement.correlationId, "delivery-ack");
    assert.equal(acknowledgement.jsonRpcId, "delivery-ack");
    assert.equal(acknowledgement.resultAttemptId, receipt.resultAttemptId);
    assert.equal(acknowledgement.resultTelemetrySchemaVersion, 1);
  });

  it("rejects digest mismatch as a contract error and returns bounded not-found status", async () => {
    const config = testConfig();
    const response = materializeAndSerialize(config, "delivery-mismatch", { ok: true, result: "ok" });
    const receipt = deliveryReceipt(response);

    await assert.rejects(
      () =>
        acknowledgeToolResult(config, {
          correlationId: "delivery-mismatch",
          resultAttemptId: receipt.resultAttemptId,
          payloadSha256: "0".repeat(64)
        }),
      /payloadSha256 does not match/u
    );

    const unknown = await acknowledgeToolResult(config, {
      correlationId: "delivery-missing",
      resultAttemptId: "missing-attempt",
      payloadSha256: "0".repeat(64)
    });
    assert.equal(unknown.status, "not_found");
  });

  it("queries safe result-delivery status by result attempt ID", () => {
    const config = testConfig();
    const response = materializeAndSerialize(config, "delivery-status", { ok: true, result: { lines: ["a", "b"] } });
    const receipt = deliveryReceipt(response);
    const status = resultDeliveryStatus(config, { resultAttemptId: receipt.resultAttemptId }) as Record<string, any>;

    assert.equal(status.status, "found");
    assert.equal(status.queryScope, "result_attempt");
    assert.equal(status.classification, "RESPONSE_FINISHED_UNACKNOWLEDGED");
    assert.equal(status.correlationId, "delivery-status");
    assert.equal(status.resultAttemptId, receipt.resultAttemptId);
    assert.equal(status.resultDimensions?.payloadSha256, receipt.payloadSha256);
    assert.equal(status.resultDimensions?.resultTelemetrySchemaVersion, 1);
    assert.equal(status.acknowledgement.acknowledged, false);
    assert.doesNotMatch(JSON.stringify(status), /"lines":\["a","b"\]/u);
  });

  it("records bounded projection completion, range, source, chunk, and continuation dimensions", () => {
    const config = testConfig();
    const sourceSha256 = "a".repeat(64);
    const response = materializeAndSerialize(config, "delivery-bounded", {
      mcpContent: [
        { type: "text" as const, text: "Text chunk: docs/safe.md lines 1-1, bytes 0-12." },
        { type: "text" as const, text: "visible chunk" }
      ],
      structuredContent: {
        serializer: { name: "bounded-text-v1", version: "1" },
        complete: false,
        nextCursor: "tp1.cursor",
        chunkIndex: 2,
        sourceSha256,
        range: {
          startByteOffset: 40,
          endByteOffset: 52
        }
      }
    });
    const receipt = deliveryReceipt(response);
    const status = resultDeliveryStatus(config, { resultAttemptId: receipt.resultAttemptId }) as Record<string, any>;

    assert.equal(status.resultDimensions?.serializerName, "bounded-text-v1");
    assert.equal(status.resultDimensions?.truncated, true);
    assert.equal(status.resultDimensions?.chunked, true);
    assert.equal(status.resultDimensions?.chunkIndex, 2);
    assert.equal(status.resultDimensions?.sourceSha256, sourceSha256);
    assert.equal(status.resultDimensions?.sourceRangeStart, 40);
    assert.equal(status.resultDimensions?.sourceRangeEnd, 52);
    assert.equal(status.resultDimensions?.continuationPresent, true);
    assert.doesNotMatch(JSON.stringify(status), /visible chunk/u);
  });

  it("rejects mismatched correlation and attempt identifiers instead of ignoring either identifier", () => {
    const config = testConfig();
    const first = deliveryReceipt(materializeAndSerialize(config, "delivery-exact-a", { ok: true, result: "a" }));
    materializeAndSerialize(config, "delivery-exact-b", { ok: true, result: "b" });

    assert.throws(
      () => resultDeliveryStatus(config, { correlationId: "delivery-exact-b", resultAttemptId: first.resultAttemptId }),
      /do not identify the same result attempt/u
    );
  });

  it("keeps acknowledgement and failure classification scoped to the exact result attempt", async () => {
    const config = testConfig();
    const acknowledged = deliveryReceipt(materializeAndSerialize(config, "delivery-shared", { ok: true, result: "ack" }));
    const failed = deliveryReceipt(materializeAndSerialize(config, "delivery-shared", { ok: true, result: "closed" }));
    recordToolCallTrace(config, {
      correlationId: "delivery-shared",
      stage: "http_connection_closed",
      resultAttemptId: failed.resultAttemptId,
      payloadSha256: failed.payloadSha256,
      closeObserved: true,
      finishObserved: false,
      closeBeforeFinish: true,
      result: "error"
    });

    await acknowledgeToolResult(config, {
      correlationId: "delivery-shared",
      resultAttemptId: acknowledged.resultAttemptId,
      payloadSha256: acknowledged.payloadSha256
    });

    const acknowledgedStatus = resultDeliveryStatus(config, { resultAttemptId: acknowledged.resultAttemptId }) as Record<string, any>;
    const failedStatus = resultDeliveryStatus(config, { resultAttemptId: failed.resultAttemptId }) as Record<string, any>;
    const aggregate = resultDeliveryStatus(config, { correlationId: "delivery-shared" }) as Record<string, any>;

    assert.equal(acknowledgedStatus.classification, "CLIENT_ACKNOWLEDGED");
    assert.equal(failedStatus.classification, "CONNECTION_CLOSED_BEFORE_FINISH");
    assert.equal(failedStatus.acknowledgement.acknowledged, false);
    assert.equal(aggregate.queryScope, "correlation");
    assert.equal(aggregate.classification, "CORRELATION_AGGREGATE");
    assert.equal(aggregate.attempts?.length, 2);
  });
});
