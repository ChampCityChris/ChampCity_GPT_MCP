# Implementer Prompt — WC-V1-0104A-REPAIR02 Trace Boundary, Classification, Redaction, and Evidence Repair

Recommended Codex model: GPT-5.6
Recommended reasoning level: High

You are the Implementer for ChampCity GPT MCP.

Implement the approved bounded repair:

`planning/phases/phase-v1.0/Work_Cards/WC-V1-0104A-REPAIR02_trace_boundary_classification_redaction_evidence.md`

Read the complete controlling corpus before editing:

1. `AGENTS.MD`
2. `docs/dev/VALIDATION_COMMAND_LANES.md`
3. `planning/phases/phase-v1.0/Work_Cards/WC-V1-0104A_mcp_tool_call_dispatch_trace.md`
4. `planning/phases/phase-v1.0/Work_Cards/WC-V1-0104A-REPAIR01_contract_compliant_mcp_tool_call_trace.md`
5. `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104A-REPAIR01_contract_compliant_mcp_tool_call_trace.md`
6. `planning/phases/phase-v1.0/Architect_Reports/ARCHITECT_REVIEW_WC-V1-0104A-REPAIR01_contract_compliant_mcp_tool_call_trace.md`
7. `planning/phases/phase-v1.0/Work_Cards/WC-V1-0104A-REPAIR02_trace_boundary_classification_redaction_evidence.md`

REPAIR02 controls where it corrects REPAIR01. Preserve accepted REPAIR01 behavior unless this prompt explicitly requires a change.

## Repository Identity

Expected local repository:

`%USERPROFILE%\Projects\ChampCity_GPT`

Expected remote:

`ChampCityChris/ChampCity_GPT_MCP`

Expected branch:

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

The worktree contains intermingled unrelated work, parent-pass work, REPAIR01 work, planning artifacts, and Architect reviews.

Do not:

- reset;
- clean;
- stash;
- discard;
- restore whole files indiscriminately;
- checkout over dirty files;
- revert unrelated changes;
- rewrite runtime-drift or promotion-provenance work.

Before editing each target file:

1. inspect its current diff;
2. identify accepted REPAIR01 behavior;
3. identify the specific REPAIR02 defect being corrected;
4. preserve unrelated hunks exactly.

Do not modify:

- `scripts/promote-runtime-exe.mjs`
- `tests/promoteRuntimeProvenance.test.ts`

## Sequencing Restriction

Do not implement, prepare, partially implement, or mix in:

`WC-V1-0202A — Workspace-Scoped Planning Artifact Write Policy`

REPAIR02 must contain no `writePolicy`, `artifact_only`, `artifactWriteRoots`, greenfield workspace, or related configuration/UI implementation.

## Objective

Finish the correlated MCP tool-call trace by correcting the remaining receipt, scope-denial, caller-controlled-ID, classification, path-redaction, duplicate-batch identity, persistence-failure, and documentation defects.

Do not redesign the public tool surface, registered tool catalog, OAuth model, write model, or workspace model.

## Task 1 — Trace Every `tools/call` Before Parameter Validation

The current parser skips malformed calls when `params` is absent or not an object.

Change the HTTP receipt parser so every parsed JSON-RPC object with:

`method: "tools/call"`

receives:

- a server-generated correlation ID;
- an `http_received` event;
- its safely representable JSON-RPC ID;
- safe metadata when extractable;
- undefined metadata when not extractable.

Trace all of these without making them executable:

- missing `params`;
- `params: null`;
- scalar `params`;
- array `params`;
- missing name;
- non-string name;
- missing arguments;
- null arguments;
- scalar arguments;
- array arguments.

The MCP SDK must remain responsible for normal schema rejection.

Add HTTP-level tests proving each malformed object has receipt evidence and an independent correlation ID.

## Task 2 — Correct OAuth Scope-Denial Classification

The current scope-denial path records receipt and HTTP completion but no policy code, so classification is wrong.

Implement a structured scope-denial trace result without inventing stages that did not occur.

Required lifecycle:

- `http_received`;
- a structured safe scope-denial code attached to an actual event;
- `http_response_completed`;
- no `dispatch_started`;
- no `toolbox_entered`;
- no helper stage;
- no `tool_result_returned`.

Required classification:

`APP_POLICY_DENIED`

Add HTTP-level tests for:

- missing `files.read` on a read tool;
- missing `files.write` on `workspace_write_attached_image`;
- any toolbox write action whose write scope is enforced at the HTTP or dispatcher boundary;
- mixed batches where each contained tool call gets independent scope-denial evidence.

Do not change OAuth behavior, scope strings, token behavior, or tool exposure.

## Task 3 — Sanitize and Bound String JSON-RPC IDs

JSON-RPC IDs are caller-controlled diagnostic data.

Implement one safe JSON-RPC-ID sanitizer:

- numeric IDs remain numeric;
- null remains null;
- short safe string IDs remain recognizable;
- string IDs are normalized for whitespace and control characters;
- string IDs are passed through the same secret, URL, content, and path redaction contract as other diagnostic strings;
- string IDs are capped at 128 characters after sanitization;
- old persisted trace lines are sanitized when read;
- public diagnostic output never returns the original unsafe ID.

Add tests for:

- safe short ID;
- URL-containing ID;
- access-token-looking ID;
- absolute Windows path ID;
- UNC path ID;
- Unix absolute path ID;
- `patch=...`, `content=...`, and `prompt=...` ID;
- ID with CR/LF/control characters;
- ID longer than 128 characters.

## Task 4 — Use One Shared Error Classification Authority

The current policy-code lists are duplicated and include operational failures.

Create one shared module or exported predicate used by:

- `src/tools/common.ts` helper trace result selection;
- `src/server/toolCallTrace.ts` final classification.

Review every currently defined `AppErrorCode` in `src/utils/errors.ts`.

Classify each code explicitly as:

- policy denial;
- execution failure;
- transport/not applicable.

Policy-only examples include:

- invalid input;
- path/file/patch/command policy denial;
- approval/write-mode denial;
- Git-required policy;
- workspace selection denial;
- file-type, extension, MIME, image-format, dimension, size, reparse, and destination constraints.

Execution examples must include:

- `DOWNLOAD_TIMED_OUT`;
- `DOWNLOAD_FAILED`;
- `VERIFICATION_FAILED`;
- `PROCESS_FAILED`;
- unknown errors;
- unexpected filesystem and runtime errors.

Unknown codes must default to execution failure.

Do not leave separate policy-code sets in trace and audit modules.

Add a table-driven test covering every defined AppError code and explicit tests for the four operational codes above.

## Task 5 — Complete Absolute-Path Redaction

Extend diagnostic redaction to cover arbitrary absolute paths, not only user-profile and temp paths.

Required fixtures:

- `D:\Projects\Private\file.md`;
- `C:\ProgramData\Private\file.md`;
- UNC path such as `\\server\share\private\file.md`;
- Windows extended-length path where practical;
- `/srv/private/file.md`;
- `/opt/private/file.md`;
- `/var/lib/private/file.md`;
- a mounted workspace path outside `/home` or `/Users`.

Preserve route-only structured fields such as `/mcp` and `/health`.

Do not solve this with a broad replacement that destroys legitimate structured route fields. Apply absolute-path redaction to free-form diagnostic strings and caller-controlled IDs; keep routes in dedicated route fields.

## Task 6 — Prove Duplicate Batch-Call Identity

The existing implementation claims contexts by matching tool metadata and handler order. The current test uses different tools and does not prove duplicate association.

Add tests with two and three identical batch calls where all metadata except JSON-RPC ID is identical.

Required assertions:

- distinct correlation IDs;
- correct JSON-RPC ID on every lifecycle event for each correlation;
- no cross-association;
- all contexts claimed when all calls dispatch;
- no duplicate claim;
- correct result and completion classification for each call.

Add a controlled delayed or reversed-completion fixture where technically supported.

Prefer an MCP SDK-supported request identity if available. Investigate the installed SDK types and handler context before assuming the JSON-RPC ID is unavailable.

If the SDK does not expose it:

- document the exact SDK limitation;
- implement the strongest deterministic sequence association possible;
- make the guarantee and limitation explicit in the Builder Report;
- do not claim stronger identity guarantees than tests prove.

## Task 7 — Replace Direct-Trace Substitutes With HTTP Evidence

Add actual HTTP tests for:

- malformed receipt followed by SDK rejection;
- scope denial;
- dispatcher/schema rejection before toolbox entry;
- dispatcher entry without completed execution through a controlled server/handler fixture;
- returned result without HTTP completion through a controlled response fixture where feasible.

Direct trace tests may remain, but do not cite them as sole proof of HTTP-boundary requirements.

## Task 8 — Complete Audit Compatibility and Persistence Failure Tests

Add deterministic tests proving:

1. old trace lines without newer fields remain readable or safely ignored;
2. old audit lines without correlation fields remain parseable;
3. a later correlated audit write can append after old audit lines;
4. corrupt and partial trace lines are ignored;
5. trace append failure does not fail a tool call;
6. compaction failure after a successful append does not fail a tool call;
7. temporary compaction files are not returned by diagnostics;
8. retention remains at 2,000 newest valid events after corrupt-line cleanup.

The existing invalid-parent fixture proves append failure only. Create a distinct compaction-failure fixture that reaches append and then fails during compaction or atomic replacement.

Do not make production trace failure fatal.

## Task 9 — Correct Documentation and Parent-Pass Residue

Inspect every current diff hunk in:

- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `docs/RELEASE_NOTES.md`
- `docs/SECURITY_MODEL.md`
- `docs/TOOL_REFERENCE.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`

For each hunk introduced by the rejected parent or repair passes:

- retain it only when accurate and authorized;
- correct contradictory language;
- revert it when it is rejected-pass residue unrelated to the trace repair;
- identify its disposition in the Builder Report.

Documentation must state accurately:

- 31 internal registered schemas at the restored baseline;
- seven ChatGPT-visible toolbox tools;
- the bounded image writer appears only when scope and local mode allow;
- internal registered legacy helpers are exposure-filtered, not removed;
- direct non-public calls receive safe public-surface rejection;
- malformed calls receive receipt evidence;
- scope denials are `APP_POLICY_DENIED` without fabricated stages;
- string JSON-RPC IDs are sanitized and capped;
- arbitrary absolute paths are redacted.

Do not mark live CAV validation passed.

## Prohibited Changes

Do not change:

- registered tool names, count, or schemas;
- public tool names or exposure rules;
- OAuth, DCR, PKCE, token, refresh, or session behavior;
- files.read/files.write meaning;
- local write modes;
- patch proposal or approval behavior;
- Git workflow behavior;
- workspace routing;
- runtime-drift or promotion-provenance behavior;
- packaging or release configuration;
- Electron UI;
- Figma behavior;
- WC-V1-0202A planning-workspace behavior.

Do not add dependencies.

## Required Tests

Implement and report all 45 deterministic tests enumerated in the REPAIR02 Work Card.

At minimum, use exact named tests for:

- malformed-call receipt variants;
- HTTP scope-denial classifications;
- malicious and oversized JSON-RPC IDs;
- arbitrary Windows, UNC, and Unix path redaction;
- table-driven AppError classification;
- duplicate and triplicate identical batch calls;
- actual HTTP pre-dispatch boundaries;
- old audit compatibility;
- append failure;
- post-append compaction failure;
- retention after corrupt-line cleanup;
- unchanged internal registry and public exposure;
- explicit absence of WC-V1-0202A implementation.

## Required Builder Report

Create:

`planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104A-REPAIR02_trace_boundary_classification_redaction_evidence.md`

Do not overwrite prior reports.

The Builder Report must contain a corrected acceptance-criterion-to-test matrix with one row for every mandatory scope section and all 45 numbered tests.

Each row must identify:

- exact test file;
- exact test name;
- exact assertion or boundary proven;
- command;
- result;
- limitation.

Do not use “unit suite passed” as the sole evidence for a specific acceptance criterion.

## Validation Lane

Before running tests or builds, follow:

`docs/dev/VALIDATION_COMMAND_LANES.md`

Use the approved normal Windows lane. Do not repeatedly retry sandbox commands after `spawn EPERM`.

Run in order:

1. repository-defined typecheck;
2. focused trace, HTTP transport, classification, redaction, and audit tests;
3. repository-defined build;
4. broader repository unit lane required by touched shared modules;
5. repository-defined MCP self-test;
6. `npm run check:public` if present;
7. lint;
8. `git diff --check`.

Record exact commands and lane.

Do not use Playwright.
Do not package.
Do not promote the runtime.
Do not restart the active connector.
Do not reconnect ChatGPT.
Do not perform live validation.

## Git Restrictions

Do not stage, commit, push, merge, integrate, tag, package, promote, publish, or release.

Leave all changes unstaged for Architect review.

## Stop Conditions

Stop and report rather than improvising if:

- the MCP SDK provides no deterministic way to preserve duplicate batch identity and your proposed sequence guarantee cannot be proven;
- a public schema change is required;
- scope classification would require changing OAuth semantics;
- path redaction cannot preserve route fields safely;
- compaction-failure testing requires redesigning unrelated logging;
- any change overlaps WC-V1-0202A;
- a fallback architecture is needed.

No fallback is authorized.

## Manual Validation After Codex

Report these steps exactly as not performed:

1. Architect reviews the REPAIR02 diff and Builder Report.
2. After approval, a separately authorized pass integrates the approved changes.
3. WC-V1-0202A is implemented separately on the approved trace baseline.
4. A separately authorized pass packages and promotes the runtime.
5. Operator restarts ChampCity MCP and reconnects ChatGPT.
6. Operator opens a new conversation.
7. Operator performs a safe call and queries `recent_tool_calls` with `since`, `correlationId`, and `publicToolName`.
8. Operator validates a live scope denial as `APP_POLICY_DENIED` without dispatch stages.
9. Operator validates a host-reported or malformed-call case when available.
10. Operator confirms diagnostics expose no malicious string-ID content, full URLs, absolute paths, private endpoints, raw content, credentials, or stack traces.

## Remaining Passes

After this implementation:

- Architect disposition of REPAIR02;
- authorized Git integration if approved;
- separate WC-V1-0202A implementation;
- separately authorized package-and-promote pass;
- live ChatGPT connector validation;
- final evidence capture and acceptance-matrix disposition.

## Final Report Requirements

Your final response and Builder Report must include:

- verified repository identity;
- starting branch, HEAD, remote, and dirty state;
- final dirty state;
- exact files changed by REPAIR02;
- unrelated work preservation method;
- malformed receipt implementation;
- scope-denial classification implementation;
- JSON-RPC ID sanitization and maximum length;
- shared AppError classification authority and table;
- absolute-path redaction behavior;
- duplicate batch identity mechanism and proven limitation;
- HTTP boundary evidence;
- audit compatibility evidence;
- append and compaction failure behavior;
- documentation hunk disposition;
- corrected 45-test acceptance matrix;
- exact validation commands and lane;
- validation not performed;
- blockers and assumptions;
- confirmation that WC-V1-0202A was untouched;
- confirmation that nothing was staged, committed, pushed, integrated, packaged, promoted, restarted, reconnected, published, or released.

End with:

`No fallback implementation was used.`
