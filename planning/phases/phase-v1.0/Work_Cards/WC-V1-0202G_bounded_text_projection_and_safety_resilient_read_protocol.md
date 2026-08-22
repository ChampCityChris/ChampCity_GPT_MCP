# WC-V1-0202G — Bounded Text Projection and Safety-Resilient Read Protocol

## Work Card Identity

- ID: `WC-V1-0202G`
- Title: Bounded Text Projection and Safety-Resilient Read Protocol
- Phase: v1.0 — ChatGPT Connector and Safety-Layer Reliability
- Priority: P0
- Type: Public read-protocol hardening
- Repository: `%USERPROFILE%\Projects\ChampCity_GPT`
- Remote: `ChampCityChris/ChampCity_GPT_MCP`
- Branch at authorization: `dev`
- Starting HEAD at authorization: `db6aa399716db271f2b38a6927de33f0f29a55ec`
- Depends on: `WC-V1-0104B`
- Controlling RCA: `planning/phases/phase-v1.0/Architect_Reports/CODE_REVIEW_RCA_OPENAI_SAFETY_LAYER_FALSE_POSITIVES_AND_GIT_COUPLING_2026-07-31.md`
- Required Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202G_bounded_text_projection_and_safety_resilient_read_protocol.md`

## Authorization Basis

The controlling RCA determined that repository and artifact text reads can return tens or hundreds of kilobytes as one JSON-escaped MCP text item. A single host-side safety false positive therefore prevents the caller from consuming the entire controlling document. The existing public actions do not provide exact line ranges, opaque cursors, Markdown heading indexes, section reads, or a deterministic retry path.

The exact 41,389-byte Revisionary Architect Interview later read successfully through `repo_toolbox.read_file`, proving that the document is not deterministically prohibited. The workflow nevertheless remains fragile because success depends on one opaque platform decision over one large result.

This card is authorized to replace large single-result dependence with a bounded, exact, auditable text-projection protocol. It is not authorization to encode or disguise content to bypass platform safety.

## Sequencing and Isolation

Implement only after `WC-V1-0104B` is approved or its result-delivery telemetry contracts are available on the implementation branch.

Do not implement workspace/Git capability migration from `WC-V1-0202H` under this card.

The repository contains an unrelated tracked modification outside this work card: `docs/CHATGPT_CONNECTION_GUIDE.md`. Preserve it and every other unrelated change discovered at implementation start exactly. Do not reset, restore whole files, clean, stash, discard, stage, commit, push, merge, integrate, package, promote, restart, reconnect, publish, or release.

## Objective

Provide one shared text-read authority that allows ChatGPT to inspect arbitrary safe text and Markdown files through bounded exact projections. The protocol must:

- inspect a file without returning its full content;
- expose stable metadata, line counts, and Markdown headings;
- read bounded exact chunks using opaque server-issued cursors;
- read bounded line ranges when explicit lines are needed;
- read Markdown sections with deterministic pagination;
- preserve exact source semantics and prove integrity with hashes;
- return content through bounded MCP content items rather than one large JSON-escaped object;
- provide complete action-contract discovery;
- give the caller an explicit supported retry after any blocked or incomplete result; and
- support repository, artifact, and planning-corpus workflows without duplicating read engines.

## Non-Goals and Prohibited Approaches

This card must not:

- disable, evade, or misrepresent OpenAI safety systems;
- base64-, hex-, URL-, ROT-, compress-, encrypt-, fragment-, or obfuscate text for the purpose of avoiding classification;
- remove words such as `student`, `minor`, `teacher`, `weapon`, `medical`, or other sensitive terms from source content;
- rewrite controlling documents before they are read;
- silently omit blocked sections;
- use LLM-generated summaries as substitutes for exact source inspection;
- add arbitrary filesystem commands;
- add arbitrary byte-range reads that can split UTF-8 unsafely;
- create parallel repository and artifact implementations with inconsistent semantics;
- make Git a prerequisite for reading or projecting text.

## Mandatory Implementation Scope

### 1. Create a shared text projection module

Create a focused module, expected as:

- `src/tools/textProjection.ts`; or
- `src/tools/textReadProtocol.ts`.

The shared module must own:

- file inspection;
- UTF-8 validation;
- newline normalization metadata without altering returned source text;
- line indexing;
- Markdown heading indexing;
- opaque cursor creation and validation;
- exact chunk selection;
- line-range reads;
- section-range reads;
- chunk/source hashing;
- content-item construction metadata;
- size and count limits.

Repository and artifact toolboxes must delegate to this module rather than maintain separate range logic.

### 2. Add `repo_toolbox.inspect_text_file`

Add a read-scoped action:

`repo_toolbox.inspect_text_file`

Required parameters:

- `relativePath`
- optional `includeHeadingIndex`, default `true` for `.md`
- optional `maximumHeadings` within a strict server bound.

Required result fields:

- workspace ID;
- relative path;
- file size bytes;
- modified timestamp;
- source SHA-256;
- encoding: `utf-8` when valid;
- byte-order-mark presence;
- line ending classification: `lf`, `crlf`, `mixed`, or `none`;
- line count;
- maximum line byte length;
- Markdown detected boolean;
- bounded heading index when applicable;
- recommended chunk bytes;
- recommended first action/cursor;
- full-content result intentionally omitted.

Heading entries must include:

- stable section ID derived from source SHA plus heading position, not heading text alone;
- heading level;
- bounded heading text;
- start line;
- end line when determinable;
- approximate section bytes.

The heading index must not include body excerpts.

### 3. Add `repo_toolbox.read_text_chunk`

Add a read-scoped action:

`repo_toolbox.read_text_chunk`

Required parameters:

- `relativePath` on first call or an opaque server cursor on continuation;
- optional `maximumBytes`, with a safe default and hard cap;
- optional `maximumLines`, with a safe default and hard cap;
- optional expected source SHA for stale-file detection.

Required server defaults:

- default content target no greater than `8,192` UTF-8 bytes;
- hard public maximum no greater than `16,384` UTF-8 bytes per content item;
- server may return fewer bytes to preserve line and UTF-8 boundaries.

Required result fields:

- source SHA-256;
- chunk SHA-256;
- exact start/end line;
- exact start/end byte offsets in the source;
- returned byte count;
- returned line count;
- complete boolean;
- next opaque cursor or null;
- stale-source boolean;
- truncation reason when bounded by bytes or lines;
- result-delivery receipt from `WC-V1-0104B`.

Cursor requirements:

- opaque and integrity-protected;
- bound to workspace, normalized path, source SHA, and next offset;
- bounded lifetime or invalidated by source changes;
- not a raw absolute path;
- not caller-editable JSON;
- replay safe for read-only continuation;
- cursor mismatch returns `APP_CONTRACT_REJECTED`, not path-policy denial.

### 4. Add `repo_toolbox.read_text_lines`

Add a read-scoped action for explicit source references:

`repo_toolbox.read_text_lines`

Required parameters:

- `relativePath`
- `startLine`, one-based;
- `maximumLines`
- optional `maximumBytes`
- optional expected source SHA.

Required behavior:

- never split UTF-8 code points;
- prefer whole lines;
- if one source line exceeds the hard byte cap, return metadata identifying the oversized line and a safe bounded prefix/suffix policy only if exact reconstruction is possible through explicit continuation;
- reject invalid line ranges as contract errors;
- detect stale source SHA;
- return exact line numbers and hashes;
- no hidden ellipsis inside returned content.

### 5. Add `repo_toolbox.read_markdown_section`

Add a read-scoped action:

`repo_toolbox.read_markdown_section`

Required parameters:

- `relativePath`
- `sectionId` obtained from `inspect_text_file`
- optional continuation cursor;
- optional maximum bytes/lines within public bounds;
- optional expected source SHA.

Required behavior:

- section ID must resolve only against the exact source SHA;
- include the selected heading and section body up to, but not including, the next heading of equal or higher level;
- nested subordinate headings remain part of the section;
- paginate long sections through the same opaque cursor mechanism;
- return exact section start/end lines and chunk range;
- stale or unknown section IDs are contract errors with a recommendation to re-inspect the file.

### 6. Change `repo_toolbox.read_file` default delivery behavior

Preserve the existing action name for compatibility, but change its public behavior for larger files.

Required behavior:

- files at or below a conservative inline threshold may still return complete content;
- the default inline threshold must be no greater than `16,384` UTF-8 bytes;
- files above the threshold return file metadata plus the first bounded chunk and a continuation cursor;
- the result must state `contentComplete: false` and recommend `read_text_chunk`;
- a public caller must not be able to request a 500 KB single text item by raising `maxBytes`;
- `maxBytes` continues to limit whether the file may be inspected/read, but it must not override the public content-item cap;
- internal/local tests may retain a non-public full-read helper when genuinely required;
- file hashes and exact ranges must prove that no content was silently skipped.

Backward compatibility documentation must explicitly identify this as a safer result-shaping change, not a content-access reduction.

### 7. Use bounded MCP content items

Refactor text result construction so content is not duplicated inside one large `JSON.stringify` wrapper.

Required public response shape for text projections:

- one short metadata text item or structured metadata envelope;
- one bounded text content item containing only the requested chunk;
- optional additional bounded text items only when each remains under the cap and the total result remains bounded;
- structured content containing metadata, hashes, ranges, cursors, and delivery receipt;
- the full text must not also appear in structured content.

Required serializer identifiers:

- `bounded-text-v1` for one chunk;
- `bounded-markdown-section-v1` for section reads;
- any later serializer version must be explicit.

The general toolbox serializer may remain for small non-content results, but substantive text actions must use the bounded content-aware path.

### 8. Integrate artifact reads with the shared projection protocol

Do not create another full-text engine inside `artifactCatalog.ts`.

Required artifact actions:

- retain `list_artifacts` as metadata-only and bounded;
- add `artifact_toolbox.inspect_artifact_text` or make `read_artifact_by_id` return an exact `textHandle` for the preferred Markdown component;
- add `artifact_toolbox.read_artifact_text_chunk` only if a repository-relative path cannot safely be reused through the repository action;
- preferred design: resolve artifact ID to a safe component handle, then delegate to the shared text projection module;
- `read_artifact_by_id` for Markdown larger than the inline threshold must return metadata plus a bounded first chunk/cursor rather than up to 200 KB in one field;
- `latest_artifact(includeContent=true)` must use the same bounded projection;
- `export_planning_corpus(includeFullText=true)` must paginate files and text chunks rather than place up to 500 KB into one result.

Artifact IDs, component handles, and cursors must be bound to workspace and source SHA.

### 9. Add complete action-contract discovery

Extend `diagnostics_toolbox.mcp_tool_inventory` so it reports all seven toolboxes, not only a subset.

Required per-action contract metadata:

- toolbox name;
- action name;
- required OAuth scope;
- read/write classification;
- accepted parameter names;
- required parameters;
- parameter primitive types;
- bounded numeric/string limits;
- response serializer/mode;
- whether content may be returned;
- whether continuation is supported;
- deprecation state;
- replacement action when deprecated.

Add a read-scoped action:

`diagnostics_toolbox.describe_toolbox_action`

Required parameters:

- `toolboxName`
- `actionName`

It must return the same canonical contract authority used for validation, not handwritten duplicate documentation.

Unsupported action responses must include:

- classification: contract rejection;
- complete supported action list for that toolbox;
- closest exact supported alternatives from a fixed mapping, not fuzzy arbitrary execution;
- for `read_markdown_artifact`, recommend:
  - `repo_toolbox.inspect_text_file` plus `read_text_chunk`; or
  - `artifact_toolbox.list_artifacts` plus the bounded artifact text path.

### 10. Add deterministic retry metadata

Every bounded text result must include:

- `retryable: true` when continuation exists;
- `retryAction`;
- next cursor;
- source SHA;
- prior result-attempt ID when the call is a retry;
- chunk index where known.

A retry must never silently change serializer, source revision, or chunk boundaries without reporting the change.

### 11. Add safety false-positive canary fixtures

Create benign committed text fixtures designed to exercise host-classifier ambiguity without containing prohibited instructions.

Required fixture categories:

- education: students, minors, teachers, grades, educational records, safeguarding policy;
- medical administration: patients, prescriptions, hospital scheduling without medical treatment advice;
- cybersecurity governance: malware policy, incident response, credential rotation without exploit instructions;
- financial compliance: sanctions, suspicious activity, money laundering controls without evasion guidance;
- violence-prevention policy: weapons prohibition and school safety without operational harm instructions;
- mixed neutral long-form Markdown containing the same terms at multiple chunk boundaries.

Fixture requirements:

- clearly labeled benign purpose;
- no real PII;
- no secrets;
- no sexual content involving minors;
- no instructions for wrongdoing;
- deterministic generated size variants such as approximately 4 KB, 8 KB, 16 KB, 32 KB, and 64 KB;
- stable SHA fixtures or deterministic generation tests;
- words and headings intentionally straddle chunk boundaries.

These fixtures are for deterministic serializer/unit tests and later live connector validation. The implementation card must not run live ChatGPT validation.

### 12. Add source-integrity and reconstruction proof

Tests must reconstruct the original fixture from sequential chunks and prove:

- exact byte equality;
- exact SHA-256 equality;
- exact line ordering;
- no omitted, duplicated, reordered, normalized, or inserted characters;
- CRLF and LF source files reconstruct correctly;
- Unicode and multi-byte characters are preserved;
- chunk continuation is deterministic for the same source SHA and limits.

## Expected Production Files

Expected new files:

- `src/tools/textProjection.ts` or equivalent
- `src/tools/textProjectionCursor.ts` if cursor authority is separated
- bounded result serializer module if not created by `WC-V1-0104B`

Expected modified files:

- `src/tools/readProjectFile.ts`
- `src/tools/domainToolboxes.ts`
- `src/tools/toolboxActionPolicy.ts`
- `src/server/registerTools.ts`
- `src/tools/artifactCatalog.ts`
- `src/security/filePolicy.ts` only if required for shared bounds
- `src/security/diagnosticRedaction.ts` only for new metadata fields
- input-limit definitions
- focused tests and documentation.

Do not implement the entire protocol inline in `domainToolboxes.ts`. That file is already oversized and must only route validated actions into focused modules.

## Required Deterministic Acceptance Tests

1. `inspect_text_file` returns metadata and no body text.
2. Markdown heading index reports stable section IDs and exact line ranges.
3. A 41 KB education fixture is returned through bounded chunks with no item above the hard cap.
4. Sequential chunks reconstruct the exact original bytes and SHA.
5. The exact Revisionary Architect Interview can be inspected and chunked in a controlled local fixture or configured-workspace test without a full single-item result.
6. Default `read_file` returns complete content only below the inline threshold.
7. Larger `read_file` returns the first bounded chunk and continuation.
8. Raising `maxBytes` cannot create an oversized public content item.
9. `read_text_lines` returns exact requested line numbers.
10. `read_markdown_section` excludes the next equal/higher heading and includes nested headings.
11. Long sections paginate without duplication or omission.
12. Cursor is bound to workspace, path, source SHA, and offset.
13. Tampered cursor is a contract rejection.
14. Source modification invalidates the cursor and requires re-inspection.
15. Path traversal and symlink/reparse protections remain enforced.
16. UTF-8 multi-byte characters are never split.
17. LF, CRLF, mixed, and no-final-newline files reconstruct exactly.
18. Oversized single lines use a documented exact continuation path.
19. Artifact Markdown reads delegate to the shared projection semantics.
20. `latest_artifact(includeContent=true)` remains bounded.
21. Planning corpus full-text export is paginated and bounded.
22. No full content is duplicated into structured metadata.
23. Result-delivery telemetry reports `bounded-text-v1` and accurate dimensions.
24. Complete action inventory includes repo, git, artifact, diagnostics, integration, browser, and knowledge toolboxes.
25. `describe_toolbox_action` is derived from canonical validation contracts.
26. `read_markdown_artifact` returns a contract rejection with correct alternatives.
27. Unsupported action is not classified as a policy denial.
28. Canary fixture variants reconstruct exactly.
29. No canary content or real document content appears in logs.
30. Existing OAuth, workspace, path, artifact, image, patch, Git, trace, and redaction tests remain passing.
31. Internal public top-level tool count remains unchanged.
32. No Git command is executed by the new text projection actions.

## Documentation Requirements

Update:

- `docs/TOOL_REFERENCE.md`
- `docs/SECURITY_MODEL.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `docs/RELEASE_NOTES.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`

Documentation must include:

- exact public content-item caps;
- inline threshold behavior;
- inspect/chunk/line/section examples;
- cursor and stale-source semantics;
- action-contract discovery instructions;
- deterministic retry sequence;
- explicit prohibition on content obfuscation or encoding to bypass safety systems;
- statement that bounded delivery reduces blast radius but cannot guarantee OpenAI host acceptance.

## Validation Requirements

Read `docs/dev/VALIDATION_COMMAND_LANES.md` before child-process-capable commands.

Run in order:

1. repository-defined typecheck;
2. focused text projection, cursor, serializer, artifact integration, action-contract, and canary tests;
3. repository-defined build;
4. broader repository unit lane for touched shared modules;
5. repository-defined MCP self-test;
6. `npm run check:public` if present;
7. lint;
8. `git diff --check`.

Do not use Playwright.
Do not package or promote.
Do not start, stop, or restart the active connector.
Do not reconnect ChatGPT.
Do not perform live connector validation under this implementation card.

## Builder Report Requirements

The Builder Report must include:

- repository identity and starting HEAD;
- starting/final dirty state;
- exact files changed;
- preservation of the unrelated `docs/CHATGPT_CONNECTION_GUIDE.md` modification and all other unrelated work;
- shared projection architecture;
- public thresholds and hard caps;
- cursor construction and integrity controls;
- exact serializer shapes;
- artifact/corpus delegation design;
- action-contract authority and unsupported-action recommendations;
- canary fixture inventory and benign-purpose statement;
- exact reconstruction evidence;
- acceptance-test mapping;
- validation commands and results;
- validation not performed;
- blockers and assumptions;
- confirmation that no content-obfuscation fallback was used;
- confirmation that no Git behavior from `WC-V1-0202H` was implemented;
- confirmation that nothing was staged, committed, pushed, integrated, packaged, promoted, restarted, reconnected, published, or released.

## Stop Conditions

Stop before or during implementation rather than improvising if:

- exact source reconstruction cannot be proven;
- a cursor cannot be integrity-bound without storing document content;
- the MCP SDK cannot return bounded text content plus structured metadata as required;
- artifact reads cannot safely delegate to the shared projection module;
- the only proposed workaround is content encoding, redaction, paraphrase, or obfuscation;
- action-contract discovery would require exposing arbitrary schemas or executable actions;
- the implementation would weaken allowed-root, symlink/reparse, file-size, OAuth, or write-mode controls;
- the implementation requires Git for text reads;
- live ChatGPT behavior is required to make deterministic tests pass;
- `WC-V1-0104B` telemetry contracts are unavailable or incompatible.

## Manual Validation After Codex

After Architect approval and separately authorized package/promotion/reconnect:

1. inspect the exact Revisionary Architect Interview;
2. read it sequentially through bounded chunks;
3. acknowledge each delivery attempt or final consumed result as configured;
4. verify exact source SHA and complete coverage;
5. repeat with the education/minors canary at multiple sizes;
6. repeat with medical, cybersecurity, financial-compliance, and violence-prevention canaries;
7. record whether any attempt is blocked by the ChatGPT host;
8. if blocked, retry the same source with the next smaller bounded limit;
9. export the delivery-status evidence without document content;
10. confirm that a blocked chunk does not invalidate prior or later chunks.

These live steps are not authorized under this implementation card.

## Remaining Passes

After implementation:

- Architect review of the Builder Report;
- `WC-V1-0202H` workspace capability and Git isolation implementation;
- separately authorized integration/commit if approved;
- separately authorized package and promotion;
- live ChatGPT canary matrix and exact Revisionary workflow reproduction;
- OpenAI escalation package if false positives persist;
- final acceptance-matrix disposition.

## Document Disposition

Document.Status=ApprovedForImplementation
