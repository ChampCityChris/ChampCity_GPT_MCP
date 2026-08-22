# Builder Report: WC-V1-0104B Result Delivery Telemetry, Acknowledgement, and Failure Attribution

## Identity

- Work Card: `WC-V1-0104B`
- Repository: `%USERPROFILE%\Projects\ChampCity_GPT`
- Remote: `https://github.com/ChampCityChris/ChampCity_GPT_MCP.git`
- Starting HEAD: `db6aa399716db271f2b38a6927de33f0f29a55ec`
- Final HEAD: `db6aa399716db271f2b38a6927de33f0f29a55ec`
- Branch at implementation: existing worktree branch, not changed by Builder

## Starting Dirty State

At implementation start the worktree already contained:

- Modified: `docs/CHATGPT_CONNECTION_GUIDE.md`
- Untracked: `planning/phases/phase-v1.0/Architect_Reports/CODE_REVIEW_RCA_OPENAI_SAFETY_LAYER_FALSE_POSITIVES_AND_GIT_COUPLING_2026-07-31.md`
- Untracked: `planning/phases/phase-v1.0/Work_Cards/WC-V1-0104B_result_delivery_telemetry_acknowledgement_and_failure_attribution.md`
- Untracked: `planning/phases/phase-v1.0/Work_Cards/WC-V1-0202G_bounded_text_projection_and_safety_resilient_read_protocol.md`
- Untracked: `planning/phases/phase-v1.0/Work_Cards/WC-V1-0202H_workspace_capability_model_and_git_isolation.md`

The unrelated pre-existing `docs/CHATGPT_CONNECTION_GUIDE.md` modification was preserved. This card appended a scoped result-delivery diagnostics section to that same file because the work card explicitly required documentation updates.

## Files Changed

- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `docs/RELEASE_NOTES.md`
- `docs/SECURITY_MODEL.md`
- `docs/TOOL_REFERENCE.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104B_result_delivery_telemetry_acknowledgement_and_failure_attribution.md`
- `src/security/auditLog.ts`
- `src/security/diagnosticRedaction.ts`
- `src/server/registerTools.ts`
- `src/server/resultDeliveryTrace.ts`
- `src/server/resultTelemetry.ts`
- `src/server/toolCallTrace.ts`
- `src/tools/common.ts`
- `src/tools/domainToolboxes.ts`
- `src/tools/toolboxActionPolicy.ts`
- `src/transports/httpTransport.ts`
- `src/utils/errorClassification.ts`
- `tests/httpTransport.test.ts`
- `tests/resultDeliveryTrace.test.ts`
- `tests/toolCallTrace.test.ts`

## Implementation Summary

- Added per-result `resultAttemptId`, `attemptNumber`, serializer metadata, content-item dimensions, bounded top-level key names, payload byte counts, SHA-256 digests, and final envelope digest metadata.
- Added `result_materialized`, `result_serialized`, `http_response_finished`, `http_connection_closed`, and `client_result_acknowledged` trace stages while preserving legacy `http_response_completed` events for old persisted traces.
- Added `diagnostics_toolbox.acknowledge_tool_result` and `diagnostics_toolbox.result_delivery_status` as read-scoped diagnostic actions under the existing public toolbox surface.
- Refactored public tool response creation so successful results materialize before serialization, serialization is measured, and the measured result is the returned result.
- Added Node HTTP `finish`, `close`, and `error` lifecycle listeners before response completion for traced `/mcp` calls. Batch calls retain separate correlation/result-attempt identities while sharing response lifecycle evidence safely.
- Replaced the old three-way failure taxonomy with contract, policy, authorization, execution, and transport classifications.

## Result-Attempt Schema And Retention

Result attempts are trace-retained in the existing bounded `mcp-tool-call-trace.ndjson` file, capped by the existing `MAX_TRACE_EVENTS` policy of 2,000 sanitized events. A result attempt records:

- `correlationId`
- `resultAttemptId`
- `attemptNumber`
- optional `parentResultAttemptId`
- public tool/action/workspace/path hints after existing redaction
- serializer name/version
- content item count/types
- structured-content presence
- payload and final-envelope byte counts and SHA-256 digests
- HTTP status/content type/content length where available
- finish/close/close-before-finish evidence
- acknowledgement timestamp/method when recorded

No result content, document excerpts, prompt text, patch text, artifact bodies, credentials, raw URLs, or absolute filesystem paths are persisted.

## Digest Domain

The delivery receipt cannot contain a hash of itself. The implementation records:

- `payloadSha256`: digest of the serialized `CallToolResult` before diagnostic receipt injection, used by the client acknowledgement receipt.
- `finalPayloadSha256`: digest of the final returned `CallToolResult` envelope after receipt injection, stored in trace/status telemetry only.

This preserves exact final-envelope measurement without making the receipt self-referential.

## Old-To-New Stage Mapping

- `http_received` remains unchanged.
- `dispatch_started`, `toolbox_entered`, helper stages remain unchanged.
- `tool_result_returned` is retained as a compatibility/internal result-return event.
- `result_materialized` means the toolbox result object exists before public MCP serialization.
- `result_serialized` means the public MCP result was serialized and measured.
- `http_response_completed` remains parseable as a legacy/deprecated finish-equivalent event.
- `http_response_finished` records Node response `finish`.
- `http_connection_closed` records response close and whether it preceded finish.
- `client_result_acknowledged` records an exact diagnostic receipt match.

## Error Classification Table

- `INVALID_INPUT`, unsupported toolbox actions, schema validation failures, duplicate JSON-RPC IDs: `contract`
- `PATH_DENIED`, `FILE_DENIED`, `PATCH_DENIED`, `COMMAND_DENIED`, `WORKSPACE_POLICY_DENIED`, `TARGET_OUTSIDE_ARTIFACT_ROOTS`, `REPARSE_POINT_REJECTED`, size/type restrictions: `policy`
- `OAUTH_SCOPE_DENIED`, `APPROVAL_REQUIRED`: `authorization`
- process, download, serialization, verification, and unknown application failures: `execution`
- HTTP/socket/SDK transport failures: `transport`

Trace classifications now include `APP_CONTRACT_REJECTED`, `APP_POLICY_DENIED`, `APP_AUTHORIZATION_DENIED`, `APP_EXECUTION_ERROR`, `RESULT_MATERIALIZED`, `RESULT_SERIALIZED`, `RESPONSE_FINISHED_UNACKNOWLEDGED`, `CLIENT_ACKNOWLEDGED`, `CONNECTION_CLOSED_BEFORE_FINISH`, and `TRANSPORT_ERROR`.

## HTTP Instrumentation

`httpTransport.ts` attaches one bounded lifecycle recorder per traced response before response completion. It records `finish`, `close`, and `error` at most once per response, projects the evidence to each contained tool-call context, records close-before-finish distinctly, and removes listeners after close.

The implementation does not treat `transport.handleRequest` returning as client acknowledgement.

## Acknowledgement Rules

- Exact match required: `correlationId`, `resultAttemptId`, and `payloadSha256`.
- Unknown attempts return bounded `not_found`.
- Digest mismatch is `APP_CONTRACT_REJECTED`.
- Duplicate identical acknowledgement is idempotent.
- Conflicting duplicate acknowledgement is rejected.
- Acknowledgement writes both trace and audit records.
- Acknowledgement is diagnostic receipt only, not approval.
- The action requires `files.read` and does not mutate workspace files.

## Content-Logging Proof

Focused tests assert that private result text does not appear in trace persistence. The telemetry module measures serialized byte lengths and SHA-256 digests from `CallToolResult` JSON strings but records only counts, types, hashes, and bounded keys. Redaction validators bound identifiers, digests, key names, arrays, booleans, and integers before persistence.

## Acceptance-Test Mapping

- Normal read/materialized/serialized/finished/unacknowledged: `tests/resultDeliveryTrace.test.ts`
- Valid acknowledgement and `CLIENT_ACKNOWLEDGED`: `tests/resultDeliveryTrace.test.ts`
- Duplicate acknowledgement idempotency: `tests/resultDeliveryTrace.test.ts`
- Digest mismatch contract rejection: `tests/resultDeliveryTrace.test.ts`
- Unknown attempt bounded not-found: `tests/resultDeliveryTrace.test.ts`
- No content in trace/audit persistence: `tests/resultDeliveryTrace.test.ts`, existing HTTP trace redaction tests
- Exact byte counts/digests for receipt and final envelope domains: `tests/resultDeliveryTrace.test.ts`, typechecked telemetry code
- Content item type/count and structured-content dimensions: `tests/resultDeliveryTrace.test.ts`
- HTTP finish distinct from handler return and batch correlation: `tests/httpTransport.test.ts`
- `INVALID_INPUT` as contract, OAuth scope as authorization, path/file denials as policy: `tests/toolCallTrace.test.ts`, `tests/httpTransport.test.ts`
- Existing persisted trace parseability and retention: `tests/toolCallTrace.test.ts`
- `mcp_tool_inventory` action inventory: covered by existing toolbox/action policy and self-test lanes
- Public top-level tool count unchanged: MCP schema/self-test coverage

## Validation

All validation below used the required normal Windows execution lane where child-process-capable commands were involved.

- `npm run typecheck`: PASS, normal Windows lane.
- `npm run validate:codex:unit`: PASS, normal Windows lane, 402 tests passed.
- `npm run validate:codex:build`: PASS, normal Windows lane.
- `npm run mcp:self-test`: PASS, normal Windows lane, 23 passed.
- `npm run check:public`: PASS, normal Windows lane, 261 source candidate files checked.
- `npm run lint`: PASS, normal Windows lane.
- `git diff --check`: PASS, no whitespace errors; Git reported LF-to-CRLF working-copy warnings.

No sandbox-only `spawn EPERM` failure occurred.

## Validation Not Performed

- No Playwright validation.
- No package, promote, release, publish, restart, reconnect, or live ChatGPT connector validation.
- No subjective visual validation.

## Protected Subsystems

Touched:

- MCP HTTP transport instrumentation in `src/transports/httpTransport.ts`
- MCP tool discovery/action inventory through existing toolbox action policy and diagnostics toolbox wiring

Not touched:

- OAuth/DCR implementation semantics
- PKCE behavior
- Cloudflare tunnel configuration
- token/session storage
- public top-level tool count
- write-scope enforcement semantics
- packaging/release configuration
- runtime start/stop/restart behavior
- existing preload API contracts

## Scope And Fallbacks

Scope did not change during implementation. No fallback implementation was used.

A digest-domain clarification was implemented because a receipt cannot contain a hash of itself. The implementation records both receipt-domain and final-envelope digests rather than weakening telemetry or omitting the receipt.

## Final Dirty State

Changes remain unstaged. Nothing was staged, committed, pushed, integrated, packaged, promoted, restarted, reconnected, published, or released.

The pre-existing untracked Work Cards and Architect RCA remain untracked. The pre-existing `docs/CHATGPT_CONNECTION_GUIDE.md` modification remains preserved with the scoped documentation addition required by this card.

## Remaining Operator Validation

After separate Architect approval and separately authorized package/promotion/reconnect:

1. Call a small read and record the delivery receipt.
2. Acknowledge the exact result and confirm `CLIENT_ACKNOWLEDGED`.
3. Call a larger benign read and confirm dimensions without content in logs.
4. Omit acknowledgement and confirm `RESPONSE_FINISHED_UNACKNOWLEDGED`.
5. Reproduce a host-reported safety block when possible.
6. Query by both correlation ID and result-attempt ID.
7. Inspect logs for absence of document text, credentials, absolute paths, and full endpoints.
