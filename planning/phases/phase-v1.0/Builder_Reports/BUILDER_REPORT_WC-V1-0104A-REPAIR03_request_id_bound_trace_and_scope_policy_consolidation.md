# Builder Report - WC-V1-0104A-REPAIR03 Final Closure: Request-ID-Bound Trace and Scope-Policy Consolidation

Date: 2026-07-27
Repository: `ChampCityChris/ChampCity_GPT_MCP`
Workspace: `%USERPROFILE%\Projects\ChampCity_GPT`
Branch: `dev`
Starting HEAD: `780217aa1046ad8d271d13887ba1121bba419362`
Closure disposition: `ImplementedPendingArchitectReview`

## Repository Verification

- `pwd`: `%USERPROFILE%\Projects\ChampCity_GPT`
- `git rev-parse --show-toplevel`: `%USERPROFILE%/Projects/ChampCity_GPT`
- `git branch --show-current`: `dev`
- `git rev-parse HEAD`: `780217aa1046ad8d271d13887ba1121bba419362`
- `git remote -v`: `https://github.com/ChampCityChris/ChampCity_GPT_MCP.git`
- `package.json`: present
- `AGENTS.MD`: read before edits
- `docs/dev/VALIDATION_COMMAND_LANES.md`: read before validation

Repository identity matched the required project and remote.

## Dirty State

Starting dirty state contained intermingled WC-V1-0104A work, prior REPAIR reports/reviews, runtime-drift and promotion-provenance work, documentation edits, planning artifacts, and untracked trace modules/tests.

Final dirty state remains dirty and unstaged by design. No reset, clean, stash, restore, checkout-discard, stage, commit, push, merge, integrate, package, promote, restart, reconnect, publish, or release was performed.

Preservation method:

- Read the controlling Work Cards, Architect Reviews, RCA, prior Builder Reports, `AGENTS.MD`, validation lane, and current target-file diffs before editing.
- Treated the current source tree as the implementation baseline.
- Patched only WC-V1-0104A trace/transport/dispatcher/test/report hunks.
- Preserved unrelated runtime-drift, promotion-provenance, planning, and documentation work.
- Did not modify `scripts/promote-runtime-exe.mjs`, `tests/promoteRuntimeProvenance.test.ts`, Electron UI, packaging/release configuration, or WC-V1-0202A/B implementation.

## Files Changed During This Closure Pass

- `src/server/toolCallTrace.ts`
- `src/transports/httpTransport.ts`
- `src/server/registerTools.ts`
- `tests/httpTransport.test.ts`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104A-REPAIR03_request_id_bound_trace_and_scope_policy_consolidation.md`

Pre-existing REPAIR03 files still present from the accepted architecture:

- `src/tools/toolboxActionPolicy.ts`
- `src/security/diagnosticRedaction.ts`
- `src/server/discoveryTrace.ts`
- `src/tools/domainToolboxes.ts`
- `src/tools/common.ts`
- `src/utils/errorClassification.ts`
- `tests/toolboxActionPolicy.test.ts`
- `tests/diagnosticRedaction.test.ts`
- `tests/toolCallTrace.test.ts`

## Pre-Edit Defect Inventory And Disposition

| Defect or risk reviewed | Production behavior found | Required behavior | Disposition |
| --- | --- | --- | --- |
| Duplicate representable JSON-RPC request IDs | Duplicate string/numeric IDs produced the same `requestIdKey`; binder consumed matching contexts by handler order. | Detect ambiguity before SDK dispatch; reject duplicate participants with safe invalid-input evidence; do not blame unique siblings. | Fixed in `httpTransport.ts` with pre-dispatch duplicate-key evaluation and per-call evidence. |
| Unique sibling in duplicate-ID batch | Previously would have entered dispatchable group if batch proceeded. | Unique authorized sibling in rejected batch remains `RECEIVED_NOT_DISPATCHED` with no duplicate denial code/message. | Fixed and tested. |
| Duplicate-ID batch plus scope-denied sibling | Needed duplicate and scope denials to remain call-specific. | Duplicate participants get `INVALID_INPUT`; separately scope-denied sibling gets `OAUTH_SCOPE_DENIED`. | Fixed and tested. |
| Raw malicious duplicate ID persistence | String IDs are sanitized in trace/discovery, but duplicate rejection had no explicit test. | No raw malicious duplicate ID in trace/discovery/audit persistence. | Tested with malicious duplicate string ID and discovery sibling. |
| SDK/request-ID mismatch | Binder threw a generic error; broad transport catch could record `TRANSPORT_ERROR` on active contexts if the error escaped. SDK handler errors may also become JSON-RPC errors without hitting the transport catch. | Typed mismatch discriminator, no context theft, no sibling `transport_error`, isolated redacted audit diagnostic, deterministic response. | Fixed with `ToolCallTraceIdentityMismatchError`, dispatcher-level audit handling, transport fallback handling, and HTTP fixture. |
| Accepted REPAIR03 action-policy registry | Current design centralizes toolbox action scope/mapped operation. | Preserve accepted design. | No change beyond validation. |
| Accepted shared redaction authority | Current design uses `diagnosticRedaction.ts` for trace/discovery/HTTP diagnostics. | Preserve accepted design. | No change beyond tests touching duplicate/mismatch boundaries. |
| Lifecycle classification precedence | Current classifier uses actual trace stages and policy code precedence. | Preserve; do not fabricate stages for duplicate/mismatch paths. | Verified by new duplicate/mismatch tests plus existing classification tests. |
| Protected-scope drift | Risk of touching OAuth semantics, public exposure, write modes, Git, packaging, runtime promotion, UI, WC-V1-0202A/B. | Do not alter outside authorized trace/transport/dispatcher diagnostics. | Source search found no WC-V1-0202A/B terms; no prohibited files edited. |

## Request-ID Binder Design

The accepted REPAIR03 request-ID binder remains the production identity model:

- HTTP parsing creates one `ToolCallTraceContext` for every parsed `tools/call`.
- Each context stores a server correlation ID, sanitized public diagnostic JSON-RPC ID, and bounded internal `requestIdKey`.
- `toolCallTraceRequestIdKey(...)` maps finite numbers directly and maps strings through SHA-256 base64url. Raw string IDs are not used as unbounded map keys.
- `registerTools.ts` accepts the SDK handler metadata argument and binds with `extra.requestId`.
- No metadata matching, `claimed` flag, same-tool fallback, first-unclaimed fallback, or handler-order identity selector remains in production source.
- STDIO/direct calls without an HTTP trace group still execute normally.

Closure amendment:

- `ToolCallTraceIdentityMismatchError` is a typed internal mismatch discriminator with no raw request-ID content.
- `runWithToolCallTraceRequestId(...)` throws this typed error when an HTTP trace group exists but no representable context matches the SDK request ID.
- Dispatcher-level and transport-level handlers recognize the typed error separately from genuine transport failures.

## Duplicate-ID Rejection Design

After parsing and recording `http_received` for every `tools/call`, the HTTP transport evaluates representable string and numeric request-ID keys before SDK dispatch.

When duplicates are present:

- The HTTP body is rejected deterministically with a safe bounded JSON-RPC error message: `Duplicate JSON-RPC request ID in batch.`
- No duplicate-ID call enters `runWithToolCallTraceGroupContext`.
- Duplicate participants receive `http_response_completed` with `result: "deny"`, `errorCode: "INVALID_INPUT"`, and the bounded duplicate message.
- A unique authorized sibling receives only `http_response_completed`, remains `RECEIVED_NOT_DISPATCHED`, and receives no duplicate error code/message.
- A separately scope-denied sibling receives its own `OAUTH_SCOPE_DENIED` evidence and no duplicate error code/message.
- No call in a duplicate-ID rejected batch receives `dispatch_started`, `toolbox_entered`, helper stages, or `tool_result_returned`.
- Malicious duplicate string IDs remain sanitized in tool-call trace and discovery persistence; audit/rejection messages do not include the raw ID.

## Identity-Mismatch Isolation Design

The mismatch path is isolated from genuine transport exceptions:

- Binder mismatch creates `ToolCallTraceIdentityMismatchError`, not a generic error with raw request-ID content.
- `registerTools.ts` catches the typed error outside normal traced dispatch, writes a redacted `http_mcp_trace_identity` audit diagnostic without a correlation ID, and returns a safe MCP error result.
- `httpTransport.ts` also recognizes the typed error if it escapes the SDK/dispatcher boundary; it writes the same kind of redacted audit diagnostic and records only HTTP response completion on active receipt contexts.
- No mismatch path binds or mutates another call context.
- Receipt contexts not dispatched remain `RECEIVED_NOT_DISPATCHED`.
- Genuine socket/server/transport exceptions still record `transport_error` and classify `TRANSPORT_ERROR`.

## Toolbox Action Policy Table

| Toolbox | Read actions | Write actions and mapped operation |
| --- | --- | --- |
| `repo_toolbox` | `status`, `list_files`, `read_file`, `search_files` | `write_markdown_artifact -> write_markdown_artifact`, `write_json_artifact -> write_json_artifact`, `propose_patch -> propose_patch`, `apply_approved_patch -> apply_approved_patch` |
| `git_toolbox` | `status`, `diff`, `pre_commit_scan`, `readiness_summary`, `inspect_history` | `prepare_work_branch -> prepare_git_work_branch`, `stage_paths -> safe_stage_changes`, `commit_staged -> commit_validated_changes`, `push_current_branch -> push_current_branch`, `integrate_to_dev -> integrate_to_dev` |
| `artifact_toolbox` | `builder_report_index`, `builder_report_summary`, `release_artifact_summary`, `release_publication_summary`, `local_package_summary`, `read_image_artifact`, `list_artifacts`, `read_artifact_by_id`, `latest_artifact`, `artifact_pair_status`, `current_action_context`, `export_planning_corpus`, `review_queue` | none |
| `diagnostics_toolbox` | `runtime_status`, `write_access_status`, `tool_exposure_status`, `oauth_scope_status`, `chatgpt_discovery_status`, `recent_tool_calls`, `list_workspaces`, `public_safety_status`, `project_validation`, `mcp_server_startup`, `mcp_tool_registration`, `mcp_tool_inventory`, `electron_development_startup`, `electron_packaged_startup` | none |
| `integration_toolbox` | `list_supported_services`, `get_service_status`, `list_service_capabilities`, `validate_service_configuration` | `prepare_external_handoff -> write_markdown_artifact` |
| `browser_toolbox` | `get_browser_capabilities`, `validate_public_endpoint` | none |
| `knowledge_toolbox` | `list_supported_sources`, `get_project_memory_status`, `get_reference_capabilities`, `source_analysis` | none |

HTTP scope evaluation and toolbox action-level enforcement both use this registry. Unknown or malformed actions remain non-executable validation failures. Local write-mode enforcement still uses mapped internal operation names.

## Scope And Mixed-Batch Semantics

- Top-level `workspace_write_attached_image` requires `files.write`.
- Toolbox action scope is evaluated per parsed `tools/call`.
- If a batch is rejected because any contained call lacks scope, external batch rejection remains, but trace evidence is per call.
- Authorized siblings not dispatched by a rejected batch are `RECEIVED_NOT_DISPATCHED`.
- Denied siblings are `APP_POLICY_DENIED` with call-specific `OAUTH_SCOPE_DENIED` messages.
- Duplicate-ID rejection composes with scope evaluation: duplicate participants receive only duplicate invalid-input evidence; separately scope-denied siblings retain their own scope evidence.

## Shared Redaction APIs And Persistence Consumers

Shared redaction authority: `src/security/diagnosticRedaction.ts`.

APIs:

- `sanitizeDiagnosticText`
- `sanitizeDiagnosticJsonRpcId`
- `sanitizeDiagnosticRoute`
- `sanitizeDiagnosticEndpoint`

Consumers:

- `src/server/toolCallTrace.ts`
- `src/server/discoveryTrace.ts`
- `src/transports/httpTransport.ts`
- `src/server/registerTools.ts` for mismatch audit reason text

Coverage includes Windows drive paths, UNC paths, extended Windows paths, arbitrary Unix absolute paths including `/etc`, `/usr/local`, `/root`, `/run`, `/projects`, full HTTP/HTTPS/WS/WSS endpoints, tunnel hosts, localhost/private endpoints, credential-looking strings, keyed patch/content/prompt/file/search text, stack-like frames, control characters, and oversized string JSON-RPC IDs. Structured approved route fields are preserved only through the route sanitizer.

## Lifecycle And Classification Precedence

Classification remains based only on recorded evidence:

1. `transport_error` -> `TRANSPORT_ERROR`
2. policy-denial error code -> `APP_POLICY_DENIED`
3. errored/denied tool result without policy code -> `APP_EXECUTION_ERROR`
4. `dispatch_started` plus result plus HTTP completion -> `RESPONSE_COMPLETED`
5. `dispatch_started` plus result without HTTP completion -> `RESULT_RETURNED`
6. `dispatch_started` without result -> `DISPATCHED_NOT_EXECUTED`
7. HTTP receipt/response without dispatch -> `RECEIVED_NOT_DISPATCHED`
8. bounded no-match query with `since` or `correlationId` -> `NO_SERVER_RECEIPT_EVIDENCE`

Duplicate-ID rejection uses an actual HTTP completion event with `INVALID_INPUT`. Identity mismatch does not record dispatch/result/transport stages on unrelated contexts.

## Exact Acceptance-Test Mapping

| Requirement | Evidence |
| --- | --- |
| SDK `extra.requestId` exists | `tests/toolboxActionPolicy.test.ts` - `proves the installed MCP SDK request handler metadata exposes requestId`; typecheck passed. |
| Exact distinct-ID request binding | `tests/httpTransport.test.ts` - `binds two identical calls to the correlation matching the SDK request and response IDs`; `binds three identical calls correctly even when completion order is varied`. |
| Old claim-order selector removed | `tests/toolCallTrace.test.ts` - `does not retain claim-order selector code in production trace source`; `rg -n "runWithSelectedToolCallTraceContext|claimed|first-unclaimed|same-tool" src` returned no matches. |
| Duplicate string IDs rejected | `tests/httpTransport.test.ts` - `rejects duplicate string request IDs before dispatch with per-call invalid-input evidence`. |
| Duplicate numeric IDs rejected | `tests/httpTransport.test.ts` - `rejects duplicate numeric request IDs before dispatch`. |
| Unique sibling in duplicate batch | `tests/httpTransport.test.ts` - `keeps a unique authorized sibling receipt-only when duplicate IDs reject a batch`. |
| Duplicate plus scope-denied sibling | `tests/httpTransport.test.ts` - `preserves separate scope-denial evidence for a nonduplicate sibling in a duplicate-ID batch`. |
| Malicious duplicate ID redaction | `tests/httpTransport.test.ts` - `redacts malicious duplicate string IDs from trace and discovery persistence`. |
| No dispatch for duplicate rejected batch | The four duplicate-ID HTTP tests assert no `dispatch_started`, `toolbox_entered`, or `tool_result_returned` stages. |
| Typed binder mismatch | `tests/httpTransport.test.ts` - `does not let an unknown SDK request ID steal an existing context`; typed error message assertion. |
| HTTP mismatch isolation | `tests/httpTransport.test.ts` - `isolates an HTTP SDK request-ID mismatch without marking siblings as transport errors`. |
| Mismatch diagnostic redaction | Same HTTP mismatch test asserts audit contains `http_mcp_trace_identity` and no raw endpoint/path/secret/content/stack text. |
| Genuine transport exception preserved | `tests/httpTransport.test.ts` - `classifies transport exceptions with sanitized trace output`. |
| Action-policy registry complete | `tests/toolboxActionPolicy.test.ts` - `defines every supported toolbox action exactly once and derives supported action arrays`. |
| Supported-action drift protection | `tests/toolboxActionPolicy.test.ts` drift assertion against `SUPPORTED_TOOLBOX_ACTIONS`. |
| Toolbox write pre-dispatch scope | `tests/httpTransport.test.ts` - `denies repo, git, and integration toolbox write actions before dispatch with files.read only`. |
| Mixed authorized/denied batch | `tests/httpTransport.test.ts` - `records truthful mixed-batch evidence for an authorized read sibling and denied write sibling`. |
| Redaction authority | `tests/diagnosticRedaction.test.ts`; `tests/toolCallTrace.test.ts`; `tests/httpTransport.test.ts` redaction fixtures. |
| Malformed receipt | `tests/httpTransport.test.ts` - `records http_received evidence for malformed tools/call variants before SDK rejection`. |
| In-flight dispatched boundary | `tests/httpTransport.test.ts` - `observes an actual in-flight HTTP call as DISPATCHED_NOT_EXECUTED`. |
| Successful lifecycle | `tests/httpTransport.test.ts` - `records correlated successful repo_toolbox.read_file lifecycle and helper audit events`. |
| Registry/public exposure | `tests/toolSchema.test.ts`; `npm run mcp:self-test -- --json` reports 31 internal schemas and eight exposed tools when write scope allows image writer. |
| WC-V1-0202A/B untouched | `rg -n "WC-V1-0202A|WC-V1-0202B|writePolicy|artifact_only|artifactWriteRoots|greenfield workspace" src tests docs planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md` returned no matches. |

## Validation Commands And Results

Execution lane: documented normal Windows validation lane for child-process-capable commands. No final sandbox-only `spawn EPERM` failure occurred.

| Command | Lane | Result |
| --- | --- | --- |
| `npm run typecheck` | normal Windows | PASS |
| `npm run build` | normal Windows | PASS |
| `node --test dist/tests/toolboxActionPolicy.test.js dist/tests/diagnosticRedaction.test.js dist/tests/toolCallTrace.test.js dist/tests/domainToolboxes.test.js dist/tests/toolSchema.test.js dist/tests/httpTransport.test.js` | normal Windows | PASS, 117 tests |
| `npm run validate:codex:unit` | normal Windows validation wrapper | PASS, 359 tests |
| `npm run mcp:self-test -- --json` | normal Windows | PASS, 22 checks; `registeredToolCount: 31`; exposed tools are seven toolboxes plus `workspace_write_attached_image` |
| `npm run check:public` | normal Windows | PASS, 217 source candidate files |
| `npm run lint` | normal Windows | PASS |
| `git diff --check` | local Git check | PASS exit 0; line-ending warnings only |

Earlier validation during this closure exposed and corrected:

- A type error where trace-only `batch-scope-denied` was temporarily written into the discovery transport-route enum. Fixed by using `batch-scope-denied` only for tool-call trace response route and `scope-denied`/`bad-request` for discovery.
- An HTTP mismatch fixture expectation that assumed HTTP 500. The SDK returns HTTP 200 with JSON-RPC error objects for handler failures. The final design records dispatcher-level audit diagnostics and asserts trace/audit semantics rather than an incorrect HTTP status.
- Dispatcher mismatch audit write was hardened so audit failure cannot broaden the mismatch path.

## Mandatory Adversarial Self-Review Findings

Self-review probes performed:

- duplicate string IDs;
- duplicate numeric IDs;
- malicious duplicate string IDs;
- duplicate-ID batch with a unique authorized sibling;
- duplicate-ID batch with a separately scope-denied sibling;
- unknown SDK request ID;
- missing/unmatched SDK context through binder fixture;
- authorized plus denied sibling batch;
- genuine transport exception;
- malformed call mixed cases;
- absolute Windows, UNC, extended Windows, `/etc`, `/usr/local`, `/root`, `/run`, `/projects`, and configured-root-like paths through existing redaction fixtures;
- malicious discovery ID and host metadata through existing and new discovery tests;
- compaction failure after append;
- old unsafe persisted diagnostic data read through current APIs;
- source search for removed selector terms;
- source search for WC-V1-0202A/B implementation terms.

Defects found during self-review and validation:

- Trace/discovery route enum mismatch: corrected.
- HTTP mismatch status assumption: corrected to SDK-observed HTTP 200 JSON-RPC error behavior.
- Dispatcher-level mismatch diagnostic was needed because SDK can catch handler errors before the transport catch: added in `registerTools.ts`.
- Dispatcher audit failure needed local containment: added a redacted local catch.

No unresolved defect remains from the self-review.

## Protected Scope

Touched protected areas within authorization:

- MCP HTTP transport request handling and trace response recording.
- MCP public dispatcher trace binding and mismatch diagnostics.
- Diagnostic/audit persistence for identity mismatch.

Protected areas not changed:

- OAuth and Dynamic Client Registration behavior.
- PKCE behavior.
- Token/session storage.
- Cloudflare configuration or tunnel behavior.
- Runtime path/AppData config behavior.
- Local config persistence behavior.
- Admin password handling.
- Existing public tool exposure rules beyond accepted trace evidence.
- Local write-mode semantics.
- Patch approval/application behavior.
- Git workflow semantics.
- Server lifecycle/start/stop/restart behavior.
- Packaging/release configuration.
- Electron UI.
- Figma behavior.
- Existing preload/window API contracts.

Scope did not change during implementation.

## Explicit Unresolved Issues

No local implementation defect is known.

Limitations that remain outside this authorized pass:

- Local automated tests do not prove live ChatGPT connector behavior.
- Architect review of the complete final implementation and this updated Builder Report has not been performed.
- Git integration, packaging, runtime promotion, restart/reconnect, and live ChatGPT validation remain separately authorized future passes.
- `RESULT_RETURNED` without HTTP completion remains covered by direct trace tests as previously allowed.

## Validation Not Performed

1. Architect review of the full final implementation and updated Builder Report.
2. Separately authorized Git integration.
3. Separately authorized WC-V1-0202A implementation.
4. Separately authorized WC-V1-0202B implementation.
5. Separately authorized package and runtime promotion.
6. Operator restart of ChampCity MCP and ChatGPT reconnect.
7. New live ChatGPT conversation.
8. Live safe read, insufficient-scope write, and diagnostic queries.
9. Operator confirmation that live evidence contains no secrets, endpoints, absolute paths, raw IDs, prompt/file/patch content, or stack traces.

## Final Confirmations

- WC-V1-0202A and WC-V1-0202B were untouched.
- Nothing was staged, committed, pushed, integrated, tagged, packaged, promoted, restarted, reconnected, published, or released.
- No fallback architecture was used.

No fallback implementation was used.
