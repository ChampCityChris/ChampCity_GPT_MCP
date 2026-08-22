# WC-V1-0202G-REPAIR01 — Bounded Read Contract Correction

## Identity

- ID: `WC-V1-0202G-REPAIR01`
- Parent: `WC-V1-0202G`
- Priority: P0
- Repository: `%USERPROFILE%\Projects\ChampCity_GPT`
- Branch: `dev`
- Starting HEAD: `db6aa399716db271f2b38a6927de33f0f29a55ec`
- Controlling Review: `planning/phases/phase-v1.0/Architect_Reports/ARCHITECT_REVIEW_WC-V1-0202G_bounded_text_projection_and_safety_resilient_read_protocol.md`
- Required Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202G-REPAIR01_bounded_read_contract_correction.md`
- Supersedes: `WC-V1-0202G-REPAIR02`

## Observed Production-Path Defect

The bounded-read protocol can return or report content that does not match the Operator's request:

- continuation can escape a requested line range or Markdown section;
- an artifact cursor can return artifact A text while reporting artifact B metadata;
- `export_planning_corpus(includeFullText=true)` returns metadata but no text;
- bounded-result telemetry reports incomplete chunks as `chunked:false` and `truncated:false`;
- `read_artifact_by_id(component="both")` can silently omit the requested JSON component.

These are one contract-integrity defect: the public result does not always preserve the requested source identity, range, component set, delivered bytes, and telemetry description.

## Verified Cause

Code review confirmed:

1. `src/tools/textProjection.ts` cursors bind workspace, path, source SHA, and offset, but do not enforce operation mode, generic range end, or artifact identity.
2. Cursor continuation takes precedence over conflicting caller identifiers instead of rejecting them.
3. `readTextLines()` bounds only the first response; its cursor does not retain the requested end range.
4. `readFullTextEntry()` removes source text through `boundedTextStructuredContent()`, and corpus export returns through a metadata-only path.
5. `resultTelemetry.measureToolResult()` reads the bounded serializer name but hardcodes `chunked` and `truncated` to false and omits available chunk/source/range fields.
6. The hidden bounded artifact payload can replace the ordinary `component="both"` response after JSON is added.
7. `returnedLineCount` is calculated by text splitting and can overcount a chunk ending with a newline.

The shared projection architecture remains the accepted basis. Do not redesign it.

## Smallest Authorized Correction

Correct the existing bounded-read contract only:

1. Bind every cursor to its original operation mode: full text, line range, Markdown section, or artifact text.
2. Preserve and enforce the original hard range end for line and section continuation.
3. Bind artifact cursors to the resolved artifact ID and text component.
4. Reject cursor use through the wrong action and reject any conflicting path, section ID, or artifact ID. No supplied identifier may be ignored.
5. Calculate returned line counts from exact source coverage.
6. Make `export_planning_corpus(includeFullText=true)` return actual bounded source text through MCP text items while respecting the 16,384-byte item cap and `maxBundleBytes`.
7. Keep corpus text out of structured metadata and continue deterministically through explicit cursors.
8. Populate existing WC-V1-0104B telemetry from bounded projection metadata: serializer, completion/chunked state, chunk index, source SHA, byte range, and continuation presence.
9. Preserve `component="both"`: return JSON safely when bounded, or explicitly report it as deferred/not inlined with valid continuation or replacement guidance. Never omit it silently.

No second cursor format authority, duplicate telemetry store, fallback text field, unbounded envelope, or alternate artifact identity mechanism is authorized.

## Required Production Sequences

### Range-bound continuation

`HTTP read_text_lines or read_markdown_section`
→ first bounded chunk returned
→ cursor retains operation, source, and original range end
→ continuation through the same action returns only the remaining requested bytes
→ completion occurs exactly at the original range end
→ wrong-action or conflicting-identifier use is a contract rejection.

### Artifact continuation

`HTTP read_artifact_text_chunk for artifact A`
→ cursor binds artifact A and its Markdown component
→ cursor-only continuation still reports artifact A
→ artifact B plus artifact A cursor is rejected
→ no text/metadata cross-association occurs.

### Corpus content

`HTTP export_planning_corpus(includeFullText=true)`
→ page and bundle limits applied
→ actual source text returned in bounded MCP items
→ path, SHA, range, and cursor remain in structured metadata
→ selected text is either delivered or explicitly excluded with a reason
→ no source text is duplicated in structured metadata.

### Delivery telemetry

`HTTP bounded read`
→ bounded serializer result returned with model-visible receipt
→ result trace records the actual completion state, chunk index, source SHA, byte range, and continuation state
→ `result_delivery_status` returns those dimensions without document content.

### Both artifact components

`HTTP read_artifact_by_id(component="both")`
→ Markdown is bounded when required
→ JSON is safely returned or explicitly deferred
→ neither requested component disappears silently.

## Must Remain Unchanged

- shared `textProjection.ts` architecture;
- 8,192-byte default chunk target and 16,384-byte hard content-item cap;
- exact ordinary full-file reconstruction and source hashes;
- model-visible delivery receipts and acknowledgement behavior;
- source-SHA stale detection and cursor integrity protection;
- OAuth, path, symlink/reparse, write-mode, public-tool, artifact-catalog, and Git behavior;
- all unrelated worktree files.

## Explicitly Out of Scope

- WC-V1-0202H workspace/Git capability changes;
- a generic JSON byte-range protocol;
- new top-level tools, UI, storage, retry services, or alternate read engines;
- package, promotion, restart, reconnect, live ChatGPT validation;
- staging, committing, pushing, merging, cleaning, stashing, resetting, or discarding work.

## Acceptance Criteria

Acceptance proof must use the real public HTTP MCP entry point. Direct helper tests may support but cannot replace it.

1. A multi-chunk line request reconstructs exactly the requested range and stops at its original end.
2. An oversized single line reconstructs exactly without returning the next line.
3. A section cursor used with `read_text_chunk`, or a full-text cursor used with `read_markdown_section`, is `APP_CONTRACT_REJECTED`.
4. A cursor plus conflicting `relativePath`, `sectionId`, or `artifactId` is rejected; no identifier is ignored.
5. Artifact A cursor plus artifact B ID is rejected; cursor-only continuation retains artifact A identity.
6. Cursor tamper, workspace mismatch, expiry, and source-change behavior remain safe.
7. `returnedLineCount` is exact for LF, CRLF, mixed endings, Unicode, oversized lines, and files with or without a final newline.
8. Corpus `includeFullText=true` returns actual bounded text items that reconstruct selected source bytes and SHA exactly.
9. Corpus pagination never silently omits selected text; exclusions are explicit and reason-coded.
10. No text item exceeds 16,384 bytes, total text respects `maxBundleBytes`, and structured metadata contains no duplicated source text.
11. Incomplete `bounded-text-v1` and `bounded-markdown-section-v1` results record accurate chunked/incomplete state, chunk index, source SHA, byte range, and continuation presence.
12. Complete final chunks record completion accurately, and `result_delivery_status` exposes the same safe dimensions.
13. `read_artifact_by_id(component="both")` returns or explicitly defers both requested components.
14. Existing ordinary reconstruction, artifact, corpus, receipt, acknowledgement, redaction, OAuth, path, and public-surface tests remain passing.
15. No fallback, duplicate authority, unbounded result, or unrelated refactor is introduced.

## Authorized File Surface

Expected production files:

- `src/tools/textProjection.ts`
- `src/tools/artifactCatalog.ts`
- `src/tools/domainToolboxes.ts`
- `src/server/resultTelemetry.ts`

Expected focused tests:

- `tests/textProjection.test.ts`
- `tests/artifactCatalog.test.ts`
- public HTTP MCP tests for cursor rejection, corpus delivery, telemetry, and both-component preservation.

A narrowly necessary adjacent file may change only when the Builder Report identifies the reason and proves it is required for this defect. Documentation changes are permitted only where existing text becomes inaccurate.

## Validation and Proof Boundary

Run the repository-defined normal Windows lanes for:

1. typecheck;
2. focused public HTTP and supporting unit tests;
3. full regression suite and build;
4. MCP self-test;
5. public-surface check;
6. lint;
7. `git diff --check`.

The Builder Report must identify:

- the exact HTTP requests used for range, action-mode, and artifact-identity proof;
- actual corpus content items and reconstruction evidence;
- exact telemetry fields observed through delivery status;
- both-component artifact behavior;
- automatic proof versus remaining live Operator validation;
- exact files changed and dirty-state accounting;
- confirmation that no fallback or alternate authority was added;
- confirmation that nothing was staged, committed, pushed, packaged, promoted, restarted, reconnected, published, or released.

## Stop Conditions

Stop and report rather than broaden scope if:

- operation/range/artifact binding requires replacing the shared cursor architecture;
- actual bounded corpus delivery requires an unbounded envelope;
- telemetry accuracy requires a second trace store;
- both-component preservation requires a new generic JSON chunk protocol;
- the correction requires WC-V1-0202H behavior.

## Binary Completion Rule

`cursor cannot escape or cross-associate the requested source/range`
+ `includeFullText delivers bounded text`
+ `telemetry describes the actual result`
+ `requested artifact components are preserved or explicitly deferred`
+ `existing behavior remains intact`
+ `no alternate mechanism introduced`
= `PASS`

Anything less is `RevisionRequired`.

## Document Disposition

Document.Status=PendingOperatorApproval
