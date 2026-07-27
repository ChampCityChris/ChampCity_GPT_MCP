# Builder Report - WC-V1-0104A-REPAIR02 Trace Boundary, Classification, Redaction, and Evidence Repair

Date: 2026-07-26
Repository: `ChampCityChris/ChampCity_GPT_MCP`
Workspace: `%USERPROFILE%\Projects\ChampCity_GPT`
Branch: `dev`
Starting HEAD: `780217aa1046ad8d271d13887ba1121bba419362`

## Repository Verification

- `Get-Location`: `%USERPROFILE%\Projects\ChampCity_GPT`
- `git rev-parse --show-toplevel`: `%USERPROFILE%/Projects/ChampCity_GPT`
- `git branch --show-current`: `dev`
- `git rev-parse HEAD`: `780217aa1046ad8d271d13887ba1121bba419362`
- `git remote -v`: `https://github.com/ChampCityChris/ChampCity_GPT_MCP.git`
- `package.json`: present
- `AGENTS.MD`: read before editing
- `docs/dev/VALIDATION_COMMAND_LANES.md`: read before validation

## Starting Dirty State

Starting `git status --short` showed intermingled parent, REPAIR01, runtime-drift, promotion-provenance, documentation, planning, Architect-review, and untracked work. Existing dirty files included runtime promotion files, REPAIR01 trace files, and planning artifacts.

Preservation method:

- inspected the controlling Work Cards, REPAIR01 Builder Report, and Architect Review before editing;
- inspected target diffs before modifying tracked files;
- made surgical patches only in the trace, transport, shared classification, tests, and trace-related documentation;
- did not reset, clean, stash, restore, stage, commit, push, package, promote, restart, reconnect, publish, or release;
- did not modify `scripts/promote-runtime-exe.mjs` or `tests/promoteRuntimeProvenance.test.ts`.

## Files Changed By REPAIR02

- `src/server/toolCallTrace.ts`
- `src/tools/common.ts`
- `src/transports/httpTransport.ts`
- `src/utils/errorClassification.ts`
- `tests/httpTransport.test.ts`
- `tests/toolCallTrace.test.ts`
- `docs/RELEASE_NOTES.md`
- `docs/SECURITY_MODEL.md`
- `docs/TOOL_REFERENCE.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104A-REPAIR02_trace_boundary_classification_redaction_evidence.md`

Pre-existing dirty files outside this list were preserved and not intentionally changed by REPAIR02.

## Implementation Summary

- Malformed receipt: `src/transports/httpTransport.ts` now creates a trace context for every parsed JSON-RPC object with `method: "tools/call"` before validating `params`, `name`, or `arguments`. Missing or malformed metadata remains undefined; malformed calls are not made executable.
- Scope denial: HTTP OAuth scope denials now record `http_received`, then `http_response_completed` with `result: "deny"` and `errorCode: "OAUTH_SCOPE_DENIED"`. No dispatch, toolbox, helper, or result stages are fabricated.
- JSON-RPC ID sanitization: numeric IDs and null remain unchanged; string IDs are sanitized through the diagnostic redaction path, control-normalized, and capped to 128 characters at write and read time.
- Shared classification: `src/utils/errorClassification.ts` is the single policy/execution/transport classification authority used by helper tracing and final trace classification. `DOWNLOAD_TIMED_OUT`, `DOWNLOAD_FAILED`, `VERIFICATION_FAILED`, and `PROCESS_FAILED` classify as execution failures. Unknown codes default to execution.
- Absolute-path redaction: diagnostic strings and caller-controlled string IDs redact arbitrary Windows drive paths, UNC paths, extended-length paths, and Unix absolute paths under `/srv`, `/opt`, `/var`, `/mnt`, and related mounted roots. Route fields such as `/mcp` and `/health` remain structured route values.
- Duplicate batch identity: the SDK handler surface does not expose JSON-RPC request IDs to `CallToolRequestSchema` handlers. The implementation therefore preserves REPAIR01's deterministic request-group sequence association and now proves duplicate and triplicate identical batch calls retain distinct correlation IDs and correct sanitized JSON-RPC IDs. Limitation: this is a deterministic SDK batch-order guarantee, not a stronger SDK request-ID binding.
- Persistence tolerance: append failures and post-append compaction replacement failures are caught and do not fail the underlying MCP call. Corrupt and partial trace lines are ignored; temporary compaction files are not read by diagnostics; retention remains capped at 2,000 newest valid events after cleanup.
- WC-V1-0202A: no `writePolicy`, `artifact_only`, `artifactWriteRoots`, greenfield workspace, or planning-write implementation appears in the REPAIR02 diff.

## Documentation Disposition

- `docs/CHATGPT_CONNECTION_GUIDE.md`: inspected; existing toolbox-name hunks are accurate and retained. No REPAIR02 edit.
- `docs/RELEASE_NOTES.md`: retained runtime-drift/provenance note; corrected trace note to mention malformed receipt, scope-denial classification, JSON-RPC ID sanitization, arbitrary absolute-path redaction, and the restored 31-schema internal baseline.
- `docs/SECURITY_MODEL.md`: retained runtime-drift/provenance content; corrected registry/self-test language to 31 internal schemas and exposure-filtered legacy helpers; added malformed receipt, scope-denial, JSON-RPC ID, and arbitrary-path redaction details.
- `docs/TOOL_REFERENCE.md`: corrected contradictory "no other top-level MCP tools are registered" and "removed legacy facade schemas" language; documented 31 internal schemas, seven toolbox tools, bounded image writer, direct non-public rejection, and `recent_tool_calls` redaction/classification behavior.
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`: retained NOT_RUN live validation status; clarified 31 internal schemas versus ChatGPT-visible exposure and added trace/redaction evidence expectations.

## Acceptance-Criterion-To-Test Matrix

| Requirement | Test file and test name | Assertion or boundary proven | Command | Result | Limitation |
|---|---|---|---|---|---|
| Mandatory 1 malformed receipt | `tests/httpTransport.test.ts` - `records http_received evidence for malformed tools/call variants before SDK rejection` | every malformed `tools/call` variant receives `http_received` and distinct correlation ID | `node --test dist/tests/toolCallTrace.test.js dist/tests/httpTransport.test.js` | PASS | local HTTP/SDK path |
| Mandatory 2 scope denial | `tests/httpTransport.test.ts` - missing files.read/write scope tests | scope denials classify `APP_POLICY_DENIED` without dispatch/toolbox/result stages | focused HTTP tests | PASS | local OAuth fixtures only |
| Mandatory 3 JSON-RPC IDs | `tests/toolCallTrace.test.ts` - `sanitizes malicious and oversized string JSON-RPC IDs while preserving numeric and null IDs` | numeric/null preserved; unsafe string IDs redacted and capped | focused trace tests | PASS | representative malicious classes |
| Mandatory 4 shared classification | `tests/toolCallTrace.test.ts` - `classifies every defined AppErrorCode through the shared authority` | one table covers every `AppErrorCode`; unknown defaults execution | focused trace tests | PASS | table must be updated with future codes |
| Mandatory 5 absolute paths | `tests/toolCallTrace.test.ts` - arbitrary path redaction test | Windows, UNC, extended, Unix, and mounted absolute paths redacted; routes preserved | focused trace tests | PASS | route preservation limited to structured route fields |
| Mandatory 6 duplicate identity | duplicate and triplicate HTTP batch tests | identical calls retain distinct correlation IDs and correct JSON-RPC IDs | focused HTTP tests | PASS | SDK exposes no handler request ID; deterministic order association only |
| Mandatory 7 HTTP boundaries | malformed, scope, dispatcher-schema, transport, and compaction HTTP tests | required boundaries are exercised over HTTP where feasible | focused HTTP tests | PASS | result-without-HTTP-completion remains direct-trace evidence only |
| Mandatory 8 audit/persistence | audit compatibility, corrupt-line, append failure, compaction failure, temp-file, retention tests | old lines parse/ignore safely; failures do not fail calls; retention capped | focused trace/HTTP tests | PASS | local filesystem fixtures |
| Mandatory 9 docs/evidence | documentation diff disposition in this report | contradictory registry and trace claims corrected; live CAV not marked passed | docs inspection plus `npm run check:public` | PASS | Architect must review wording |
| Test 1 valid non-batch lifecycle | `records correlated successful repo_toolbox.read_file lifecycle and helper audit events` | receipt, dispatch, toolbox, helper, result, response, audit correlation | focused HTTP tests | PASS | local HTTP |
| Test 2 missing params | malformed variants test | `id: missing-params` receives `http_received` | focused HTTP tests | PASS | SDK rejection details not asserted |
| Test 3 null params | malformed variants test | `id: null-params` receives `http_received` | focused HTTP tests | PASS | local HTTP |
| Test 4 scalar params | malformed variants test | `id: scalar-params` receives `http_received` | focused HTTP tests | PASS | local HTTP |
| Test 5 array params | malformed variants test | `id: array-params` receives `http_received` with undefined public tool | focused HTTP tests | PASS | local HTTP |
| Test 6 missing/non-string name | malformed variants test | missing and non-string names receive receipt evidence | focused HTTP tests | PASS | metadata intentionally undefined |
| Test 7 malformed arguments | malformed variants test | missing/null/scalar/array arguments receive receipt evidence | focused HTTP tests | PASS | scalar args additionally prove pre-dispatch rejection |
| Test 8 malformed batch IDs | malformed variants test | 10 malformed batch calls get 10 distinct correlation IDs | focused HTTP tests | PASS | local batch |
| Test 9 missing files.read | `classifies missing files.read HTTP scope denial as APP_POLICY_DENIED without dispatch stages` | 403 scope denial has `OAUTH_SCOPE_DENIED`, no dispatch/toolbox/result | focused HTTP tests | PASS | local OAuth token |
| Test 10 missing files.write | `classifies missing files.write HTTP scope denial for workspace_write_attached_image` | image writer scope denial is `APP_POLICY_DENIED` | focused HTTP tests | PASS | download not attempted |
| Test 11 mixed batch scope denial | `records independent scope-denial evidence for mixed batch tool calls` | each denied batch call has independent correlation and scope code | focused HTTP tests | PASS | whole HTTP batch denied at scope gate |
| Test 12 numeric JSON-RPC ID | JSON-RPC ID sanitizer test | numeric ID `42` preserved | focused trace tests | PASS | direct trace |
| Test 13 null JSON-RPC ID | JSON-RPC ID sanitizer test | null ID preserved | focused trace tests | PASS | direct trace |
| Test 14 safe short string ID | JSON-RPC ID sanitizer test | `safe-request-123` preserved | focused trace tests | PASS | direct trace |
| Test 15 URL string ID | JSON-RPC ID sanitizer test | URL/query content removed from ID | focused trace tests | PASS | representative URL |
| Test 16 token string ID | JSON-RPC ID sanitizer test | token-looking value removed from ID | focused trace tests | PASS | representative token key |
| Test 17 absolute-path string ID | JSON-RPC ID sanitizer test | Windows, UNC, Unix absolute-path IDs redacted | focused trace tests | PASS | representative paths |
| Test 18 keyed content ID | JSON-RPC ID sanitizer test | `patch=`, `content=`, `prompt=` text redacted | focused trace tests | PASS | keyed forms only |
| Test 19 control characters ID | JSON-RPC ID sanitizer test | CR/LF/control/tab normalized to spaces | focused trace tests | PASS | direct trace |
| Test 20 oversized ID | JSON-RPC ID sanitizer test | string ID length capped to 128 | focused trace tests | PASS | direct trace |
| Test 21 Windows drive paths | arbitrary path redaction test | `D:\...` and `C:\ProgramData\...` removed | focused trace tests | PASS | diagnostic string context |
| Test 22 UNC paths | arbitrary path redaction test | `\\server\share\...` removed | focused trace tests | PASS | diagnostic string context |
| Test 23 Unix paths | arbitrary path redaction test | `/srv`, `/opt`, `/var`, `/mnt` paths removed | focused trace tests | PASS | representative roots |
| Test 24 route fields | arbitrary path redaction test | `/mcp` and `/health` retained as route fields | focused trace tests | PASS | free-form arbitrary routes are not exempt |
| Test 25 every AppErrorCode | shared authority test | table expectation covers every current code | focused trace tests | PASS | future-code maintenance required |
| Test 26 DOWNLOAD_TIMED_OUT | shared authority test | classified `execution` | focused trace tests | PASS | direct classification |
| Test 27 DOWNLOAD_FAILED | shared authority test | classified `execution` | focused trace tests | PASS | direct classification |
| Test 28 VERIFICATION_FAILED | shared authority test | classified `execution` | focused trace tests | PASS | direct classification |
| Test 29 PROCESS_FAILED | shared authority test | classified `execution` | focused trace tests | PASS | direct classification |
| Test 30 unknown code | shared authority test | unknown code defaults execution | focused trace tests | PASS | direct classification |
| Test 31 two duplicate calls | `keeps correct JSON-RPC IDs for two identical valid batch calls` | two identical calls retain distinct/correct IDs and response classifications | focused HTTP tests | PASS | deterministic SDK order association |
| Test 32 three duplicate calls | `keeps correct JSON-RPC IDs for three identical valid batch calls` | triplicate identical calls do not cross-associate IDs | focused HTTP tests | PASS | deterministic SDK order association |
| Test 33 delayed/reversed fixture | duplicate batch tests plus SDK type inspection | SDK handler has no JSON-RPC ID; no stronger reversed-completion guarantee claimed | SDK type inspection; focused HTTP tests | PASS with limitation | delayed/reversed not separately supported by current handler surface |
| Test 34 HTTP malformed rejection | malformed variants test | malformed calls remain `RECEIVED_NOT_DISPATCHED` or traced from HTTP evidence | focused HTTP tests | PASS | exact SDK error body not asserted |
| Test 35 dispatcher/schema rejection | malformed variants test | scalar arguments are rejected before dispatch/toolbox and classified `RECEIVED_NOT_DISPATCHED` | focused HTTP tests | PASS | local SDK schema path |
| Test 36 old trace line | `ignores corrupt and partial trace lines while preserving older minimal entries`; `sanitizes old persisted trace lines when read` | old/minimal lines readable or safe; old unsafe fields sanitized | focused trace tests | PASS | JSONL fixtures |
| Test 37 old audit line | `keeps old audit lines parseable and appends later correlated audit entries` | old audit line without correlation parses; later correlated append succeeds | focused trace tests | PASS | append-only audit check |
| Test 38 corrupt/partial trace | corrupt/minimal trace test | corrupt and partial trace lines ignored safely | focused trace tests | PASS | JSONL fixtures |
| Test 39 append failure | `does not fail a successful tool call when trace writing fails` | invalid trace parent does not fail MCP call | focused HTTP tests | PASS | append cannot start in this fixture |
| Test 40 compaction failure | `does not fail a successful HTTP tool call when post-append trace compaction fails`; direct compaction test | append succeeds, replacement fails, MCP call still succeeds | focused HTTP/trace tests | PASS | monkey-patched rename failure |
| Test 41 retention after cleanup | `keeps retention capped after corrupt-line cleanup` | corrupt cleanup retains newest 2,000 valid events | focused trace tests | PASS | local JSONL fixture |
| Test 42 registry baseline | `tests/toolSchema.test.ts` registry tests; MCP self-test | internal registered schema count remains 31 | `npm run validate:codex:unit`; `npm run mcp:self-test -- --json` | PASS | local deterministic |
| Test 43 public exposure | `tests/toolSchema.test.ts`; HTTP discovery tests | seven toolbox tools plus scoped image writer; legacy tools hidden | unit lane and self-test | PASS | live ChatGPT not run |
| Test 44 existing behavior | broader unit lane | OAuth, session, workspace, write-mode, patch, Git tests remain passing | `npm run validate:codex:unit` | PASS, 338 tests | local deterministic |
| Test 45 no WC-V1-0202A | direct repo search | prohibited REPAIR02 implementation/config terms absent from source, tests, docs, and acceptance matrix | `rg -n "writePolicy|artifact_only|artifactWriteRoots|greenfield workspace|WC-V1-0202A" src tests docs planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md` | PASS, no matches | Work Cards and Builder Reports intentionally excluded because they name the prohibited scope for documentation |

## Validation Results

Execution lane: approved normal Windows validation lane for child-process-capable commands. No sandbox-only `spawn EPERM` failure occurred.

| Command | Lane | Result |
|---|---|---|
| `npm run typecheck` | normal Windows | PASS |
| `npm run build` | normal Windows | PASS |
| `node --test dist/tests/toolCallTrace.test.js dist/tests/httpTransport.test.js` | normal Windows | PASS, 66 tests |
| `npm run validate:codex:unit` | normal Windows wrapper | PASS, 338 tests |
| `npm run mcp:self-test -- --json` | normal Windows | PASS, 22 checks; registeredToolCount 31 |
| `npm run check:public` | normal Windows | PASS, 204 source candidate files |
| `npm run lint` | normal Windows | PASS |
| `git diff --check` | local Git check | PASS |

Validation not performed:

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

## Final Dirty State

Final dirty state remains intentionally dirty with intermingled pre-existing work and REPAIR02 changes. Staged files: none. Deleted files: none.

REPAIR02 did not stage, commit, push, merge, integrate, tag, package, promote, publish, release, restart, reconnect, or perform live validation.

## Blockers And Assumptions

No implementation blocker remains for the deterministic local acceptance evidence.

Assumption: live ChatGPT visibility, host-side safety-layer behavior, and runtime package behavior require the later separately authorized Architect review, integration, package/promote, restart/reconnect, and live validation passes.

Limitation: the installed MCP SDK request handler receives validated request params plus handler extra, but not the JSON-RPC request ID for the normal `CallToolRequestSchema` handler. Duplicate-call identity is therefore proven by deterministic parsed-batch order to SDK handler order, not by a stronger SDK-provided request-ID binding.

WC-V1-0202A was untouched.

No fallback implementation was used.

Document.Status=ImplementedPendingArchitectReview
