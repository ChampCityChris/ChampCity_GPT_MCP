# Builder Report: WC-MCP-PLANNING-RELIABILITY-01

Work Card: MCP Planning-Corpus Reliability and Bulk Review Support

## Repository Verification

- Working directory verified: `<PROJECT_REPO>`
- Git top-level verified: `<PROJECT_REPO>`
- Remote verified: `https://github.com/ChampCityChris/ChampCity_GPT_MCP.git`
- `package.json` present: yes
- Branch at start: `dev`
- Starting HEAD: `032d7891dce02efe75a7c0e7265781937a7c85ad`

## Root Causes

- `list_files` used a glob match against repository-root-relative paths. The toolbox schema defaulted `glob` to `*`, so listing a populated nested directory could return no files because entries such as `planning/phases/phase-04/file.md` do not match `*`.
- `search_files` used a separate traversal from `list_files` and `read_file`, always started at the workspace root, and searched only file contents. Exact repository-relative path and filename queries could miss files that `read_file` could read.
- `list_files`, `search_files`, and `read_file` did use separate path/traversal implementations before this work. `list_files` and `read_file` resolved requested paths directly; `search_files` resolved only the allowed root and walked independently.

## Implementation Summary

- Added a shared repository traversal helper with repository-relative normalization, Windows/POSIX separator support, containment checks, symlink skipping, file-policy checks, and structured diagnostics.
- Updated `repo_toolbox.list_files` to use the shared traversal and return requested path, normalized path, path existence, directory status, recursion/filter settings, returned count, warning, and error code diagnostics.
- Updated `repo_toolbox.search_files` to use the shared traversal, support `scopePath`, return exact path and filename matches, preserve content matching, and report `searchSources`.
- Extended `artifact_toolbox.list_artifacts` with backward-compatible filters for source-only, record kind, derived/sidecar inclusion, artifact type arrays, status arrays, and path prefix.
- Added non-authoritative `recordKind` classification: `source`, `sidecar`, or `derived`.
- Added `artifact_toolbox.export_planning_corpus`, restricted to `planning/`, returning paginated manifests, SHA-256 hashes over file bytes, read status, full-text bundles with boundaries, unsupported/binary reporting, and coverage counts.
- Improved `current_action_context` diagnostics with reason codes, checked locations, workspace root, expected configuration source, invalid-candidate status, authority source on success, and remediation text.
- Added an MCP tooling correctness validation lane note to `docs/dev/VALIDATION_COMMAND_LANES.md`.
- Updated tool documentation for list/search semantics, artifact filtering/classification, planning export, full-text accounting, hash semantics, and current-action behavior.

## API Changes

- `repo_toolbox.search_files` now accepts optional `scopePath`.
- `repo_toolbox.list_files` responses now include `requestedPath` and `diagnostics`.
- `repo_toolbox.search_files` responses now include `scopePath`, `diagnostics`, `searchSources`, and match `matchType`.
- `artifact_toolbox.list_artifacts` accepts additional optional filters while preserving the previous complete view by default.
- `artifact_toolbox.export_planning_corpus` was added as a read-only planning-corpus action.
- `artifact_toolbox.current_action_context` returns additional diagnostic fields.

## Backward Compatibility

- Existing toolbox action names remain available.
- Existing `list_files.files`, `list_files.truncated`, `search_files.matches`, and artifact listing fields remain present.
- The default `list_artifacts` call remains the complete inventory view; source-only behavior requires explicit filtering.

## Tests Added

- Nested populated phase directory listing.
- Nested `Implementer_Reports` listing.
- Windows-style and POSIX-style repository-relative paths.
- Exact path, exact filename, and content search.
- Empty directory and missing directory diagnostics.
- Path traversal rejection.
- Source, sidecar, and derived artifact classification.
- Source-only artifact filtering.
- Planning-corpus manifest counts and SHA-256 hashes.
- Full-text pagination and binary/unsupported reporting.
- Current-action `not_configured` diagnostics.

## Validation

- Command: `npm run validate:codex:unit`
- Required lane: normal Windows validation wrapper.
- First sandbox attempt: failed with documented `spawn EPERM` during esbuild; not treated as application failure.
- Approved lane rerun: passed.
- Result: 305 tests passed, 0 failed.

## Stop Conditions and Gaps

- No current-action authority was inferred or fabricated.
- No workflow-state store, transition authority, canonical artifact registry, generic command runner, browser scraping, screenshot fallback, or persistent export artifact was added.
- No Phase 05 planning conclusions were modified.
- Persistent corpus export files remain a separate architecture decision.
- A canonical current-action source selection workflow remains a separate architecture decision.

## Files Changed

- `src/tools/repoTraversal.ts`
- `src/tools/listProjectFiles.ts`
- `src/tools/searchProjectFiles.ts`
- `src/tools/artifactCatalog.ts`
- `src/tools/domainToolboxes.ts`
- `tests/domainToolboxes.test.ts`
- `tests/artifactCatalog.test.ts`
- `docs/TOOL_REFERENCE.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `docs/dev/VALIDATION_COMMAND_LANES.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-MCP-PLANNING-RELIABILITY-01.md`

## Manual Validation

Manual ChatGPT/MCP validation was not performed by Codex. Operator should run the work-card manual validation checklist in a new ChatGPT connector conversation.

## Final Git Status

Changes are intentionally left unstaged. Expected changed-file inventory is the files listed above.

## Remaining Passes

- Human MCP validation of `list_files`, `search_files`, `list_artifacts`, `export_planning_corpus`, and `current_action_context`.
- Architect/operator decision on canonical current-action authority.
- Architect/operator decision on any persistent export location and lifecycle.
