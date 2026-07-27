# WC-V1-0104A-REPAIR01 — Contract-Compliant MCP Tool-Call Trace Repair

## Work Card Identity

- ID: `WC-V1-0104A-REPAIR01`
- Parent Work Card: `WC-V1-0104A`
- Title: Contract-Compliant MCP Tool-Call Trace Repair
- Phase: v1.0 — ChatGPT Connector and Safety-Layer Reliability
- Priority: P0
- Type: Bounded corrective repair
- Owner mode: Architect specifies; Codex/Implementer repairs; Architect reviews; Operator validates only after later package-and-promote authorization
- Repository: `%USERPROFILE%\Projects\ChampCity_GPT`
- Remote: `ChampCityChris/ChampCity_GPT_MCP`
- Branch at repair authorization: `dev`
- Parent Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104A_mcp_tool_call_dispatch_trace.md`
- Controlling Architect Review: `planning/phases/phase-v1.0/Architect_Reports/ARCHITECT_REVIEW_WC-V1-0104A_mcp_tool_call_dispatch_trace.md`
- Required Repair Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104A-REPAIR01_contract_compliant_mcp_tool_call_trace.md`

## Authorization Basis

The Architect Review of WC-V1-0104A assigned `RevisionRequested` because the implementation introduced acceptance-level defects and an unauthorized MCP registration redesign.

This repair is authorized solely to correct the defects identified in that Architect Review. It does not authorize feature expansion, packaging, runtime promotion, release work, live ChatGPT validation, or adjacent MCP redesign.

Where this repair card conflicts with the failed WC-V1-0104A implementation, this repair card controls. Requirements from the original WC-V1-0104A remain controlling unless explicitly clarified below.

## Existing Dirty Worktree Condition

The repository contains intermingled pre-existing work and the rejected WC-V1-0104A implementation. The repair must preserve unrelated work.

Known work that predated the rejected WC-V1-0104A pass includes, at minimum:

- runtime/workspace package-version drift diagnostics;
- runtime promotion provenance work;
- changes in `scripts/promote-runtime-exe.mjs`;
- changes in `tests/promoteRuntimeProvenance.test.ts`;
- pre-existing edits in `docs/RELEASE_NOTES.md`, `docs/SECURITY_MODEL.md`, `docs/TOOL_REFERENCE.md`, `src/tools/domainToolboxes.ts`, and `tests/domainToolboxes.test.ts`;
- planning/project intake and interview artifacts;
- unrelated planning disposition changes.

The Implementer must inspect the current diff and the parent Builder Report before editing. Do not restore entire files from HEAD when doing so would erase pre-existing work. Revert only the rejected WC-V1-0104A portions that this repair explicitly identifies.

## Repair Objective

Deliver the original correlated MCP tool-call observability capability without changing the pre-pass registered MCP schema catalog, public tool count, public tool names, OAuth behavior, write-mode behavior, or unrelated tool semantics.

The repaired implementation must allow an Architect or Operator to determine the deepest server-observed stage for every received `tools/call`, while returning only bounded and redacted evidence.

## Mandatory Repair Scope

The Implementer must complete all of the following in one bounded pass.

### 1. Restore pre-pass MCP registration and dispatcher behavior

Remove the unapproved registration/migration redesign introduced by the rejected pass.

Required outcome:

- restore the registered tool definitions, registered tool count, registered schemas, internal/public separation, and direct legacy-call behavior that existed before WC-V1-0104A;
- remove `LEGACY_TOOL_REMOVED` behavior, migration mappings, and related trace classification unless they existed before the rejected pass;
- restore self-test and schema-test expectations to the pre-pass behavior;
- preserve the existing ChatGPT-visible stable toolbox surface and bounded image-writer behavior exactly as it existed before the rejected pass;
- implement tracing around the restored dispatcher rather than redesigning discovery or registration.

This repair does not decide whether legacy registered schemas should be permanently removed. That requires a separate Architect-approved Work Card.

### 2. Implement the exact `recent_tool_calls` contract

The public action remains:

- `diagnostics_toolbox.recent_tool_calls`

Accepted parameters must be exactly:

- `limit`: optional integer, default 20, minimum 1, maximum 50;
- `since`: optional strict ISO-8601 timestamp;
- `correlationId`: optional bounded exact filter;
- `publicToolName`: optional bounded exact public-tool-name filter.

Do not expose the rejected pass’s `publicTool` or `action` query fields. Unknown parameters must be rejected by strict validation.

Required behavior:

- results are newest-first;
- `since` filters receipt/attempt evidence at or after the supplied timestamp;
- invalid timestamps fail with a structured safe validation error;
- `NO_SERVER_RECEIPT_EVIDENCE` may be returned only when the query includes `since` or `correlationId` and no matching `http_received` evidence exists;
- the explanation must state only that no matching server receipt evidence was found and must not claim why the host did not send the request.

### 3. Trace every tool call, including JSON-RPC batches

Every received JSON-RPC object whose method is `tools/call` must receive its own trace identity and summary.

For a non-batch request, one request maps to one tool-call correlation ID.

For a batch request:

- enumerate every contained `tools/call` object;
- assign a distinct server-generated correlation ID to each contained tool call;
- preserve its JSON-RPC request ID when safely representable;
- keep each tool-call attempt independently queryable and classifiable;
- do not merge multiple batch calls into one diagnostic summary;
- discovery requests or notifications in the same batch must not create tool-call summaries.

Internal implementation may use a bounded request-group identifier if useful, but it must not be added to the public schema or returned unless already authorized by the original safe-field contract.

### 4. Correct stage and classification semantics

Permitted trace stages remain:

- `http_received`
- `dispatch_started`
- `toolbox_entered`
- `helper_started`
- `helper_allowed`
- `helper_denied`
- `tool_result_returned`
- `http_response_completed`
- `transport_error`

Do not record a later stage that did not occur.

Specific requirements:

- authentication or OAuth scope denial after HTTP receipt must not fabricate `dispatch_started` or `tool_result_returned`;
- HTTP receipt followed by failure before dispatcher entry is `RECEIVED_NOT_DISPATCHED`;
- dispatcher entry without toolbox/helper/result completion is `DISPATCHED_NOT_EXECUTED`;
- structured policy, scope, validation, path, or write-mode denial is `APP_POLICY_DENIED`;
- non-policy helper, dispatcher, or application failure is `APP_EXECUTION_ERROR`;
- a returned MCP tool result without recorded HTTP completion is `RESULT_RETURNED`;
- a completed HTTP response is `RESPONSE_COMPLETED` unless a deeper error classification correctly takes precedence;
- a transport exception is `TRANSPORT_ERROR`.

`helper_denied` alone must not automatically mean policy denial. Classification must use structured safe error codes or another deterministic policy-versus-execution discriminator.

The only permitted classifications are:

- `NO_SERVER_RECEIPT_EVIDENCE`
- `RECEIVED_NOT_DISPATCHED`
- `DISPATCHED_NOT_EXECUTED`
- `APP_POLICY_DENIED`
- `APP_EXECUTION_ERROR`
- `RESULT_RETURNED`
- `RESPONSE_COMPLETED`
- `TRANSPORT_ERROR`

### 5. Complete trace redaction

Trace persistence and diagnostic output must never expose:

- raw file or search contents;
- patch text, artifact text, prompts, or unrestricted argument objects;
- OAuth tokens, authorization codes, PKCE values, client secrets, passwords, cookies, or credential headers;
- absolute user-profile, repository, AppData, temp, or private local paths;
- full `http://`, `https://`, `ws://`, or `wss://` URLs;
- Cloudflare tunnel hostnames or other public/private endpoint values;
- URL user-info, query strings, or fragments;
- raw stack traces;
- attachment bytes.

Route-only values such as `/mcp` may remain where already authorized. Full URLs must be replaced with a stable placeholder such as `<REDACTED_URL>`.

Use or extend existing project redaction utilities where practical. Do not introduce a third-party logging or redaction dependency.

### 6. Make retention deterministically bounded

The trace store must be bounded on disk, not only bounded when read.

Required minimum behavior:

- retain no more than 2,000 complete tool-call trace events in the active JSONL trace;
- compact or rotate deterministically when the limit is exceeded;
- preserve the newest complete events;
- a failed compaction or trace write must not fail the underlying MCP tool call;
- corrupt or partial JSONL lines must be ignored safely by diagnostic reads;
- diagnostic output remains limited to at most 50 summaries.

A different numeric retention bound requires Architect approval before implementation.

### 7. Preserve unrelated behavior

Do not change:

- OAuth, DCR, PKCE, token/session storage, or endpoint authentication;
- Cloudflare configuration or tunnel operation;
- files.read/files.write scope semantics;
- local write-mode semantics;
- patch proposal/application or approval behavior;
- Git workflow semantics;
- workspace routing semantics;
- packaging, promotion, or release configuration;
- Electron UI;
- Figma behavior;
- unrelated runtime-drift or promotion-provenance implementation.

## Expected Files

The bounded repair may modify only the files necessary to correct the rejected pass, expected to include:

- `src/server/toolCallTrace.ts`
- `src/transports/httpTransport.ts`
- `src/server/registerTools.ts`
- `src/tools/common.ts`
- `src/tools/domainToolboxes.ts`
- `src/utils/errors.ts` only if required to remove rejected error behavior or preserve structured classification
- `src/validation/mcpSelfTest.ts`
- `tests/httpTransport.test.ts`
- `tests/domainToolboxes.test.ts`
- `tests/toolSchema.test.ts`
- focused new trace tests if cleaner
- `docs/TOOL_REFERENCE.md`
- `docs/SECURITY_MODEL.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md` only to remove rejected-pass changes
- `docs/RELEASE_NOTES.md` only to correct rejected-pass claims while preserving unrelated release-note content
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md` only to restore pre-pass routes and describe approved trace evidence
- the required repair Builder Report

Do not modify `scripts/promote-runtime-exe.mjs` or `tests/promoteRuntimeProvenance.test.ts` under this repair.

If another file is technically required, report the necessity in the Builder Report and keep the change narrowly tied to an explicit acceptance criterion.

## Required Deterministic Tests

The repair must add or restore deterministic coverage for every item below:

1. successful non-batch `repo_toolbox.read_file` correlation across receipt, dispatch, toolbox, helper, result, and response;
2. two or more `tools/call` objects in one JSON-RPC batch receive distinct correlation IDs and independent summaries;
3. mixed discovery/notification/tool-call batch traces only the tool calls;
4. strict `recent_tool_calls` schema accepts only `limit`, `since`, `correlationId`, and `publicToolName`;
5. default limit 20, minimum 1, maximum 50, and rejection above 50;
6. valid `since` filtering and invalid ISO-8601 rejection;
7. time-window-based `NO_SERVER_RECEIPT_EVIDENCE` with evidentiary wording only;
8. correlation-ID-based `NO_SERVER_RECEIPT_EVIDENCE` with evidentiary wording only;
9. HTTP receipt followed by pre-dispatch failure is `RECEIVED_NOT_DISPATCHED`;
10. dispatcher entry without completed execution is `DISPATCHED_NOT_EXECUTED`;
11. structured path/scope/write-mode/action denial is `APP_POLICY_DENIED`;
12. non-policy helper or application failure is `APP_EXECUTION_ERROR`;
13. tool result without response completion is `RESULT_RETURNED`;
14. completed response is `RESPONSE_COMPLETED`;
15. transport exception is `TRANSPORT_ERROR`;
16. concurrent requests receive distinct correlation IDs;
17. older JSONL or audit entries without new fields remain readable or are safely ignored;
18. corrupt and partial trace lines do not break diagnostics;
19. trace write or compaction failure does not fail a successful MCP call;
20. retention keeps no more than 2,000 newest complete events;
21. redaction covers tokens, credential-bearing strings, absolute paths, file content, patch text, full URLs, Cloudflare/public tunnel URLs, localhost/private endpoints, URL query strings, and stack traces;
22. current registered tool names, count, schemas, scope behavior, and direct legacy-call behavior match the pre-WC-V1-0104A baseline;
23. existing OAuth, discovery, session, workspace routing, write-scope, and write-mode tests remain passing.

## Acceptance-Criterion-to-Test Matrix

The repair Builder Report must include a table mapping every Mandatory Repair Scope section and every Required Deterministic Test item to:

- test file and test name;
- validation command;
- result;
- any limitation.

A generic statement that the unit suite passed is not sufficient.

## Validation Requirements

Before running any child-process-capable command, read `docs/dev/VALIDATION_COMMAND_LANES.md` and use the documented normal Windows validation lane.

Run, in order:

1. repository-defined typecheck;
2. focused trace/transport/toolbox/schema tests;
3. repository-defined build;
4. broader repository unit lane required by the shared modules touched;
5. repository-defined MCP self-test;
6. `npm run check:public` if present;
7. lint;
8. `git diff --check`.

Do not use Playwright.
Do not package.
Do not promote the runtime.
Do not start, stop, or restart the active production MCP connector.
Do not perform live ChatGPT connector validation.

## Reporting Requirements

The repair Builder Report must include:

- verified repository path, remote, branch, and starting HEAD;
- starting and final dirty state;
- exact files changed by REPAIR01;
- method used to preserve pre-existing dirty changes;
- rejected WC-V1-0104A changes removed or corrected;
- protected subsystems touched;
- confirmation that registered tool behavior was restored to the pre-pass baseline;
- final `recent_tool_calls` parameter contract;
- batch-correlation architecture;
- classification precedence;
- redaction behavior;
- retention behavior;
- acceptance-criterion-to-test matrix;
- validation commands, lane, and results;
- validation not performed;
- blockers and assumptions;
- explicit statement that no staging, commit, push, package, promotion, restart, reconnect, or release occurred;
- explicit statement: `No fallback implementation was used.`

## Stop Conditions

Stop and report rather than improvising if:

- restoring pre-pass registration behavior cannot be separated from unrelated dirty work;
- the exact pre-pass schema behavior cannot be established from repository history/current tests;
- batch tracing requires a public schema change beyond this repair card;
- the 2,000-event retention bound cannot be implemented without changing unrelated logging architecture;
- any required repair would alter OAuth, Cloudflare, write approval, Git mutation, packaging, release, or UI behavior;
- deterministic tests cannot demonstrate a required classification.

No fallback architecture is authorized.

## Manual Validation After Codex

After the repair Builder Report receives Architect approval and a later pass separately authorizes package and runtime promotion, the Operator will:

1. package and promote the approved runtime;
2. restart ChampCity MCP;
3. disconnect and reconnect the ChatGPT connector;
4. open a new ChatGPT conversation;
5. perform a safe `repo_toolbox.read_file` call;
6. query `diagnostics_toolbox.recent_tool_calls` using `since`, `correlationId`, and `publicToolName` separately;
7. verify correlated receipt through HTTP completion;
8. verify an invalid action is classified as application policy denial;
9. reproduce a host-reported blocked call when available and query the matching time window;
10. confirm absent receipt is described only as `NO_SERVER_RECEIPT_EVIDENCE`;
11. confirm no secret, full URL, absolute path, content, or stack trace appears.

These steps are not authorized under this repair implementation pass.

## Remaining Passes for the Current Phase

After REPAIR01 implementation:

- Architect review of the REPAIR01 Builder Report;
- authorized Git integration only if approved;
- separately authorized package-and-promote pass;
- live ChatGPT connector validation for affected CAV cases;
- final evidence capture and acceptance-matrix disposition.

## Document Disposition

Document.Status=ApprovedForImplementation
