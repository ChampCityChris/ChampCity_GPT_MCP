# Implementer Prompt — WC-V1-0104A-REPAIR01 Contract-Compliant MCP Tool-Call Trace Repair

Recommended Codex model: GPT-5.6
Recommended reasoning level: High

You are the Implementer for ChampCity GPT MCP.

Implement the approved bounded repair Work Card:

`planning/phases/phase-v1.0/Work_Cards/WC-V1-0104A-REPAIR01_contract_compliant_mcp_tool_call_trace.md`

Before editing, read completely:

1. `AGENTS.MD`
2. `docs/dev/VALIDATION_COMMAND_LANES.md`
3. `planning/phases/phase-v1.0/Work_Cards/WC-V1-0104A_mcp_tool_call_dispatch_trace.md`
4. `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104A_mcp_tool_call_dispatch_trace.md`
5. `planning/phases/phase-v1.0/Architect_Reports/ARCHITECT_REVIEW_WC-V1-0104A_mcp_tool_call_dispatch_trace.md`
6. `planning/phases/phase-v1.0/Work_Cards/WC-V1-0104A-REPAIR01_contract_compliant_mcp_tool_call_trace.md`

The REPAIR01 Work Card controls where it clarifies or corrects the rejected implementation. Do not reinterpret this as permission to redesign MCP registration, discovery, OAuth, write approval, packaging, or unrelated tool behavior.

## Repository Identity

Expected local repository:

`%USERPROFILE%\Projects\ChampCity_GPT`

Expected GitHub remote:

`ChampCityChris/ChampCity_GPT_MCP`

Expected branch at handoff:

`dev`

Before editing, verify and report:

1. `Get-Location`
2. `git rev-parse --show-toplevel`
3. `git branch --show-current`
4. `git rev-parse HEAD`
5. `git remote -v`
6. `git status --short`
7. `package.json` exists
8. `AGENTS.MD` was read
9. `docs/dev/VALIDATION_COMMAND_LANES.md` was read

Stop before editing if repository identity is wrong.

## Dirty Worktree Preservation

The worktree contains intermingled pre-existing work and the rejected WC-V1-0104A pass. Do not reset, restore whole files, clean, stash, checkout-discard, revert indiscriminately, or replace another pass.

Known pre-existing work includes runtime/workspace version drift diagnostics and runtime promotion provenance. It includes changes in shared files that the rejected pass also touched.

Before changing any file:

1. inspect its current diff;
2. compare the current file to the starting HEAD where useful;
3. use the parent Builder Report’s starting-dirty inventory to distinguish pre-existing changes;
4. preserve unrelated hunks exactly;
5. remove or correct only the rejected WC-V1-0104A portions authorized by REPAIR01.

Do not modify:

- `scripts/promote-runtime-exe.mjs`
- `tests/promoteRuntimeProvenance.test.ts`

Do not remove or rewrite unrelated planning/project artifacts or disposition changes.

## Protected-Subsystem Authorization

This repair authorizes narrow changes to:

- MCP tool-call tracing;
- MCP HTTP transport trace boundaries;
- existing dispatcher instrumentation;
- toolbox/helper trace correlation;
- read-only diagnostics for recent tool calls;
- trace redaction and retention;
- deterministic tests and directly related documentation;
- restoration of pre-WC-V1-0104A registered schema/dispatcher behavior that the rejected pass changed without authorization.

This repair does not authorize changes to:

- OAuth or Dynamic Client Registration;
- PKCE;
- access-token, refresh-token, or session behavior;
- Cloudflare configuration or tunnel behavior;
- files.read/files.write scope semantics;
- local write-mode semantics;
- patch proposal/application or approval behavior;
- Git workflow semantics;
- packaging, runtime promotion, release publication, or active runtime configuration;
- Electron UI;
- Figma behavior;
- unrelated runtime drift or promotion provenance.

## Required Repair Outcome

Produce a contract-compliant correlated trace for every received public MCP `tools/call` while restoring the pre-pass registration and direct-call behavior.

The repair must not merely make tests pass. The code, public diagnostic schema, tests, and documentation must match the exact REPAIR01 contract.

## Repair Task 1 — Restore Pre-Pass Tool Registration Behavior

The rejected pass removed legacy definitions from the registered `tools` catalog, changed self-test assumptions, added `LEGACY_TOOL_REMOVED`, added migration mappings, and rewrote documentation around that change.

Restore the behavior that existed at the starting HEAD before WC-V1-0104A while preserving unrelated dirty-worktree changes.

Required:

- restore registered tool definitions, count, schemas, and direct legacy-call behavior to the pre-pass baseline;
- remove `LEGACY_TOOL_REMOVED`, `legacy_tool_rejected`, migration maps, and related classifications introduced only by the rejected pass;
- restore schema/self-test expectations to the pre-pass baseline;
- preserve the existing ChatGPT-visible toolbox surface exactly as it was before the rejected pass;
- add tracing around the restored dispatcher without changing its behavior.

Use repository history/current HEAD as the baseline authority. Do not infer the baseline from the rejected Builder Report alone.

## Repair Task 2 — Exact `recent_tool_calls` Schema

Implement only these parameters:

- `limit`: optional integer, default 20, minimum 1, maximum 50;
- `since`: optional strict ISO-8601 timestamp;
- `correlationId`: optional bounded exact filter;
- `publicToolName`: optional bounded exact filter.

Use strict validation. Reject `publicTool`, `action`, unknown fields, limit values above 50, and invalid timestamps.

Required semantics:

- newest-first summaries;
- `since` filters attempts at or after the supplied timestamp;
- `publicToolName` is exact-match;
- `correlationId` is exact-match;
- `NO_SERVER_RECEIPT_EVIDENCE` is returned only when `since` or `correlationId` is supplied and no matching `http_received` event exists;
- absence wording must state only that the server has no matching receipt evidence and does not prove why the host did not send a request.

Update code, tests, and documentation to this exact contract.

## Repair Task 3 — Per-Call Batch Correlation

The rejected `firstToolCallRequest` design is insufficient.

For each JSON-RPC HTTP body:

- identify every object whose method is `tools/call`;
- assign a distinct server-generated correlation ID to each contained tool call;
- retain its safe JSON-RPC ID, public tool name, toolbox action, workspace ID, and allowed repository-relative path hint;
- keep each attempt independently queryable and independently classifiable;
- do not create tool-call trace attempts for discovery requests or notifications in the same batch.

Do not expose new public input fields. Do not merge separate batch calls under one summary.

Preserve initialization, notifications, stateful sessions, stateless compatibility, discovery tracing, OAuth checks, and Accept-header behavior.

## Repair Task 4 — Correct Stage Semantics

Use only the stages approved in the Work Card:

- `http_received`
- `dispatch_started`
- `toolbox_entered`
- `helper_started`
- `helper_allowed`
- `helper_denied`
- `tool_result_returned`
- `http_response_completed`
- `transport_error`

Record only stages that actually occurred.

Do not record `tool_result_returned` for authentication or scope denial before dispatcher execution.

Required boundary behavior:

- receipt before dispatcher failure: receipt only, classified `RECEIVED_NOT_DISPATCHED`;
- dispatcher entered but execution did not complete: `DISPATCHED_NOT_EXECUTED`;
- toolbox/action/path/scope/write-mode/policy denial: `APP_POLICY_DENIED`;
- non-policy helper/application exception: `APP_EXECUTION_ERROR`;
- public handler returned a result but HTTP completion is absent: `RESULT_RETURNED`;
- HTTP response completion: `RESPONSE_COMPLETED` unless an error classification correctly takes precedence;
- transport exception: `TRANSPORT_ERROR`.

Do not fabricate a deeper stage merely to simplify classification.

## Repair Task 5 — Policy Versus Execution Classification

The rejected implementation classifies all `helper_denied` events as policy denial. Correct this.

Use structured error codes or an equally deterministic discriminator so that:

- expected policy, scope, validation, path, and write-mode failures map to `APP_POLICY_DENIED`;
- unexpected file-system, parsing, helper, dispatcher, or runtime failures map to `APP_EXECUTION_ERROR`.

A helper failure may still use `helper_denied` as the lifecycle stage, but classification must not rely on that stage alone.

The final classification set must contain only:

- `NO_SERVER_RECEIPT_EVIDENCE`
- `RECEIVED_NOT_DISPATCHED`
- `DISPATCHED_NOT_EXECUTED`
- `APP_POLICY_DENIED`
- `APP_EXECUTION_ERROR`
- `RESULT_RETURNED`
- `RESPONSE_COMPLETED`
- `TRANSPORT_ERROR`

## Repair Task 6 — Complete Redaction

Trace persistence and public diagnostic output must redact all prohibited material.

At minimum cover:

- tokens, codes, cookies, passwords, secrets, authorization material, PKCE material, and credential headers;
- absolute Windows, macOS, Linux, AppData, user-profile, repository, and temp paths;
- raw file/search/artifact/patch/prompt content;
- full `http://`, `https://`, `ws://`, and `wss://` URLs;
- Cloudflare tunnel hostnames and public/private endpoint values;
- localhost, loopback, LAN, and credential-bearing URLs;
- query strings and fragments;
- stack traces.

Route-only values such as `/mcp` may remain. Use a stable placeholder such as `<REDACTED_URL>` for full URLs.

Prefer existing project sanitizers or a shared bounded sanitizer. Do not add a dependency.

## Repair Task 7 — Bounded Trace Retention

The active trace must retain no more than 2,000 complete JSONL events.

Implement deterministic compaction or rotation that:

- preserves the newest complete events;
- keeps the trace readable as JSONL;
- tolerates corrupt or partial lines;
- does not fail an MCP call when trace append/compaction fails;
- does not expose trace/log paths through public diagnostics.

Do not change the numeric bound without stopping for Architect approval.

## Repair Task 8 — Complete Deterministic Coverage

Add or restore tests for all 23 test requirements in the REPAIR01 Work Card.

Your tests must explicitly demonstrate:

- non-batch full lifecycle;
- multiple independent calls in one batch;
- mixed batch behavior;
- exact diagnostics schema and unknown-field rejection;
- default/min/max limits;
- `since` filtering and invalid timestamp rejection;
- both permitted `NO_SERVER_RECEIPT_EVIDENCE` query forms;
- every classification boundary;
- concurrent distinct IDs;
- older/corrupt JSONL tolerance;
- trace write and compaction failure tolerance;
- 2,000-event retention;
- complete redaction including URLs and endpoints;
- restored pre-pass registered tool names/count/schemas/direct-call behavior;
- unchanged OAuth, discovery, session, workspace, scope, and write-mode behavior.

Use focused unit/integration fixtures. Do not rely on live ChatGPT or browser automation.

## Documentation Corrections

Correct only documentation changed by the rejected pass or required to describe the approved trace.

At minimum:

- `docs/TOOL_REFERENCE.md`
- `docs/SECURITY_MODEL.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`

Also remove rejected-pass claims from these only where necessary:

- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `docs/RELEASE_NOTES.md`

Preserve unrelated runtime-drift and promotion-provenance documentation.

Do not mark any live CAV case passed.

## Required Builder Report

Create:

`planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104A-REPAIR01_contract_compliant_mcp_tool_call_trace.md`

Do not overwrite the parent Builder Report.

The report must include an acceptance-criterion-to-test matrix. For every mandatory repair section and every numbered deterministic test requirement, provide:

- test file;
- exact test name;
- validation command;
- result;
- limitation, if any.

A general statement that the suite passed is insufficient.

## Validation Lane

Before any command that may spawn child processes, follow:

`docs/dev/VALIDATION_COMMAND_LANES.md`

Use the approved normal Windows validation lane. Do not repeatedly retry sandboxed commands after `spawn EPERM`.

Run in this order:

1. repository-defined typecheck;
2. focused trace, transport, toolbox, and schema tests;
3. repository-defined build;
4. broader repository unit lane required by touched shared modules;
5. repository-defined MCP self-test;
6. `npm run check:public` if present;
7. lint;
8. `git diff --check`.

Record the exact commands and execution lane.

Do not use Playwright.
Do not package.
Do not promote the runtime.
Do not start, stop, or restart the active production MCP connector.
Do not reconnect ChatGPT.
Do not perform live connector validation.

## Git and Release Restrictions

Do not stage, commit, push, merge, tag, package, promote, publish, or release.

Leave all repair changes unstaged for Architect review.

Do not modify Git history or remove unrelated changes.

## Stop Conditions

Stop and report rather than improvising if:

- the pre-pass registered schema behavior cannot be established from repository history;
- restoring a rejected hunk would overwrite unrelated dirty work;
- batch trace correlation requires a public schema change;
- the 2,000-event bound requires redesign of unrelated logging;
- a repair requires changing OAuth, Cloudflare, approval, Git, packaging, release, or UI behavior;
- deterministic tests cannot distinguish policy denial from execution failure;
- any fallback architecture appears necessary.

No fallback is authorized.

## Manual Validation After Codex

Report these steps exactly as not performed:

1. Architect reviews the REPAIR01 diff and Builder Report.
2. After approval, a separately authorized pass integrates the repair.
3. A separately authorized pass packages and promotes the runtime.
4. Operator restarts ChampCity MCP and reconnects the ChatGPT connector.
5. Operator opens a new ChatGPT conversation.
6. Operator performs a safe `repo_toolbox.read_file` call.
7. Operator queries `diagnostics_toolbox.recent_tool_calls` separately with `since`, `correlationId`, and `publicToolName`.
8. Operator verifies one correlation ID spans receipt through completion for the selected call.
9. Operator verifies an invalid toolbox action is `APP_POLICY_DENIED`.
10. Operator reproduces a host-reported block when available and queries the matching time window.
11. Operator confirms missing receipt evidence is stated only as `NO_SERVER_RECEIPT_EVIDENCE`.
12. Operator confirms no secret, full URL, private endpoint, absolute path, content, or stack trace appears.

## Remaining Passes for the Current Phase

After this implementation pass:

- Architect disposition of the REPAIR01 Builder Report;
- authorized Git integration only if approved;
- separately authorized package-and-promote pass;
- live ChatGPT connector validation for affected CAV cases;
- final evidence capture and acceptance-matrix disposition.

## Final Report Requirements

Your final response and Builder Report must include:

- verified repository identity;
- starting branch, HEAD, remote, and dirty state;
- final dirty state;
- exact files changed by REPAIR01;
- how pre-existing changes were preserved;
- rejected parent-pass behavior removed or corrected;
- protected subsystems touched;
- whether scope changed;
- restored registration baseline evidence;
- final diagnostics parameter contract;
- batch correlation architecture;
- stage and classification precedence;
- redaction behavior;
- retention behavior;
- acceptance-criterion-to-test matrix;
- exact validation commands, execution lane, and results;
- validation not performed;
- manual validation after Codex;
- remaining phase passes;
- blockers and assumptions;
- confirmation that nothing was staged, committed, pushed, packaged, promoted, restarted, reconnected, published, or released.

End with:

`No fallback implementation was used.`
