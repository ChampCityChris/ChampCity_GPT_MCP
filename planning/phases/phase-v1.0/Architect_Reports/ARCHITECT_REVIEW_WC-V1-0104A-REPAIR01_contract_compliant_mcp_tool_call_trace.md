# Architect Review — WC-V1-0104A-REPAIR01 Contract-Compliant MCP Tool-Call Trace Repair

Date: 2026-07-26
Repository: `ChampCityChris/ChampCity_GPT_MCP`
Workspace: `%USERPROFILE%\Projects\ChampCity_GPT`
Branch reviewed: `dev`
Starting HEAD reported by Implementer: `780217aa1046ad8d271d13887ba1121bba419362`
Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104A-REPAIR01_contract_compliant_mcp_tool_call_trace.md`
Work Card: `planning/phases/phase-v1.0/Work_Cards/WC-V1-0104A-REPAIR01_contract_compliant_mcp_tool_call_trace.md`
Disposition: RevisionRequested

## Executive Disposition

WC-V1-0104A-REPAIR01 is not approved for Git integration, packaging, runtime promotion, restart, reconnect, or live ChatGPT connector validation.

The repair correctly restores the pre-WC-V1-0104A internal registration baseline, removes `LEGACY_TOOL_REMOVED`, implements the approved `recent_tool_calls` parameter names and limits, adds per-call batch contexts for valid calls, separates helper policy codes from generic helper errors, and introduces bounded trace retention.

However, the implementation still fails required observability and redaction behavior at several boundaries. Passing typecheck, build, 322 unit tests, self-test, lint, and public scan does not cure these acceptance defects because the missing cases were not tested or were represented by weaker direct-trace fixtures rather than the required HTTP behavior.

## Repository State Reviewed

ChampCity MCP reported:

- Workspace: `champcity_gpt`
- Repository: `ChampCityChris/ChampCity_GPT_MCP`
- Branch: `dev`
- Worktree: dirty
- Tracked modified files: 17
- Untracked files before this review artifact: 19
- Staged files: 0
- Deleted files: 0

The review did not reset, restore, clean, stash, stage, commit, push, package, promote, restart, reconnect, publish, or release anything. The only repository write performed by this review is this Architect Review artifact.

## Confirmed Improvements

The following rejected-parent defects were materially corrected:

1. The registered internal schema catalog was restored to the pre-pass model rather than reduced to eight registered schemas.
2. `LEGACY_TOOL_REMOVED` and its migration classification were removed.
3. Direct non-public calls again receive the prior public-surface rejection.
4. `recent_tool_calls` now uses `limit`, `since`, `correlationId`, and `publicToolName`, with public validation defaulting to 20 and rejecting limits above 50.
5. The implementation enumerates multiple valid `tools/call` objects in a JSON-RPC batch and assigns separate correlation IDs.
6. `helper_denied` no longer automatically determines policy classification solely by stage.
7. Auth and scope denials no longer fabricate `dispatch_started` or `tool_result_returned`.
8. Trace persistence now attempts to retain at most 2,000 valid JSONL events.

These improvements are not sufficient for approval because the remaining findings affect the reliability and safety of the diagnostic evidence itself.

## Findings

### Finding 1 — Malformed `tools/call` requests receive no trace identity

Severity: P0 observability acceptance failure

The REPAIR01 Work Card requires every received JSON-RPC object whose method is `tools/call` to receive its own trace identity and summary.

`src/transports/httpTransport.ts` currently excludes a request unless all of the following are true before context creation:

- `method === "tools/call"`;
- `params` exists;
- `params` is an object;
- `params` is not an array.

A request such as a `tools/call` with missing, null, scalar, or array `params` is therefore omitted from `toolCallRequests`. It receives no `http_received` event and no correlation ID. The MCP SDK may reject that request before the public call handler, leaving precisely the unobservable pre-dispatch condition this Work Card was created to diagnose.

Required correction:

- Identify every JSON-RPC object with `method: "tools/call"` before validating `params`.
- Create a receipt context even when tool name, arguments, action, workspace, or path cannot be extracted.
- Add HTTP tests for missing `params`, null `params`, scalar `params`, array `params`, missing name, and malformed arguments.
- Confirm each malformed call is independently classified from actual server evidence.

### Finding 2 — OAuth scope denials are classified as `RECEIVED_NOT_DISPATCHED`, not `APP_POLICY_DENIED`

Severity: P0 diagnostic correctness failure

The Work Card explicitly requires structured scope denial to classify as `APP_POLICY_DENIED` without fabricating dispatcher or result stages.

Current behavior in `src/transports/httpTransport.ts`:

1. records `http_received`;
2. detects `mcpScopeDenial`;
3. returns HTTP 403;
4. records `http_response_completed`;
5. records no structured denial code on either trace event.

Current classification in `src/server/toolCallTrace.ts` sees no policy error code and no `dispatch_started`. It therefore returns `RECEIVED_NOT_DISPATCHED`.

This is a real code-path defect, not merely missing test coverage. The Builder Report’s Test 11 entry cites existing scope tests, but those tests verify only that the request is refused; they do not inspect the resulting trace classification.

Required correction:

- Record a structured scope-denial result on an actual stage that occurred, such as the receipt or HTTP-completion event, without inventing `dispatch_started` or `tool_result_returned`.
- Classify the affected call as `APP_POLICY_DENIED`.
- Add HTTP-level classification tests for `files.read` and `files.write` scope denials, including the top-level image writer and any other applicable exposed tool.

### Finding 3 — Caller-controlled string JSON-RPC IDs are unbounded and unredacted

Severity: P0 public diagnostic redaction failure

`safeJsonRpcId` returns any string unchanged. It applies neither `sanitizeTraceString` nor a maximum length.

JSON-RPC IDs are caller-controlled. A caller can therefore place any of the following in a string ID and have it persisted and returned through `recent_tool_calls`:

- a full private or public URL;
- an absolute local path;
- a token or credential-looking value;
- file or prompt content;
- an oversized string that defeats the intended bounded metadata contract.

The Work Card permits JSON-RPC IDs only when safely representable and separately prohibits secrets, full URLs, absolute paths, unrestricted content, and unbounded diagnostic fields.

Required correction:

- Sanitize and length-bound string JSON-RPC IDs before persistence and output.
- Preserve numeric and null IDs as-is.
- Add tests with URL, path, token, content, control-character, and oversized string IDs.

### Finding 4 — Operational failures remain incorrectly listed as policy-denial codes

Severity: P0 classification failure

The policy-code sets in both `src/server/toolCallTrace.ts` and `src/tools/common.ts` include:

- `DOWNLOAD_TIMED_OUT`;
- `DOWNLOAD_FAILED`;
- `VERIFICATION_FAILED`.

These codes can represent operational execution failures rather than caller policy violations. Under the current classifier, a timed-out network operation, failed download, or post-write verification failure can be reported as `APP_POLICY_DENIED`.

This repeats the central semantic defect from the rejected parent pass in a narrower form. The direct classification test uses `UNKNOWN_ERROR` as the execution fixture and does not exercise real operational AppError codes.

Required correction:

- Define one shared, reviewed policy-denial predicate rather than duplicating code sets in trace and audit modules.
- Limit policy classification to actual scope, validation, path, file-policy, write-mode, workspace, and approval denials.
- Treat transport, download, process, I/O, parsing, and verification failures as execution errors unless a specific code is unambiguously policy-only.
- Add a table-driven test covering every AppError code used by traced helpers.

### Finding 5 — Absolute-path redaction is incomplete

Severity: P1 security and evidence defect

The sanitizer redacts selected Windows user/temp paths and selected Unix user/temp paths. It does not redact arbitrary absolute paths such as:

- `D:\Projects\Private\file.md`;
- `C:\ProgramData\Private\file.md`;
- `/srv/private/file.md`;
- `/opt/private/file.md`;
- other configured workspace roots outside a user-profile path.

The Work Card prohibits absolute repository, private local, user-profile, AppData, and temp paths. The current redaction test uses the test framework’s temporary root, which exercises only a covered temp/user-path pattern and does not prove general absolute-path redaction.

Required correction:

- Redact arbitrary Windows drive-absolute and UNC paths.
- Redact arbitrary Unix absolute paths where returned as diagnostic error text, while preserving specifically authorized route-only values such as `/mcp`.
- Add fixtures for non-user-profile drive paths, UNC paths, and non-home Unix paths.

### Finding 6 — Batch correlation does not prove correct JSON-RPC ID association for duplicate calls

Severity: P1 evidence gap

The transport creates contexts with JSON-RPC IDs, but the SDK call handler does not receive that ID. `runWithSelectedToolCallTraceContext` selects a context by public tool, action, workspace ID, and requested path, then mutates a shared `claimed` flag. If two batch entries have the same tool, action, workspace, and path, context association depends on SDK handler invocation order.

The existing batch test uses two different tools and therefore does not prove correct association for duplicate or near-duplicate calls. The Work Card requires each contained call to remain identifiable by its own JSON-RPC ID.

Required correction or evidence:

- Add duplicate-call batch tests with distinct JSON-RPC IDs and identical tool metadata.
- Add reversed-completion or delayed-handler fixtures where feasible.
- Demonstrate that lifecycle events remain attached to the correct request ID, or replace metadata-order claiming with an SDK-supported request identity mechanism.

### Finding 7 — The acceptance matrix overstates required deterministic coverage

Severity: P0 evidence failure

The Builder Report states that every required deterministic test passed, but several entries do not map to the required behavior:

- Test 9 requires an HTTP receipt followed by a pre-dispatch failure. The cited evidence is a direct trace fixture and general auth/scope tests that do not assert trace classification.
- Test 11 includes scope denial classification. No scope-denial trace classification assertion exists, and the implementation is incorrect.
- Test 17 refers to older JSONL or audit entries. The cited test covers only a minimal trace line, not backward-compatible audit entries.
- Test 19 requires trace-write or compaction-failure tolerance. The test makes the log parent invalid before trace creation; it does not exercise a compaction failure after a valid append.
- Test 21 claims broad path and diagnostic-field redaction, but does not cover arbitrary absolute paths or caller-controlled JSON-RPC IDs.

Required correction:

- Replace indirect or weaker fixtures with tests that exercise the actual HTTP and persistence boundaries specified by the Work Card.
- Revise the Builder Report matrix so every row names the exact assertion that proves the requirement.

### Finding 8 — Documentation still contains contradictory registry claims and rejected-pass residue

Severity: P1 documentation and scope defect

The current documentation simultaneously states that legacy implementation functions remain registered internally and that no other top-level MCP tools are registered. It also describes self-test coverage for “removed legacy facade schemas” even though REPAIR01 restored the 31-schema internal registry baseline.

Examples remain in:

- `docs/SECURITY_MODEL.md`;
- `docs/TOOL_REFERENCE.md`.

The worktree also retains rejected-pass route rewrites in `docs/CHATGPT_CONNECTION_GUIDE.md` and `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md` that were not listed as REPAIR01 changes or explicitly dispositioned in the Builder Report.

Required correction:

- Clearly distinguish internal registered schemas from the ChatGPT-visible exposed surface.
- Remove statements that claim legacy schemas are removed when they are registered but exposure-filtered.
- Identify and either revert or explicitly justify every surviving documentation hunk introduced by the rejected parent pass.

## Builder Report Accuracy

The Builder Report accurately reports repository identity, dirty-state preservation, local validation commands, and the absence of packaging, promotion, restart, reconnect, and live validation.

The report is not accurate in claiming complete acceptance coverage. The scope-denial classification defect is directly contradicted by the implementation, malformed calls are not traced, JSON-RPC IDs are not redacted, and several test-matrix entries cite indirect evidence that does not test the required boundary.

## Required Repair Scope

A bounded `WC-V1-0104A-REPAIR02` pass is required. It must be limited to:

1. tracing malformed `tools/call` receipts;
2. correctly classifying scope denials without fabricated stages;
3. sanitizing and bounding string JSON-RPC IDs;
4. centralizing and correcting policy-versus-execution error classification;
5. completing arbitrary absolute-path redaction;
6. proving duplicate-call batch ID association;
7. adding the missing HTTP, audit-compatibility, and compaction-failure tests;
8. correcting contradictory or residual documentation;
9. issuing a corrected acceptance-criterion-to-test matrix.

Do not combine the separately approved greenfield planning-write Work Card into REPAIR02. `WC-V1-0202A` remains a separate subsequent implementation because it touches shared toolbox/configuration areas and should not be intermingled with trace repair.

## Source-Control and Runtime Direction

Do not stage, commit, push, integrate, package, promote, restart, reconnect, publish, release, or perform live connector validation for REPAIR01.

Those actions remain blocked until the subsequent bounded repair receives Architect approval.

## Final Disposition

WC-V1-0104A-REPAIR01 disposition: RevisionRequested

Document.Status=RevisionRequested
