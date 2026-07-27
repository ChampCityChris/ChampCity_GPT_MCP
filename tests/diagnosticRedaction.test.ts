import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  sanitizeDiagnosticEndpoint,
  sanitizeDiagnosticJsonRpcId,
  sanitizeDiagnosticRoute,
  sanitizeDiagnosticText
} from "../src/security/diagnosticRedaction.js";

describe("field-aware diagnostic redaction", () => {
  it("redacts arbitrary free-text absolute paths, endpoints, secrets, content, and stack frames", () => {
    const redacted = sanitizeDiagnosticText(
      [
        "D:\\Projects\\Private\\file.md",
        "C:\\ProgramData\\Private\\file.md",
        "\\\\server\\share\\private\\file.md",
        "\\\\?\\C:\\Very\\Long\\Private\\file.md",
        "/etc/private/config",
        "/usr/local/private/file",
        "/root/private/file",
        "/run/secrets/value",
        "/projects/private/file",
        "https://example.com/mcp?access_token=secret",
        "access_token=secret-value",
        "patch=PATCH_TEXT_SHOULD_NOT_SURVIVE",
        "at Object.privateFrame (C:\\Users\\sample-user\\src\\secret.ts:1:2)"
      ].join(" ")
    );

    assert.doesNotMatch(redacted, /Projects|ProgramData|server\\share|Very\\Long|\/etc|\/usr\/local|\/root|\/run|\/projects|example\.com|secret-value|PATCH_TEXT_SHOULD_NOT_SURVIVE|privateFrame/u);
    assert.match(redacted, /<REDACTED_PATH>|<REDACTED_URL>|<REDACTED_SECRET>|<REDACTED_TEXT>|<REDACTED_STACK>/u);
  });

  it("keeps JSON-RPC numeric, null, and safe short IDs while sanitizing strings", () => {
    assert.equal(sanitizeDiagnosticJsonRpcId(42), 42);
    assert.equal(sanitizeDiagnosticJsonRpcId(null), null);
    assert.equal(sanitizeDiagnosticJsonRpcId("safe-request-123"), "safe-request-123");
    assert.equal(String(sanitizeDiagnosticJsonRpcId("x".repeat(500))).length, 128);
    assert.doesNotMatch(String(sanitizeDiagnosticJsonRpcId("id https://example.com/private?token=secret")), /example\.com|token=secret/u);
    assert.doesNotMatch(String(sanitizeDiagnosticJsonRpcId("/etc/private/config")), /\/etc|private|config/u);
  });

  it("preserves approved route fields separately from arbitrary path-like values", () => {
    assert.equal(sanitizeDiagnosticRoute("/mcp"), "/mcp");
    assert.equal(sanitizeDiagnosticRoute("/health"), "/health");
    assert.equal(sanitizeDiagnosticRoute("/oauth/token"), "/oauth/token");
    assert.equal(sanitizeDiagnosticRoute("batch-scope-denied"), "batch-scope-denied");
    assert.equal(sanitizeDiagnosticRoute("/etc/private/config"), undefined);
    assert.equal(sanitizeDiagnosticRoute("https://example.com/mcp"), undefined);
  });

  it("redacts endpoint and host fields without persisting public tunnel URLs", () => {
    assert.equal(sanitizeDiagnosticEndpoint("https://abc.trycloudflare.com/mcp"), "<REDACTED_ENDPOINT>");
    assert.equal(sanitizeDiagnosticEndpoint("127.0.0.1:3333"), "<REDACTED_ENDPOINT>");
    assert.equal(sanitizeDiagnosticEndpoint("chat.openai.com"), "chat.openai.com");
  });
});
