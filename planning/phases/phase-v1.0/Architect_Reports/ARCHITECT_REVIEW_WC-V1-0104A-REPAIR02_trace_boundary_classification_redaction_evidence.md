# Architect Review — WC-V1-0104A-REPAIR02 Trace Boundary, Classification, Redaction, and Evidence Repair

Date: 2026-07-26
Repository: `ChampCityChris/ChampCity_GPT_MCP`
Workspace: `%USERPROFILE%\Projects\ChampCity_GPT`
Branch reviewed: `dev`
Starting HEAD reported by Implementer: `780217aa1046ad8d271d13887ba1121bba419362`
Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104A-REPAIR02_trace_boundary_classification_redaction_evidence.md`
Work Card: `planning/phases/phase-v1.0/Work_Cards/WC-V1-0104A-REPAIR02_trace_boundary_classification_redaction_evidence.md`
Disposition: RevisionRequested

## Executive Disposition

WC-V1-0104A-REPAIR02 is not approved for Git integration, packaging, runtime promotion, restart, reconnect, or live ChatGPT connector validation.

REPAIR02 materially improves the implementation. It now creates receipt contexts for malformed `tools/call` objects, attaches a structured OAuth scope-denial code to an actual HTTP completion event, sanitizes and bounds string JSON-RPC IDs in the tool-call trace, centralizes application error classification, adds broader path fixtures, and exercises append/compaction failure tolerance.

However, the implementation still does not satisfy several explicit P0 requirements. The HTTP scope gate cannot identify write actions nested inside the public toolboxes, batch-level scope denial is attributed indiscriminately to every contained tool call, duplicate-call identity remains an unproven handler-order assumption, the required HTTP `DISPATCHED_NOT_EXECUTED` boundary is still represented only by a direct trace fixture, and the claimed arbitrary-path/ID redaction has persistence paths that bypass the new sanitizer.

Passing typecheck, build, 338 unit tests, MCP self-test, public scan, lint, and `git diff --check` does not cure those contract and evidence defects.

## Repository State Reviewed

ChampCity MCP reported:

- Workspace: `champcity_gpt`
- Repository: `ChampCityChris/ChampCity_GPT_MCP`
- Branch: `dev`
- Worktree: dirty
- Tracked modified files: 17
- Untracked files before this review artifact: 24
- Staged files: 0
- Deleted files: 0

The review did not reset, restore, clean, stash, stage, commit, push, integrate, package, promote, restart, reconnect, publish, or release anything. The only repository write performed by this review is this Architect Review artifact.

## Confirmed Improvements

The following REPAIR01 findings were materially corrected:

1. Parsed JSON-RPC objects with `method: "tools/call"` now receive a receipt context before `params`, name, or arguments validation.
2. Scope denials now carry `OAUTH_SCOPE_DENIED` on an actual `http_response_completed` event and no longer require fabricated dispatch or tool-result stages.
3. String JSON-RPC IDs in the tool-call trace are sanitized and capped at 128 characters; numeric and null IDs remain representable.
4. `src/utils/errorClassification.ts` provides one shared classification authority for traced helper and final call classification.
5. `DOWNLOAD_TIMED_OUT`, `DOWNLOAD_FAILED`, `VERIFICATION_FAILED`, and `PROCESS_FAILED` now classify as execution failures.
6. The trace sanitizer covers the tested Windows drive, UNC, extended-length, `/srv`, `/opt`, `/var`, and `/mnt` path fixtures.
7. Existing and old-format trace/audit fixtures are tested for read/append compatibility.
8. A post-append rename failure is now exercised without failing the underlying MCP call.
9. The restored 31-schema internal registry and public seven-toolbox-plus-image-writer exposure distinction is described more accurately.
10. No WC-V1-0202A implementation was identified in the REPAIR02 source changes reviewed.

These corrections are substantial but do not resolve the findings below.

## Findings

### Finding 1 — The HTTP scope gate still cannot identify write actions inside mixed public toolboxes

Severity: P0 acceptance failure

The REPAIR02 Work Card explicitly requires coverage for:

- missing `files.write` for an applicable toolbox write action where the HTTP scope gate can determine the requirement.

`mcpScopeDenial` in `src/transports/httpTransport.ts` examines only the top-level MCP tool name:

- `isWriteToolName(toolName)`;
- `isReadToolName(toolName)`.

All seven public toolboxes are included in the read-visible tool set. The function does not inspect the already parsed toolbox `action` to determine that calls such as:

- `repo_toolbox.write_markdown_artifact`;
- `repo_toolbox.write_json_artifact`;
- write-capable Git toolbox actions;
- other mapped write actions

require `files.write`.

A caller with `files.read` but not `files.write` can therefore pass the HTTP scope gate for `repo_toolbox.write_markdown_artifact`. The call is denied later after `dispatch_started` and toolbox entry by the action-level scope check. That preserves security, but it does not meet the authorized HTTP scope-boundary contract.

The Builder Report omits this required case from its scope-denial evidence. Its missing-`files.write` test covers only `workspace_write_attached_image`, which is a top-level write-scoped tool.

Required correction:

- introduce one safe top-level-tool/action scope-requirement lookup shared with the toolbox action contract;
- use the parsed toolbox action at the HTTP gate where the write requirement is deterministic;
- preserve mixed toolbox visibility and existing action-level defense in depth;
- add an HTTP test proving `repo_toolbox.write_markdown_artifact` with only `files.read` is denied before dispatch and classified `APP_POLICY_DENIED` without dispatch/toolbox/result stages;
- cover at least one additional write-capable toolbox action.

### Finding 2 — Batch scope denial is indiscriminately stamped onto every contained tool call

Severity: P0 diagnostic correctness failure

`mcpScopeDenial` returns one denial string for the entire HTTP body. When any request in the batch triggers that denial, the transport calls:

`recordToolCallHttpResponses(config, toolCallContexts, ..., { errorCode: "OAUTH_SCOPE_DENIED", ... })`

for every contained `tools/call` context.

This produces incorrect per-call evidence for a mixed batch containing, for example:

- an authorized `repo_toolbox.read_file` call; and
- a `workspace_write_attached_image` call without `files.write`.

Both calls would be classified as `APP_POLICY_DENIED`, and both would receive the image-writer `files.write` denial message, even though the read call itself satisfied its scope requirement. The HTTP batch may be rejected as a whole, but the trace is required to identify each contained call accurately. A batch-level refusal must not be represented as if every call independently violated the same scope policy.

The new mixed-batch test does not expose this defect. It includes two write-denied calls, plus `tools/list`; it does not include one authorized `tools/call` and one denied `tools/call`.

Required correction:

- compute scope evaluation per contained tool call;
- record the actual per-call scope outcome and any separate batch-level response consequence;
- do not attach another call’s denial message to an authorized call;
- add a batch fixture containing one authorized read tool call and one denied write tool call;
- define and test the classification for the authorized call when the transport rejects the whole batch because of another entry.

### Finding 3 — Duplicate-call JSON-RPC identity remains an unproven order assumption

Severity: P0 evidence and stop-condition failure

The production association mechanism remains `runWithSelectedToolCallTraceContext`, which:

1. matches by tool name, action, workspace, and path;
2. falls back to the first unclaimed context for the same tool;
3. then falls back to the first unclaimed context in the group;
4. mutates a shared `claimed` flag.

For two identical calls, association is therefore based on the assumption that the MCP SDK invokes `CallToolRequestSchema` handlers in the same order as the parsed JSON-RPC batch.

The REPAIR02 tests prove that:

- two correlations exist;
- each correlation contains one internally consistent JSON-RPC ID;
- both response IDs are present.

They do not prove that the correlation selected for a given handler invocation is the correlation belonging to the JSON-RPC response ID assigned by the SDK. If SDK handler invocation order differs from parsed batch order, the two IDs can be swapped while all current assertions still pass.

The Builder Report acknowledges that no SDK request-ID binding exists, but then records Test 33 as `PASS with limitation`. The Work Card’s stop condition requires the Implementer to stop if no deterministic safe association can be proven. An undocumented assumption is not the required proof.

Required correction or disposition:

- create a controlled server fixture that returns the selected trace correlation ID or invocation sequence in each SDK result, allowing the JSON-RPC response ID to be compared directly with the trace correlation and stored JSON-RPC ID;
- test duplicate calls with delayed or intentionally varied handler completion where the SDK permits it;
- inspect and cite the installed SDK batch-dispatch implementation if order preservation is the relied-upon guarantee;
- if the guarantee cannot be proven, stop and report the architecture blocker rather than marking the criterion passed.

### Finding 4 — The required HTTP `DISPATCHED_NOT_EXECUTED` boundary is still not tested

Severity: P0 evidence failure

Mandatory Repair Scope section 7 requires an HTTP-level controlled fixture for:

- valid dispatcher entry without completed execution.

The only assertion for `DISPATCHED_NOT_EXECUTED` remains in `tests/toolCallTrace.test.ts`, where events are inserted directly into the trace file through the test helper. No HTTP transport test asserts an actual received call with `dispatch_started` and no completed execution.

The Builder Report states that the required HTTP boundaries were exercised and records Mandatory 7 as PASS. Repository search shows no HTTP assertion for `DISPATCHED_NOT_EXECUTED`.

Required correction:

- add a controlled HTTP/MCP server fixture that records `dispatch_started` and then prevents toolbox/helper/result completion without converting the event to `TRANSPORT_ERROR`;
- assert the actual persisted stages and `DISPATCHED_NOT_EXECUTED` classification;
- if the current SDK makes this boundary technically impossible to fixture, report that limitation explicitly and seek an Architect revision instead of claiming the requirement passed.

`RESULT_RETURNED` without HTTP completion was explicitly allowed to remain a direct fixture where an HTTP fixture is not feasible; the same exception was not granted for `DISPATCHED_NOT_EXECUTED`.

### Finding 5 — “Arbitrary absolute-path redaction” remains an allowlist of selected Unix roots

Severity: P1 redaction defect

The new trace sanitizer covers the tested Unix prefixes:

- `/srv`;
- `/opt`;
- `/var`;
- `/mnt`;
- `Volumes`, `private`, `workspace`, `workspaces`, and `data` in selected contexts.

It does not redact arbitrary Unix absolute paths such as:

- `/etc/private/config`;
- `/usr/local/private/file`;
- `/root/private/file`;
- `/run/secrets/value`;
- `/projects/private/file`;
- another configured workspace root whose first path segment is not in the regex allowlist.

A caller-supplied `requestedPath` such as `/etc/passwd` can therefore remain in the trace even though the application later denies it. The Work Card requires arbitrary Unix absolute paths and configured workspace roots outside user-profile paths to be redacted; it does not authorize a fixed list of common prefixes.

The tests cover only the implemented prefix list and therefore cannot support the Builder Report and documentation claim of arbitrary absolute-path redaction.

Required correction:

- treat any free-form Unix absolute path as private path data unless it is held in a structured route field;
- preserve route values through field-specific handling rather than negative regex exceptions;
- add `/etc`, `/usr/local`, `/root`, `/run`, and an arbitrary configured-root fixture;
- add a denied absolute `requestedPath` HTTP fixture and confirm it is redacted in `recent_tool_calls`.

### Finding 6 — Other diagnostic persistence paths bypass the new ID/path sanitizer

Severity: P1 security and evidence defect

Two persistence paths remain outside the new tool-call sanitizer:

1. `recordMcpDiscovery` stores `jsonRpcIds(body)` directly. In a mixed batch containing a discovery method and a `tools/call` with a malicious string ID, the raw caller-controlled ID can enter the discovery trace.
2. `logHttpTransportError` uses `safeOAuthErrorDescription`, whose path handling remains limited to selected user/temp paths and does not provide the new arbitrary Windows/UNC/Unix path or full endpoint redaction.

The Work Card requires caller-controlled string IDs to be sanitized before persistence and diagnostic strings to redact arbitrary absolute local paths. The implementation currently satisfies that only within `mcp-tool-call-trace.ndjson`, not across the adjacent diagnostics generated by the same request.

Required correction:

- reuse a shared redaction primitive for tool-call trace, discovery IDs, and HTTP error diagnostic text;
- sanitize and bound string IDs before writing discovery trace metadata;
- preserve numeric/null discovery IDs;
- add a mixed discovery/tool-call batch with a malicious string ID and verify all persisted diagnostics are redacted;
- add transport-error log fixtures for a non-user-profile Windows path and an arbitrary Unix path.

### Finding 7 — The Builder Report overstates acceptance coverage

Severity: P0 evidence integrity failure

The acceptance matrix records PASS for requirements that are absent or weaker than stated:

- Mandatory 2 omits the required toolbox write-action HTTP scope case.
- Mandatory 6 and Tests 31–33 do not prove response-ID-to-correlation association for duplicate calls.
- Mandatory 7 claims HTTP boundary coverage although `DISPATCHED_NOT_EXECUTED` remains a direct trace fixture only.
- Mandatory 5 and Tests 21–24 claim arbitrary path coverage while the sanitizer and tests cover selected prefixes.
- Test 11’s “mixed batch” contains write-denied calls only and does not test an authorized and denied `tools/call` together.

The report’s stated limitation for SDK identity is useful, but a limitation cannot be labeled PASS where the controlling Work Card defined it as a stop condition.

Required correction:

- replace the overstated rows with exact evidence;
- mark any unresolved boundary as blocked or failed;
- do not use broad suite success as evidence for an untested semantic condition.

## Documentation Accuracy

The registry distinction is materially improved:

- internal registered schema baseline: 31;
- ChatGPT-visible exposure: seven stable toolboxes plus the bounded image writer when permitted;
- internal legacy schemas are exposure-filtered rather than removed.

The documentation is not fully accurate because it currently claims:

- arbitrary absolute-path redaction;
- complete deterministic scope-denial classification;
- trustworthy malformed and duplicate-call correlation.

Those claims must be narrowed or corrected until Findings 1–6 are resolved.

## Required Next Repair Scope

A final bounded `WC-V1-0104A-REPAIR03` is required and must be limited to:

1. action-aware HTTP scope requirements for public toolbox calls;
2. per-call scope evaluation and truthful mixed-batch evidence;
3. proof or formal blocker disposition for duplicate-call response-ID association;
4. an actual HTTP `DISPATCHED_NOT_EXECUTED` fixture or approved architecture revision;
5. field-aware arbitrary absolute-path redaction;
6. shared sanitization for discovery IDs and HTTP error diagnostics;
7. corrected tests, documentation, and acceptance matrix.

Do not combine WC-V1-0202A into REPAIR03. Do not alter the 31-schema internal registry, public tool surface, OAuth semantics, write modes, patch workflow, Git workflow, workspace routing, runtime-drift work, packaging, Electron UI, or Figma behavior.

## Source-Control and Runtime Direction

Do not stage, commit, push, integrate, package, promote, restart, reconnect, publish, release, or perform live connector validation for REPAIR02.

Those actions remain blocked until the subsequent bounded repair receives Architect approval.

## Final Disposition

WC-V1-0104A-REPAIR02 disposition: RevisionRequested

Document.Status=RevisionRequested
