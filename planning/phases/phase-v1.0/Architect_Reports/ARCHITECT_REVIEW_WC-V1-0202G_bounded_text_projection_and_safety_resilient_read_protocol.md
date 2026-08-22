# Architect Review — WC-V1-0202G Bounded Text Projection and Safety-Resilient Read Protocol

Date: 2026-08-01
Repository: `ChampCityChris/ChampCity_GPT_MCP`
Workspace: `%USERPROFILE%\Projects\ChampCity_GPT`
Branch reviewed: `dev`
Starting and final HEAD: `db6aa399716db271f2b38a6927de33f0f29a55ec`
Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202G_bounded_text_projection_and_safety_resilient_read_protocol.md`
Work Card: `planning/phases/phase-v1.0/Work_Cards/WC-V1-0202G_bounded_text_projection_and_safety_resilient_read_protocol.md`
Disposition: RevisionRequested

## Executive Disposition

WC-V1-0202G is not approved for integration, packaging, promotion, restart, reconnect, live ChatGPT validation, or commencement of WC-V1-0202H.

The implementation establishes the intended shared projection architecture and passes the repository validation suite. Code review nevertheless identified one bounded public-contract defect set: continuation scope, artifact identity, corpus text delivery, telemetry accuracy, line-count accuracy, and requested component preservation can diverge from the Operator's request.

One combined repair is authorized:

`planning/phases/phase-v1.0/Work_Cards/WC-V1-0202G-REPAIR01_cursor_scope_range_and_artifact_identity.md`

The previously proposed REPAIR02 is superseded and must not be implemented separately.

## Accepted Foundation

The repair must preserve these implemented behaviors:

- files above 16,384 bytes use bounded MCP content items;
- ordinary sequential chunks reconstruct exact source bytes and SHA-256;
- Markdown headings use source-SHA/position-derived section IDs;
- section reads exclude the next equal or higher heading;
- cursor signatures detect tampering and source revision changes;
- artifact Markdown reads delegate to `textProjection.ts`;
- all seven toolbox action inventories are exposed;
- unsupported `read_markdown_artifact` is a contract rejection with bounded alternatives;
- no content encoding or obfuscation fallback was introduced.

## Verified Defects and Causes

### 1. Line-range continuation can escape the requested range

`readTextLines()` supplies the requested range end only to the first chunk. The continuation cursor retains the next offset but not the original hard range end. Following the cursor through `read_text_chunk` can therefore continue to end-of-file.

### 2. Cursor action and artifact identity are not enforced

The cursor binds workspace, path, source SHA, and offset, but not an enforced operation mode or artifact identity.

Consequences:

- a Markdown section cursor can be used through `read_text_chunk` and escape the section;
- a supplied path can be silently ignored when a cursor is present;
- artifact A's cursor can be supplied with artifact B and return A's text labeled with B metadata.

### 3. `includeFullText=true` returns no text

`readFullTextEntry()` removes source text through `boundedTextStructuredContent()`. Corpus export then returns through the generic metadata-only path. The public result contains chunk metadata and cursors but no source text.

### 4. Bounded-result telemetry is inaccurate

`resultTelemetry.measureToolResult()` reads the bounded serializer name but hardcodes:

- `chunked: false`;
- `truncated: false`.

It also omits available chunk index, source SHA, byte range, and continuation state.

### 5. Returned line count can be wrong

`returnedLineCount` is derived by splitting text. A chunk ending with a newline produces a trailing empty entry and can overcount the exact source-line coverage.

### 6. `component="both"` can silently lose JSON

For a large Markdown component, the hidden bounded payload becomes the public result after JSON is added to the ordinary response object. The requested JSON component can disappear without an explicit deferred status.

## Evidence Gap

The Builder Report states the acceptance mapping is complete, but existing tests do not prove:

- byte-bounded line-range continuation;
- operation-bound cursor enforcement;
- artifact ID/cursor mismatch rejection;
- actual corpus text delivery;
- accurate bounded telemetry through the public HTTP MCP path;
- mixed endings and no-final-newline line-count accuracy;
- both-component preservation when Markdown is bounded.

The tests pass because they exercise successful ordinary reconstruction and one-chunk line ranges, not these failure paths.

## Independent Validation

Independent validation through ChampCity MCP completed successfully:

- typecheck: PASS;
- full build/test lane: PASS;
- 414 tests passed, 0 failed;
- HEAD unchanged;
- staged files: 0.

The active packaged connector still exposes the old action inventory because package, promotion, restart, and reconnect were not authorized. That expected runtime state is not the basis for this disposition.

## Required Correction

The combined REPAIR01 must make the existing public result contract truthful and exact:

- cursors must preserve operation, range, source, and artifact identity;
- conflicting identifiers and wrong-action continuation must fail as contract rejections;
- corpus `includeFullText=true` must return actual bounded text;
- bounded telemetry must describe the actual chunk and range;
- returned line counts must reflect exact source coverage;
- requested artifact components must be returned or explicitly deferred, never silently dropped.

No second cursor authority, duplicate telemetry store, unbounded result, generic JSON range engine, or alternate artifact identity mechanism is authorized.

## Progression Boundary

Do not begin WC-V1-0202H until the combined REPAIR01 Builder Report is reviewed and approved.

This review did not reset, restore, clean, stash, stage, commit, push, merge, integrate, package, promote, restart, reconnect, publish, or release anything.

## Final Disposition

WC-V1-0202G disposition: RevisionRequested

Document.Status=RevisionRequested
