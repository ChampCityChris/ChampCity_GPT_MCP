# Implementer Prompt — WC-V1-0104A Correlated MCP Tool-Call Dispatch Trace

Recommended Codex model: GPT-5.6
Recommended reasoning level: High

You are the Implementer for ChampCity GPT MCP.

Implement the approved Work Card:

`planning/phases/phase-v1.0/Work_Cards/WC-V1-0104A_mcp_tool_call_dispatch_trace.md`

Read the complete Work Card and its source RCA before making any source change:

`planning/phases/phase-v1.0/Architect_Reports/RCA_MCP_DIRECT_HELPER_READ_PLATFORM_BLOCK_2026-07-26.md`

## Repository Identity

Expected local repository:

`%USERPROFILE%\Projects\ChampCity_GPT`

Expected GitHub remote repository:

`ChampCityChris/ChampCity_GPT_MCP`

Expected working branch at handoff:

`dev`

Before editing, verify and report:

1. `Get-Location`
2. `git rev-parse --show-toplevel`
3. `git branch --show-current`
4. `git rev-parse HEAD`
5. `git remote -v`
6. `git status --short`
7. `package.json` exists
8. `AGENTS.MD` exists and has been read
9. `docs/dev/VALIDATION_COMMAND_LANES.md` has been read before running tests or builds

Stop before editing if the repository identity is wrong.

## Existing Dirty Worktree

The repository was already dirty when the Work Card was created. Known pre-existing work included runtime/workspace package-version drift diagnostics and runtime promotion provenance changes. At minimum, the earlier dirty-path inventory included:

- `docs/RELEASE_NOTES.md`
- `docs/SECURITY_MODEL.md`
- `docs/TOOL_REFERENCE.md`
- `planning/phases/phase-v1.0/04_operator_intake_interview.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_RUNTIME_DRIFT_PROMOTION_PROVENANCE_v0.3.0.md`
- `planning/phases/phase-v1.0/Live_Connector_Evidence/README.md`
- project intake/interview artifacts
- `scripts/promote-runtime-exe.mjs`
- `src/tools/domainToolboxes.ts`
- `tests/domainToolboxes.test.ts`
- `tests/promoteRuntimeProvenance.test.ts`

The live status may have changed. Treat current repository state as authoritative.

Do not reset, clean, stash, discard, revert, checkout over, or otherwise remove existing changes. Before editing any already-modified target file, inspect its current diff and preserve the unrelated work exactly. If a target-file collision cannot be resolved without overwriting or reinterpreting unrelated work, stop and report the precise collision.

Do not stage, commit, push, merge, tag, package, promote the runtime, publish a release, or alter the active server configuration.

## Protected-Subsystem Authorization

This Work Card explicitly authorizes bounded changes to:

- MCP HTTP transport request tracing
- MCP public tool dispatch tracing
- diagnostics toolbox exposure for redacted recent-call evidence
- audit-log schema and correlation behavior

It does not authorize changes to:

- OAuth
- Dynamic Client Registration
- PKCE
- token/session storage
- Cloudflare configuration or behavior
- public endpoint authentication
- write approval behavior
- patch proposal/application semantics
- Git mutation workflows
- packaging, runtime promotion, or release publication
- unrelated MCP tool behavior
- UI behavior

Preserve all out-of-scope behavior.

## Objective

Implement an end-to-end, correlated, redacted, bounded trace for every public MCP `tools/call` request that reaches the ChampCity MCP HTTP server.

The resulting diagnostics must allow an Architect or Operator to determine whether a reported call:

1. never produced server receipt evidence;
2. reached HTTP transport but was not dispatched;
3. reached the public dispatcher but not the toolbox/helper;
4. was denied by application policy or validation;
5. failed during application execution;
6. returned a tool result; or
7. completed the HTTP response path.

The implementation must never claim that absence of server evidence proves an OpenAI safety decision or motive.

## Required Design

Use the existing JSONL audit infrastructure where practical. Do not add a third-party logging package.

Create a server-side correlation identifier for each inbound HTTP JSON-RPC request containing `tools/call`. Preserve the JSON-RPC request ID when it is a string, number, or null.

Propagate correlation context across:

- `src/transports/httpTransport.ts`
- the public `CallToolRequestSchema` handler in `src/server/registerTools.ts`
- toolbox routing in `src/tools/domainToolboxes.ts`
- existing helper audit wrappers in `src/tools/common.ts`
- existing helper implementations such as `src/tools/readProjectFile.ts`

A small new module using Node `AsyncLocalStorage` is acceptable and likely appropriate. Explicit context propagation is also acceptable. Do not inject internal correlation fields into public tool arguments or public schemas.

Record the applicable lifecycle stages:

- `http_received`
- `dispatch_started`
- `toolbox_entered`
- `helper_started`
- `helper_allowed`
- `helper_denied`
- `tool_result_returned`
- `http_response_completed`
- `transport_error`

Use one correlation ID across all stages for the same request.

## Safe Metadata Contract

The trace may record only:

- timestamp
- correlation ID
- JSON-RPC request ID
- public tool name
- toolbox action
- workspace ID
- normalized repository-relative path hint when legitimately available
- lifecycle stage
- allow, deny, or error result
- structured error code
- bounded sanitized reason
- duration milliseconds
- HTTP status
- transport route
- process ID or runtime-start identifier if useful

Do not log or return:

- raw file contents
- search match contents
- patches, original text, or replacement text
- prompts or conversation text
- unrestricted argument objects
- authorization headers
- access tokens, refresh tokens, authorization codes, code verifiers, client secrets, admin passwords, cookies, or credentials
- absolute repository roots or user-profile paths
- public tunnel URLs
- environment dumps
- raw stack traces through public diagnostics

Reuse or extend existing redaction helpers rather than creating inconsistent redaction behavior.

## Diagnostics Toolbox Action

Add this internal action under the already-public `diagnostics_toolbox`:

`recent_tool_calls`

Do not add a new top-level MCP tool.

Accepted parameters:

- `limit`: optional integer; default 20; minimum 1; maximum 50
- `since`: optional ISO-8601 timestamp
- `correlationId`: optional bounded exact filter
- `publicToolName`: optional bounded exact filter

The action is read-only and requires only existing `files.read` access.

Return newest-first redacted attempt summaries. Each summary must include the deepest observed stage and one classification:

- `RECEIVED_NOT_DISPATCHED`
- `DISPATCHED_NOT_EXECUTED`
- `APP_POLICY_DENIED`
- `APP_EXECUTION_ERROR`
- `RESULT_RETURNED`
- `RESPONSE_COMPLETED`

Support `NO_SERVER_RECEIPT_EVIDENCE` only when the query supplies a bounded `since` time window or a correlation identifier and no matching HTTP receipt is found. State exactly that no server receipt evidence was found. Do not state that the platform blocked the call.

Maintain backward compatibility with older audit-log lines that lack the new fields.

## Transport Requirements

At the HTTP boundary:

1. Detect JSON-RPC requests containing `tools/call` after safe JSON parsing.
2. Extract only safe metadata: JSON-RPC ID, public tool name, toolbox action, workspace ID, and an allowed repository-relative path hint.
3. Generate correlation context before calling the MCP SDK transport.
4. Record `http_received` before `transport.handleRequest`.
5. Record `http_response_completed` after the request handler returns, including safe status, route, and duration.
6. Record `transport_error` when the transport path throws.
7. Preserve current discovery tracing, Accept-header normalization, session behavior, OAuth checks, and scope checks.

Handle batch JSON-RPC requests safely. A request-level correlation ID is acceptable, but each contained `tools/call` must remain identifiable by JSON-RPC ID and public tool name. Do not break existing initialization or notification behavior.

## Dispatcher Requirements

In the public call handler:

1. Record `dispatch_started` before public-surface validation.
2. Preserve the current rejection of direct legacy helper calls.
3. Record policy or public-surface denials with structured code and the shared correlation ID.
4. Record `tool_result_returned` after a toolbox or image-writer result is converted to the MCP response.
5. Record application errors without exposing raw arguments or stack traces.
6. Do not change current tool names, tool count, schemas, scope behavior, or write-mode behavior.

## Toolbox and Helper Requirements

At toolbox entry, record `toolbox_entered` with safe toolbox action and workspace ID.

Extend `withAudit` so helper-level entries inherit the active correlation ID and can record `helper_started`, `helper_allowed`, or `helper_denied` without requiring every helper caller to pass a new public field.

Preserve existing helper audit metadata and result semantics.

## Testing Requirements

Add deterministic tests for at least the following:

1. Successful `repo_toolbox.read_file` produces one correlation ID across HTTP receipt, dispatch, toolbox, helper allow, tool result, and HTTP completion.
2. Invalid toolbox action produces correlated application-denial evidence.
3. Direct legacy helper call, when sent to the server, records receipt and public-surface denial.
4. HTTP receipt followed by a simulated dispatcher failure is classified as `RECEIVED_NOT_DISPATCHED` or the precise equivalent defined by the Work Card.
5. Dispatcher entry without helper execution is classified as `DISPATCHED_NOT_EXECUTED`.
6. Helper denial is classified as `APP_POLICY_DENIED` when applicable.
7. Unhandled application failure is classified as `APP_EXECUTION_ERROR`.
8. Successful result before HTTP completion is `RESULT_RETURNED`; completed response is `RESPONSE_COMPLETED`.
9. `recent_tool_calls` enforces default and maximum limits.
10. `since`, `correlationId`, and `publicToolName` filters work.
11. `NO_SERVER_RECEIPT_EVIDENCE` requires a bounded query and uses evidentiary language only.
12. Concurrent tool calls receive distinct correlation IDs.
13. Older JSONL audit entries remain readable.
14. Diagnostic output redacts secrets, authorization values, absolute paths, raw content, patch text, and unrestricted arguments.
15. Existing toolbox exposure remains unchanged.
16. Existing OAuth, scope, write-mode, discovery, session, and direct-legacy-tool tests remain passing.

Prefer focused test additions in existing transport and toolbox test files unless a new focused trace test file is cleaner.

## Documentation Requirements

Update only the documentation necessary to describe the implemented behavior:

- `docs/TOOL_REFERENCE.md`
- `docs/SECURITY_MODEL.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`

Add or update acceptance coverage so CAV-028 and CAV-030 can use the correlated trace. Do not mark live ChatGPT validation as passed.

Create a Builder Report at:

`planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104A_mcp_tool_call_dispatch_trace.md`

Do not overwrite another report.

## Validation Lane

Before running tests, builds, Electron startup, Vite, Vitest, esbuild, or any child-process-capable command, read:

`docs/dev/VALIDATION_COMMAND_LANES.md`

Use the approved validation lane. Do not repeatedly retry a sandboxed command after `spawn EPERM`.

Run:

1. the repository-defined typecheck command;
2. targeted transport/dispatcher/audit/diagnostics tests;
3. the repository-defined MCP self-test;
4. `npm run check:public` if present;
5. `git diff --check`;
6. broader unit tests only when required by shared-module changes.

Do not run Playwright.
Do not package.
Do not promote the runtime.
Do not launch or restart the production MCP connector.

## Manual Validation After Codex

Report these human validation steps exactly; do not claim to have completed them:

1. Review the source diff and Builder Report.
2. Approve any separate integration/runtime-promotion pass required by project governance.
3. After the updated runtime is promoted and reconnected, open a new ChatGPT conversation.
4. Call `repo_toolbox` with `action: read_file` against a safe Markdown file.
5. Query `diagnostics_toolbox` with `action: recent_tool_calls` and verify one correlation ID spans receipt through HTTP completion.
6. Attempt an invalid toolbox action and verify application-denial classification.
7. Observe any ChatGPT-reported safety block and query the matching `since` time window.
8. Confirm that an absent call is described only as `NO_SERVER_RECEIPT_EVIDENCE`.
9. Confirm no secret, absolute path, raw content, private URL, or stack trace appears.

## Remaining Passes for the Current Phase

After this implementation is reviewed, the phase still requires:

- Architect disposition of the Builder Report
- authorized Git integration into `dev` if approved
- separately authorized package-and-promote pass
- live ChatGPT connector validation for the affected CAV cases
- final evidence capture and acceptance-matrix status update

## Final Report Requirements

Your final response must include:

- verified repository identity
- initial branch, HEAD, remote, and dirty status
- final dirty status
- files changed
- pre-existing changes preserved
- whether protected subsystems were touched
- whether scope changed
- implementation architecture
- trace fields and redaction behavior
- validation commands and execution lane
- validation results
- validation not performed
- manual validation after Codex
- remaining passes for the current phase
- blockers and assumptions
- whether any fallback was used

End with:

`No fallback implementation was used.`
