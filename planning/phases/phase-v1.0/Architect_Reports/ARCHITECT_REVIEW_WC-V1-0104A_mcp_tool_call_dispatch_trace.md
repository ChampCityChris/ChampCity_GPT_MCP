# Architect Review — WC-V1-0104A MCP Tool-Call Dispatch Trace

Date: 2026-07-26
Repository: `ChampCityChris/ChampCity_GPT_MCP`
Workspace: `%USERPROFILE%\Projects\ChampCity_GPT`
Branch reviewed: `dev`
Base HEAD reported by Implementer: `780217aa1046ad8d271d13887ba1121bba419362`
Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104A_mcp_tool_call_dispatch_trace.md`
Work Card: `planning/phases/phase-v1.0/Work_Cards/WC-V1-0104A_mcp_tool_call_dispatch_trace.md`
Disposition: RevisionRequested

## Executive Disposition

WC-V1-0104A is not approved for Git integration, packaging, runtime promotion, or live connector validation.

The implementation establishes a plausible correlation architecture using `AsyncLocalStorage`, a dedicated JSONL trace, HTTP/dispatcher/toolbox/helper stages, and a read-only diagnostics action. However, several Work Card and Implementer Prompt requirements are either implemented incorrectly, omitted, or replaced with an unauthorized adjacent redesign. Passing local validation does not cure these acceptance defects.

No repository or Git mutation beyond creation of this Architect Review was authorized or performed by this review.

## Repository State Reviewed

ChampCity MCP reported:

- Workspace: `champcity_gpt`
- Repository: `ChampCityChris/ChampCity_GPT_MCP`
- Branch: `dev`
- Worktree: dirty
- Tracked modified files: 17
- Untracked files: 11
- Staged files: 0
- Deleted files: 0

The review treated the existing dirty worktree as authoritative and did not reset, restore, clean, stash, stage, commit, push, package, promote, or release anything.

## Findings

### Finding 1 — Required `recent_tool_calls` contract was not implemented

Severity: P0 acceptance failure

The approved Work Card requires:

- `limit`: default 20, minimum 1, maximum 50
- `since`: optional ISO-8601 timestamp
- `correlationId`: optional exact filter
- `publicToolName`: optional exact tool-name filter

The implementation instead defines:

- `limit`: default 25, maximum 100
- no `since` parameter
- `publicTool` instead of `publicToolName`
- an additional `action` filter not specified by the Work Card

Affected code:

- `src/tools/domainToolboxes.ts`
- `src/server/toolCallTrace.ts`
- `docs/TOOL_REFERENCE.md`
- `docs/SECURITY_MODEL.md`
- `tests/httpTransport.test.ts`

This is not a naming-only issue. The required operator-supplied time-window workflow for `NO_SERVER_RECEIPT_EVIDENCE` is absent. The implementation and tests validate a different interface from the approved interface.

Required correction:

1. Implement `since` with strict ISO-8601 validation and event filtering.
2. Use the approved `publicToolName` field unless the Work Card is explicitly revised by the Operator.
3. Enforce default 20 and maximum 50.
4. Remove or separately authorize the additional `action` filter.
5. Update documentation and tests to the approved contract.

### Finding 2 — Batch JSON-RPC requests trace only the first `tools/call`

Severity: P0 observability failure

`src/transports/httpTransport.ts` uses `firstToolCallRequest`, which returns after finding the first `tools/call` in a JSON-RPC batch. Only that first call receives HTTP receipt metadata and a correlation context.

The Implementer Prompt explicitly requires safe batch handling and states that each contained `tools/call` must remain identifiable by JSON-RPC ID and public tool name. The current implementation silently omits later calls from the batch, so it cannot satisfy the requirement that every received public tool call be traceable.

Required correction:

- Parse all `tools/call` entries in a batch.
- Ensure each call is identifiable and correlated through dispatcher/result evidence.
- Add deterministic multi-call batch coverage, including mixed discovery/tool-call batches and multiple tool calls in one batch.

### Finding 3 — Helper execution failures are misclassified as application-policy denials

Severity: P0 diagnostic correctness failure

`withAudit` records `helper_denied` for every exception thrown by a helper. `classify` then gives `helper_denied` unconditional precedence as `APP_POLICY_DENIED`.

This means ordinary execution failures at the helper layer, including file-system or unexpected runtime failures, can be reported as policy denials. The Work Card requires the diagnostics to distinguish application policy/validation denial from application execution error.

Affected code:

- `src/tools/common.ts`
- `src/server/toolCallTrace.ts`

Required correction:

- Distinguish helper policy denial from helper execution error, either through separate stages or reliable structured error-code classification.
- Do not classify every helper exception as `APP_POLICY_DENIED`.
- Add tests proving that a policy/path/write-mode denial is `APP_POLICY_DENIED` and a non-policy helper failure is `APP_EXECUTION_ERROR`.

### Finding 4 — Registered tool schemas were redesigned outside the authorized trace scope

Severity: P0 protected-scope violation

The Implementer Prompt states: “Do not change current tool names, tool count, schemas, scope behavior, or write-mode behavior.”

The implementation removes numerous legacy definitions from the `tools` registration array, changes registry/self-test assumptions, adds `LEGACY_TOOL_REMOVED` migration behavior, and updates broad documentation and acceptance-matrix routes around that redesign.

The public ChatGPT-visible surface may still resolve to the same seven toolboxes plus the image writer, but the registered schema catalog and dispatcher behavior were materially changed. This is an MCP discovery/exposure redesign, not a necessary implementation detail of correlated tracing.

Affected code and documentation include:

- `src/server/registerTools.ts`
- `src/validation/mcpSelfTest.ts`
- `tests/toolSchema.test.ts`
- `tests/httpTransport.test.ts`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `docs/RELEASE_NOTES.md`
- `docs/SECURITY_MODEL.md`
- `docs/TOOL_REFERENCE.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`

Required correction:

- Revert the unapproved registry/schema removal and migration redesign from this Work Card, preserving the pre-pass behavior.
- Implement tracing around the existing dispatcher behavior.
- If permanent removal of internally registered legacy schemas is desired, create a separate Architect-approved Work Card with explicit discovery, compatibility, migration, and live-validation acceptance criteria.

### Finding 5 — Required deterministic tests are missing

Severity: P0 evidence failure

The Builder Report records passing typecheck, build, lint, unit, self-test, public scan, and diff checks. Those results are useful but do not demonstrate all card-specific acceptance criteria.

Required coverage not demonstrated in the implementation diff includes:

- `since` filtering
- default 20 and maximum 50 limit enforcement
- time-window-based `NO_SERVER_RECEIPT_EVIDENCE`
- HTTP receipt followed by dispatcher failure
- dispatcher entry without toolbox/helper execution
- helper/application execution failure classified as `APP_EXECUTION_ERROR`
- `RESULT_RETURNED` without HTTP completion
- concurrent calls receiving distinct correlation IDs
- compatibility with older JSONL/audit entries
- multi-call JSON-RPC batch handling
- no change to current registered tool names, count, and schemas
- redaction of private/public tunnel URLs

Required correction:

Add deterministic tests for every Work Card and Implementer Prompt requirement. The repair report must map each acceptance criterion to a test name and result.

### Finding 6 — Trace redaction does not cover prohibited private/public URLs

Severity: P1 security/evidence defect

The Work Card prohibits public tunnel URLs and private URLs in diagnostic output. `sanitizeTraceString` redacts selected filesystem paths and credential patterns but does not redact general `http://` or `https://` URLs.

An exception message containing a Cloudflare tunnel URL or another private endpoint could therefore be persisted and returned through `recent_tool_calls`.

Required correction:

- Add bounded URL redaction appropriate to the project’s public-safety rules.
- Add explicit tests for Cloudflare/public tunnel URLs, localhost URLs where appropriate, URLs containing credentials/query secrets, and private endpoint values.

### Finding 7 — Several recorded stages do not represent the stage that actually occurred

Severity: P1 diagnostic semantics defect

The transport records `tool_result_returned` for authentication and scope denials even though the public tool handler did not return a tool result. This weakens the “deepest observed stage” evidence model.

The classifier also maps `toolbox_entered`, `helper_started`, and `helper_allowed` without a returned result to `DISPATCHED_NOT_EXECUTED`, even though those stages prove some execution occurred.

Required correction:

- Record the actual deepest stage without fabricating a later stage.
- Define deterministic precedence for auth denial, scope denial, dispatch failure, toolbox validation denial, helper policy denial, helper execution error, returned result, and completed response.
- Add focused classification tests for each boundary.

### Finding 8 — The trace file is append-only and not storage-bounded

Severity: P1 operational defect

The reader limits processing to the last 2,000 lines, but `recordToolCallTrace` appends indefinitely to `mcp-tool-call-trace.ndjson`. The implementation therefore bounds reads, not trace storage.

The Work Card requires a bounded trace. Unless project policy explicitly defines “bounded” as output-only, the persistent trace needs rotation, truncation, or another deterministic retention limit.

Required correction:

- Implement a deterministic retention bound or document and obtain approval for an output-only interpretation.
- Add tests for retention behavior and corrupt-line tolerance.

## Builder Report Accuracy

The Builder Report accurately states that live ChatGPT connector validation, packaging, and runtime promotion were not performed. Those omissions are expected under this Work Card and are not the basis for rejection.

The report is not sufficient to support approval because it presents the changed parameter contract and tool-registry redesign as completed implementation rather than scope deviations. It also states that no local implementation blocker remains, although the approved acceptance contract is not met.

## Required Repair Scope

The next Implementer pass must be a bounded repair of WC-V1-0104A. It must:

1. Preserve the existing dirty worktree and identify the exact patch attributable to WC-V1-0104A.
2. Restore the pre-pass registered tool schema/catalog behavior unless a separate Work Card authorizes the redesign.
3. Implement the exact `recent_tool_calls` contract from the Work Card.
4. trace every `tools/call`, including each call in a batch.
5. Correct policy-versus-execution classification.
6. Correct stage semantics.
7. complete URL and private-endpoint redaction.
8. Make trace retention deterministically bounded or obtain an explicit architecture revision.
9. Add all missing deterministic tests.
10. Re-run the required Windows validation lane and produce an acceptance-criterion-to-test matrix.

## Source-Control and Runtime Direction

Do not stage, commit, push, package, promote, restart, reconnect, or perform live connector validation for this implementation.

Those actions remain blocked until the repaired Builder Report receives Architect approval.

## Final Disposition

WC-V1-0104A disposition: RevisionRequested

Document.Status=RevisionRequested
