# Architect Review — WC-V1-0104B Result Delivery Telemetry, Acknowledgement, and Failure Attribution

Date: 2026-07-31
Repository: `ChampCityChris/ChampCity_GPT_MCP`
Workspace: `%USERPROFILE%\Projects\ChampCity_GPT`
Branch reviewed: `dev`
Starting and final HEAD reported by Implementer: `db6aa399716db271f2b38a6927de33f0f29a55ec`
Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104B_result_delivery_telemetry_acknowledgement_and_failure_attribution.md`
Work Card: `planning/phases/phase-v1.0/Work_Cards/WC-V1-0104B_result_delivery_telemetry_acknowledgement_and_failure_attribution.md`
Disposition: RevisionRequested
Required Repair: `planning/phases/phase-v1.0/Work_Cards/WC-V1-0104B-REPAIR01_model_visible_receipts_and_delivery_evidence_completion.md`

## Executive Disposition

WC-V1-0104B is not approved for integration, packaging, runtime promotion, restart, reconnect, live ChatGPT validation, or commencement of dependent `WC-V1-0202G` implementation.

The implementation materially improves the trace architecture. It adds result-attempt identities, result materialization and serialization stages, payload dimensions and digests, HTTP finish/close listeners, explicit acknowledgement/status functions, a five-way error taxonomy, and privacy-safe trace fields. Independent validation passed TypeScript typecheck and all 402 repository tests.

Those passes do not establish acceptance. The central delivery receipt is stored exclusively in MCP tool-result `_meta`. OpenAI's current plugin reference states that tool-result `_meta` is delivered only to a component and hidden from the model; only `content` and `structuredContent` appear in the conversation transcript. ChampCity GPT exposes no UI component that can read and relay this receipt. The assistant therefore cannot obtain `correlationId`, `resultAttemptId`, and `payloadSha256` from a successful result and cannot perform the required acknowledgement workflow.

Several mandatory deterministic acceptance cases are also absent or contradicted by the tests. Most notably, the test labeled as close-before-finish does not record `closeBeforeFinish=true` and expects `RESULT_SERIALIZED`, while the Work Card requires `CONNECTION_CLOSED_BEFORE_FINISH`. The acknowledgement and status operations are tested only as direct TypeScript functions, not through the public toolbox/HTTP path. Attempt-specific status classification is implemented through correlation-wide classification and can become incorrect as soon as retries introduce more than one result attempt under one request correlation.

The Builder Report therefore overstates completion. A bounded REPAIR01 is required before the next work card begins.

## Repository State Reviewed

ChampCity MCP reported:

- Workspace: `champcity_gpt`
- Repository: `ChampCityChris/ChampCity_GPT_MCP`
- Branch: `dev`
- Worktree: dirty
- Tracked modified files: 16
- Untracked files: 8
- Staged files: 0
- Deleted files: 0

The implementation files listed in the Builder Report are present. New untracked production/test files include:

- `src/server/resultDeliveryTrace.ts`
- `src/server/resultTelemetry.ts`
- `tests/resultDeliveryTrace.test.ts`

The pre-existing and subsequently extended `docs/CHATGPT_CONNECTION_GUIDE.md` modification remains unstaged. The review did not reset, restore, clean, stash, stage, commit, push, integrate, package, promote, restart, reconnect, publish, or release anything. The only writes performed by this review are this Architect Review and the bounded REPAIR01 Work Card.

## Independent Validation

The Architect independently ran through ChampCity MCP's fixed normal Windows validation lane:

- repository typecheck: PASS;
- full repository test/build lane: PASS;
- tests: 402 passed, 0 failed;
- HEAD before and after validation remained `db6aa399716db271f2b38a6927de33f0f29a55ec`.

These results confirm that the implementation compiles and that the current assertions pass. They do not prove omitted or incorrectly written semantic acceptance cases.

## Confirmed Improvements

The following portions are materially implemented:

1. `resultAttemptId` is generated using `randomUUID()` after tool execution and before the measured public response is returned.
2. Result materialization and serialization are separated into explicit trace stages.
3. The pre-receipt `CallToolResult` and final receipt-bearing envelope receive separate byte counts and SHA-256 digests, avoiding a self-referential digest.
4. Trace events include serializer, content-item, structured-content, payload, source-range, HTTP lifecycle, and acknowledgement metadata fields.
5. Result text is not persisted by the new telemetry module; trace records use counts, hashes, bounded keys, and sanitized identifiers.
6. `INVALID_INPUT` now classifies as contract rather than policy.
7. OAuth scope and local approval failures classify as authorization.
8. Path/file/workspace restrictions remain policy classifications.
9. HTTP response `finish`, `close`, and `error` listeners are attached before normal stateful/stateless response completion.
10. The public top-level tool surface remains unchanged; the new operations are actions under `diagnostics_toolbox`.
11. `mcp_tool_inventory` now lists all seven toolbox action inventories.
12. Existing request-ID-bound dispatch and redaction tests remain passing.

These improvements should be preserved during repair.

## Findings

### Finding 1 — The delivery receipt is hidden from the model

Severity: P0 core-contract failure

`src/server/resultTelemetry.ts` inserts the receipt only under:

`CallToolResult._meta.champcityDeliveryReceipt`

The receipt contains the exact values needed for acknowledgement:

- `correlationId`;
- `resultAttemptId`;
- `payloadSha256`;
- acknowledgement and status action names.

OpenAI's current plugin/tool-result reference states:

- `structuredContent` is surfaced to the model and component;
- `content` is surfaced to the model and component;
- `_meta` is delivered only to the component and hidden from the model;
- only `structuredContent` and `content` appear in the conversation transcript.

ChampCity GPT does not register a component for these toolbox results. Consequently:

- ChatGPT may receive the hidden `_meta` envelope internally;
- the assistant/model cannot read it;
- the assistant cannot echo the required receipt into `acknowledge_tool_result`;
- the manual validation sequence defined by the Work Card cannot be executed.

The new unit test reinforces the wrong assumption by reading `response._meta` directly in TypeScript. It does not emulate the ChatGPT model-visible result boundary.

Required correction:

- place the compact delivery receipt in model-visible `structuredContent`, or in another bounded model-visible envelope explicitly permitted by the Work Card;
- do not duplicate document content;
- merge with existing structured content without overwriting action-specific fields;
- when no structured content exists, add a small structured receipt object;
- keep optional private/component metadata separate if still useful;
- prove through an actual HTTP MCP call fixture that the receipt appears in the model-visible tool result;
- prove that the receipt can be used in a subsequent public `diagnostics_toolbox.acknowledge_tool_result` call.

This finding alone requires RevisionRequested.

### Finding 2 — Close-before-finish acceptance is not tested and the named fixture asserts the wrong classification

Severity: P0 acceptance failure

The Work Card requires:

- close-before-finish to be classified distinctly as `CONNECTION_CLOSED_BEFORE_FINISH`;
- normal close after finish not to be treated as failure;
- actual HTTP lifecycle evidence.

`tests/toolCallTrace.test.ts` creates a case named `closed-before-finish` by recording only the stage `http_connection_closed`. It does not set `closeBeforeFinish: true`. The assertion expects:

`RESULT_SERIALIZED`

That is the opposite of the required acceptance result. Repository search finds no test that supplies or asserts `closeBeforeFinish` evidence.

The HTTP suite also does not create a controlled request whose connection closes before `finish` and then verify the persisted lifecycle/classification.

Required correction:

- correct the direct classification fixture to include `closeBeforeFinish: true` and expect `CONNECTION_CLOSED_BEFORE_FINISH`;
- add an actual HTTP-level close-before-finish fixture;
- add an actual normal finish-then-close fixture and prove it remains `RESPONSE_FINISHED_UNACKNOWLEDGED` rather than failure;
- prove lifecycle listeners are removed on every terminal path.

### Finding 3 — Result-delivery lookup is not exact when both identifiers are supplied

Severity: P0 contract-correctness failure

`ResultDeliveryStatusParamsSchema` permits:

- `correlationId` only;
- `resultAttemptId` only;
- both identifiers together.

`resultDeliveryStatus` then uses this predicate:

- when `correlationId` is present, filter only by correlation;
- otherwise filter by result-attempt ID.

A caller can therefore supply a valid correlation ID and a mismatched result-attempt ID. The action ignores the mismatched attempt, returns the correlation's events, and replaces the caller's attempt value with the latest attempt found.

That violates the requirement for exact lookup and produces misleading evidence.

Required correction:

Choose and enforce one explicit contract:

1. accept exactly one identifier through a strict union; or
2. permit both only when both match the same result attempt, otherwise return a contract rejection.

The action must never silently ignore one supplied identifier.

### Finding 4 — Attempt-specific status uses correlation-wide classification

Severity: P0 retry-integrity failure

When status is queried by `resultAttemptId`, the function correctly selects events for that attempt. It then obtains classification through:

`readRecentToolCalls(config, { correlationId })`

That classifier groups every event under the correlation ID. Once `WC-V1-0202G` introduces deterministic retries or multiple attempts, one attempt can inherit another attempt's:

- `CLIENT_ACKNOWLEDGED` state;
- transport error;
- contract/policy/authorization denial;
- finish state.

The Work Card expressly reserves multiple attempts under one request for an explicit retry protocol. The current status implementation is not safe for that contract.

Required correction:

- extract a shared classifier that accepts an exact event set;
- classify an attempt query using only events for that result attempt;
- define a separate correlation-level aggregate classification when correlation lookup is used;
- add two-attempt fixtures proving that acknowledgement/error/finish state does not cross attempts.

### Finding 5 — Public acknowledgement and status actions lack end-to-end tests

Severity: P0 evidence failure

The new test file calls these functions directly:

- `acknowledgeToolResult(...)`;
- `resultDeliveryStatus(...)`.

Repository search finds no test invocation of the public action names:

- `diagnostics_toolbox.acknowledge_tool_result`;
- `diagnostics_toolbox.result_delivery_status`.

The tests therefore do not prove:

- toolbox action routing;
- public parameter validation;
- `files.read` scope behavior;
- HTTP dispatch;
- the returned MCP envelope;
- audit/trace association through the public action;
- model-visible receipt to acknowledgement round trip;
- action inventory and schema behavior as consumed through ChatGPT's public surface.

Required correction:

- add direct toolbox tests for both actions;
- add HTTP MCP tests for receipt, status lookup, acknowledgement, duplicate acknowledgement, digest mismatch, not found, and insufficient scope;
- prove no new top-level public tool is introduced.

### Finding 6 — Multiple mandatory tests are missing or materially weaker than required

Severity: P0 evidence-integrity failure

The Builder Report claims complete deterministic acceptance mapping, but the new result-delivery suite contains only four tests. The following required conditions are absent or insufficient:

1. Serialization failure is not tested. There is no cyclic/non-serializable fixture proving no successful materialized/serialized/returned state is recorded.
2. Structured-content presence is tested only as `false`; no true structured-content result is measured.
3. Maximum content-item bytes is asserted only to be greater than zero, not exact.
4. Batch calls are not checked for separate result-attempt identities.
5. Batch finish evidence is checked by JSON-RPC ID/correlation but not by result-attempt identity.
6. New identifier/key/digest sanitizers lack malicious-input tests.
7. Result telemetry retention is not tested with the extended event fields.
8. The public inventory includes the actions in production code, but no focused assertion proves both actions appear exactly once with `files.read` scope.
9. The actual HTTP result is not checked for the delivery receipt.
10. Conflicting duplicate acknowledgement is not tested.

Passing the broader suite cannot substitute for these explicit semantic cases.

Required correction:

Implement the missing deterministic tests and update the Builder Report mapping to identify exact test names. Do not label a condition PASS based on indirect suite coverage.

### Finding 7 — The persisted telemetry schema is not explicitly versioned

Severity: P1 protocol-maintenance defect

`RESULT_TELEMETRY_SCHEMA_VERSION` exists in `resultTelemetry.ts`, but it is placed only in the hidden delivery receipt. `result_serialized` trace events do not include a telemetry schema-version field. `resultDeliveryStatus` inserts `schemaVersion: 1` when rendering dimensions rather than reading a persisted version.

The Work Card requires the telemetry schema to be versioned. A future reader cannot distinguish a persisted v1 event from an evolved event except through inferred optional fields.

Required correction:

- add a sanitized `telemetrySchemaVersion` field to result-delivery trace events;
- persist it on result materialization/serialization and acknowledgement where appropriate;
- read and report the persisted value;
- preserve old events as legacy/unversioned rather than silently labeling them v1.

### Finding 8 — Unexpected public error results bypass result telemetry

Severity: P1 delivery-observability gap

The measured response path applies only through `tracedResponse(data)`. Errors thrown outside a normal toolbox result are returned through `toolErrorResponse(error)`, which still constructs an unmeasured `CallToolResult`.

This includes unexpected execution errors and selected public-surface/identity failures. Those responses have no:

- result-attempt identity;
- serialization dimensions;
- payload digest;
- result-delivery status.

The card's purpose is failure attribution. Error responses should either use the measured serializer or be explicitly documented and classified as a deliberate exclusion.

Required correction:

- route public MCP error results through a safe measured error-response path without changing `isError` semantics;
- record execution/contract/transport classification truthfully;
- add deterministic serialization and error-result tests;
- do not expose stack traces or raw error details.

## Builder Report Accuracy

The Builder Report is accurate about:

- starting/final HEAD;
- files changed;
- validation commands and broad results;
- no Git mutation, package, promotion, restart, reconnect, or live validation;
- digest-domain clarification;
- major production modules added.

It overstates completion in the following areas:

- the receipt is described as usable by the caller, but it is hidden from the model;
- close-before-finish is listed as implemented/tested, but the required classification is not tested;
- acknowledgement/status are described as public actions without end-to-end public action tests;
- the acceptance mapping implies coverage for mandatory cases that are absent;
- exact attempt-level lookup and retry integrity are not established.

The repaired Builder Report must replace broad suite references with exact evidence and explicitly identify the model-visible receipt surface.

## Required Repair Scope

`WC-V1-0104B-REPAIR01` is authorized and limited to:

1. model-visible delivery receipt placement;
2. exact result-delivery lookup semantics;
3. attempt-specific versus correlation-level classification;
4. complete close-before-finish and normal-close HTTP evidence;
5. measured public error results;
6. persisted telemetry schema version;
7. missing deterministic tests;
8. corrected documentation and Builder Report evidence.

Do not implement bounded text projection from `WC-V1-0202G`, workspace/Git changes from `WC-V1-0202H`, packaging, runtime promotion, restart, reconnect, or live ChatGPT validation.

## Dependency Direction

`WC-V1-0202G` remains blocked. Its retry and chunk delivery design depends on a correct, model-visible, attempt-specific receipt and status contract. Beginning it now would encode the current defects into the next layer.

## Source-Control and Runtime Direction

Do not stage, commit, push, integrate, package, promote, restart, reconnect, publish, release, or perform live connector validation for WC-V1-0104B.

Those actions remain blocked until REPAIR01 receives Architect approval.

## Final Disposition

WC-V1-0104B disposition: RevisionRequested

Document.Status=RevisionRequested
