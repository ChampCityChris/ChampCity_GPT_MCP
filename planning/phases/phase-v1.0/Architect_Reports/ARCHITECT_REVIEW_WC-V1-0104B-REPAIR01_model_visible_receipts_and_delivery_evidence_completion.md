# Architect Review — WC-V1-0104B-REPAIR01 Model-Visible Result Receipt Repair

Date: 2026-07-31
Repository: `ChampCityChris/ChampCity_GPT_MCP`
Workspace: `%USERPROFILE%\Projects\ChampCity_GPT`
Branch: `dev`
HEAD reviewed: `db6aa399716db271f2b38a6927de33f0f29a55ec`
Work Card: `planning/phases/phase-v1.0/Work_Cards/WC-V1-0104B-REPAIR01_model_visible_receipts_and_delivery_evidence_completion.md`
Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104B-REPAIR01_model_visible_receipts_and_delivery_evidence_completion.md`
Disposition: RevisionRequested

## Executive Disposition

REPAIR01 materially corrects the original model-visibility defect. Tool results now expose `champcityDeliveryReceipt` through `structuredContent`, the public HTTP round trip from read to status to acknowledgement works, exact attempt lookup is implemented, early connection close is exercised through the HTTP boundary, and safely returned inner-handler errors use the measured response path.

The repair is not approved because the acknowledgement event breaks the previously approved request-ID-bound trace invariant. The required serialization-failure proof is also absent, and acknowledgement events do not persist the result telemetry schema version required by the repair card.

WC-V1-0202G remains blocked pending one narrow repair.

## Confirmed Corrections

The following production-path defects are corrected:

1. `src/server/resultTelemetry.ts` merges the receipt into model-visible `structuredContent` and preserves existing `content` and structured fields.
2. Public `/mcp` tests use the returned receipt through `result_delivery_status` and `acknowledge_tool_result`.
3. Exact result-attempt status no longer silently ignores one supplied identifier.
4. Attempt-level acknowledgement and close-before-finish state are classified from the selected attempt.
5. A real HTTP client abort produces `CONNECTION_CLOSED_BEFORE_FINISH`.
6. Inner public error results pass through `createMeasuredToolResponse` and preserve `isError: true`.
7. The public tool surface remains unchanged.

## Findings

### Finding 1 — Acknowledgement contaminates the original correlation with the acknowledgement request ID

Severity: P0 trace-integrity failure

Verified path:

`HTTP diagnostics_toolbox.acknowledge_tool_result`
→ `acknowledgeToolResult()`
→ `recordToolCallTrace({ correlationId: targetCorrelationId, resultAttemptId: targetAttemptId, ... })`
→ `sanitizeEvent()` fills the omitted `jsonRpcId` from the current AsyncLocal trace context
→ `client_result_acknowledged` is stored under the original result correlation with the later acknowledgement call's JSON-RPC ID.

The original result correlation therefore contains events from two JSON-RPC request IDs. This violates the request-ID-bound trace architecture approved under WC-V1-0104A-REPAIR03 and the REPAIR01 requirement that request-ID binding remain unchanged.

The new HTTP round-trip test does not detect this. It asserts that the events share one correlation ID, but does not assert that every event under that correlation retains the original JSON-RPC ID.

Required correction:

- write the target result's persisted JSON-RPC ID explicitly on `client_result_acknowledged`;
- keep the acknowledgement call's own correlation and JSON-RPC ID on its normal call trace;
- do not introduce another trace store or alternate identity authority;
- add an HTTP assertion proving the original result correlation contains only the original call ID after acknowledgement and the acknowledgement call retains its own ID.

### Finding 2 — Acknowledgement events are unversioned

Severity: P1 schema-evidence failure

`client_result_acknowledged` is a new result-delivery event, but `acknowledgeToolResult()` does not copy `resultTelemetrySchemaVersion` from the target serialized event. Because the acknowledgement is recorded before the acknowledgement call's own result is measured, the current context does not supply the target version.

This does not satisfy the repair requirement to persist the telemetry schema version on new result-delivery events.

Required correction:

- copy the target serialized event's telemetry schema version onto the acknowledgement event;
- retain legacy behavior for old unversioned attempts;
- test the persisted acknowledgement event directly.

### Finding 3 — Required serialization-failure proof is absent

Severity: P1 acceptance-evidence failure

The repair card requires proof that a serialization failure does not record successful delivery evidence for the failed payload. Repository search and the reviewed tests found no cyclic or otherwise nonserializable production-path fixture.

The current code appears designed to catch a response-materialization failure and return a separately measured safe error result, but that behavior is not proven through the public HTTP MCP path. Broad suite success is not evidence for this boundary.

Required proof:

- exercise a controlled nonserializable result through the public handler path;
- prove the failed payload does not receive successful serialization or finish evidence;
- prove the separately returned safe error result is measured and classified as an execution error;
- prove no private payload content enters trace or audit persistence.

## Builder Report Accuracy

The Builder Report accurately describes the model-visible receipt, exact lookup, acknowledgement round trip, early-close test, and validation results. It overstates binary completion because Findings 1–3 remain unresolved.

The report also does not enumerate the exact starting and final dirty paths requested by the card. The repair report for the next pass must provide exact counts and paths or reference an attached deterministic status output.

## Independent Validation

Architect validation used the repository-defined normal Windows lane:

- typecheck: PASS;
- full build and test lane: PASS;
- 406 tests passed, 0 failed;
- HEAD unchanged before and after validation.

Passing validation does not cure the untested and incorrectly attributed trace behavior above.

## Repository State

At review time:

- branch: `dev`;
- tracked modified: 16;
- untracked: 11 before this review artifact;
- staged: 0;
- deleted: 0;
- HEAD unchanged.

No files were staged, committed, pushed, merged, packaged, promoted, restarted, reconnected, published, or released by this review.

## Required Next Step

Implement only:

`WC-V1-0104B-REPAIR02 — Acknowledgement Trace Identity and Serialization-Failure Proof`

Do not begin WC-V1-0202G until REPAIR02 receives Architect approval.

## Final Disposition

WC-V1-0104B-REPAIR01 disposition: RevisionRequested

Document.Status=RevisionRequested
