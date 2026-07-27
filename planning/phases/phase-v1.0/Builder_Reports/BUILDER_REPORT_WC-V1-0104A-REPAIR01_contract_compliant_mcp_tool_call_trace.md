# Builder Report - WC-V1-0104A-REPAIR01 Contract-Compliant MCP Tool-Call Trace Repair

Date: 2026-07-26
Repository: `ChampCityChris/ChampCity_GPT_MCP`
Workspace: `%USERPROFILE%\Projects\ChampCity_GPT`
Branch: `dev`
Starting HEAD: `780217aa1046ad8d271d13887ba1121bba419362`

## Repository Verification

- `pwd`: `%USERPROFILE%\Projects\ChampCity_GPT`
- `git rev-parse --show-toplevel`: `%USERPROFILE%/Projects/ChampCity_GPT`
- `git remote -v`: `https://github.com/ChampCityChris/ChampCity_GPT_MCP.git`
- `package.json`: present
- `docs/dev/VALIDATION_COMMAND_LANES.md`: read before validation
- Branch verified: `dev`

## Starting Dirty State

Starting dirty state contained intermingled pre-existing work and the rejected WC-V1-0104A implementation. The repair inspected `git status --short`, `git diff --stat`, the parent Builder Report, the Architect Review, and the Work Card before editing.

Pre-existing unrelated work preserved included runtime-drift and promotion-provenance changes, planning/project artifacts, `scripts/promote-runtime-exe.mjs`, `tests/promoteRuntimeProvenance.test.ts`, and prior planning/documentation edits. No reset, restore, clean, stash, checkout, stage, commit, push, package, promotion, restart, reconnect, or release operation was performed.

## Files Changed By REPAIR01

- `src/server/toolCallTrace.ts`
- `src/server/registerTools.ts`
- `src/tools/common.ts`
- `src/tools/domainToolboxes.ts`
- `src/transports/httpTransport.ts`
- `tests/httpTransport.test.ts`
- `tests/toolCallTrace.test.ts`
- `docs/RELEASE_NOTES.md`
- `docs/SECURITY_MODEL.md`
- `docs/TOOL_REFERENCE.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104A-REPAIR01_contract_compliant_mcp_tool_call_trace.md`

Content from the rejected pass was removed from `src/utils/errors.ts`, `src/validation/mcpSelfTest.ts`, and `tests/toolSchema.test.ts` by restoring the pre-pass content. Those files show no content diff in `git diff --name-only`, though `git status --short` may still show line-ending modification state.

## Preservation Method

- Used the parent Builder Report to identify files that were clean before the rejected pass.
- Reversed the rejected registry/self-test/schema/error-code redesign with whitespace-tolerant reverse patching, then reintroduced only trace hooks around the restored dispatcher.
- Avoided whole-file restoration for files known to contain pre-existing unrelated work, especially `src/tools/domainToolboxes.ts` and documentation.
- Did not modify `scripts/promote-runtime-exe.mjs` or `tests/promoteRuntimeProvenance.test.ts`.

## Rejected WC-V1-0104A Changes Removed Or Corrected

- Removed `LEGACY_TOOL_REMOVED` behavior and classification from implementation.
- Restored the pre-pass registered tool schema catalog and self-test expectations.
- Restored direct non-public legacy-call behavior to the prior safe public-surface rejection.
- Replaced rejected `recent_tool_calls` parameters `publicTool` and `action` with the approved contract.
- Added `since` filtering, strict timestamp validation, default limit 20, and maximum 50.
- Traced every `tools/call` in JSON-RPC batches with distinct correlation IDs.
- Corrected helper policy-versus-execution classification using structured error codes.
- Stopped fabricating `tool_result_returned` for auth/scope denials before dispatcher entry.
- Added URL, endpoint, path, secret, stack-like frame, and keyed content redaction.
- Added deterministic active JSONL retention capped at 2,000 complete events.

## Protected Subsystems Touched

Touched, as explicitly authorized by the repair card:

- MCP HTTP transport request tracing
- MCP public dispatcher tracing
- MCP diagnostics toolbox action contract
- MCP trace persistence and redacted diagnostic reads
- Existing helper audit correlation metadata

Not changed:

- OAuth, DCR, PKCE, token/session storage, endpoint authentication
- Cloudflare tunnel configuration or behavior
- files.read/files.write scope semantics
- local write-mode semantics
- patch approval/application behavior
- Git workflow semantics
- workspace routing semantics
- packaging/release configuration
- Electron UI
- Figma behavior

## Registered Tool Behavior

Registered behavior was restored to the pre-WC-V1-0104A baseline:

- MCP self-test reports `registeredToolCount: 31`.
- `tools/list` with write scope reports the seven stable toolbox tools plus `workspace_write_attached_image`.
- Legacy registered implementation functions remain registered internally where required.
- Direct calls to non-public legacy names return the pre-pass safe "not exposed on the public toolbox surface" behavior.
- No `LEGACY_TOOL_REMOVED` implementation or classification remains.

## `recent_tool_calls` Contract

Public action: `diagnostics_toolbox.recent_tool_calls`

Accepted params:

- `limit`: optional integer, default 20, minimum 1, maximum 50
- `since`: optional strict ISO-8601 timestamp
- `correlationId`: optional exact bounded filter
- `publicToolName`: optional exact bounded public-tool-name filter

Unknown params are rejected by strict Zod validation. Results are newest-first. `NO_SERVER_RECEIPT_EVIDENCE` is returned only for `since` or `correlationId` lookups without matching `http_received` evidence, with wording limited to: "No matching server receipt evidence was found."

## Batch Correlation Architecture

`src/transports/httpTransport.ts` enumerates every JSON-RPC object whose method is `tools/call`. Each gets a server-generated correlation ID, safe JSON-RPC ID, public tool name, action, workspace ID, and path hint where available. A request group is used internally only to let the SDK dispatcher select the matching per-call trace context during batch handling. The request group is not exposed in the public schema or diagnostic output.

Discovery requests and notifications in the same JSON-RPC batch do not create tool-call summaries.

## Classification Precedence

Classification is deterministic:

1. `transport_error` => `TRANSPORT_ERROR`
2. Structured policy error code => `APP_POLICY_DENIED`
3. Non-policy errored tool result => `APP_EXECUTION_ERROR`
4. `dispatch_started` plus result plus HTTP completion => `RESPONSE_COMPLETED`
5. `dispatch_started` plus result without HTTP completion => `RESULT_RETURNED`
6. `dispatch_started` without result => `DISPATCHED_NOT_EXECUTED`
7. `http_response_completed` without dispatcher entry => `RECEIVED_NOT_DISPATCHED`
8. Receipt-only => `RECEIVED_NOT_DISPATCHED`
9. Explicit missing receipt evidence query => `NO_SERVER_RECEIPT_EVIDENCE`

`helper_denied` alone is not treated as policy denial. Policy denial requires a structured policy error code.

## Redaction Behavior

Trace persistence and output redacts or avoids:

- OAuth tokens, authorization codes, PKCE values, cookies, passwords, client secrets, and credential-like key/value strings
- Windows, Unix, temp, user-profile, AppData, and private local paths
- Full `http`, `https`, `ws`, and `wss` URLs
- localhost/private endpoint values
- Cloudflare/public tunnel hostnames
- URL query strings and fragments through full-URL replacement
- stack-like frames
- keyed raw text payloads such as `patch=...`, `content=...`, `prompt=...`, file content, search content, and artifact text

Route-only values such as `/mcp` remain.

## Retention Behavior

The active trace file is `mcp-tool-call-trace.ndjson` beside the audit log. After writes, the file is compacted to the newest 2,000 complete valid JSON trace events. Corrupt or partial lines are ignored. Trace write or compaction failure is caught and logged without failing the underlying MCP tool call.

## Acceptance-Criterion-To-Test Matrix

| Requirement | Test file and test name | Validation command | Result | Limitation |
|---|---|---|---|---|
| Mandatory 1 restore registration/dispatcher | `tests/toolSchema.test.ts` - registered schema tests; `tests/httpTransport.test.ts` - `preserves pre-pass direct legacy call rejection behavior`; MCP self-test registry checks | focused tests; `npm run mcp:self-test -- --json` | PASS | Local deterministic only, not live ChatGPT |
| Mandatory 2 exact `recent_tool_calls` contract | `tests/httpTransport.test.ts` - `classifies validation denials and enforces diagnostic filters`; `tests/toolCallTrace.test.ts` - `applies default limit, since filtering, and no-receipt evidence wording` | focused tests; unit lane | PASS | Public action validated locally |
| Mandatory 3 batch tracing | `tests/httpTransport.test.ts` - `traces every tools/call in a mixed JSON-RPC batch independently` | focused tests; unit lane | PASS | Local SDK/HTTP path |
| Mandatory 4 stage/classification semantics | `tests/toolCallTrace.test.ts` - `classifies every approved trace outcome deterministically`; HTTP transport trace tests | focused tests; unit lane | PASS | Deterministic classifications only |
| Mandatory 5 redaction | `tests/toolCallTrace.test.ts` - redaction test; `tests/httpTransport.test.ts` - lifecycle/transport redaction checks; `npm run check:public` | focused tests; public scan | PASS | No subjective manual review |
| Mandatory 6 bounded retention | `tests/toolCallTrace.test.ts` - `keeps the active trace bounded to the newest 2,000 complete events` | focused tests; unit lane | PASS | Single-process deterministic file test |
| Mandatory 7 preserve unrelated behavior | `npm run validate:codex:unit`; existing OAuth/workspace/write/git tests | unit lane | PASS | Did not perform live connector validation |
| Test 1 successful non-batch correlation | `tests/httpTransport.test.ts` - `records correlated successful repo_toolbox.read_file lifecycle and helper audit events` | focused tests; unit lane | PASS | Local HTTP |
| Test 2 multi-call batch distinct IDs | `tests/httpTransport.test.ts` - mixed batch test | focused tests; unit lane | PASS | Local HTTP |
| Test 3 mixed discovery/notification/tool batch | `tests/httpTransport.test.ts` - mixed batch test | focused tests; unit lane | PASS | Local HTTP |
| Test 4 strict schema fields | `tests/httpTransport.test.ts` - invalid `publicTool` query rejection | focused tests; unit lane | PASS | Zod validation evidence |
| Test 5 default/min/max/reject over 50 | `tests/toolCallTrace.test.ts` default/min; `tests/httpTransport.test.ts` reject `limit: 51` | focused tests; unit lane | PASS | Direct reader clamps; public schema rejects |
| Test 6 valid/invalid `since` | `tests/toolCallTrace.test.ts` valid since; `tests/httpTransport.test.ts` invalid since | focused tests; unit lane | PASS | Strict ISO pattern plus Date parse |
| Test 7 time-window no receipt | `tests/toolCallTrace.test.ts` no-receipt by since | focused tests; unit lane | PASS | Local trace file |
| Test 8 correlation no receipt | `tests/httpTransport.test.ts` and `tests/toolCallTrace.test.ts` missing correlation | focused tests; unit lane | PASS | Local trace file |
| Test 9 pre-dispatch failure | `tests/toolCallTrace.test.ts` receipt-only classification; HTTP auth/scope existing tests | focused tests; unit lane | PASS | Classification proven directly |
| Test 10 dispatch without completion | `tests/toolCallTrace.test.ts` dispatch-only classification | focused tests; unit lane | PASS | Direct trace |
| Test 11 policy/path/scope/write/action denial | `tests/httpTransport.test.ts` unsupported action; existing write-scope/write-mode tests; `tests/toolCallTrace.test.ts` policy code | focused tests; unit lane | PASS | Multiple deterministic paths |
| Test 12 non-policy helper/app failure | `tests/toolCallTrace.test.ts` non-policy helper/result error | focused tests; unit lane | PASS | Direct trace |
| Test 13 result without response | `tests/toolCallTrace.test.ts` result-only classification | focused tests; unit lane | PASS | Direct trace |
| Test 14 completed response | `tests/httpTransport.test.ts` successful lifecycle; `tests/toolCallTrace.test.ts` completed classification | focused tests; unit lane | PASS | Local HTTP and direct trace |
| Test 15 transport exception | `tests/httpTransport.test.ts` - `classifies transport exceptions with sanitized trace output`; direct trace test | focused tests; unit lane | PASS | Local forced transport error |
| Test 16 concurrent distinct IDs | `tests/httpTransport.test.ts` - `assigns distinct correlation IDs to concurrent tool calls` | focused tests; unit lane | PASS | Local HTTP concurrency |
| Test 17 older entries readable/ignored | `tests/toolCallTrace.test.ts` - corrupt/minimal entry test | focused tests; unit lane | PASS | JSONL fixture |
| Test 18 corrupt/partial lines safe | `tests/toolCallTrace.test.ts` - corrupt/minimal entry test | focused tests; unit lane | PASS | JSONL fixture |
| Test 19 write/compaction failure tolerated | `tests/httpTransport.test.ts` - `does not fail a successful tool call when trace writing fails` | focused tests; unit lane | PASS | Simulated invalid log parent |
| Test 20 retention <=2,000 newest | `tests/toolCallTrace.test.ts` retention test | focused tests; unit lane | PASS | JSONL fixture |
| Test 21 redaction coverage | `tests/toolCallTrace.test.ts` redaction test; `npm run check:public` | focused tests; public scan | PASS | Covers representative prohibited classes |
| Test 22 registered tools/count/schemas/direct legacy baseline | `tests/toolSchema.test.ts`; MCP self-test; `tests/httpTransport.test.ts` direct legacy test | focused tests; `npm run mcp:self-test -- --json` | PASS | Local deterministic only |
| Test 23 existing OAuth/discovery/session/workspace/write/git tests | `npm run validate:codex:unit` | unit lane | PASS | No live ChatGPT |

## Validation Results

Execution lane: documented normal Windows validation lane for child-process-capable commands. `git diff --check` was run as a local Git whitespace check. No sandbox-only `spawn EPERM` failures occurred.

| Command | Lane | Result |
|---|---|---|
| `npm run typecheck` | normal Windows | PASS |
| `npm run build` | normal Windows | PASS |
| `node --test dist/tests/toolCallTrace.test.js dist/tests/httpTransport.test.js dist/tests/domainToolboxes.test.js dist/tests/toolSchema.test.js` | normal Windows | PASS, 79 tests |
| `node --test dist/tests/toolCallTrace.test.js` | normal Windows | PASS, 5 tests after fixture cleanup |
| `node --test dist/tests/httpTransport.test.js` | normal Windows | PASS, 45 tests after concurrent coverage |
| `npm run validate:codex:unit` | normal Windows wrapper | PASS, 322 tests |
| `npm run mcp:self-test -- --json` | normal Windows | PASS, 22 checks |
| `npm run check:public` | normal Windows | PASS, 196 source candidate files |
| `npm run lint` | normal Windows | PASS |
| `git diff --check` | local Git check | PASS |

Validation not performed:

- Live ChatGPT connector validation
- Packaging
- Runtime promotion
- Restart/reconnect
- Playwright/browser visual validation
- Manual/operator visual validation

## Final Dirty State

Final `git status --short` still contains pre-existing unrelated tracked and untracked changes, plus REPAIR01 files. No files were staged.

REPAIR01 content changes are limited to the files listed in "Files Changed By REPAIR01." Pre-existing unrelated modified files remain present, including runtime promotion provenance files and planning artifacts.

## Blockers And Assumptions

No local implementation blocker remains for deterministic validation.

Assumption: live ChatGPT visibility and host-side safety-layer behavior still require the later separately authorized package/promote/restart/reconnect/live-validation passes.

A fallback may be possible, but was not implemented because architect/operator approval was not provided.

No fallback implementation was used.

No staging, commit, push, package, promotion, restart, reconnect, or release occurred.

Document.Status=ImplementedPendingArchitectReview
