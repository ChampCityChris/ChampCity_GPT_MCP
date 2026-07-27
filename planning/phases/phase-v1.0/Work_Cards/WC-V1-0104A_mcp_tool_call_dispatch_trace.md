# WC-V1-0104A — Add Correlated MCP Tool-Call Dispatch Trace

## Work Card Identity

- ID: `WC-V1-0104A`
- Title: Add Correlated MCP Tool-Call Dispatch Trace
- Phase: v1.0 — ChatGPT Connector and Safety-Layer Reliability
- Priority: P0
- Type: Connector diagnostics / audit observability
- Owner mode: Architect specifies; Codex/Implementer implements; Operator performs live ChatGPT validation
- Repository: `%USERPROFILE%\Projects\ChampCity_GPT`
- Remote: `ChampCityChris/ChampCity_GPT_MCP`
- Base branch observed at authorization: `dev`
- Source RCA: `planning/phases/phase-v1.0/Architect_Reports/RCA_MCP_DIRECT_HELPER_READ_PLATFORM_BLOCK_2026-07-26.md`

## Authorization and Protected Scope

The Operator explicitly requested an RCA and directed that good MCP debugging logs be built if required. This Work Card is the scoped authorization for the diagnostic implementation described below.

This card intentionally touches protected subsystems:

- MCP HTTP transport request handling
- MCP public tool dispatch
- MCP diagnostics exposure
- Audit logging and redaction

No other protected subsystem is authorized. OAuth, Dynamic Client Registration, PKCE, token storage, Cloudflare configuration, write approval behavior, Git mutation behavior, packaging, release publication, and unrelated tool behavior are out of scope.

## Problem Statement

ChampCity MCP currently records discovery traces, selected HTTP errors, scope denials, and helper-level audit entries. It does not record a complete correlated lifecycle for every public `tools/call` request.

When ChatGPT reports that a safe call was blocked by the platform safety layer, current evidence cannot conclusively distinguish:

1. No request reached the MCP server.
2. The HTTP request reached the server but the MCP SDK did not dispatch it.
3. The public handler entered but the toolbox action did not execute.
4. The application denied the action through policy or validation.
5. The helper succeeded but the response was lost, rejected, or suppressed after server execution.

This evidence gap prevents reliable root-cause classification and weakens the live connector acceptance matrix.

## Objective

Add an end-to-end, redacted, bounded, correlated tool-call trace that allows an operator or Architect to determine the deepest server-observed stage of a public MCP call without exposing sensitive content.

## Required Architecture

Use the existing audit-log infrastructure unless a small dedicated trace module is necessary for safe bounded reads. Do not add a third-party logging dependency.

Generate one server-side correlation ID for each inbound JSON-RPC HTTP request that contains `tools/call`. Preserve the JSON-RPC request ID when safely available. Propagate the correlation context through transport handling, public tool dispatch, toolbox routing, and helper audit events.

A Node `AsyncLocalStorage` context is an acceptable implementation if it remains deterministic under the repository’s supported Node runtime. An equivalent explicit context propagation is also acceptable. Do not mutate public tool arguments to carry internal trace metadata.

## Required Trace Stages

Record the applicable stages below:

- `http_received`
- `dispatch_started`
- `toolbox_entered`
- `helper_started`
- `helper_allowed`
- `helper_denied`
- `tool_result_returned`
- `http_response_completed`
- `transport_error`

Not every call requires every stage. The trace must preserve the deepest completed stage.

## Safe Trace Fields

Allowed fields:

- timestamp
- correlation ID
- JSON-RPC request ID when string, number, or null
- public tool name
- toolbox action
- workspace ID
- normalized repository-relative path hint when the called action legitimately includes one
- trace stage
- allow/deny/error result
- structured application error code
- bounded reason string
- duration in milliseconds
- HTTP status
- transport route
- process ID or runtime start identifier when useful

Prohibited fields:

- raw file contents
- search result contents
- patches or replacement text
- prompts or model messages
- unrestricted argument objects
- OAuth access tokens, refresh tokens, authorization codes, code verifiers, client secrets, passwords, cookies, or headers containing credentials
- absolute local roots or private paths
- public tunnel URLs
- environment-variable dumps
- stack traces in public diagnostic output

Internal logs may retain a sanitized stack only where the current error logger already does so. Public diagnostics must never return it.

## New Diagnostic Action

Add `diagnostics_toolbox` action:

- `recent_tool_calls`

Parameters:

- `limit`: optional integer, default 20, minimum 1, maximum 50
- `since`: optional ISO-8601 timestamp
- `correlationId`: optional bounded UUID/string filter
- `publicToolName`: optional bounded exact tool-name filter

The action must return only redacted trace summaries and must not require `files.write`.

Each summarized attempt must include a classification based on the deepest recorded stage:

- `NO_SERVER_RECEIPT_EVIDENCE`
- `RECEIVED_NOT_DISPATCHED`
- `DISPATCHED_NOT_EXECUTED`
- `APP_POLICY_DENIED`
- `APP_EXECUTION_ERROR`
- `RESULT_RETURNED`
- `RESPONSE_COMPLETED`

`NO_SERVER_RECEIPT_EVIDENCE` cannot be inferred from the log alone for an unspecified event. It may only be returned by a bounded query that includes a time window or correlation identifier supplied by the caller and finds no matching server receipt. The result text must state that this is absence of server evidence, not proof of a host safety decision.

## Implementation Scope

Expected files may include:

- `src/transports/httpTransport.ts`
- `src/server/registerTools.ts`
- `src/security/auditLog.ts`
- `src/tools/common.ts`
- `src/tools/domainToolboxes.ts`
- a small new trace/context module under `src/server` or `src/security`
- `tests/httpTransport.test.ts`
- `tests/domainToolboxes.test.ts`
- focused new test files if preferable
- `docs/TOOL_REFERENCE.md`
- `docs/SECURITY_MODEL.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`
- Builder Report for this Work Card

Do not modify unrelated files.

## Existing Dirty Worktree Condition

At Work Card creation, the repository was already dirty with unrelated work, including modifications to `src/tools/domainToolboxes.ts` and associated runtime-drift documentation/tests.

The Implementer must:

1. Verify and report the current dirty state before editing.
2. Read the existing diff for every target file.
3. Preserve all unrelated current changes.
4. Avoid reset, clean, stash, checkout-discard, revert, or replacement of another pass.
5. Stop and report a collision only when the target change cannot be made without overwriting or reinterpreting unrelated work.

No staging, commit, push, merge, tag, package, promotion, or release action is authorized by this card.

## Functional Acceptance Criteria

1. Every inbound public `tools/call` that reaches the HTTP server records a redacted `http_received` event.
2. Public handler entry records `dispatch_started` with the same correlation ID.
3. Toolbox routing records `toolbox_entered` with safe action and workspace metadata.
4. Repository file reads and other existing `withAudit` helpers inherit the same correlation ID without adding it to public arguments.
5. Successful calls record `tool_result_returned`; the HTTP path records `http_response_completed` with safe status and route metadata.
6. Transport, dispatch, policy, validation, and helper failures record the deepest stage and a structured safe error classification.
7. `diagnostics_toolbox.recent_tool_calls` returns a bounded, newest-first, redacted summary.
8. Diagnostic output contains no secrets, raw content, unrestricted arguments, absolute roots, private URLs, or stack traces.
9. Existing discovery tracing remains functional and is not conflated with normal call tracing.
10. Existing public tool count and public tool names do not change except for the new internal action under the already-public `diagnostics_toolbox`.
11. Existing OAuth, scope enforcement, write-mode behavior, and direct-legacy-tool rejection remain unchanged.
12. Existing audit entries remain parseable or receive a backward-compatible schema extension.

## Required Tests

Add deterministic coverage for:

- successful `repo_toolbox.read_file` lifecycle correlation
- invalid toolbox action lifecycle and classification
- application policy denial lifecycle
- HTTP receipt followed by dispatcher failure fixture
- transport error trace
- bounded `recent_tool_calls` output
- `since`, `correlationId`, and tool-name filters
- `NO_SERVER_RECEIPT_EVIDENCE` wording and time-window requirement
- maximum limit enforcement
- JSONL compatibility with older audit entries
- concurrent calls receiving distinct correlation IDs
- redaction of tokens, absolute paths, raw content, patch text, and unrestricted arguments
- no change to exposed public top-level tool names
- no change to OAuth or write-scope behavior

## Validation Requirements

Before running child-process-capable validation, read `docs/dev/VALIDATION_COMMAND_LANES.md` and use the approved lane.

Run the smallest relevant validations first, then the card-required lane:

1. Typecheck.
2. Targeted tests for transport, dispatcher, audit trace, and diagnostics toolbox.
3. Existing MCP self-test.
4. Public safety scan.
5. Diff check.
6. Broader unit suite only if required by touched shared modules.

Do not use Playwright. Do not package or promote the runtime under this Work Card.

## Live Operator Validation

After implementation is reviewed and later promoted through a separately authorized runtime pass, the Operator must validate in a new ChatGPT conversation:

1. Call `repo_toolbox` with `action: read_file` for a safe Markdown file.
2. Query `diagnostics_toolbox.recent_tool_calls` and verify correlated receipt through HTTP completion.
3. Attempt an invalid toolbox action and verify application-denial classification.
4. Trigger or observe a ChatGPT-reported blocked call, then query the matching time window.
5. Confirm that no matching receipt is reported as `NO_SERVER_RECEIPT_EVIDENCE` with an explicit evidentiary caveat.
6. Confirm no sensitive local data appears in the diagnostic response.

Local tests cannot substitute for this live validation.

## Reporting Requirements

The Implementer Report must include:

- repository path, branch, HEAD, remote, and initial/final dirty status
- files changed
- pre-existing changes preserved
- protected subsystems touched
- scope changes, if any
- trace architecture selected and why
- validation commands and execution lane
- validation passed, failed, or not run
- redaction tests performed
- live validation not performed
- operator validation steps
- blockers and assumptions
- explicit statement: `No fallback implementation was used.`

## Out of Scope

- changing ChatGPT or OpenAI safety policy
- claiming or detecting OpenAI intent
- browser scraping or browser automation
- screenshots as diagnostic authority
- arbitrary command execution
- new top-level MCP tools
- changing public tool names
- re-exposing direct legacy helpers
- OAuth, PKCE, DCR, Cloudflare, token, approval, Git, packaging, release, or UI redesign work

## Document Disposition

Document.Status=ApprovedForImplementation
