# Architect Review — WC-V1-0104A-REPAIR03 Final Closure: Request-ID-Bound Trace and Scope-Policy Consolidation

Date: 2026-07-27
Repository: `ChampCityChris/ChampCity_GPT_MCP`
Workspace: `%USERPROFILE%\Projects\ChampCity_GPT`
Branch reviewed: `dev`
Starting HEAD reported by Implementer: `780217aa1046ad8d271d13887ba1121bba419362`
Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104A-REPAIR03_request_id_bound_trace_and_scope_policy_consolidation.md`
Controlling Work Card: `planning/phases/phase-v1.0/Work_Cards/WC-V1-0104A-REPAIR03_request_id_bound_trace_and_scope_policy_consolidation.md`
Prior REPAIR03 Review: `planning/phases/phase-v1.0/Architect_Reports/ARCHITECT_REVIEW_WC-V1-0104A-REPAIR03_request_id_bound_trace_and_scope_policy_consolidation.md`
Disposition: Approved

## Executive Disposition

WC-V1-0104A-REPAIR03 final closure is approved.

The updated implementation resolves the remaining request-identity ambiguity and mismatch-isolation defects identified in the prior Architect Review. The complete WC-V1-0104A trace implementation now has a coherent and testable architecture:

- HTTP receipt parsing creates an independent context for every parsed `tools/call`, including malformed calls;
- valid SDK dispatch binds by `extra.requestId`, not by tool metadata or assumed handler order;
- duplicate representable JSON-RPC IDs are rejected before dispatch rather than silently order-bound;
- unmatched SDK request IDs cannot steal another context and do not contaminate sibling traces with false transport errors;
- OAuth scope requirements are defined by one canonical toolbox action-policy registry and evaluated per call;
- tool-call, discovery, and HTTP transport diagnostics use shared field-aware redaction;
- trace classification is based on stages and structured outcomes that actually occurred;
- deterministic tests exercise the actual HTTP and SDK boundaries rather than relying only on inserted trace fixtures.

No remaining implementation defect was identified within the authorized WC-V1-0104A scope. The remaining package, runtime promotion, restart/reconnect, and live ChatGPT checks are subsequent validation steps, not unresolved defects in this implementation pass.

## Repository State Reviewed

ChampCity MCP reported:

- Workspace: `champcity_gpt`
- Repository: `ChampCityChris/ChampCity_GPT_MCP`
- Branch: `dev`
- Worktree: dirty
- Tracked modified files: 18
- Staged files: 0
- Deleted files: 0

The worktree contains intermingled parent trace work, prior repair artifacts, runtime-drift and promotion-provenance work, planning records, and unrelated documentation changes. This review did not reset, restore, clean, stash, stage, commit, push, integrate, package, promote, restart, reconnect, publish, or release anything.

The only repository write performed by this review is this Architect Review artifact.

## Final Architecture Review

### 1. Exact SDK request-ID binding — Approved

`src/server/registerTools.ts` accepts the MCP handler metadata argument and binds dispatch through:

```ts
runWithToolCallTraceRequestId(extra.requestId, ...)
```

`src/server/toolCallTrace.ts` derives bounded internal keys consistently for the HTTP receipt context and SDK handler identity:

- finite numeric IDs use a bounded numeric key;
- string IDs use a SHA-256 base64url digest;
- raw caller-controlled string IDs are not used as internal map keys;
- public diagnostic IDs remain separately sanitized and capped.

The former metadata/claim-order mechanism is absent from production source. Repository searches found no remaining:

- `runWithSelectedToolCallTraceContext`;
- mutable `claimed` field;
- same-tool fallback;
- first-unclaimed fallback.

The cross-layer HTTP tests compare the inbound JSON-RPC ID, SDK `extra.requestId`, selected correlation ID, persisted trace ID, and JSON-RPC response ID. The three-call test intentionally varies completion order and retains correct identity association.

### 2. Duplicate request-ID ambiguity — Approved

The final closure adds pre-dispatch detection of duplicate representable string and numeric JSON-RPC IDs.

Confirmed behavior:

- duplicate string IDs are rejected before SDK dispatch;
- duplicate numeric IDs are rejected before SDK dispatch;
- each duplicate participant keeps its own correlation ID and receives `INVALID_INPUT` evidence;
- no duplicate participant receives `dispatch_started`, `toolbox_entered`, helper stages, or `tool_result_returned`;
- a unique authorized sibling in the rejected batch remains `RECEIVED_NOT_DISPATCHED` and receives no duplicate denial code or message;
- a separately scope-denied sibling retains its own `OAUTH_SCOPE_DENIED` evidence and does not inherit the duplicate-ID error;
- malicious duplicate string IDs are redacted in tool-call trace, discovery persistence, audit output, and the returned error evidence.

This removes the remaining handler-order ambiguity rather than attempting to make duplicate wire IDs appear uniquely attributable.

### 3. SDK identity-mismatch isolation — Approved

`ToolCallTraceIdentityMismatchError` provides a typed internal discriminator with a fixed safe message and no raw request-ID content.

Confirmed behavior:

- an unmatched SDK request ID cannot bind or consume another context;
- the dispatcher records a bounded `http_mcp_trace_identity` audit diagnostic;
- audit-write failure is locally contained;
- the SDK returns a safe error result;
- active receipt contexts remain `RECEIVED_NOT_DISPATCHED` when no dispatch occurred;
- sibling contexts receive no false `transport_error`, `dispatch_started`, or `tool_result_returned` stage;
- genuine server or transport exceptions still record `transport_error` and classify as `TRANSPORT_ERROR`.

The HTTP mismatch fixture confirms the SDK-observed HTTP 200 JSON-RPC error behavior and validates trace semantics rather than assuming an incorrect HTTP 500 outcome.

### 4. Canonical toolbox action policy — Approved

`src/tools/toolboxActionPolicy.ts` is the single authority for supported toolbox actions, required OAuth scope, and mapped internal write operation.

The supported-action arrays are derived from the registry. `src/transports/httpTransport.ts` and `src/tools/domainToolboxes.ts` consume the same policy authority.

Confirmed behavior includes pre-dispatch `files.write` denial for:

- `repo_toolbox.write_markdown_artifact`;
- `git_toolbox.stage_paths`;
- `integration_toolbox.prepare_external_handoff`.

Read-scoped actions remain dispatchable with `files.read`. Local write-mode enforcement continues through the mapped internal operation after OAuth scope enforcement. Unknown actions remain validation failures and are not executable.

### 5. Truthful mixed-batch evidence — Approved

Scope evaluation is per contained `tools/call`.

For an authorized read call and denied write call in the same rejected batch:

- the denied write is `APP_POLICY_DENIED` with its own `OAUTH_SCOPE_DENIED` message;
- the authorized read is `RECEIVED_NOT_DISPATCHED`;
- the authorized read receives no sibling denial code or message;
- neither call receives fabricated dispatch or result stages.

Two separately denied calls retain distinct call-specific messages. Duplicate-ID rejection composes correctly with per-call scope denial.

### 6. Shared diagnostic redaction — Approved

`src/security/diagnosticRedaction.ts` supplies field-specific sanitizers for:

- free-form diagnostic text;
- JSON-RPC IDs;
- structured routes;
- endpoints and host values.

The shared authority is used by:

- `src/server/toolCallTrace.ts`;
- `src/server/discoveryTrace.ts`;
- `src/transports/httpTransport.ts`;
- dispatcher mismatch diagnostics in `src/server/registerTools.ts`.

The reviewed tests cover:

- Windows drive-absolute paths;
- UNC and extended-length Windows paths;
- arbitrary Unix paths including `/etc`, `/usr/local`, `/root`, `/run`, and `/projects`;
- full HTTP, HTTPS, WS, and WSS endpoints;
- public tunnel and localhost endpoints;
- credential-looking values;
- keyed content, patch, file, prompt, and search text;
- stack-like frames and control characters;
- malicious and oversized string JSON-RPC IDs;
- approved structured routes such as `/mcp` and `/health`.

Discovery diagnostics are sanitized both before persistence and when legacy persisted data is read.

### 7. Lifecycle and classification evidence — Approved

The implementation now has deterministic evidence for the required lifecycle boundaries:

- malformed `tools/call` receipt before SDK rejection;
- pre-dispatch scope denial;
- duplicate-ID pre-dispatch rejection;
- actual in-flight HTTP `DISPATCHED_NOT_EXECUTED`;
- successful receipt-to-response lifecycle;
- policy denial after application dispatch;
- execution error;
- result without recorded HTTP completion through the accepted direct fixture;
- genuine transport exception;
- append and post-append compaction failure tolerance;
- corrupt and legacy trace/audit compatibility;
- 2,000-event retention.

The in-flight test sends a real HTTP call, enters the SDK handler, binds by `extra.requestId`, records `dispatch_started`, blocks before result completion, and observes the persisted classification before releasing the handler.

## Builder Report Accuracy

The updated Builder Report is materially accurate.

Its closure claims are supported by the reviewed production code and exact test assertions. In particular, the report no longer treats duplicate-ID association or generic mismatch handling as acceptable assumptions. It documents defects found during self-review and the corrections made before submission.

Reported deterministic validation results are internally consistent with the reviewed test inventory:

- typecheck: PASS;
- build: PASS;
- focused suite: PASS, 117 tests;
- broader unit lane: PASS, 359 tests;
- MCP self-test: PASS, 22 checks;
- internal registered schema count: 31;
- public exposure: seven toolbox tools plus `workspace_write_attached_image` when scope and local write mode permit it;
- public scan: PASS;
- lint: PASS;
- `git diff --check`: PASS, with line-ending warnings only.

The report correctly identifies live ChatGPT behavior, packaging, promotion, restart, reconnect, and source-control integration as not performed.

## Scope Review

No WC-V1-0202A or WC-V1-0202B implementation was identified in the reviewed source changes.

The final trace closure does not change:

- OAuth scope names or token semantics;
- DCR or PKCE behavior;
- local write-mode semantics;
- patch proposal or approval behavior;
- workspace routing;
- Git workflow semantics;
- the 31-schema internal registry baseline;
- the ChatGPT-visible public tool surface;
- packaging or release configuration;
- Electron UI;
- Figma behavior.

The dirty worktree contains separate pre-existing runtime-drift and promotion-provenance changes. Those changes were not dispositioned as part of WC-V1-0104A approval.

## Approval Boundary

This approval authorizes WC-V1-0104A-REPAIR03 to proceed to a separately authorized Git integration step.

It does not itself authorize:

- staging;
- committing;
- pushing;
- merging or integration;
- packaging;
- runtime promotion;
- application or connector restart;
- ChatGPT reconnect;
- live connector validation;
- release publication.

Those actions remain separate controlled passes.

## Remaining Validation Sequence

The implementation is locally approved. The remaining sequence is operational:

1. separately authorized Git integration of the approved change set;
2. implementation of WC-V1-0202A and WC-V1-0202B in their own approved sequence;
3. separately authorized package and runtime promotion;
4. Operator restart and ChatGPT reconnect;
5. live ChatGPT validation of safe read, insufficient-scope write, malformed or blocked-call evidence, and `recent_tool_calls` output;
6. final connector acceptance-matrix disposition.

Failure in a later package or live connector check would require an RCA against that observed boundary. It does not keep this local implementation in an indefinite repair state without new evidence.

## Final Disposition

WC-V1-0104A-REPAIR03 final closure disposition: Approved

WC-V1-0104A implementation status: LocallyApprovedPendingIntegrationAndLiveValidation

Document.Status=Approved
