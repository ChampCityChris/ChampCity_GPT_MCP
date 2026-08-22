# Builder Report: WC-V1-0104B-REPAIR01

## Summary

Result-delivery receipts are now model-visible on returned MCP `CallToolResult.structuredContent.champcityDeliveryReceipt`, while preserving existing `content` and merging existing `structuredContent`.

`result_delivery_status` now resolves exact result attempts. A caller may query by one identifier, or by both `correlationId` and `resultAttemptId` only when they identify the same attempt. Mismatches are rejected instead of silently ignoring an identifier.

Attempt classification now uses attempt-local events for exact attempt status. Correlation-level diagnostics are explicitly labeled as aggregate when multiple attempts exist and include per-attempt summaries.

Safely returned MCP error results from the public tool handler now pass through the measured result path and receive delivery receipts without changing existing safe error content semantics.

HTTP lifecycle tracing now carries result telemetry schema version where available, and a real HTTP client close before response finish is classified as `CONNECTION_CLOSED_BEFORE_FINISH`.

No fallback implementation was used.

## Files Changed By This Repair

- `src/server/resultTelemetry.ts`
- `src/server/resultDeliveryTrace.ts`
- `src/server/toolCallTrace.ts`
- `src/server/registerTools.ts`
- `src/transports/httpTransport.ts`
- `tests/resultDeliveryTrace.test.ts`
- `tests/toolCallTrace.test.ts`
- `tests/httpTransport.test.ts`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104B-REPAIR01_model_visible_receipts_and_delivery_evidence_completion.md`

No adjacent file outside the authorized repair surface was required for this repair.

## Preserved Behavior

- Existing MCP result `content` is preserved.
- Existing `structuredContent` is preserved and merged.
- Existing safe MCP error text shape is preserved.
- Existing public toolbox surface count and public-surface cleanliness remain passing.
- OAuth, PKCE, write-scope enforcement, path policy, approval behavior, Cloudflare behavior, packaging, release, runtime promotion, and token storage were not changed by this repair.

## Production HTTP Proof

Focused HTTP transport tests prove the repaired production path through the real public `/mcp` entry point:

- `repo_toolbox.read_file` returns unchanged `content` and a model-visible `structuredContent.champcityDeliveryReceipt`.
- The receipt from that response succeeds through public `diagnostics_toolbox.result_delivery_status`.
- The exact attempt reports `RESPONSE_FINISHED_UNACKNOWLEDGED` before acknowledgement.
- Public `diagnostics_toolbox.acknowledge_tool_result` validates the exact correlation, attempt, and digest.
- A duplicate identical acknowledgement is idempotent.
- The exact attempt reports `CLIENT_ACKNOWLEDGED` after acknowledgement.
- A safely returned public contract error for an unexposed tool preserves `isError: true` and receives measured delivery telemetry.
- A denied toolbox result in write-mode-off state receives measured delivery telemetry.
- A raw HTTP client abort while a real `/mcp` call is in flight records `http_connection_closed` with `closeBeforeFinish=true` and classifies as `CONNECTION_CLOSED_BEFORE_FINISH`.

## Supporting Unit Proof

Focused unit tests prove:

- Receipt insertion merges existing structured content without changing content.
- Payload digest is computed over the serialized result before delivery receipt insertion.
- Result telemetry schema version is persisted on new result-delivery events.
- Mismatched `correlationId` plus `resultAttemptId` is rejected.
- Acknowledging one attempt does not acknowledge another attempt under the same correlation.
- Close-before-finish classification is attempt-local.
- Correlation status with multiple attempts is explicitly aggregate and includes per-attempt summaries.
- Trace/audit persistence avoids document text, prompt-like text, patch text, raw private paths, URLs, stacks, and secrets through the existing redaction path.

## Validation

Validation commands and lanes:

- `npm run typecheck`
  - Lane: direct Codex shell.
  - Result: PASS.
  - Sandbox-only failure: none.

- `npm run build`
  - First direct attempt hit known sandbox-only `spawn EPERM` in `esbuild`.
  - Lane rerun: approved normal Windows execution.
  - Result: PASS.

- `node --test dist/tests/resultDeliveryTrace.test.js dist/tests/toolCallTrace.test.js dist/tests/httpTransport.test.js`
  - First direct attempt hit known sandbox-only `spawn EPERM` in Node test runner.
  - Lane rerun: approved normal Windows execution.
  - Result: PASS, 88 tests passed.

- `npm run validate:codex:unit`
  - Lane: approved normal Windows execution.
  - Result: PASS, 406 tests passed.

- `npm run lint`
  - Lane: direct Codex shell.
  - Result: PASS.
  - Sandbox-only failure: none.

- `npm run mcp:self-test`
  - Lane: approved normal Windows execution.
  - Result: PASS, 23 checks passed.

- `npm run check:public`
  - Lane: direct Codex shell.
  - Result: PASS publication cleanliness.
  - Checked 264 source candidate files.

- `git diff --check`
  - Lane: direct Codex shell.
  - Result: PASS.
  - Notes: Git reported existing LF-to-CRLF working-copy warnings only; no whitespace errors were reported.

## Not Performed

- Live ChatGPT connector validation was not performed.
- Packaging, release, promotion, restart, reconnect, publish, upload, signing, staging, committing, pushing, merging, cleaning, stashing, resetting, and discarding work were not performed.
- Subjective UI or visual validation was not performed.

## Operator Validation Remaining

- In a new ChatGPT connector conversation, run a normal toolbox read and confirm the model can see `structuredContent.champcityDeliveryReceipt`.
- Use that exact receipt in `diagnostics_toolbox.result_delivery_status`.
- Acknowledge that exact receipt through `diagnostics_toolbox.acknowledge_tool_result`.
- Confirm the exact attempt transitions from `RESPONSE_FINISHED_UNACKNOWLEDGED` to `CLIENT_ACKNOWLEDGED`.
- Confirm ChatGPT-visible behavior matches the automated HTTP proof.

## Git / Dirty State

- Starting HEAD from the work card: `db6aa399716db271f2b38a6927de33f0f29a55ec`.
- Final HEAD after repair: `db6aa399716db271f2b38a6927de33f0f29a55ec`.
- The working tree was already dirty before repair. Existing unrelated dirty files and untracked planning artifacts were preserved.
- No files were staged.
- No commit was created.
- No push was performed.

## Scope And Protected Subsystems

Protected MCP/result-delivery subsystems were touched only within the explicit REPAIR01 authorization:

- public MCP tool result materialization and error result measurement;
- result-delivery trace lookup and classification;
- HTTP response lifecycle trace evidence.

Scope did not change during implementation.

No fallback receipt location, duplicate telemetry store, alternate acknowledgement mechanism, alternate classifier authority, screenshot fallback, browser scraping, network scraping, clipboard automation, or metadata-only fallback was introduced.

A fallback may be possible, but was not implemented because architect/operator approval was not provided.

## Result

`observed delivery defect corrected through the real HTTP MCP path`
+ `existing behavior preserved`
+ `invalid and partial states fail safely`
+ `no fallback, duplicate implementation, or alternate authority introduced`
= `PASS`
