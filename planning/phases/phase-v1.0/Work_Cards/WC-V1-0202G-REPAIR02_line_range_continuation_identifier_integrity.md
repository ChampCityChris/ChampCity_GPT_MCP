# WC-V1-0202G-REPAIR02 — Line-Range Continuation Identifier Integrity

## Identity

- ID: `WC-V1-0202G-REPAIR02`
- Parent: `WC-V1-0202G`
- Repairs: `WC-V1-0202G-REPAIR01`
- Priority: P0
- Repository: `%USERPROFILE%\Projects\ChampCity_GPT`
- Branch: `dev`
- Required Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202G-REPAIR02_line_range_continuation_identifier_integrity.md`

## Observed Production Defect

A caller can continue `repo_toolbox.read_text_lines` with a valid line-range cursor while also supplying a conflicting `startLine`.

The server accepts the request, ignores the supplied `startLine`, and continues from the cursor's current offset. The returned content therefore does not correspond to every identifier in the submitted request.

## Verified Cause

In `src/tools/textProjection.ts`, `readTextLines()` checks a continuation-supplied `startLine` only when `cursorPayload.chunkIndex === 0`.

A continuation cursor is issued with an incremented chunk index, so this condition cannot be true for the production continuation path.

The cursor also does not retain sufficient immutable original line-range identity to validate a continuation-supplied `startLine` and `maximumLines` against the complete original request. Comparing only the moving cursor offset and calculated hard end is insufficient.

## Smallest Authorized Correction

Correct the existing signed line-range cursor contract only.

1. Bind each `line_range` cursor to immutable original range identity sufficient to validate:
   - original `startLine`;
   - original `maximumLines`;
   - original start offset;
   - original hard end offset.
2. On every `read_text_lines` continuation:
   - accept cursor-only continuation;
   - accept repeated range identifiers only when they exactly match the original request;
   - reject conflicting `relativePath`, `startLine`, or `maximumLines` before returning source text.
3. Remove the ineffective `chunkIndex === 0` limitation from conflict enforcement.
4. Continue using the existing signed cursor authority, workspace binding, source-SHA validation, hard-end enforcement, and contract-error classification.

No alternate cursor authority, fallback parser, duplicate range state, or second read path is authorized.

## Required Production Sequences

### Valid continuation

`HTTP repo_toolbox.read_text_lines`
→ initial request supplies `relativePath`, `startLine`, `maximumLines`, and bounded `maximumBytes`
→ first response returns an incomplete chunk and signed cursor
→ continuation supplies the cursor alone or repeats the exact original identifiers
→ server validates the immutable original range
→ remaining bytes are returned
→ completion occurs exactly at the original hard end
→ the following line is never returned.

### Conflicting continuation

`HTTP repo_toolbox.read_text_lines`
→ initial bounded range returns a cursor
→ continuation supplies that cursor plus a different `startLine`, different `maximumLines`, or both
→ server compares supplied identifiers to the original request identity
→ request is rejected as `APP_CONTRACT_REJECTED`
→ no source-text content item is returned
→ the same cursor remains usable for a later valid continuation.

## Must Remain Unchanged

- Shared `textProjection.ts` architecture.
- Existing cursor signing, expiry, tamper rejection, workspace binding, and source-change detection.
- Existing range hard-end enforcement and exact source-byte reconstruction.
- `read_text_chunk`, `read_markdown_section`, and `read_artifact_text_chunk` behavior.
- Artifact identity, corpus export, bounded telemetry, delivery receipts, and acknowledgement behavior.
- OAuth, path, file, symlink, write-mode, Git, transport, and public-tool behavior.
- Repair01 behavior not directly implicated by this defect.

## Explicitly Out of Scope

- Text-projection redesign or server-side cursor session storage.
- Markdown-section or artifact cursor changes.
- Corpus export, artifact JSON, or telemetry changes.
- New tools, UI, storage, retry services, or alternate read engines.
- Sanitizing the unrelated historical Builder Report currently failing publication cleanliness.
- Packaging, promotion, restart, reconnection, staging, commit, push, merge, reset, clean, stash, or release.

The known publication-cleanliness failure must be reported accurately but does not authorize modification of unrelated historical records under this card.

## Acceptance Criteria

Acceptance proof must use the real public HTTP MCP entry point. Direct helper tests may support but cannot replace it.

1. Cursor-only continuation reconstructs exactly the original requested line range.
2. Repeating the exact original `startLine` and `maximumLines` succeeds.
3. Cursor plus conflicting `startLine` is `APP_CONTRACT_REJECTED`.
4. Cursor plus conflicting `maximumLines` is `APP_CONTRACT_REJECTED`.
5. A different `startLine` and `maximumLines` combination is rejected even when it calculates the same hard end offset.
6. Conflicting `relativePath` remains rejected.
7. Rejected requests return no source-text content item.
8. Rejection does not consume or invalidate the cursor; a later valid continuation succeeds.
9. Completion stops at the original hard end and never returns the following line.
10. Existing cursor, section, artifact, corpus, telemetry, receipt, OAuth, path, transport, and public-tool regression tests remain passing.
11. No fallback, duplicate range authority, alternate cursor mechanism, or unrelated refactor is introduced.

## Authorized File Surface

Expected production file:

- `src/tools/textProjection.ts`

Expected focused tests:

- `tests/textProjection.test.ts`
- `tests/httpTransport.test.ts`

Required report:

- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202G-REPAIR02_line_range_continuation_identifier_integrity.md`

A narrowly necessary adjacent file may change only when the Builder Report identifies the exact technical reason and proves it is required for this defect.

## Validation and Proof Boundary

Run:

1. Typecheck.
2. Focused text-projection tests.
3. Focused public HTTP MCP tests.
4. Full regression suite and build.
5. MCP self-test.
6. Lint.
7. `git diff --check`.
8. Publication-cleanliness check.

The Builder Report must distinguish repair-specific proof from the known unrelated publication-cleanliness failure and identify any remaining Operator validation. No visual or interactive Operator validation is required for this repair.

## Builder Report Requirements

The Builder Report must identify:

- exact files changed;
- immutable range fields added to the cursor;
- exact HTTP requests used for positive and negative proof;
- observed classification for each conflicting request;
- proof rejected requests returned no source text;
- proof the same cursor remained usable afterward;
- complete validation results and dirty-state accounting;
- confirmation that no fallback or alternate authority was introduced;
- confirmation that nothing was staged, committed, pushed, packaged, promoted, restarted, reconnected, published, or released.

## Stop Conditions

Stop and report rather than broaden scope if:

- correction requires replacing the shared cursor architecture;
- correction requires a second cursor store or server-side session state;
- correction requires Markdown-section, artifact, corpus, telemetry, or WC-V1-0202H changes;
- correction requires modifying unrelated historical planning records.

## Binary Completion Rule

`conflicting continuation identifiers are rejected through the real HTTP MCP path`
+ `valid continuation reconstructs exactly the original line range`
+ `rejected conflicts return no source text and do not invalidate the cursor`
+ `previously accepted behavior remains intact`
+ `no fallback or alternate authority is introduced`
= `PASS`

Anything less is `RevisionRequired`.

## Document Disposition

`Document.Status=PendingOperatorApproval`
