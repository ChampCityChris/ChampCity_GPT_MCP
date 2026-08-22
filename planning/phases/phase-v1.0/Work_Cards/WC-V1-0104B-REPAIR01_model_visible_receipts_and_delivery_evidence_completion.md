# WC-V1-0104B-REPAIR01 — Model-Visible Result Receipt Repair

## Work Card Identity

- ID: `WC-V1-0104B-REPAIR01`
- Parent: `WC-V1-0104B`
- Priority: P0
- Repository: `%USERPROFILE%\Projects\ChampCity_GPT`
- Remote: `ChampCityChris/ChampCity_GPT_MCP`
- Branch: `dev`
- Starting HEAD: `db6aa399716db271f2b38a6927de33f0f29a55ec`
- Controlling RCA: `planning/phases/phase-v1.0/Architect_Reports/CODE_REVIEW_RCA_OPENAI_SAFETY_LAYER_FALSE_POSITIVES_AND_GIT_COUPLING_2026-07-31.md`
- Controlling Architect Review: `planning/phases/phase-v1.0/Architect_Reports/ARCHITECT_REVIEW_WC-V1-0104B_result_delivery_telemetry_acknowledgement_and_failure_attribution.md`
- Parent Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104B_result_delivery_telemetry_acknowledgement_and_failure_attribution.md`
- Required Repair Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104B-REPAIR01_model_visible_receipts_and_delivery_evidence_completion.md`

## Observed Production Defect

ChampCity MCP can create result-delivery telemetry, but ChatGPT cannot reliably use it to determine whether a returned result was received, acknowledged, or blocked after leaving the MCP server.

The returned receipt is not visible to the model, and the current status path can attribute correlation-level state to the wrong result attempt. This prevents the intended real-world sequence:

`tool result returned → ChatGPT reads receipt → ChatGPT queries status or acknowledges that exact result → trace reports the exact attempt state`

## Verified Cause

Code review confirmed:

1. `src/server/resultTelemetry.ts` writes `champcityDeliveryReceipt` only to `CallToolResult._meta`. That field is not model-visible in the ChatGPT tool-result boundary used by this application.
2. `src/server/resultDeliveryTrace.ts` permits ambiguous status lookup and can silently ignore `resultAttemptId` when `correlationId` is also supplied.
3. Attempt status is derived from correlation-wide events, allowing one attempt's acknowledgement or failure to affect another attempt's classification.
4. The close-before-finish test does not provide the required `closeBeforeFinish=true` evidence and therefore does not prove the production failure boundary.
5. Public error responses bypass the measured result path, so returned error results may lack result-attempt telemetry.

The parent implementation otherwise remains the accepted basis for repair. Do not redesign the telemetry architecture.

## Authorized Correction

Make the smallest changes required to restore one trustworthy production path:

1. Put the compact receipt in model-visible `structuredContent` under `champcityDeliveryReceipt`.
2. Preserve existing `content` and merge, rather than replace, existing `structuredContent`.
3. Make status lookup exact:
   - accept exactly one of `correlationId` or `resultAttemptId`; or
   - accept both only when they resolve to the same attempt.
   No supplied identifier may be ignored.
4. Classify an attempt from that attempt's events only. Correlation queries may return an explicitly labeled aggregate plus per-attempt summaries.
5. Route safely returned public error results through the same measured result-attempt path without changing existing MCP error semantics.
6. Record and classify `closeBeforeFinish=true` as `CONNECTION_CLOSED_BEFORE_FINISH`.
7. Persist the telemetry schema version on new result-delivery events. Old unversioned events remain readable as legacy events.

No fallback receipt location, duplicate trace store, alternate acknowledgement mechanism, or second classification authority is authorized.

## Required Production Sequence

### Successful result

`HTTP MCP tools/call`
→ existing toolbox execution
→ result materialized and measured
→ model-visible receipt merged into `structuredContent`
→ HTTP response finishes
→ `result_delivery_status` resolves the exact attempt
→ `acknowledge_tool_result` validates the exact correlation, attempt, and digest
→ only that attempt becomes `CLIENT_ACKNOWLEDGED`
→ ChatGPT can report the exact delivery state.

### Early connection close

`HTTP MCP tools/call`
→ result lifecycle begins
→ response closes before `finish`
→ `http_connection_closed` persists with `closeBeforeFinish=true`
→ classification is `CONNECTION_CLOSED_BEFORE_FINISH`
→ no successful finish or acknowledgement is inferred.

### Returned public error

`HTTP MCP tools/call`
→ contract or execution error is converted to the existing safe MCP error result
→ returned error result receives a result-attempt identity and measurement
→ no stack, secret, absolute path, or raw private content is exposed
→ status reports the correct contract or execution classification.

## Must Remain Unchanged

- seven public toolbox surfaces and bounded image writer;
- OAuth, PKCE, scope enforcement, write modes, path policy, and approval behavior;
- request-ID binding and batch call identity;
- existing trace retention limit and redaction authority;
- existing document and result content;
- all unrelated worktree changes.

## Explicitly Out of Scope

- bounded text reads, chunks, lines, sections, or cursors from `WC-V1-0202G`;
- workspace capability or Git isolation from `WC-V1-0202H`;
- new top-level tools or UI components;
- package, promotion, release, restart, reconnect, or live ChatGPT validation;
- staging, committing, pushing, merging, cleaning, stashing, resetting, or discarding work.

## Acceptance Criteria

### Positive production-path proof

Use the real public HTTP MCP entry point. Direct helper tests alone are not acceptance evidence.

1. A normal toolbox read returns unchanged `content` plus a model-visible `structuredContent.champcityDeliveryReceipt`.
2. Existing structured content remains intact after receipt insertion.
3. The receipt from that real response succeeds through public `result_delivery_status` and `acknowledge_tool_result` calls.
4. The exact attempt changes from `RESPONSE_FINISHED_UNACKNOWLEDGED` to `CLIENT_ACKNOWLEDGED`.
5. Duplicate identical acknowledgement is idempotent.
6. A safely returned public contract or execution error has measured result telemetry and preserves `isError: true`.

### Negative and preservation proof

7. Mismatched correlation and attempt identifiers fail as a contract rejection; neither identifier is ignored.
8. Acknowledging one attempt does not acknowledge another attempt under the same correlation.
9. A transport or contract failure on one attempt does not overwrite another attempt's state.
10. Close before finish produces `CONNECTION_CLOSED_BEFORE_FINISH`; normal finish then close remains `RESPONSE_FINISHED_UNACKNOWLEDGED` until acknowledged.
11. A serialization failure does not record successful `result_serialized` or HTTP-finished delivery evidence.
12. Trace and audit persistence contain no document text, prompt text, patch text, artifact body, credential, raw URL, stack trace, or absolute path.
13. No new public tool, fallback receipt, duplicate telemetry store, or alternate classification path exists.
14. Existing OAuth, write, path, artifact, image, request-ID, and toolbox regression tests remain passing.

## Authorized File Surface

Expected production files:

- `src/server/resultTelemetry.ts`
- `src/server/resultDeliveryTrace.ts`
- `src/server/toolCallTrace.ts`
- `src/server/registerTools.ts`
- `src/transports/httpTransport.ts`
- `src/tools/domainToolboxes.ts`

Expected focused tests:

- `tests/resultDeliveryTrace.test.ts`
- `tests/httpTransport.test.ts`
- `tests/toolCallTrace.test.ts`
- existing public toolbox/action-policy tests where needed.

Documentation may be corrected only where required to describe the repaired behavior:

- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `docs/SECURITY_MODEL.md`
- `docs/TOOL_REFERENCE.md`
- `docs/RELEASE_NOTES.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`

A narrowly necessary adjacent file may change only when the Repair Builder Report identifies the reason and proves it is required for this defect. Unrelated refactoring is prohibited.

## Validation and Proof Boundary

Run the repository-defined normal Windows lanes for:

1. typecheck;
2. focused production-path tests above;
3. full unit regression lane;
4. build;
5. MCP self-test;
6. public-surface check;
7. lint;
8. `git diff --check`.

Automated validation proves code and protocol behavior only. It does not prove live ChatGPT host acceptance. Live package, reconnect, and Operator validation remain separately authorized work after Architect review.

The Repair Builder Report must distinguish:

- what was reproduced and proven through the HTTP MCP production path;
- what was proven only by supporting unit tests;
- what remains for later Operator validation;
- exact files changed and preserved;
- exact starting and final HEAD and dirty state;
- confirmation that no fallback or duplicate mechanism was introduced;
- confirmation that nothing was staged, committed, pushed, packaged, promoted, restarted, reconnected, published, or released.

## Stop Conditions

Stop and report instead of broadening the implementation if:

- the receipt cannot be made model-visible without a new UI component or top-level tool;
- exact attempt classification requires replacing the existing trace architecture;
- measured error results would change OAuth or MCP protocol semantics;
- a real HTTP close-before-finish fixture cannot be produced without adding production-only behavior;
- the correction requires work from `WC-V1-0202G` or `WC-V1-0202H`.

## Binary Completion Rule

`observed delivery defect corrected through the real HTTP MCP path`
+ `existing behavior preserved`
+ `invalid and partial states fail safely`
+ `no fallback, duplicate implementation, or alternate authority introduced`
= `PASS`

Anything less is `RevisionRequired`.

## Document Disposition

Document.Status=PendingOperatorApproval
