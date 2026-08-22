# Builder Report: WC-V1-0202G-REPAIR02

Work Card: `planning/phases/phase-v1.0/Work_Cards/WC-V1-0202G-REPAIR02_line_range_continuation_identifier_integrity.md`

## Summary

Implemented the narrow line-range cursor identity repair. `line_range` cursors now bind the immutable original range identity in the signed cursor payload and every continuation rejects conflicting request identifiers before any source-text content item is returned.

No fallback implementation was used. No alternate cursor authority, duplicate cursor store, server-side cursor session state, alternate read engine, or unrelated text-projection redesign was introduced.

## Files Changed By This Repair

- `src/tools/textProjection.ts`
- `tests/textProjection.test.ts`
- `tests/httpTransport.test.ts`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202G-REPAIR02_line_range_continuation_identifier_integrity.md`

Note: `src/tools/textProjection.ts` and `tests/textProjection.test.ts` were already untracked before this repair, and `tests/httpTransport.test.ts` already had unrelated uncommitted changes before this repair. This repair changed only the line-range cursor identity implementation and focused proof in those files.

## Cursor Fields Added

The signed `line_range` cursor payload now carries:

- `lineRangeStartLine`
- `lineRangeMaximumLines`
- `lineRangeStartOffset`
- `lineRangeHardEndOffset`

`decodeCursor()` rejects `line_range` cursors missing this original identity, and verifies `hardEndOffset` matches `lineRangeHardEndOffset`. `chunkFromRange()` preserves these fields into continuation cursors. `readTextLines()` removed the ineffective `chunkIndex === 0` limitation and now compares continuation-supplied `startLine` and `maximumLines` directly to the immutable original identifiers.

## Public HTTP MCP Proof

Focused public HTTP MCP proof was added to `tests/httpTransport.test.ts` using `runHttpTransport()` and real `/mcp` `tools/call` requests with OAuth `files.read`.

Fixture:

```text
line-1
line-2-is-long-enough-to-split
line-3
line-4-must-not-return
```

Exact requests proven:

- JSON-RPC id `20`: `repo_toolbox.read_text_lines` with `relativePath: "docs/range.md"`, `startLine: 2`, `maximumLines: 2`, `maximumBytes: 12`.
- JSON-RPC ids `21+`: `repo_toolbox.read_text_lines` with cursor only and `maximumBytes: 12`.
- JSON-RPC id `30`: same cursor plus repeated exact `relativePath`, `startLine: 2`, `maximumLines: 2`, `maximumBytes: 12`.
- JSON-RPC id `32`: same cursor plus conflicting `startLine: 3`.
- JSON-RPC id `33`: same cursor plus conflicting `maximumLines: 3`.
- JSON-RPC id `34`: same cursor plus `startLine: 1`, `maximumLines: 3`, a different identifier pair that calculates the same hard end offset.
- JSON-RPC id `35`: same cursor plus conflicting `relativePath: "docs/other.md"`.
- JSON-RPC id `36`: same cursor used again after rejected conflicts.

Observed proof:

- Cursor-only continuation reconstructed exactly `line-2-is-long-enough-to-split\nline-3\n`.
- The following line, `line-4-must-not-return`, was not returned.
- Repeating exact identifiers succeeded and returned the expected next chunk.
- Conflicting `startLine`, conflicting `maximumLines`, same-hard-end different identifiers, and conflicting `relativePath` each returned toolbox error details with `classification: "contract_rejection"`.
- Trace diagnostics classified JSON-RPC ids `32`, `33`, `34`, and `35` as `APP_CONTRACT_REJECTED`.
- Rejected conflict results did not include the fixture source text content item.
- The same cursor remained usable after rejections; JSON-RPC id `36` succeeded with the expected continuation chunk.

## Direct Focused Proof

`tests/textProjection.test.ts` now mirrors the same contract directly through `repoToolbox`:

- cursor-only continuation reconstructs the original range exactly;
- repeated exact identifiers succeed;
- conflicting `startLine`, conflicting `maximumLines`, and same-hard-end different identifiers reject with `contract_rejection`;
- rejected direct calls return no `mcpContent`;
- the same cursor remains usable after rejected conflicts.

## Validation

Execution lane: normal Windows validation lane. No sandbox-only `spawn EPERM` failure occurred.

- `npm run typecheck`: PASS.
- `npm run validate:codex:build`: PASS.
- `node --test dist/tests/textProjection.test.js dist/tests/httpTransport.test.js`: PASS, 77 tests.
- `npm run validate:codex`: PASS, 417 tests, followed by build.
- `npm run mcp:self-test`: PASS, 23 checks.
- `npm run lint`: PASS.
- `git diff --check`: PASS. It emitted CRLF normalization warnings for existing dirty files but no whitespace errors.
- `npm run check:public`: FAIL due to known unrelated historical record:
  - `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202G_bounded_text_projection_and_safety_resilient_read_protocol.md`
  - matched a private local Windows user-profile path value
  - matched the corresponding local username token

One mistaken validation command was attempted before the correct full wrapper:

- `npm run validate:codex:full`: FAIL, npm script does not exist. The correct full wrapper is `npm run validate:codex`, which passed.

## Dirty-State Accounting

The worktree was dirty before this repair. Pre-existing modified files included docs, security, server, transport, toolbox, utility, and test files outside the narrow Repair02 implementation. Pre-existing untracked planning records, `src/server/resultDeliveryTrace.ts`, `src/server/resultTelemetry.ts`, `src/tools/textProjection.ts`, `tests/resultDeliveryTrace.test.ts`, and `tests/textProjection.test.ts` were also present before this repair.

After this repair, no files were staged, committed, pushed, packaged, promoted, restarted, reconnected, published, or released.

## Scope Confirmation

- Protected OAuth, PKCE, token storage, Cloudflare, runtime path/AppData config, packaging/release, write-scope enforcement, and server lifecycle behavior were not modified by this repair.
- Public HTTP transport production code was not modified; only HTTP tests were expanded for proof.
- `read_text_chunk`, `read_markdown_section`, and `read_artifact_text_chunk` behavior was not changed.
- Artifact identity, corpus export, bounded telemetry, delivery receipts, and acknowledgement behavior were not modified.
- No fallback implementation was used.

## Remaining Operator Validation

No visual or interactive Operator validation is required for this repair. The only remaining non-pass validation item is the known unrelated publication-cleanliness failure in the historical WC-V1-0202G Builder Report, which was not modified because this card explicitly forbids unrelated historical planning-record cleanup.

`Document.Status=BuilderComplete`
