# WC-V1-0104B-REPAIR02 — Acknowledgement Trace Identity and Serialization-Failure Proof

## Identity

- ID: `WC-V1-0104B-REPAIR02`
- Parent: `WC-V1-0104B-REPAIR01`
- Priority: P0
- Repository: `%USERPROFILE%\Projects\ChampCity_GPT`
- Remote: `ChampCityChris/ChampCity_GPT_MCP`
- Branch: `dev`
- Starting HEAD: `db6aa399716db271f2b38a6927de33f0f29a55ec`
- Controlling Review: `planning/phases/phase-v1.0/Architect_Reports/ARCHITECT_REVIEW_WC-V1-0104B-REPAIR01_model_visible_receipts_and_delivery_evidence_completion.md`
- Required Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104B-REPAIR02_acknowledgement_trace_identity_and_serialization_failure_proof.md`

## Observed Defect

A result can now be acknowledged through the public MCP path, but the acknowledgement event is written under the original result correlation while carrying the later acknowledgement request's JSON-RPC ID. The original correlation therefore no longer represents one request identity.

The repair also lacks production-path proof for a nonserializable result, so it is not proven that failed payload serialization remains distinct from the separately returned safe error result.

## Verified Cause

`acknowledgeToolResult()` records `client_result_acknowledged` with the target `correlationId` and `resultAttemptId` but omits `jsonRpcId` and `resultTelemetrySchemaVersion`.

`recordToolCallTrace()` then calls `sanitizeEvent()`, which fills those missing values from the current AsyncLocal context—the acknowledgement call, not the acknowledged result.

No HTTP test asserts request-ID isolation after acknowledgement. No HTTP fixture returns a controlled cyclic or otherwise nonserializable result.

## Authorized Correction

Make only these corrections:

1. When recording `client_result_acknowledged`, copy the target serialized event's:
   - `jsonRpcId`;
   - `resultTelemetrySchemaVersion`;
   - existing target correlation and attempt identity.
2. Leave the acknowledgement call's own request identity on its normal trace. Do not merge the two calls or create a second trace store.
3. Add a controlled public-handler serialization-failure fixture. The failed payload must not be recorded as successfully serialized or delivered. A separately created safe MCP error result may be measured and returned under its own result attempt.

No other telemetry, classifier, transport, OAuth, toolbox, workspace, Git, or read-projection behavior may change.

## Required Production Sequences

### Acknowledgement identity

`original HTTP tools/call with JSON-RPC ID A`
→ result attempt created and returned
→ `acknowledge_tool_result` called through a later HTTP request with JSON-RPC ID B
→ acknowledgement validates the original receipt
→ `client_result_acknowledged` is appended to the original attempt with JSON-RPC ID A
→ the acknowledgement call remains separately traced with JSON-RPC ID B
→ original attempt becomes `CLIENT_ACKNOWLEDGED` without mixed request identity.

### Serialization failure

`HTTP tools/call`
→ controlled handler returns a nonserializable result
→ failed payload materialization or serialization is classified as execution failure
→ no successful serialization or finish evidence is attributed to that failed payload
→ existing safe MCP error conversion returns a serializable `isError: true` result
→ safe error result receives its own measured result attempt
→ no private payload content enters trace or audit persistence.

## Must Remain Unchanged

- model-visible receipt in `structuredContent`;
- exact status and acknowledgement contracts;
- request-ID binding for all existing calls and batches;
- public tool surface;
- OAuth, PKCE, scope, write-mode, path, approval, and redaction behavior;
- trace retention and existing source changes;
- all unrelated worktree files.

## Out of Scope

- WC-V1-0202G bounded text projection;
- WC-V1-0202H workspace/Git capability changes;
- new tools, UI, storage, retry protocols, or alternate trace authorities;
- package, promotion, restart, reconnect, live ChatGPT validation, staging, commit, push, or merge.

## Acceptance Criteria

Use the real public HTTP MCP entry point.

1. A result call with ID A is acknowledged by a later call with ID B.
2. Every event under the original result correlation, including `client_result_acknowledged`, retains ID A.
3. Every event under the acknowledgement call correlation retains ID B.
4. The acknowledgement event contains the target result's persisted telemetry schema version.
5. Exact attempt status becomes `CLIENT_ACKNOWLEDGED` and the acknowledgement remains idempotent.
6. A controlled nonserializable result does not receive successful `result_serialized`, `http_response_finished`, or acknowledgement evidence.
7. The separately returned safe error result preserves `isError: true`, is measured, and classifies as `APP_EXECUTION_ERROR`.
8. Neither trace nor audit persistence contains the failed private payload, stack, secret, raw URL, or absolute path.
9. Existing model-visible receipt, exact lookup, early-close, OAuth, write, path, request-ID, batch, and public-surface tests remain passing.
10. No fallback, duplicate trace, alternate identity field authority, or unrelated refactor is introduced.

Direct helper tests may support these criteria but cannot replace the HTTP proof.

## Authorized File Surface

Expected:

- `src/server/resultDeliveryTrace.ts`
- focused trace or registration code only if required for the controlled serialization fixture;
- `tests/httpTransport.test.ts`
- `tests/resultDeliveryTrace.test.ts` or `tests/toolCallTrace.test.ts` only for supporting assertions;
- Repair02 Builder Report.

A narrowly necessary adjacent file may change only when justified in the Builder Report. Documentation changes are not expected unless current text becomes false.

## Validation and Report

Run the repository-defined normal Windows lanes for typecheck, focused tests, full unit regression, build, MCP self-test, public check, lint, and `git diff --check`.

The Builder Report must identify:

- the exact original and acknowledgement JSON-RPC IDs used in the HTTP test;
- the exact target acknowledgement event fields;
- the controlled serialization-failure path and separate safe error attempt;
- automatic proof versus remaining live Operator validation;
- exact starting and final dirty counts and paths;
- confirmation that no fallback or alternate authority was added;
- confirmation that nothing was staged, committed, pushed, packaged, promoted, restarted, reconnected, published, or released.

## Binary Completion Rule

`original correlation remains request-ID pure after acknowledgement`
+ `acknowledgement event is schema-versioned`
+ `serialization failure is proven through the public HTTP path`
+ `preserved behavior remains intact`
+ `no alternate mechanism introduced`
= `PASS`

Anything less is `RevisionRequired`.

## Document Disposition

Document.Status=PendingOperatorApproval
