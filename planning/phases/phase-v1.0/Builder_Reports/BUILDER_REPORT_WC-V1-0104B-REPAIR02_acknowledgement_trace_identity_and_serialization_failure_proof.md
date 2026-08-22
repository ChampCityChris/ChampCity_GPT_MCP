# BUILDER REPORT - WC-V1-0104B-REPAIR02

## Summary

Status: PASS

Implemented the acknowledgement trace identity repair and added public HTTP proof for a controlled nonserializable result. The acknowledgement event now copies the target result attempt's persisted request identity and telemetry schema version instead of inheriting the later acknowledgement request context.

## Files Changed

- `src/server/resultDeliveryTrace.ts`
- `src/server/registerTools.ts`
- `tests/httpTransport.test.ts`
- `tests/resultDeliveryTrace.test.ts`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104B-REPAIR02_acknowledgement_trace_identity_and_serialization_failure_proof.md`

Note: all source/test files above except this Builder Report were already dirty or untracked before this repair began.

## Implementation

- `acknowledgeToolResult()` now records `client_result_acknowledged` with the target serialized event's:
  - `correlationId`
  - `jsonRpcId`
  - `resultAttemptId`
  - `attemptNumber`
  - `resultTelemetrySchemaVersion`
  - target public tool/action/workspace/path and payload digest
- The acknowledgement request still records its own normal diagnostics tool trace under its own HTTP request JSON-RPC ID.
- The public tool-call wrapper now records a failed `tool_result_returned` event if response materialization/measurement throws, then lets the existing safe MCP error conversion create and return a separate measured `isError: true` result attempt.
- A controlled test-only `ToolExposureOptions.serializationFailureFixture` hook was added for the HTTP test. It is not exposed in default production tool discovery and does not add a public tool.

## HTTP Proof

Acknowledgement identity HTTP test:

- Original public HTTP `tools/call` JSON-RPC ID: `2`
- Later acknowledgement HTTP `tools/call` JSON-RPC ID: `4`
- Duplicate/idempotent acknowledgement JSON-RPC ID: `5`
- Status calls used JSON-RPC IDs `3` and `6`

Assertions added:

- Every event under the original `repo_toolbox.read_file` correlation has `jsonRpcId === 2`, including `client_result_acknowledged`.
- The `client_result_acknowledged` event has:
  - `jsonRpcId: 2`
  - `resultAttemptId: <target receipt resultAttemptId>`
  - `resultTelemetrySchemaVersion: 1`
  - `payloadSha256: <target receipt payloadSha256>`
- The acknowledgement call trace remains separate under `diagnostics_toolbox` with every event having `jsonRpcId === 4`.
- The acknowledgement call trace does not contain `client_result_acknowledged`.
- The acknowledged attempt classifies as `CLIENT_ACKNOWLEDGED`.
- Duplicate acknowledgement remains idempotent.

Serialization-failure HTTP test:

- Public HTTP `tools/call` JSON-RPC ID: `serialization-failure-A`
- Public tool: `diagnostics_toolbox`
- Controlled action: `__test_nonserializable_result`
- Controlled fixture: a result with serializable `mcpContent` and cyclic `structuredContent`, causing `JSON.stringify()` in result measurement to fail.

Assertions added:

- Failed private payload attempt records `result_materialized` and `tool_result_returned` with `result: "error"`.
- Failed private payload attempt does not record `result_serialized`, `http_response_finished`, or `client_result_acknowledged`.
- Failed private payload attempt classifies as `APP_EXECUTION_ERROR`.
- Separately returned safe MCP error result has `isError: true`.
- Safe error result receives its own delivery receipt and measured `result_serialized` event.
- Safe error attempt records `http_response_finished`.
- Safe error attempt classifies as `APP_EXECUTION_ERROR`.
- Trace, audit persistence, and returned safe error messages do not contain the private payload sentinel, fixture secret, private path, or stack-frame text.

## Validation

Execution lane: normal Windows validation lane, using the repository wrapper where applicable.

- `npm run validate:codex:unit`
  - First sandbox run failed with known `spawn EPERM` during esbuild.
  - Rerun in normal Windows lane passed.
  - Result: 407 tests passed, 0 failed.
- `npm run validate:codex:build`
  - Normal Windows lane.
  - Result: PASS.
- `node --test dist/tests/httpTransport.test.js dist/tests/resultDeliveryTrace.test.js dist/tests/toolCallTrace.test.js`
  - Normal Windows lane.
  - Result: 89 tests passed, 0 failed.
- `npm run typecheck`
  - Normal Windows lane.
  - Result: PASS.
- `npm run lint`
  - Normal Windows lane.
  - Result: PASS.
- `npm run mcp:self-test`
  - Normal Windows lane.
  - Result: PASS, 23 checks passed, 0 failed.
- `npm run check:public`
  - Normal Windows lane.
  - Result: PASS publication cleanliness, 267 source candidate files checked.
- `git diff --check`
  - Result before report: PASS, with line-ending warnings only.

## Dirty Worktree Accounting

Starting dirty count: 29 paths

Starting dirty paths:

- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `docs/RELEASE_NOTES.md`
- `docs/SECURITY_MODEL.md`
- `docs/TOOL_REFERENCE.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`
- `src/security/auditLog.ts`
- `src/security/diagnosticRedaction.ts`
- `src/server/registerTools.ts`
- `src/server/toolCallTrace.ts`
- `src/tools/common.ts`
- `src/tools/domainToolboxes.ts`
- `src/tools/toolboxActionPolicy.ts`
- `src/transports/httpTransport.ts`
- `src/utils/errorClassification.ts`
- `tests/httpTransport.test.ts`
- `tests/toolCallTrace.test.ts`
- `planning/phases/phase-v1.0/Architect_Reports/ARCHITECT_REVIEW_WC-V1-0104B-REPAIR01_model_visible_receipts_and_delivery_evidence_completion.md`
- `planning/phases/phase-v1.0/Architect_Reports/ARCHITECT_REVIEW_WC-V1-0104B_result_delivery_telemetry_acknowledgement_and_failure_attribution.md`
- `planning/phases/phase-v1.0/Architect_Reports/CODE_REVIEW_RCA_OPENAI_SAFETY_LAYER_FALSE_POSITIVES_AND_GIT_COUPLING_2026-07-31.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104B-REPAIR01_model_visible_receipts_and_delivery_evidence_completion.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104B_result_delivery_telemetry_acknowledgement_and_failure_attribution.md`
- `planning/phases/phase-v1.0/Work_Cards/WC-V1-0104B-REPAIR01_model_visible_receipts_and_delivery_evidence_completion.md`
- `planning/phases/phase-v1.0/Work_Cards/WC-V1-0104B-REPAIR02_acknowledgement_trace_identity_and_serialization_failure_proof.md`
- `planning/phases/phase-v1.0/Work_Cards/WC-V1-0104B_result_delivery_telemetry_acknowledgement_and_failure_attribution.md`
- `planning/phases/phase-v1.0/Work_Cards/WC-V1-0202G_bounded_text_projection_and_safety_resilient_read_protocol.md`
- `planning/phases/phase-v1.0/Work_Cards/WC-V1-0202H_workspace_capability_model_and_git_isolation.md`
- `src/server/resultDeliveryTrace.ts`
- `src/server/resultTelemetry.ts`
- `tests/resultDeliveryTrace.test.ts`

Final dirty count: 30 paths

Final dirty paths: the same 29 starting paths, plus:

- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104B-REPAIR02_acknowledgement_trace_identity_and_serialization_failure_proof.md`

## Scope and Safety

- Protected subsystem touched: MCP tool registration/handler code was touched only to add result serialization failure tracing and a controlled test fixture hook. No OAuth, PKCE, MCP transport, endpoint behavior, write-scope enforcement, token/session storage, packaging, runtime path, Cloudflare, or server lifecycle behavior was changed.
- Scope did not change during implementation.
- No fallback implementation was used.
- No duplicate trace store or alternate identity authority was added.
- Nothing was staged, committed, pushed, packaged, promoted, restarted, reconnected, published, or released.

## Remaining Operator Validation

- Live ChatGPT connector validation was not performed because it is out of scope for this repair card.
- Operator may optionally verify in a new ChatGPT conversation that model-visible delivery receipts still appear in `structuredContent` and that `acknowledge_tool_result` remains callable through the live connector.

## Disposition

Document.Status=PendingOperatorApproval
