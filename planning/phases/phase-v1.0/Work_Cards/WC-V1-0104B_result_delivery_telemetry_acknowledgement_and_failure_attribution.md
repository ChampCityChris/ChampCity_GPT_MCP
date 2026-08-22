# WC-V1-0104B — Result Delivery Telemetry, Acknowledgement, and Failure Attribution

## Work Card Identity

- ID: `WC-V1-0104B`
- Title: Result Delivery Telemetry, Acknowledgement, and Failure Attribution
- Phase: v1.0 — ChatGPT Connector and Safety-Layer Reliability
- Priority: P0
- Type: Observability and protocol hardening
- Repository: `%USERPROFILE%\Projects\ChampCity_GPT`
- Remote: `ChampCityChris/ChampCity_GPT_MCP`
- Branch at authorization: `dev`
- Starting HEAD at authorization: `db6aa399716db271f2b38a6927de33f0f29a55ec`
- Controlling RCA: `planning/phases/phase-v1.0/Architect_Reports/CODE_REVIEW_RCA_OPENAI_SAFETY_LAYER_FALSE_POSITIVES_AND_GIT_COUPLING_2026-07-31.md`
- Required Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104B_result_delivery_telemetry_acknowledgement_and_failure_attribution.md`

## Authorization Basis

The controlling RCA established that existing request-bound traces stop at the ChampCity MCP server boundary. `RESPONSE_COMPLETED` currently means that the server completed an HTTP response. It does not prove that ChatGPT accepted the result, exposed it to the model, or consumed its content.

The trace also lacks safe result dimensions needed to correlate host-side safety failures with payload size, serializer, item structure, truncation, or retry attempts. Unsupported actions are classified as application policy denials because `INVALID_INPUT` is grouped with security-policy errors.

This card is authorized to extend the existing request-ID-bound trace architecture. It must not replace or weaken the identity, OAuth, redaction, path, write-mode, or public-tool protections implemented by `WC-V1-0104A-REPAIR03`.

## Sequencing and Isolation

Implement this card before `WC-V1-0202G`.

Do not implement bounded text reads, Markdown section projection, Git policy migration, packaging, promotion, release, or live connector validation under this card.

The repository contains an unrelated tracked modification outside this work card: `docs/CHATGPT_CONNECTION_GUIDE.md`. Preserve it and every other unrelated change discovered at implementation start exactly. Do not reset, restore whole files, clean, stash, discard, stage, commit, push, merge, integrate, package, promote, restart, reconnect, publish, or release.

## Objective

Extend the MCP trace from request execution into a privacy-safe result-delivery protocol that can distinguish:

- no server receipt;
- receipt without dispatch;
- application contract rejection;
- application policy denial;
- authorization denial;
- application execution error;
- result materialization;
- result serialization;
- HTTP response finish;
- connection close or transport error;
- response finished without client acknowledgement; and
- explicit client acknowledgement of a specific result attempt.

The implementation must provide evidence sufficient to investigate a ChatGPT host safety error without retaining document content, prompt text, patch text, credentials, absolute paths, or secrets.

## Mandatory Implementation Scope

### 1. Add a result-attempt identity

Create a bounded result-attempt identity generated after tool execution and before public result serialization.

Each substantive tool response must be associated with:

- existing `correlationId`;
- new `resultAttemptId`;
- `attemptNumber`, defaulting to `1`;
- optional `parentResultAttemptId` for deterministic retries;
- public tool name;
- toolbox action;
- workspace ID;
- sanitized requested path when available.

Requirements:

- `resultAttemptId` must be random or cryptographically collision-resistant;
- it must not derive from content;
- it must be bounded and safe for diagnostics;
- it must not replace the existing request correlation ID;
- one request may have more than one result attempt only when an explicit retry protocol identifies the relationship;
- attempts from separate requests must never share identity implicitly.

### 2. Extend trace stages

Extend `ToolCallTraceStage` with explicit result-delivery stages. Required semantic stages:

- `result_materialized`
- `result_serialized`
- `http_response_finished`
- `http_connection_closed`
- `client_result_acknowledged`

Retain backward compatibility for persisted `http_response_completed` events. It may remain as a deprecated stage or be normalized during reads, but existing trace files must remain parseable.

Required meanings:

- `result_materialized`: the toolbox result object exists before MCP serialization;
- `result_serialized`: the MCP `CallToolResult` has been created and safe response dimensions have been measured;
- `http_response_finished`: Node emitted response `finish` or equivalent evidence that response bytes were handed to the transport stack;
- `http_connection_closed`: the response/socket closed, with a safe indicator of whether finish had already occurred;
- `client_result_acknowledged`: a later explicit acknowledgement matched the result attempt and payload digest.

Do not use `client_result_acknowledged` to imply OpenAI approved the content under every internal policy. It proves only that a subsequent caller supplied the matching receipt.

### 3. Persist privacy-safe result telemetry

Extend trace events and/or a dedicated result-delivery record with the following fields where available:

- `resultAttemptId`
- `attemptNumber`
- `parentResultAttemptId`
- `serializerName`
- `serializerVersion`
- `contentItemCount`
- `contentItemTypes`
- `structuredContentPresent`
- `payloadBytes`
- `payloadSha256`
- `maximumContentItemBytes`
- `textCharacterCount`
- `textLineCount`
- `topLevelResultKeys`
- `truncated`
- `chunked`
- `chunkIndex`
- `chunkCount`
- `sourceSha256`
- `sourceRangeStart`
- `sourceRangeEnd`
- `httpStatus`
- `responseContentType`
- `contentLengthHeader`
- `socketBytesWrittenDelta` when safely measurable
- `finishObserved`
- `closeObserved`
- `closeBeforeFinish`
- safe transport error code
- acknowledgement timestamp and acknowledgement method.

Hard restrictions:

- never persist result content;
- never persist document excerpts;
- never persist prompt, patch, or artifact body text;
- never persist raw URLs, credentials, OAuth material, cookies, or absolute filesystem paths;
- never persist unbounded arrays or arbitrary result values;
- top-level keys must be sanitized, bounded, and limited in count;
- hashes must be SHA-256 of exact serialized bytes or exact source bytes as labeled;
- telemetry schema must be versioned.

### 4. Instrument result materialization and serialization

Refactor `toolResponse` so result measurement is explicit and testable.

Required design:

- produce a typed materialization record before serialization;
- serialize once for the selected response mode;
- measure the exact public `CallToolResult` representation rather than an approximation;
- record payload SHA-256 and byte count after serialization;
- record content item metadata without duplicating content;
- return the same public result that was measured;
- record serialization failures as application execution errors, not successful result returns.

`tool_result_returned` must no longer be emitted before serialization if its meaning implies a public result exists. Either move it after successful `toolResponse` construction or retain it as an internal result stage and use the new stages for public delivery.

### 5. Instrument Node HTTP finish, close, and error evidence

Update `httpTransport.ts` to attach bounded listeners for each traced tool-call response.

Required behavior:

- register `finish`, `close`, and `error` listeners before response completion;
- record each lifecycle event at most once per correlation/result attempt;
- distinguish close-before-finish from normal close-after-finish;
- do not calculate global socket byte counts without a per-response delta or safe approximation;
- do not treat `transport.handleRequest` returning as equivalent to client acknowledgement;
- ensure batch responses bind lifecycle evidence to each contained call without cross-association;
- remove listeners after terminal recording to avoid leaks;
- preserve stateful and stateless transport behavior.

### 6. Add explicit result acknowledgement

Add a read-scoped diagnostic action:

`diagnostics_toolbox.acknowledge_tool_result`

Required parameters:

- `correlationId`
- `resultAttemptId`
- `payloadSha256`
- optional `acknowledgementContext`, restricted to a short enum such as `content_consumed`, `metadata_consumed`, or `retry_requested`.

Required behavior:

- no document content is accepted;
- the acknowledgement must match an existing result attempt exactly;
- digest mismatch returns a contract rejection;
- unknown/expired attempts return a bounded not-found result without exposing unrelated trace entries;
- duplicate identical acknowledgement is idempotent;
- conflicting duplicate acknowledgement is rejected;
- acknowledgement writes a trace event and audit record;
- acknowledgement requires only `files.read` because it records diagnostic receipt state and does not mutate a project workspace;
- acknowledgement retention follows the trace-retention policy.

The action must not be named or described as an approval control.

### 7. Add result-delivery status query

Add a read-scoped diagnostic action:

`diagnostics_toolbox.result_delivery_status`

It must support exact lookup by:

- `correlationId`; or
- `resultAttemptId`.

Return only bounded safe metadata:

- current delivery classification;
- lifecycle stages;
- result dimensions;
- acknowledgement status;
- sanitized public tool/action/workspace/path;
- no raw content.

### 8. Correct failure taxonomy

Replace the current three-category error classification with a taxonomy that separates contract, security policy, authorization, execution, and transport.

Required application-level classifications:

- `contract`
- `policy`
- `authorization`
- `execution`
- `transport`

Required mapping direction:

- `INVALID_INPUT` → `contract`
- unknown/unsupported toolbox action → `contract`
- schema validation failure → `contract`
- `PATH_DENIED`, `FILE_DENIED`, `PATCH_DENIED`, `COMMAND_DENIED`, `WORKSPACE_POLICY_DENIED`, `TARGET_OUTSIDE_ARTIFACT_ROOTS`, `REPARSE_POINT_REJECTED`, size/type restrictions → `policy`
- OAuth scope denial → `authorization`
- write-mode/approval requirement may remain `authorization` or a specifically documented local-policy category, but it must not be conflated with malformed input;
- process, download, serialization, and verification failures → `execution` unless transport-specific;
- HTTP/socket/SDK transport failures → `transport`.

Required trace classifications:

- `NO_SERVER_RECEIPT_EVIDENCE`
- `RECEIVED_NOT_DISPATCHED`
- `APP_CONTRACT_REJECTED`
- `APP_POLICY_DENIED`
- `APP_AUTHORIZATION_DENIED`
- `APP_EXECUTION_ERROR`
- `RESULT_MATERIALIZED`
- `RESULT_SERIALIZED`
- `RESPONSE_FINISHED_UNACKNOWLEDGED`
- `CLIENT_ACKNOWLEDGED`
- `CONNECTION_CLOSED_BEFORE_FINISH`
- `TRANSPORT_ERROR`

Backward-compatible old traces must still render deterministically.

### 9. Add safe delivery receipt metadata to substantive results

Every result that can carry file content, artifact content, corpus text, patch text, or substantial diagnostics must include a short structured delivery receipt containing:

- `correlationId`
- `resultAttemptId`
- `payloadSha256`
- `acknowledgementRecommended` boolean
- `deliveryStatusAction`: `result_delivery_status`
- `acknowledgementAction`: `acknowledge_tool_result`

Do not duplicate the receipt inside document text. Keep it as structured metadata or a compact envelope.

Small status calls may omit acknowledgement recommendations, but the trace must still record materialization and serialization dimensions.

### 10. Preserve and extend redaction

Use the existing shared field-aware redaction authority. Add dedicated validators for new identifiers, enums, digests, key names, and numeric dimensions.

Do not pass response content through free-form diagnostic redaction as a substitute for not logging it.

### 11. Complete action inventory for new diagnostics

Update `TOOLBOX_ACTION_POLICY`, supported action arrays, and `mcp_tool_inventory` so the two new actions are represented consistently.

Do not expose a new top-level public tool. The public surface remains the existing seven toolboxes plus the bounded image writer.

## Expected Production Files

Expected modified files:

- `src/server/toolCallTrace.ts`
- `src/server/registerTools.ts`
- `src/transports/httpTransport.ts`
- `src/tools/domainToolboxes.ts`
- `src/tools/toolboxActionPolicy.ts`
- `src/tools/common.ts`
- `src/security/auditLog.ts`
- `src/security/diagnosticRedaction.ts`
- `src/utils/errorClassification.ts`
- `src/utils/errors.ts` only if new explicit error codes are necessary

Expected new files may include:

- `src/server/resultDeliveryTrace.ts`
- `src/server/resultTelemetry.ts`

Keep the implementation modular. Do not further expand `domainToolboxes.ts` or `registerTools.ts` with large inline telemetry engines when a focused module is appropriate.

## Required Test Scope

Expected focused tests:

- `tests/toolCallTrace.test.ts`
- `tests/httpTransport.test.ts`
- `tests/domainToolboxes.test.ts`
- `tests/toolboxActionPolicy.test.ts`
- a new `tests/resultDeliveryTrace.test.ts` or equivalent.

Mandatory deterministic tests:

1. A normal small read records materialized, serialized, HTTP finished, and unacknowledged states.
2. A valid acknowledgement changes the classification to `CLIENT_ACKNOWLEDGED`.
3. Duplicate identical acknowledgement is idempotent.
4. Digest mismatch is `APP_CONTRACT_REJECTED`.
5. Unknown attempt lookup returns a bounded not-found result.
6. No result content appears in trace or audit persistence.
7. Payload byte count and digest match the exact serialized `CallToolResult` bytes.
8. Content item count/type and maximum item size are accurate.
9. Structured-content presence is accurate.
10. Serialization failure is not recorded as successful result return.
11. Response `finish` is distinguishable from handler return.
12. Close-before-finish is classified distinctly.
13. Normal close after finish is not a failure.
14. Batch calls retain separate result-attempt identities.
15. Batch finish evidence does not cross-associate request IDs.
16. `INVALID_INPUT` is classified as contract, not policy.
17. Path and file denials remain policy denials.
18. OAuth scope denial is authorization denial.
19. Existing persisted trace lines remain readable.
20. Retention remains bounded after the schema extension.
21. Malicious identifiers, key names, paths, URLs, and error text remain redacted.
22. `mcp_tool_inventory` includes the new diagnostic actions.
23. Internal registered schema count and public top-level tool count remain unchanged.
24. Existing request-ID binding tests remain passing.
25. Existing OAuth, write-mode, workspace, path, patch, image, and artifact tests remain passing.

## Documentation Requirements

Update:

- `docs/TOOL_REFERENCE.md`
- `docs/SECURITY_MODEL.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `docs/RELEASE_NOTES.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`

Documentation must state precisely:

- HTTP finish is not client acknowledgement;
- acknowledgement is a diagnostic receipt, not approval;
- content is never retained in result telemetry;
- result hashes identify bytes without revealing content;
- unsupported actions are contract errors;
- live OpenAI safety decisions remain outside the MCP server's direct observability.

## Validation Requirements

Read `docs/dev/VALIDATION_COMMAND_LANES.md` before child-process-capable commands.

Run in order:

1. repository-defined typecheck;
2. focused trace, result-delivery, HTTP transport, toolbox-policy, and redaction tests;
3. repository-defined build;
4. broader repository unit lane for all touched shared modules;
5. repository-defined MCP self-test;
6. `npm run check:public` if present;
7. lint;
8. `git diff --check`.

Do not use Playwright.
Do not package or promote.
Do not start, stop, or restart the active connector.
Do not reconnect ChatGPT.
Do not perform live connector validation under this implementation card.

## Builder Report Requirements

The Builder Report must include:

- repository identity and starting HEAD;
- starting and final dirty state;
- exact files changed;
- preservation of the unrelated `docs/CHATGPT_CONNECTION_GUIDE.md` modification and all other unrelated work;
- result-attempt schema and retention policy;
- old-to-new trace stage mapping;
- exact error-classification table;
- serialization measurement method;
- HTTP finish/close instrumentation method;
- acknowledgement matching and idempotency rules;
- proof that no content is logged;
- complete deterministic acceptance-test mapping;
- validation commands and results;
- validation not performed;
- blockers and assumptions;
- confirmation that no public top-level tool was added;
- confirmation that nothing was staged, committed, pushed, integrated, packaged, promoted, restarted, reconnected, published, or released.

## Stop Conditions

Stop before editing or during implementation rather than improvising if:

- exact serialized payload bytes cannot be measured without changing MCP protocol semantics;
- Node response finish/close instrumentation cannot be bound to the correct request IDs;
- acknowledgement would require accepting document content or secrets;
- acknowledgement would require a new top-level public tool;
- the implementation weakens request-ID binding or OAuth scope enforcement;
- the implementation requires storing raw result content;
- a live ChatGPT connection is required to make deterministic unit tests pass;
- completing the card requires bounded text read implementation from `WC-V1-0202G`;
- completing the card requires workspace/Git migration from `WC-V1-0202H`.

## Manual Validation After Codex

After Architect approval and separately authorized package/promotion/reconnect:

1. call a small read and record its delivery receipt;
2. acknowledge the exact result and confirm `CLIENT_ACKNOWLEDGED`;
3. call a larger benign read and confirm dimensions without content in logs;
4. intentionally omit acknowledgement and confirm `RESPONSE_FINISHED_UNACKNOWLEDGED`;
5. reproduce a host-reported safety block when possible;
6. query by correlation and result-attempt ID;
7. verify that the server evidence distinguishes no receipt, response finish, and acknowledgement;
8. inspect logs for absence of document text, credentials, absolute paths, and full endpoints.

These live steps are not authorized under this implementation card.

## Remaining Passes

After implementation:

- Architect review of the Builder Report;
- `WC-V1-0202G` bounded text projection implementation;
- `WC-V1-0202H` Git isolation implementation;
- separately authorized integration/commit if approved;
- separately authorized package and promotion;
- live ChatGPT canary and incident reproduction matrix;
- final acceptance-matrix disposition.

## Document Disposition

Document.Status=ApprovedForImplementation
