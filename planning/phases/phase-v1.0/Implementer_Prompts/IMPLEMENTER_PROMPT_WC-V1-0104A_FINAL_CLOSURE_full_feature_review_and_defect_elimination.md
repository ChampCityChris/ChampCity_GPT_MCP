# Implementer Prompt — WC-V1-0104A Final Closure: Full Feature Review and Defect Elimination

Recommended Codex model: GPT-5.6
Recommended reasoning level: High

You are the Implementer responsible for closing WC-V1-0104A completely.

This is not a narrow two-defect amendment and it is not another iterative repair pass. The Operator requires a finished implementation that survives Architect review without another cycle.

Your responsibility is to review the entire current tool-call trace feature, identify every remaining defect before editing, correct all defects in one implementation pass, and then perform a second adversarial review of your own completed work before you are permitted to report success.

Do not optimize for producing a green test run or a persuasive Builder Report. Optimize for a correct implementation whose code, tests, documentation, and evidence agree.

## Controlling Records

Read completely before editing:

1. `AGENTS.MD`
2. `docs/dev/VALIDATION_COMMAND_LANES.md`
3. `planning/phases/phase-v1.0/Work_Cards/WC-V1-0104A_mcp_tool_call_dispatch_trace.md`
4. `planning/phases/phase-v1.0/Work_Cards/WC-V1-0104A-REPAIR01_contract_compliant_mcp_tool_call_trace.md`
5. `planning/phases/phase-v1.0/Work_Cards/WC-V1-0104A-REPAIR02_trace_boundary_classification_redaction_evidence.md`
6. `planning/phases/phase-v1.0/Work_Cards/WC-V1-0104A-REPAIR03_request_id_bound_trace_and_scope_policy_consolidation.md`
7. all three prior Architect Reviews for WC-V1-0104A and its repairs
8. `planning/phases/phase-v1.0/Architect_Reports/CODE_REVIEW_RCA_WC-V1-0104A_TRACE_REPAIR_CHURN_2026-07-26.md`
9. `planning/phases/phase-v1.0/Architect_Reports/ARCHITECT_REVIEW_WC-V1-0104A-REPAIR03_request_id_bound_trace_and_scope_policy_consolidation.md`
10. all three prior Builder Reports
11. the complete current diff for every source, test, and documentation file involved in WC-V1-0104A

The current source tree is the implementation baseline. Earlier records explain intent and prior failure patterns; they are not permission to assume the current implementation is otherwise correct.

## Repository Verification

Expected repository:

`%USERPROFILE%\Projects\ChampCity_GPT`

Expected remote:

`ChampCityChris/ChampCity_GPT_MCP`

Expected branch:

`dev`

Before editing, verify and report:

1. current directory;
2. Git top-level directory;
3. branch;
4. HEAD;
5. remote;
6. complete dirty status;
7. `package.json` exists;
8. `AGENTS.MD` was read;
9. validation lanes were read.

Stop if repository identity is wrong.

## Dirty Worktree Protection

The worktree contains intermingled work. Preserve every unrelated hunk.

Do not reset, clean, stash, restore whole files, discard, stage, commit, push, merge, integrate, tag, package, promote, restart, reconnect, publish, or release.

Before editing each tracked file:

1. inspect its current diff;
2. identify the exact WC-V1-0104A-related hunks;
3. preserve unrelated runtime-drift, promotion-provenance, planning, and other feature work;
4. patch surgically.

Do not modify:

- `scripts/promote-runtime-exe.mjs`
- `tests/promoteRuntimeProvenance.test.ts`
- WC-V1-0202A implementation
- WC-V1-0202B implementation
- Electron UI
- packaging/release configuration

## Required Working Method

### Phase 1 — Full pre-edit code review

Before making any production edit, review the complete implementation path:

- HTTP request parsing;
- malformed-call receipt creation;
- request-ID key creation;
- trace-group construction;
- SDK `extra.requestId` binding;
- public dispatcher entry;
- toolbox action-policy lookup;
- HTTP scope evaluation;
- action-level scope and local write-mode enforcement;
- helper audit propagation;
- tool-result creation;
- HTTP response completion;
- transport-error handling;
- trace persistence, compaction, and reading;
- classification precedence;
- discovery persistence;
- HTTP error/audit diagnostics;
- all redaction boundaries;
- schema count and public exposure;
- every existing focused test and its actual assertion.

Create a private defect inventory before editing. Do not limit that inventory to the two findings in the latest Architect Review.

For each potential defect, determine:

- actual production behavior;
- required behavior;
- whether an existing test truly proves it;
- exact code change required;
- regression risk.

Do not begin implementation until the review is complete.

### Phase 2 — Implement all confirmed defects

Correct every defect identified during Phase 1 in the same pass. Do not knowingly leave a defect for another repair.

The two already confirmed defects are mandatory, but not exhaustive.

## Mandatory Correction 1 — Reject duplicate representable JSON-RPC request IDs before dispatch

The current request-ID binder correctly handles distinct IDs but silently order-binds duplicate wire IDs because duplicate IDs produce the same `requestIdKey`.

This is prohibited.

Required behavior:

1. After parsing every `tools/call` and creating receipt evidence, inspect all representable request-ID keys within the HTTP body.
2. Detect any duplicate string or numeric request-ID key before SDK dispatch.
3. Do not allow a duplicate key into a dispatchable trace group.
4. Reject the request or batch deterministically before dispatcher entry.
5. Do not use handler order to distinguish duplicate IDs.
6. Do not expose the raw duplicate ID in diagnostics.

Required per-call evidence for a rejected batch:

- each call participating in a duplicate-ID ambiguity:
  - remains independently correlated;
  - records `http_received`;
  - records HTTP completion;
  - is classified `APP_POLICY_DENIED` using a safe invalid-input code such as `INVALID_INPUT` and a bounded message such as `Duplicate JSON-RPC request ID in batch.`;
  - contains no raw request-ID content beyond the existing sanitized diagnostic ID;
- any unique authorized sibling call in the same rejected batch:
  - remains `RECEIVED_NOT_DISPATCHED`;
  - receives no duplicate-ID denial code or message;
- no call receives `dispatch_started`, toolbox, helper, or tool-result stages.

Use the existing classification authority. Do not add a new public AppErrorCode unless technically required. An internal trace discriminator may be used, but it must classify deterministically and remain safe.

Add tests for:

- two identical calls with the same string ID;
- two different calls with the same numeric ID;
- duplicate-ID calls plus one unique authorized sibling;
- duplicate-ID calls plus a separately scope-denied sibling;
- no dispatch for any rejected duplicate-ID batch;
- truthful per-call classification and messages;
- no raw malicious duplicate-ID content in trace or discovery persistence.

## Mandatory Correction 2 — Isolate SDK/request-ID mismatch without misclassifying sibling calls

The current binder throws a generic error when `extra.requestId` has no matching HTTP trace context. The outer HTTP catch then records `TRANSPORT_ERROR` for every active context.

That prevents context theft but produces false evidence.

Required design:

1. Introduce a typed internal identity-mismatch discriminator, for example `ToolCallTraceIdentityMismatchError`.
2. The discriminator must contain no raw request-ID content.
3. A mismatch must never bind or mutate another context.
4. A mismatch must never cause every active context to receive `transport_error`.
5. Handle the mismatch separately from genuine transport exceptions.
6. Record one isolated, redacted diagnostic through an appropriate server/audit path without assigning it to an unrelated correlation ID.
7. Complete the HTTP/MCP response deterministically and safely.
8. Existing parsed receipt contexts that were not dispatched must remain truthful:
   - `http_received` plus response completion when applicable;
   - `RECEIVED_NOT_DISPATCHED`;
   - no `TRANSPORT_ERROR` unless an actual transport exception independently occurred.

A genuine socket, stream, transport, or server exception must continue to classify `TRANSPORT_ERROR`.

Add an HTTP-level controlled fixture that creates an SDK identity mismatch and proves:

- no context is stolen;
- no sibling receives `transport_error`;
- no sibling receives a fabricated tool result;
- receipt contexts remain independently queryable;
- the isolated mismatch diagnostic is redacted and bounded;
- the HTTP response completes deterministically.

A direct unit test that only asserts the binder throws is insufficient.

## Mandatory Whole-Feature Invariants

After implementing the confirmed corrections, verify the entire feature against these invariants. Fix any violation found.

### Receipt and identity

- Every parsed `tools/call` receives receipt evidence before parameter validation.
- Distinct representable IDs bind exactly through SDK `extra.requestId`.
- Duplicate IDs are rejected before dispatch.
- Missing/unrepresentable IDs never steal another context.
- No metadata matching, `claimed` flag, same-tool fallback, first-unclaimed fallback, or handler-order identity mechanism exists.
- Raw untrusted string IDs are not retained as internal map keys.

### Authorization and policy

- One canonical toolbox action-policy registry defines every supported action exactly once.
- HTTP and action-level enforcement use that same registry.
- Write-capable repo, Git, and integration actions require `files.write` before dispatch when determinable.
- Local write-mode enforcement still uses the mapped internal operation.
- Unknown/malformed actions remain non-executable validation failures.
- Mixed batches produce truthful per-call evidence.

### Lifecycle classification

- Auth/scope/invalid-input denial never fabricates dispatch or result stages.
- `RECEIVED_NOT_DISPATCHED`, `DISPATCHED_NOT_EXECUTED`, `APP_POLICY_DENIED`, `APP_EXECUTION_ERROR`, `RESULT_RETURNED`, `RESPONSE_COMPLETED`, and `TRANSPORT_ERROR` are based only on stages/events that actually occurred.
- Operational errors are not labeled policy denials.
- Identity mismatch is not labeled as transport failure for unrelated calls.

### Redaction and persistence

- One shared field-aware redaction authority is used by tool-call trace, discovery trace, and HTTP error diagnostics.
- Any Windows drive, UNC, extended Windows, or free-form Unix absolute path is redacted.
- Full HTTP/HTTPS/WS/WSS endpoints and tunnel hosts are redacted.
- Approved route fields remain usable only through the route sanitizer.
- String JSON-RPC IDs are sanitized and capped at 128 characters.
- Discovery IDs are sanitized before write and on legacy read.
- Secrets, OAuth material, prompt/file/patch content, stack traces, and control characters do not persist.
- Trace append/compaction failure does not fail the underlying call.
- Retention remains bounded at 2,000 valid events.

### Compatibility

- Internal registered schema count remains 31.
- Public exposure remains seven toolboxes plus the bounded image writer when scope and local mode allow.
- OAuth, PKCE, DCR, token, session, workspace routing, write-mode, patch, Git, runtime-drift, promotion-provenance, Electron, and Figma behavior remain unchanged.

## Phase 3 — Build tests that prove semantics, not implementation appearance

Tests must fail if the production semantic contract is wrong even when traces remain internally consistent.

Required test classes:

1. Cross-layer distinct-ID association:
   - inbound ID;
   - SDK `extra.requestId`;
   - selected correlation;
   - persisted ID;
   - response ID.
2. Reverse/delayed completion for distinct IDs.
3. Duplicate-ID rejection before dispatch.
4. Unique sibling behavior in duplicate-ID rejection.
5. HTTP-level identity mismatch isolation.
6. Action-aware pre-dispatch scope denial for repo, Git, and integration writes.
7. Authorized-plus-denied mixed batch.
8. Real in-flight `DISPATCHED_NOT_EXECUTED`.
9. Successful full lifecycle.
10. Genuine transport exception.
11. Malformed receipt.
12. Arbitrary path/endpoint/secret/string-ID redaction across trace, discovery, and HTTP audit persistence.
13. Compaction and legacy-read tolerance.
14. Registry/public-exposure regression.

Do not mark an acceptance item passed merely because a broad test suite passed.

## Phase 4 — Mandatory adversarial self-review after implementation

After all code and tests pass, stop and review your own work as if you were the Architect attempting to reject it.

This phase is mandatory and must occur before writing the Builder Report.

### Re-read the entire diff

For every modified file:

- verify the change matches the controlling contract;
- identify any unintended behavior change;
- check error paths, not only successful paths;
- check batch behavior with heterogeneous calls;
- check missing, null, malformed, duplicate, malicious, and oversized inputs;
- check whether one call can contaminate another call’s evidence;
- check whether a thrown error reaches a broader catch than intended;
- check whether documentation says more than tests prove.

### Challenge every Builder Report claim

Before writing a claim, identify the exact test assertion or direct code evidence that proves it.

Do not write `PASS` when the evidence is:

- an assumption;
- a disclosed limitation;
- a direct trace fixture standing in for a required HTTP boundary;
- an internally consistent trace that does not prove cross-layer identity;
- a broad suite with no named semantic assertion;
- a search that excludes relevant files;
- a test of only the happy path.

### Required adversarial probes

At minimum, deliberately evaluate:

- duplicate string IDs;
- duplicate numeric IDs;
- malicious duplicate string IDs;
- unknown SDK ID;
- missing SDK context;
- authorized plus denied sibling batch;
- duplicate-ID batch with unique sibling;
- duplicate-ID batch with scope-denied sibling;
- transport exception after some calls have dispatched;
- malformed call mixed with valid call;
- absolute requested path on Windows, UNC, `/etc`, `/usr/local`, `/root`, `/run`, `/projects`, and an arbitrary configured root;
- malicious discovery ID and host metadata;
- compaction failure after append;
- old unsafe persisted diagnostic data read through current APIs.

If this self-review finds a defect, fix it and rerun the relevant tests before reporting.

Do not knowingly submit an implementation with an unresolved defect.

## Validation

Use `docs/dev/VALIDATION_COMMAND_LANES.md`.

Run in this order:

1. typecheck;
2. focused SDK identity, duplicate-ID, mismatch, scope-policy, redaction, discovery, trace, audit, and HTTP tests;
3. build;
4. full repository unit lane required by touched shared modules;
5. MCP self-test;
6. `npm run check:public` if present;
7. lint;
8. `git diff --check`.

Do not use Playwright.
Do not package or promote.
Do not restart or reconnect.
Do not stage, commit, push, or integrate.

## Required Final Builder Report

Update the existing REPAIR03 Builder Report rather than creating another repair cycle:

`planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104A-REPAIR03_request_id_bound_trace_and_scope_policy_consolidation.md`

The report must describe the complete final implementation, not only the latest two corrections.

Required sections:

- repository verification;
- starting and final dirty state;
- exact files changed during this closure pass;
- preservation method;
- complete pre-edit defect inventory and disposition;
- final request-ID binder design;
- duplicate-ID rejection design;
- identity-mismatch isolation design;
- full toolbox action-policy table;
- per-call scope and mixed-batch semantics;
- shared redaction APIs and every persistence consumer;
- lifecycle/classification precedence;
- exact named acceptance-test mapping;
- validation commands and results;
- mandatory adversarial self-review findings;
- defects found during self-review and how they were corrected;
- explicit unresolved issues, if any;
- validation not performed;
- confirmation that WC-V1-0202A and WC-V1-0202B were untouched;
- confirmation that nothing was staged, committed, pushed, integrated, packaged, promoted, restarted, reconnected, published, or released.

The report must not claim completion if any known defect, unsupported assumption, failed test, or stop condition remains.

End with exactly:

`No fallback implementation was used.`

## Completion Standard

You may report `ImplementedPendingArchitectReview` only when all of the following are true:

1. the complete current feature has been reviewed, not only the latest findings;
2. every confirmed defect has been fixed;
3. the two mandatory edge conditions are fixed;
4. all semantic acceptance tests pass;
5. the adversarial self-review found no unresolved defect;
6. every Builder Report claim is backed by exact evidence;
7. no protected subsystem or unrelated work was altered.

If any item is false, do not claim completion. Report the exact blocker or remaining defect instead.

This is the closure pass. Do not propose another repair number, another narrow follow-up, or a fallback architecture.

## Manual Validation After Codex

Report these as not performed:

1. Architect reviews the full final implementation and updated Builder Report.
2. After approval, a separately authorized pass integrates the approved changes.
3. WC-V1-0202A and WC-V1-0202B proceed separately.
4. A separately authorized pass packages and promotes the runtime.
5. Operator restarts ChampCity MCP and reconnects ChatGPT.
6. Operator opens a new conversation.
7. Operator performs safe read, insufficient-scope write, and diagnostic queries.
8. Operator confirms live evidence contains no secrets, endpoints, absolute paths, raw IDs, prompt/file/patch content, or stack traces.

## Remaining Passes for the Current Phase

After successful Architect approval of this closure pass:

- authorized Git integration;
- separate WC-V1-0202A implementation;
- separate WC-V1-0202B implementation;
- authorized package and runtime promotion;
- live ChatGPT validation;
- final evidence and acceptance-matrix disposition.
