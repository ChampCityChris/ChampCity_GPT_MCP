# WC-V1-0104A-REPAIR02 — Trace Boundary, Classification, Redaction, and Evidence Repair

## Work Card Identity

- ID: `WC-V1-0104A-REPAIR02`
- Parent Work Card: `WC-V1-0104A`
- Prior Repair: `WC-V1-0104A-REPAIR01`
- Title: Trace Boundary, Classification, Redaction, and Evidence Repair
- Phase: v1.0 — ChatGPT Connector and Safety-Layer Reliability
- Priority: P0
- Type: Bounded corrective repair
- Owner mode: Architect specifies; Codex/Implementer repairs; Architect reviews; Operator validates only after separately authorized package and runtime promotion
- Repository: `%USERPROFILE%\Projects\ChampCity_GPT`
- Remote: `ChampCityChris/ChampCity_GPT_MCP`
- Branch at authorization: `dev`
- Controlling Architect Review: `planning/phases/phase-v1.0/Architect_Reports/ARCHITECT_REVIEW_WC-V1-0104A-REPAIR01_contract_compliant_mcp_tool_call_trace.md`
- REPAIR01 Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104A-REPAIR01_contract_compliant_mcp_tool_call_trace.md`
- Required REPAIR02 Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104A-REPAIR02_trace_boundary_classification_redaction_evidence.md`

## Authorization Basis

The Architect Review assigned `RevisionRequested` to REPAIR01 after confirming that the registry baseline, approved `recent_tool_calls` parameters, valid-call batch contexts, and bounded retention were substantially corrected.

REPAIR02 is authorized only to correct the remaining trace-boundary, classification, redaction, duplicate-batch association, evidence, and documentation defects identified in that Architect Review.

This Work Card does not authorize another trace redesign. Preserve the working REPAIR01 architecture unless a specific change is required by an acceptance criterion below.

## Sequencing Constraint

`WC-V1-0202A — Workspace-Scoped Planning Artifact Write Policy` is separate and must not be implemented, partially implemented, prepared, or intermingled with REPAIR02.

REPAIR02 must receive Architect approval before shared trace/toolbox files are used as the base for WC-V1-0202A implementation.

## Existing Dirty Worktree

The repository remains heavily dirty with:

- pre-existing runtime-drift and promotion-provenance changes;
- the parent WC-V1-0104A implementation;
- REPAIR01 changes;
- planning/project artifacts;
- Architect reviews, Work Cards, and Implementer Prompts;
- unrelated disposition/documentation changes.

The Implementer must preserve all unrelated work. Before editing each target file:

1. inspect current `git status --short`;
2. inspect the current file diff;
3. read the REPAIR01 Builder Report and Architect Review;
4. distinguish REPAIR02 corrections from unrelated and accepted REPAIR01 behavior;
5. avoid whole-file restoration where it would erase unrelated changes.

Do not reset, clean, stash, revert broadly, discard, checkout over, or replace unrelated work.

## Repair Objective

Make the correlated MCP tool-call trace trustworthy at every required receipt, denial, redaction, and batch-association boundary without changing the restored internal tool registry, ChatGPT-visible tool surface, OAuth behavior, write behavior, workspace behavior, or unrelated diagnostics.

## Mandatory Repair Scope

### 1. Trace every received `tools/call`, including malformed calls

Every parsed JSON-RPC object with `method: "tools/call"` must receive a server-generated correlation ID and an `http_received` event before validation of `params`, `name`, or `arguments`.

Required behavior:

- valid `tools/call` requests continue to capture safe tool metadata;
- missing `params` is traced;
- `params: null` is traced;
- scalar `params` is traced;
- array `params` is traced;
- missing tool name is traced;
- non-string tool name is traced;
- missing, null, scalar, or array `arguments` is traced;
- safe metadata fields remain undefined when they cannot be extracted;
- the MCP SDK or dispatcher may reject malformed requests normally, but the server receipt evidence must remain queryable;
- malformed calls in a batch each receive independent correlation IDs.

Do not weaken JSON-RPC or MCP SDK validation to make malformed requests execute.

### 2. Classify OAuth scope denials as `APP_POLICY_DENIED`

When a received call is refused at the HTTP scope gate:

- record `http_received`;
- do not fabricate `dispatch_started`, `toolbox_entered`, helper stages, or `tool_result_returned`;
- attach a structured safe denial code to an event that actually occurred;
- record `http_response_completed` after the 403 response;
- classify the call as `APP_POLICY_DENIED`.

Required scope-denial coverage:

- missing `files.read` for a read-visible tool;
- missing `files.write` for a write-scoped top-level tool;
- missing `files.write` for an applicable toolbox write action where the HTTP scope gate can determine the requirement;
- multiple calls in one batch where one or more calls are scope denied.

Do not change OAuth scope semantics or tool exposure behavior.

### 3. Sanitize and bound caller-controlled JSON-RPC IDs

Numeric and null JSON-RPC IDs may remain unchanged.

String JSON-RPC IDs must:

- be sanitized before persistence;
- be sanitized again when old trace lines are read;
- have a deterministic maximum length of 128 characters after sanitization;
- redact full URLs and endpoint values;
- redact tokens and credential-looking values;
- redact absolute local paths;
- redact keyed content and prompt/file/patch-like text;
- normalize or remove control characters and line breaks;
- never expose unrestricted caller content through `recent_tool_calls`.

Do not hash all normal short string IDs unless necessary. Safe short IDs should remain recognizable for diagnosis.

### 4. Centralize policy-versus-execution classification

Create one shared policy-denial predicate or shared classified-code set used by helper audit tracing and final trace classification.

The shared classification must distinguish:

Policy denials, including:

- invalid input and unsupported action;
- OAuth scope denial;
- path and file-policy denial;
- patch-policy denial;
- command-policy denial;
- write-mode or approval denial;
- Git-required policy denial;
- workspace-required or workspace-not-found denial;
- reparse-point, extension, MIME, image-format, dimension, file-size, and destination-exists policy denials where these represent explicit constraints.

Execution failures, including:

- `DOWNLOAD_TIMED_OUT`;
- `DOWNLOAD_FAILED`;
- `VERIFICATION_FAILED`;
- `PROCESS_FAILED`;
- unexpected filesystem or I/O errors;
- parser/runtime exceptions not caused by an input-policy violation;
- transport exceptions, which remain `TRANSPORT_ERROR` when the transport stage exists.

Required outcome:

- no duplicated policy-code sets in `src/server/toolCallTrace.ts` and `src/tools/common.ts`;
- every currently defined `AppErrorCode` is explicitly classified as policy, execution, or transport/not-applicable;
- unknown codes default to execution error, not policy denial.

Do not change the public `AppErrorCode` contract unless required to add one narrowly scoped HTTP scope-denial code.

### 5. Complete arbitrary absolute-path redaction

Diagnostic strings and string JSON-RPC IDs must redact arbitrary absolute local paths, including:

- Windows drive-absolute paths on any drive;
- Windows UNC paths;
- Windows extended-length paths where practical;
- arbitrary Unix absolute paths such as `/srv/...`, `/opt/...`, `/var/...`, and mounted workspace paths;
- configured workspace roots outside a user-profile directory.

Preserve only specifically authorized route-only values such as:

- `/mcp`;
- `/health`;
- OAuth metadata route names when recorded as route fields.

Do not preserve arbitrary absolute paths merely because they begin with `/`.

Use structured route fields rather than free-form string exceptions where practical.

### 6. Prove correct duplicate-call batch association

Valid calls in a JSON-RPC batch must remain associated with their own JSON-RPC IDs even when two or more calls have identical:

- public tool name;
- toolbox action;
- workspace ID;
- relative path;
- arguments.

Required behavior:

- each duplicate call receives a distinct correlation ID;
- every lifecycle event for that attempt retains the correct sanitized JSON-RPC ID;
- no call receives the other call’s request ID;
- no context remains unclaimed when the SDK dispatches all calls;
- delayed or reversed completion must not cross-associate calls where a deterministic fixture is possible.

Preferred implementation:

- use an SDK-supported request identity or request-local sequence/queue tied deterministically to the parsed batch order and actual handler invocation order;
- avoid metadata-only matching as the sole identity mechanism.

If the MCP SDK does not expose JSON-RPC IDs to the call handler, document the exact SDK limitation and implement the strongest deterministic association possible. The tests must demonstrate the actual guarantee rather than merely checking distinct IDs exist.

### 7. Exercise actual HTTP pre-dispatch and denial boundaries

Replace weaker direct-trace substitutes with HTTP-level tests for:

- malformed `tools/call` receipt followed by SDK rejection;
- authenticated receipt followed by scope denial;
- authenticated receipt followed by dispatcher/schema rejection before toolbox execution;
- valid dispatcher entry without completed execution through a controlled fixture;
- tool result without HTTP completion through a controlled fixture where feasible.

Direct trace-unit tests may supplement but do not replace HTTP evidence for required HTTP boundaries.

### 8. Complete backward compatibility and failure-tolerance evidence

Add deterministic evidence for:

- old trace lines without new fields;
- existing audit-log lines without correlation fields remaining parseable and writable;
- corrupt and partial trace lines being ignored safely;
- trace append failure not failing the underlying MCP call;
- trace compaction failure after a successful append not failing the underlying MCP call;
- temporary compaction files not being returned through diagnostics;
- retention preserving no more than 2,000 newest valid events after corrupt-line cleanup.

A fixture that prevents trace-file creation entirely is not sufficient proof of compaction-failure tolerance.

### 9. Correct documentation and acceptance evidence

Correct contradictory and residual documentation in the files actually affected.

Required documentation distinctions:

- internal registered MCP schema catalog: 31 schemas at the restored baseline;
- ChatGPT-visible exposed surface: seven stable toolboxes plus the bounded image writer when scope and local mode permit;
- internal registered legacy helpers are exposure-filtered, not removed from registration;
- direct non-public calls receive the existing safe public-surface rejection;
- `recent_tool_calls` records malformed receipt evidence and scope-denial classification;
- string JSON-RPC IDs and arbitrary absolute paths are redacted and bounded.

Inspect and explicitly disposition every surviving parent-pass documentation hunk in:

- `docs/CHATGPT_CONNECTION_GUIDE.md`;
- `docs/RELEASE_NOTES.md`;
- `docs/SECURITY_MODEL.md`;
- `docs/TOOL_REFERENCE.md`;
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`.

Preserve unrelated runtime-drift and promotion-provenance documentation.

Do not mark live ChatGPT validation passed.

## Prohibited Scope

Do not change:

- registered tool names, count, or schemas except any narrowly required internal trace metadata that does not alter public schemas;
- ChatGPT-visible public tool names or exposure rules;
- OAuth authorization, DCR, PKCE, token, refresh-session, or endpoint authentication behavior;
- files.read or files.write semantics;
- write-mode, patch approval, or proposal semantics;
- workspace routing;
- Git workflow behavior;
- runtime-drift or promotion-provenance implementation;
- packaging or release configuration;
- Electron UI;
- Figma behavior;
- greenfield planning-write policy from WC-V1-0202A.

Do not add dependencies.

## Expected Files

Expected source files:

- `src/server/toolCallTrace.ts`
- `src/server/registerTools.ts`
- `src/transports/httpTransport.ts`
- `src/tools/common.ts`
- a small shared trace/error-classification module if necessary
- `src/utils/errors.ts` only if a narrow scope-denial code is necessary

Expected tests:

- `tests/httpTransport.test.ts`
- `tests/toolCallTrace.test.ts`
- focused new trace/error-classification tests if cleaner
- audit-log tests if required for backward compatibility

Expected documentation:

- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `docs/RELEASE_NOTES.md`
- `docs/SECURITY_MODEL.md`
- `docs/TOOL_REFERENCE.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`
- the required REPAIR02 Builder Report

Do not modify `scripts/promote-runtime-exe.mjs` or `tests/promoteRuntimeProvenance.test.ts`.

## Required Deterministic Tests

The REPAIR02 pass must include explicit deterministic coverage for all items below.

1. Valid non-batch lifecycle remains correlated.
2. Missing `params` receives `http_received` evidence.
3. Null `params` receives `http_received` evidence.
4. Scalar `params` receives `http_received` evidence.
5. Array `params` receives `http_received` evidence.
6. Missing or non-string tool name receives receipt evidence.
7. Malformed arguments receive receipt evidence.
8. Multiple malformed batch calls receive distinct correlation IDs.
9. Missing `files.read` is `APP_POLICY_DENIED` without dispatch/result stages.
10. Missing `files.write` is `APP_POLICY_DENIED` without dispatch/result stages.
11. Mixed batch scope denial produces an independent classification for every contained call.
12. Numeric JSON-RPC ID is preserved.
13. Null JSON-RPC ID is preserved.
14. Safe short string JSON-RPC ID is preserved.
15. URL-bearing string ID is redacted.
16. token-bearing string ID is redacted.
17. absolute-path string ID is redacted.
18. keyed content string ID is redacted.
19. control characters and line breaks in string ID are normalized.
20. oversized string ID is bounded to 128 characters.
21. Windows drive-absolute paths are redacted.
22. UNC paths are redacted.
23. Unix `/srv`, `/opt`, `/var`, and mounted absolute paths are redacted.
24. Authorized route fields such as `/mcp` remain usable.
25. Every defined `AppErrorCode` has a table-driven classification expectation.
26. `DOWNLOAD_TIMED_OUT` is `APP_EXECUTION_ERROR`.
27. `DOWNLOAD_FAILED` is `APP_EXECUTION_ERROR`.
28. `VERIFICATION_FAILED` is `APP_EXECUTION_ERROR`.
29. `PROCESS_FAILED` is `APP_EXECUTION_ERROR`.
30. unknown application code defaults to `APP_EXECUTION_ERROR`.
31. identical valid batch calls retain distinct and correct JSON-RPC IDs.
32. three identical batch calls do not cross-associate contexts.
33. delayed or reversed duplicate-call fixture does not cross-associate IDs, where technically supported.
34. actual HTTP malformed-call rejection is `RECEIVED_NOT_DISPATCHED` or the precise evidenced classification.
35. actual HTTP dispatcher/schema rejection is classified correctly.
36. old trace line without new fields remains readable or safely ignored.
37. old audit line without correlation fields remains parseable and later audit writes succeed.
38. corrupt and partial trace lines remain safe.
39. append failure does not fail the underlying call.
40. compaction failure after append does not fail the underlying call.
41. retention remains capped at 2,000 newest valid events after corrupt-line cleanup.
42. internal registered schema baseline remains 31.
43. ChatGPT-visible surface remains unchanged.
44. existing OAuth, session, workspace, write-mode, patch, and Git tests remain passing.
45. no WC-V1-0202A behavior or configuration appears in the diff.

## Corrected Acceptance-Criterion-to-Test Matrix

The REPAIR02 Builder Report must contain a row for every Mandatory Repair Scope section and every Required Deterministic Test item.

Each row must include:

- exact test file;
- exact test name;
- exact assertion or behavior proven;
- validation command;
- result;
- limitation.

Do not cite a broad unit suite as the sole proof of a specific boundary.

## Validation Requirements

Before running child-process-capable commands, read `docs/dev/VALIDATION_COMMAND_LANES.md` and use the documented normal Windows lane.

Run in this order:

1. repository-defined typecheck;
2. focused trace, transport, error-classification, and audit tests;
3. repository-defined build;
4. broader unit lane required by shared modules;
5. repository-defined MCP self-test;
6. `npm run check:public` if present;
7. lint;
8. `git diff --check`.

Do not use Playwright.
Do not package.
Do not promote the runtime.
Do not start, stop, or restart the active production MCP connector.
Do not reconnect ChatGPT.
Do not perform live connector validation.

## Reporting Requirements

The REPAIR02 Builder Report must include:

- repository path, branch, starting HEAD, and remote;
- starting and final dirty state;
- exact files changed by REPAIR02;
- preservation method for unrelated work;
- each REPAIR01 defect corrected;
- malformed receipt architecture;
- scope-denial event and classification semantics;
- string JSON-RPC ID sanitization and limit;
- shared policy-versus-execution classification table;
- arbitrary absolute-path redaction behavior;
- duplicate-call batch association guarantee and any SDK limitation;
- append and compaction failure behavior;
- documentation hunk disposition;
- corrected acceptance-criterion-to-test matrix;
- exact validation commands, lane, and results;
- validation not performed;
- blockers and assumptions;
- confirmation that WC-V1-0202A was not touched;
- explicit statement that nothing was staged, committed, pushed, integrated, packaged, promoted, restarted, reconnected, published, or released;
- explicit statement: `No fallback implementation was used.`

## Stop Conditions

Stop and report rather than improvising if:

- the MCP SDK cannot provide or preserve duplicate batch-call identity and no deterministic safe association can be proven;
- a public schema change appears necessary;
- correcting scope classification requires changing OAuth semantics;
- arbitrary path redaction cannot preserve route fields safely;
- compaction-failure testing requires destabilizing unrelated logging;
- any change would overlap WC-V1-0202A implementation;
- a fallback architecture is required.

No fallback is authorized.

## Manual Validation After Codex

Report these steps as not performed:

1. Architect reviews the REPAIR02 diff and Builder Report.
2. After approval, a separately authorized pass integrates the approved change set.
3. A separately authorized pass packages and promotes the runtime.
4. Operator restarts ChampCity MCP and reconnects the ChatGPT connector.
5. Operator opens a new ChatGPT conversation.
6. Operator performs a safe tool call and queries `recent_tool_calls` by `since`, `correlationId`, and `publicToolName`.
7. Operator validates a live scope denial and confirms `APP_POLICY_DENIED` without fabricated dispatch stages.
8. Operator observes a blocked or malformed-call case where available and confirms server receipt evidence is accurate.
9. Operator confirms no secret, caller-controlled string ID content, full URL, absolute path, private endpoint, content, or stack trace appears.

## Remaining Passes

After REPAIR02 implementation:

- Architect disposition of the REPAIR02 Builder Report;
- authorized Git integration only if approved;
- implementation of the separately approved WC-V1-0202A;
- separately authorized package-and-promote pass;
- live ChatGPT connector validation;
- final evidence and acceptance-matrix disposition.

## Document Disposition

Document.Status=ApprovedForImplementation
