import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { type AppConfig } from "../src/config.js";
import { APP_ERROR_CODE_CLASSIFICATION, classifyAppErrorCode, isPolicyDeniedErrorCode } from "../src/utils/errorClassification.js";
import { type AppErrorCode } from "../src/utils/errors.js";
import { writeAuditLog } from "../src/security/auditLog.js";
import { getToolCallTracePaths, readRecentToolCalls, recordToolCallTrace, type ToolCallTraceStage } from "../src/server/toolCallTrace.js";

let tempRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-tool-trace-"));
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

function trace(
  config: AppConfig,
  correlationId: string,
  stages: ToolCallTraceStage[],
  options: { result?: "allow" | "deny" | "error"; errorCode?: string; errorMessage?: string; timestamp?: string; closeBeforeFinish?: boolean } = {}
): void {
  stages.forEach((stage, index) => {
    recordToolCallTrace(config, {
      correlationId,
      stage,
      timestamp: options.timestamp ?? new Date(Date.now() + index).toISOString(),
      publicTool: "repo_toolbox",
      action: "read_file",
      result: stage === "tool_result_returned" ? options.result ?? "allow" : "allow",
      errorCode: stage === "tool_result_returned" || stage === "helper_denied" || stage === "transport_error" ? options.errorCode : undefined,
      errorMessage: options.errorMessage,
      closeBeforeFinish: stage === "http_connection_closed" ? options.closeBeforeFinish ?? true : undefined
    });
  });
}

describe("MCP tool-call trace diagnostics", () => {
  it("does not retain claim-order selector code in production trace source", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src", "server", "toolCallTrace.ts"), "utf8");
    assert.doesNotMatch(source, /runWithSelectedToolCallTraceContext|claimed|first-unclaimed|same-tool/u);
  });

  it("classifies every approved trace outcome deterministically", () => {
    const config = testConfig();
    trace(config, "received", ["http_received"]);
    trace(config, "dispatched", ["http_received", "dispatch_started"]);
    trace(config, "contract", ["http_received", "dispatch_started", "tool_result_returned"], {
      result: "deny",
      errorCode: "INVALID_INPUT"
    });
    trace(config, "policy", ["http_received", "dispatch_started", "tool_result_returned"], {
      result: "deny",
      errorCode: "PATH_DENIED"
    });
    trace(config, "authorization", ["http_received", "dispatch_started", "tool_result_returned"], {
      result: "deny",
      errorCode: "OAUTH_SCOPE_DENIED"
    });
    trace(config, "execution", ["http_received", "dispatch_started", "helper_denied", "tool_result_returned"], {
      result: "error",
      errorCode: "UNKNOWN_ERROR"
    });
    trace(config, "result", ["http_received", "dispatch_started", "tool_result_returned"]);
    trace(config, "materialized", ["http_received", "dispatch_started", "result_materialized"]);
    trace(config, "serialized", ["http_received", "dispatch_started", "result_materialized", "result_serialized"]);
    trace(config, "completed", ["http_received", "dispatch_started", "result_materialized", "result_serialized", "http_response_finished"]);
    trace(config, "acknowledged", ["http_received", "dispatch_started", "result_materialized", "result_serialized", "http_response_finished", "client_result_acknowledged"]);
    trace(config, "closed-before-finish", ["http_received", "dispatch_started", "result_materialized", "result_serialized", "http_connection_closed"]);
    trace(config, "transport", ["http_received", "transport_error"], { result: "error", errorCode: "TRANSPORT_ERROR" });

    const classifications = new Map(readRecentToolCalls(config, { limit: 50 }).calls.map((call) => [call.correlationId, call.classification]));
    assert.equal(classifications.get("received"), "RECEIVED_NOT_DISPATCHED");
    assert.equal(classifications.get("dispatched"), "DISPATCHED_NOT_EXECUTED");
    assert.equal(classifications.get("contract"), "APP_CONTRACT_REJECTED");
    assert.equal(classifications.get("policy"), "APP_POLICY_DENIED");
    assert.equal(classifications.get("authorization"), "APP_AUTHORIZATION_DENIED");
    assert.equal(classifications.get("execution"), "APP_EXECUTION_ERROR");
    assert.equal(classifications.get("result"), "RESULT_RETURNED");
    assert.equal(classifications.get("materialized"), "RESULT_MATERIALIZED");
    assert.equal(classifications.get("serialized"), "RESULT_SERIALIZED");
    assert.equal(classifications.get("completed"), "RESPONSE_FINISHED_UNACKNOWLEDGED");
    assert.equal(classifications.get("acknowledged"), "CLIENT_ACKNOWLEDGED");
    assert.equal(classifications.get("closed-before-finish"), "CONNECTION_CLOSED_BEFORE_FINISH");
    assert.equal(classifications.get("transport"), "TRANSPORT_ERROR");
  });

  it("classifies every defined AppErrorCode through the shared authority", () => {
    const expected: Record<AppErrorCode, "contract" | "policy" | "authorization" | "execution" | "transport"> = {
      INVALID_INPUT: "contract",
      PATH_DENIED: "policy",
      FILE_DENIED: "policy",
      PATCH_DENIED: "policy",
      COMMAND_DENIED: "policy",
      APPROVAL_REQUIRED: "authorization",
      GIT_REQUIRED: "policy",
      GIT_CAPABILITY_UNAVAILABLE: "execution",
      WORKSPACE_POLICY_DENIED: "policy",
      TARGET_OUTSIDE_ARTIFACT_ROOTS: "policy",
      PROCESS_FAILED: "execution",
      WORKSPACE_REQUIRED: "policy",
      WORKSPACE_NOT_FOUND: "policy",
      REPARSE_POINT_REJECTED: "policy",
      EXTENSION_MISMATCH: "policy",
      MIME_MISMATCH: "policy",
      UNSUPPORTED_IMAGE: "policy",
      IMAGE_DIMENSIONS_REJECTED: "policy",
      FILE_TOO_LARGE: "policy",
      DOWNLOAD_TIMED_OUT: "execution",
      DOWNLOAD_FAILED: "execution",
      DESTINATION_EXISTS: "policy",
      VERIFICATION_FAILED: "execution"
    };

    assert.deepEqual(APP_ERROR_CODE_CLASSIFICATION, expected);
    for (const [code, classification] of Object.entries(expected)) {
      assert.equal(classifyAppErrorCode(code), classification, code);
      assert.equal(isPolicyDeniedErrorCode(code), classification === "policy", code);
    }

    assert.equal(classifyAppErrorCode("DOWNLOAD_TIMED_OUT"), "execution");
    assert.equal(classifyAppErrorCode("DOWNLOAD_FAILED"), "execution");
    assert.equal(classifyAppErrorCode("VERIFICATION_FAILED"), "execution");
    assert.equal(classifyAppErrorCode("PROCESS_FAILED"), "execution");
    assert.equal(classifyAppErrorCode("UNKNOWN_FUTURE_CODE"), "execution");
    assert.equal(classifyAppErrorCode("OAUTH_SCOPE_DENIED"), "authorization");
    assert.equal(isPolicyDeniedErrorCode("OAUTH_SCOPE_DENIED"), false);
  });

  it("applies default limit, since filtering, and no-receipt evidence wording", () => {
    const config = testConfig();
    const oldTimestamp = "2026-07-26T00:00:00.000Z";
    const newTimestamp = "2026-07-26T01:00:00.000Z";
    for (let index = 0; index < 25; index += 1) {
      trace(config, `call-${index.toString().padStart(2, "0")}`, ["http_received"], {
        timestamp: index < 5 ? oldTimestamp : newTimestamp
      });
    }

    assert.equal(readRecentToolCalls(config).calls.length, 20);
    assert.equal(readRecentToolCalls(config, { limit: 1 }).calls.length, 1);
    assert.ok(readRecentToolCalls(config, { since: "2026-07-26T00:30:00.000Z", limit: 50 }).calls.every((call) => call.startedAt >= newTimestamp));

    const bySince = readRecentToolCalls(config, { since: "2026-07-27T00:00:00.000Z" }).calls[0];
    assert.equal(bySince.classification, "NO_SERVER_RECEIPT_EVIDENCE");
    assert.equal(bySince.explanation, "No matching server receipt evidence was found.");

    const byCorrelation = readRecentToolCalls(config, { correlationId: "missing-correlation" }).calls[0];
    assert.equal(byCorrelation.classification, "NO_SERVER_RECEIPT_EVIDENCE");
    assert.equal(byCorrelation.explanation, "No matching server receipt evidence was found.");
  });

  it("ignores corrupt and partial trace lines while preserving older minimal entries", () => {
    const config = testConfig();
    const { tracePath } = getToolCallTracePaths(config);
    fs.mkdirSync(path.dirname(tracePath), { recursive: true });
    fs.writeFileSync(
      tracePath,
      [
        "{not json",
        JSON.stringify({ correlationId: "older-entry", stage: "http_received", timestamp: "2026-07-26T00:00:00.000Z" }),
        JSON.stringify({ stage: "http_received" }).slice(0, 12)
      ].join("\n"),
      "utf8"
    );

    const calls = readRecentToolCalls(config, { correlationId: "older-entry" }).calls;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].classification, "RECEIVED_NOT_DISPATCHED");
  });

  it("keeps old audit lines parseable and appends later correlated audit entries", async () => {
    const config = testConfig();
    fs.mkdirSync(path.dirname(config.auditLogPath), { recursive: true });
    fs.writeFileSync(
      config.auditLogPath,
      `${JSON.stringify({ timestamp: "2026-07-26T00:00:00.000Z", toolName: "old_tool", result: "allow", reason: "old schema" })}\n`,
      "utf8"
    );

    await writeAuditLog(config.auditLogPath, {
      toolName: "read_project_file",
      correlationId: "later-correlation",
      requestedPath: "README.md",
      result: "allow",
      reason: "ok"
    });

    const entries = fs.readFileSync(config.auditLogPath, "utf8").trim().split(/\r?\n/u).map((line) => JSON.parse(line) as { correlationId?: string; toolName: string });
    assert.equal(entries[0].toolName, "old_tool");
    assert.equal(entries[0].correlationId, undefined);
    assert.equal(entries[1].correlationId, "later-correlation");
  });

  it("sanitizes malicious and oversized string JSON-RPC IDs while preserving numeric and null IDs", () => {
    const config = testConfig();
    const cases: Array<{ correlationId: string; jsonRpcId: string | number | null; forbidden?: RegExp; expected?: string | number | null }> = [
      { correlationId: "numeric-id", jsonRpcId: 42, expected: 42 },
      { correlationId: "null-id", jsonRpcId: null, expected: null },
      { correlationId: "safe-string-id", jsonRpcId: "safe-request-123", expected: "safe-request-123" },
      { correlationId: "url-id", jsonRpcId: "id https://example.com/private?token=secret", forbidden: /example\.com|token=secret/u },
      { correlationId: "token-id", jsonRpcId: "access_token=secret-value", forbidden: /secret-value/u },
      { correlationId: "windows-path-id", jsonRpcId: "C:\\ProgramData\\Private\\file.md", forbidden: /ProgramData|Private|file\.md/u },
      { correlationId: "unc-path-id", jsonRpcId: "\\\\server\\share\\private\\file.md", forbidden: /server|share|private|file\.md/u },
      { correlationId: "unix-path-id", jsonRpcId: "/opt/private/file.md", forbidden: /\/opt\/private|file\.md/u },
      { correlationId: "content-id", jsonRpcId: "patch=PATCH_TEXT content=FILE_TEXT prompt=PRIVATE_PROMPT", forbidden: /PATCH_TEXT|FILE_TEXT|PRIVATE_PROMPT/u },
      { correlationId: "control-id", jsonRpcId: "line-one\r\nline-two\u0000tab\tend", forbidden: /\r|\n|\u0000|\t/u },
      { correlationId: "oversized-id", jsonRpcId: "x".repeat(500) }
    ];

    for (const testCase of cases) {
      recordToolCallTrace(config, {
        correlationId: testCase.correlationId,
        stage: "http_received",
        jsonRpcId: testCase.jsonRpcId
      });
    }

    const calls = new Map(readRecentToolCalls(config, { limit: 50 }).calls.map((call) => [call.correlationId, call]));
    assert.equal(calls.get("numeric-id")?.events[0].jsonRpcId, 42);
    assert.equal(calls.get("null-id")?.events[0].jsonRpcId, null);
    assert.equal(calls.get("safe-string-id")?.events[0].jsonRpcId, "safe-request-123");
    for (const testCase of cases) {
      if (testCase.forbidden) {
        assert.doesNotMatch(String(calls.get(testCase.correlationId)?.events[0].jsonRpcId), testCase.forbidden);
      }
    }
    assert.equal(String(calls.get("control-id")?.events[0].jsonRpcId), "line-one line-two tab end");
    assert.equal(String(calls.get("oversized-id")?.events[0].jsonRpcId).length, 128);
  });

  it("redacts secrets, paths, URLs, endpoint hostnames, patch text, and stack-like frames", () => {
    const config = testConfig();
    trace(config, "redacted", ["http_received", "transport_error"], {
      result: "error",
      errorCode: "TRANSPORT_ERROR",
      errorMessage: [
        `access_token=secret-value ${path.join(tempRoot, "private", "file.md")}`,
        "https://user:pass@example.trycloudflare.com/mcp?code=secret#frag",
        "http://127.0.0.1:3333/mcp?token=secret",
        "patch=PATCH_TEXT_SHOULD_NOT_SURVIVE",
        "at Object.privateFrame (C:\\Users\\sample-user\\Projects\\ChampCity_GPT\\src\\secret.ts:1:2)"
      ].join(" ")
    });

    const serialized = JSON.stringify(readRecentToolCalls(config, { correlationId: "redacted" }).calls[0]);
    assert.doesNotMatch(serialized, /secret-value|sample-user|trycloudflare|127\.0\.0\.1|token=secret|PATCH_TEXT_SHOULD_NOT_SURVIVE|privateFrame/u);
    assert.match(serialized, /<REDACTED_URL>|%USERPROFILE%|<REDACTED_SECRET>|<REDACTED_STACK>/u);
  });

  it("redacts arbitrary Windows, UNC, extended-length, Unix, and mounted absolute paths without destroying route fields", () => {
    const config = testConfig();
    recordToolCallTrace(config, {
      correlationId: "arbitrary-paths",
      stage: "http_received",
      mcpRoute: "/mcp",
      responseRoute: "/health"
    });
    recordToolCallTrace(config, {
      correlationId: "arbitrary-paths",
      stage: "transport_error",
      mcpRoute: "/mcp",
      responseRoute: "/health",
      result: "error",
      errorCode: "TRANSPORT_ERROR",
      errorMessage: [
        "D:\\Projects\\Private\\file.md",
        "C:\\ProgramData\\Private\\file.md",
        "\\\\server\\share\\private\\file.md",
        "\\\\?\\C:\\Very\\Long\\Private\\file.md",
        "/srv/private/file.md",
        "/opt/private/file.md",
        "/var/lib/private/file.md",
        "/mnt/workspace/private/file.md",
        "/etc/private/config",
        "/usr/local/private/file",
        "/root/private/file",
        "/run/secrets/value",
        "/projects/private/file"
      ].join(" ")
    });

    const call = readRecentToolCalls(config, { correlationId: "arbitrary-paths" }).calls[0];
    const serialized = JSON.stringify(call);
    assert.equal(call.events[0].mcpRoute, "/mcp");
    assert.equal(call.events[0].responseRoute, "/health");
    assert.doesNotMatch(serialized, /D:\\Projects|C:\\ProgramData|server\\share|Very\\Long|\/srv\/private|\/opt\/private|\/var\/lib\/private|\/mnt\/workspace|\/etc\/private|\/usr\/local|\/root\/private|\/run\/secrets|\/projects\/private/u);
    assert.match(serialized, /<REDACTED_PATH>/u);
  });

  it("sanitizes old persisted trace lines when read", () => {
    const config = testConfig();
    const { tracePath } = getToolCallTracePaths(config);
    fs.mkdirSync(path.dirname(tracePath), { recursive: true });
    fs.writeFileSync(
      tracePath,
      `${JSON.stringify({
        timestamp: "2026-07-26T00:00:00.000Z",
        correlationId: "old-unsafe-id",
        stage: "http_received",
        jsonRpcId: "https://example.com/private?access_token=secret",
        errorMessage: "C:\\ProgramData\\Private\\file.md"
      })}\n`,
      "utf8"
    );

    const serialized = JSON.stringify(readRecentToolCalls(config, { correlationId: "old-unsafe-id" }).calls[0]);
    assert.doesNotMatch(serialized, /example\.com|access_token=secret|ProgramData|Private|file\.md/u);
  });

  it("keeps the active trace bounded to the newest 2,000 complete events", () => {
    const config = testConfig();
    for (let index = 0; index < 2_010; index += 1) {
      recordToolCallTrace(config, {
        correlationId: `retained-${index}`,
        stage: "http_received",
        timestamp: new Date(1_000_000 + index).toISOString(),
        publicTool: "repo_toolbox"
      });
    }

    const lines = fs.readFileSync(getToolCallTracePaths(config).tracePath, "utf8").trim().split(/\r?\n/u);
    assert.equal(lines.length, 2_000);
    assert.equal(JSON.parse(lines[0]).correlationId, "retained-10");
    assert.equal(JSON.parse(lines[lines.length - 1]).correlationId, "retained-2009");
  });

  it("does not return temporary compaction files through diagnostics", () => {
    const config = testConfig();
    const { tracePath } = getToolCallTracePaths(config);
    fs.mkdirSync(path.dirname(tracePath), { recursive: true });
    fs.writeFileSync(tracePath, `${JSON.stringify({ correlationId: "real-event", stage: "http_received" })}\n`, "utf8");
    fs.writeFileSync(`${tracePath}.123.tmp`, `${JSON.stringify({ correlationId: "temp-event", stage: "http_received" })}\n`, "utf8");

    const serialized = JSON.stringify(readRecentToolCalls(config, { limit: 50 }).calls);
    assert.match(serialized, /real-event/u);
    assert.doesNotMatch(serialized, /temp-event/u);
  });

  it("keeps retention capped after corrupt-line cleanup", () => {
    const config = testConfig();
    const { tracePath } = getToolCallTracePaths(config);
    fs.mkdirSync(path.dirname(tracePath), { recursive: true });
    const lines = ["{broken"];
    for (let index = 0; index < 2_005; index += 1) {
      lines.push(JSON.stringify({ correlationId: `cleanup-${index}`, stage: "http_received", timestamp: new Date(2_000_000 + index).toISOString() }));
    }
    fs.writeFileSync(tracePath, `${lines.join("\n")}\n`, "utf8");

    recordToolCallTrace(config, {
      correlationId: "after-cleanup",
      stage: "http_received"
    });

    const retained = fs.readFileSync(tracePath, "utf8").trim().split(/\r?\n/u);
    assert.equal(retained.length, 2_000);
    assert.doesNotThrow(() => retained.forEach((line) => JSON.parse(line)));
    assert.equal(JSON.parse(retained[retained.length - 1]).correlationId, "after-cleanup");
  });

  it("does not fail trace recording when compaction fails after append", () => {
    const config = testConfig();
    const { tracePath } = getToolCallTracePaths(config);
    fs.mkdirSync(path.dirname(tracePath), { recursive: true });
    fs.writeFileSync(
      tracePath,
      Array.from({ length: 2_000 }, (_, index) => JSON.stringify({ correlationId: `pre-${index}`, stage: "http_received" })).join("\n") + "\n",
      "utf8"
    );

    const originalRenameSync = fs.renameSync;
    fs.renameSync = (() => {
      throw new Error("forced compaction replacement failure");
    }) as typeof fs.renameSync;
    try {
      assert.doesNotThrow(() => recordToolCallTrace(config, { correlationId: "append-before-compaction-failure", stage: "http_received" }));
    } finally {
      fs.renameSync = originalRenameSync;
    }

    assert.match(fs.readFileSync(tracePath, "utf8"), /append-before-compaction-failure/u);
    fs.rmSync(path.dirname(tracePath), { recursive: true, force: true });
  });
});
