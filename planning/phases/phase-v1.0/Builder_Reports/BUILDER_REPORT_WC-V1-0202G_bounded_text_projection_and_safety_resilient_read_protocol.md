# Builder Report: WC-V1-0202G Bounded Text Projection and Safety-Resilient Read Protocol

## Summary

Implemented a shared bounded text projection protocol for repository and Markdown artifact reads. The public read path can now inspect text metadata without body content, read exact bounded chunks, read explicit line ranges, read Markdown sections by source-SHA-bound section IDs, continue through integrity-protected cursors, and avoid duplicating substantive text inside structured JSON metadata.

No fallback implementation was used.

## Repository Identity

- Repository root: `C:\Users\chapm\Projects\ChampCity_GPT`
- Git toplevel: `C:/Users/chapm/Projects/ChampCity_GPT`
- Remote: `https://github.com/ChampCityChris/ChampCity_GPT_MCP.git`
- Starting HEAD/final HEAD observed: `db6aa399716db271f2b38a6927de33f0f29a55ec`
- `package.json`: present

## Dirty State

Starting dirty state included pre-existing modified files and untracked WC-V1-0104B telemetry/report files, including the unrelated `docs/CHATGPT_CONNECTION_GUIDE.md` modification called out by the work card. Those unrelated changes were preserved; no reset, restore, stash, stage, commit, push, merge, package, promote, restart, reconnect, publish, or release action was performed.

Final dirty state remains dirty because this implementation is intentionally left unstaged and because pre-existing unrelated work remains present.

## Files Changed by This Card

- `src/tools/textProjection.ts`
- `src/tools/readProjectFile.ts`
- `src/tools/domainToolboxes.ts`
- `src/tools/toolboxActionPolicy.ts`
- `src/tools/artifactCatalog.ts`
- `src/server/resultTelemetry.ts`
- `tests/textProjection.test.ts`
- `tests/artifactCatalog.test.ts`
- `tests/toolboxActionPolicy.test.ts`
- `docs/TOOL_REFERENCE.md`
- `docs/SECURITY_MODEL.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `docs/RELEASE_NOTES.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202G_bounded_text_projection_and_safety_resilient_read_protocol.md`

Pre-existing dirty/untracked files outside this scope remain in the working tree.

## Architecture

`src/tools/textProjection.ts` is the shared text-read authority. It owns UTF-8 validation, byte-preserving source loading, line indexing, line-ending classification, Markdown heading indexing, stable SHA/position-derived section IDs, HMAC-protected cursors, bounded chunk selection, line reads, section reads, SHA-256 integrity metadata, and bounded MCP content item construction.

Repository reads delegate to this module through:

- `repo_toolbox.inspect_text_file`
- `repo_toolbox.read_text_chunk`
- `repo_toolbox.read_text_lines`
- `repo_toolbox.read_markdown_section`
- larger `repo_toolbox.read_file` results

Artifact Markdown reads delegate to the same module through:

- `artifact_toolbox.inspect_artifact_text`
- `artifact_toolbox.read_artifact_text_chunk`
- larger `artifact_toolbox.read_artifact_by_id`
- `latest_artifact(includeContent=true)`
- `export_planning_corpus(includeFullText=true)`

`list_artifacts` remains metadata-only.

## Public Bounds

- Inline full-content threshold: `16,384` UTF-8 bytes.
- Default chunk target: `8,192` UTF-8 bytes.
- Hard public content item cap: `16,384` UTF-8 bytes.
- Default chunk line target: `240` lines.
- Hard line cap: `1,000` lines.
- Heading index default: `200` headings.
- Heading index hard cap: `1,000` headings.
- Source read gate: existing public `maxBytes` gates remain bounded at `500,000` bytes for toolbox reads.

Raising `maxBytes` cannot force a large single public content item.

## Cursor and Integrity Controls

Cursors are prefixed `tp1`, signed with HMAC-SHA-256, short-lived, and bound to workspace ID, normalized repository-relative path, source SHA-256, byte offset, chunk index, and optional section identity/end offset. Tampering returns contract rejection. Source changes invalidate continuation and require re-inspection.

Chunks include source SHA-256, chunk SHA-256, exact byte offsets, exact line ranges, returned byte/line counts, completion state, retry action, retryable flag, next cursor, and chunk index. Structured metadata omits the substantive returned text.

## Serializer Shapes

Bounded text responses use:

- `bounded-text-v1` for chunk and line reads.
- `bounded-markdown-section-v1` for section reads.

The MCP result content contains one short metadata text item plus one bounded text item with the exact source chunk. Structured content contains metadata, hashes, ranges, cursors, retry metadata, and the WC-V1-0104B model-visible delivery receipt after materialization. The full text is not duplicated in structured content.

`src/server/resultTelemetry.ts` now reports the explicit bounded serializer name/version when present in structured content.

## Action Contracts

`toolboxActionPolicy.ts` now provides canonical action-contract metadata for diagnostics. `diagnostics_toolbox.mcp_tool_inventory` reports all seven toolboxes and includes `toolboxActionContracts`. `diagnostics_toolbox.describe_toolbox_action` returns the canonical contract for one action.

Unsupported toolbox actions remain `INVALID_INPUT`, which classifies as `APP_CONTRACT_REJECTED`. The fixed unsupported-action mapping recommends bounded alternatives for `artifact_toolbox.read_markdown_artifact`.

## Canary Fixtures and Reconstruction Evidence

`tests/textProjection.test.ts` generates deterministic benign canaries for:

- education terms;
- medical administration terms;
- cybersecurity governance terms;
- financial compliance terms;
- violence-prevention policy terms;
- mixed long-form Markdown with Unicode and boundary-sensitive words.

Variants cover approximately 4 KB, 8 KB, 16 KB, 32 KB, 41 KB, and 64 KB. The tests reconstruct sequential chunks and assert exact string equality, exact SHA-256 equality, CRLF/LF preservation, Unicode preservation, bounded item sizes, and no content duplication in structured metadata.

No canary content or real document content is written to logs by the implementation.

## Acceptance Mapping

- Inspect metadata/no body: covered by `tests/textProjection.test.ts`.
- Heading index with stable section IDs/ranges: covered.
- 41 KB fixture through bounded chunks/read_file: covered.
- Sequential reconstruction exact bytes/SHA: covered.
- Inline threshold and raised `maxBytes` cap: covered.
- Line reads: covered.
- Markdown sections and pagination: covered.
- Cursor binding, tamper rejection, stale-source invalidation: covered.
- UTF-8, CRLF/LF, Unicode, no hidden ellipsis path: covered.
- Artifact Markdown bounded delegation: covered.
- `latest_artifact(includeContent=true)` bounded: covered.
- Planning corpus full-text export bounded: covered.
- No full content duplication in structured metadata: covered.
- Contract inventory and `describe_toolbox_action`: covered.
- `read_markdown_artifact` unsupported alternatives: covered.
- Existing broad tests, MCP self-test, check-public, lint, and diff-check: passed as listed below.

Live ChatGPT connector acceptance remains operator validation and was not performed under this card.

## Validation

Validation lane document read first: `docs/dev/VALIDATION_COMMAND_LANES.md`.

Commands run:

- `pnpm typecheck`  
  Lane: sandbox TypeScript lane. Result: pass.
- `pnpm build`  
  Initial sandbox lane result: failed with known `spawn EPERM` from esbuild. Approved normal Windows lane rerun: pass.
- `node --test dist\tests\textProjection.test.js`  
  Initial sandbox lane result: failed with known Node test runner `spawn EPERM`. Approved normal Windows lane rerun: pass, 7/7 tests.
- `npm run validate:codex:unit`  
  Lane: approved normal Windows validation wrapper. First run exposed two old test expectations; after test updates, rerun passed, 414/414 tests.
- `npm run mcp:self-test`  
  Lane: approved normal Windows lane. Result: pass, 23 checks passed.
- `npm run check:public`  
  Lane: approved normal Windows lane. Result: pass, 271 source candidate files checked.
- `npm run lint`  
  Lane: TypeScript no-emit lint lane. Result: pass.
- `git diff --check`  
  Lane: local git whitespace check. Result: pass. It emitted CRLF normalization warnings only; no whitespace errors.

## Validation Not Performed

- Live ChatGPT connector validation was not performed.
- Packaging was not performed.
- Runtime promotion was not performed.
- Connector restart/reconnect was not performed.
- Playwright/browser/screenshot validation was not performed.
- Subjective UI validation was not performed.

## Protected Subsystems

Protected subsystem touched: yes, but only within the card's explicit scope. Public MCP toolbox action routing/contract discovery and result-telemetry serializer reporting were modified to expose bounded read actions and report bounded serializers. OAuth, PKCE, token/session storage, Cloudflare, MCP HTTP transport behavior, endpoint behavior, write-scope enforcement, server lifecycle, packaging, and Git automation behavior were not changed by this card.

## Scope and Fallback Confirmation

- Scope did not change during implementation.
- No content-obfuscation fallback was used.
- No screenshot, scraping, browser, clipboard, encoding, compression, redaction, paraphrase, or alternate architecture fallback was implemented.
- WC-V1-0202H workspace capability/Git isolation behavior was not implemented.
- No Git command is executed by the new text projection actions.
- Nothing was staged, committed, pushed, integrated, packaged, promoted, restarted, reconnected, published, or released.

## Remaining Operator Validation

After Architect approval and separately authorized package/promotion/reconnect:

1. Inspect and chunk the Revisionary Architect Interview through ChatGPT.
2. Repeat with education/minors, medical administration, cybersecurity governance, financial compliance, violence-prevention, and mixed long-form canaries.
3. Verify source SHA, chunk coverage, delivery receipts, and acknowledgement/status flow.
4. If ChatGPT blocks a chunk, retry the same cursor with a smaller byte limit and record redacted delivery-status evidence.
