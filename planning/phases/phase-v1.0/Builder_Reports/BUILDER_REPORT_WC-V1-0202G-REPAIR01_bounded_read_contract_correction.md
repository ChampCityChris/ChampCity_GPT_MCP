# Builder Report: WC-V1-0202G-REPAIR01

## Summary

Implemented the bounded read contract correction for cursor scope, range preservation, artifact identity, corpus text delivery, and bounded-result telemetry.

No fallback implementation was used.

## Files Changed For This Repair

- `src/tools/textProjection.ts`
- `src/tools/artifactCatalog.ts`
- `src/tools/domainToolboxes.ts`
- `src/server/resultTelemetry.ts`
- `src/server/resultDeliveryTrace.ts`
- `src/server/toolCallTrace.ts`
- `tests/textProjection.test.ts`
- `tests/artifactCatalog.test.ts`
- `tests/resultDeliveryTrace.test.ts`
- `tests/httpTransport.test.ts`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202G-REPAIR01_bounded_read_contract_correction.md`

## Protected Subsystems

No protected subsystem outside the work-card scope was intentionally changed.

The public HTTP MCP path was exercised by tests, but OAuth, MCP transport routing, Cloudflare, token storage, write-scope enforcement, server lifecycle, packaging, and tool discovery/exposure were not intentionally modified for this repair.

## Scope

Scope did not change during implementation.

No alternate cursor authority, duplicate telemetry store, fallback text field, unbounded envelope, generic JSON byte-range protocol, or alternate artifact identity mechanism was added.

## Implementation Notes

- Text projection cursors now bind `mode`, `hardEndOffset`, `artifactId`, and `artifactComponent` where applicable.
- `read_text_chunk`, `read_text_lines`, `read_markdown_section`, and `read_artifact_text_chunk` reject wrong-action cursor use.
- Cursor continuations reject conflicting request identifiers instead of ignoring them.
- Line-range continuation preserves the original hard end offset and stops at that range.
- Returned line counts are calculated from source byte coverage rather than splitting returned text.
- Artifact text cursors bind to the resolved artifact ID and Markdown component; cursor-only continuation reports the original artifact.
- `read_artifact_by_id(component="both")` preserves both components when Markdown is bounded. JSON is inlined when safely bounded, or explicitly deferred with reason and replacement guidance.
- `export_planning_corpus(includeFullText=true)` now returns actual bounded text through MCP content items while keeping source text out of structured metadata.
- Result telemetry now records bounded serializer dimensions: completion/truncation, chunked state, chunk index/count where known, source SHA, byte range, and continuation presence.

## HTTP Proof Requests

Focused public HTTP MCP proof was added in `tests/httpTransport.test.ts`:

1. `repo_toolbox` `read_text_lines`
   - params: `relativePath=docs/range.md`, `startLine=2`, `maximumLines=2`, `maximumBytes=12`
   - proof: first bounded chunk returned with `complete=false` and a cursor.
2. `repo_toolbox` `read_text_lines`
   - params: `cursor=<line-range cursor>`, `maximumBytes=12`
   - proof: continuation reconstructs exactly `line-2-is-long-enough-to-split\nline-3\n` and never returns line 4.
3. `repo_toolbox` `read_text_chunk`
   - params: `cursor=<line-range cursor>`
   - proof: response is a contract rejection.
4. `diagnostics_toolbox` `result_delivery_status`
   - params: `resultAttemptId=<receipt from first bounded read>`
   - proof: `serializerName=bounded-text-v1`, `truncated=true`, `chunked=true`, `sourceRangeStart=7`, `continuationPresent=true`.

## Supporting Automated Proof

- Line range continuation remains bounded to the original requested range.
- Wrong-action cursor use is rejected for line-range and full-text/Markdown cross-use.
- Conflicting `relativePath` is rejected.
- Artifact A cursor-only continuation reports artifact A.
- Artifact A cursor plus artifact B ID is rejected.
- Corpus full-text export includes actual source text MCP items and no `content` field in structured `fullText` metadata.
- Bounded `component="both"` returns bounded Markdown and inlined small JSON.
- Bounded result telemetry is exposed through `result_delivery_status` without document content.

## Validation Performed

- `npm run validate:codex:unit`
  - lane: normal Windows validation lane, rerun outside sandbox after documented `spawn EPERM`
  - result: PASS, 417 tests passed
  - includes build, full regression tests, HTTP MCP tests, and MCP self-test test coverage
- `npm run lint`
  - lane: local command, TypeScript no-emit
  - result: PASS
- `git diff --check`
  - lane: local command
  - result: PASS
- `npm run mcp:self-test`
  - lane: rerun outside sandbox after documented `spawn EPERM`/git subprocess failures
  - result: PASS, 23 checks passed

## Validation Not Performed

- Packaging was not run; it is explicitly out of scope.
- Runtime promotion was not run.
- Live ChatGPT connector validation was not run.
- Subjective UI or visual validation was not applicable.

## Validation Blocker

- `npm run check:public` failed because pre-existing dirty file `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202G_bounded_text_projection_and_safety_resilient_read_protocol.md` contains a local private path/user value.
- That file was already present in the dirty worktree and was not changed for this repair.

## Dirty State Accounting

The worktree already contained unrelated modified and untracked files before this repair began. Those were not reverted or cleaned.

Nothing was staged, committed, pushed, packaged, promoted, restarted, reconnected, published, or released.

## Operator Validation

Remaining operator validation is limited to any desired live ChatGPT connector confirmation of the bounded public tool behavior. Automated public HTTP MCP coverage was added and passed in the normal validation lane.
