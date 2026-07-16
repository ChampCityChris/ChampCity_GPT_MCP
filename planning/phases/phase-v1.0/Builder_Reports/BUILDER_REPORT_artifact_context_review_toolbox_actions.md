# Builder Report - Artifact Context and Review Toolbox Actions

## Objective

Add six read-only actions to the existing `artifact_toolbox` without creating a new top-level MCP tool:

- `list_artifacts`
- `read_artifact_by_id`
- `latest_artifact`
- `artifact_pair_status`
- `current_action_context`
- `review_queue`

## Repository Verification

- Current working directory: `C:\Users\chapm\Projects\ChampCity_GPT`
- Git top-level: `C:/Users/chapm/Projects/ChampCity_GPT`
- Remote: `https://github.com/ChampCityChris/ChampCity_GPT_MCP.git`
- Starting branch: `dev`
- Starting HEAD: `4e16c81f71d86cc02bb3517e8ff1df0705f1143c`
- Starting status: clean
- `package.json`: present

## Files Reviewed

- `AGENTS.MD`
- `docs/dev/VALIDATION_COMMAND_LANES.md`
- `package.json`
- `package-lock.json`
- `electron-builder.json`
- `src/server/registerTools.ts`
- `src/tools/domainToolboxes.ts`
- `src/tools/builderReportFacade.ts`
- `src/workspaces.ts`
- `src/security/pathPolicy.ts`
- `src/security/filePolicy.ts`
- `docs/TOOL_REFERENCE.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- Existing toolbox, builder-report, MCP schema, architect-tool, and self-test tests

## Authorities Discovered

- Artifact catalog: no single persisted authoritative artifact catalog existed. Added an internal read model that prefers registry records, then JSON sidecars, structured Markdown front matter, path conventions, and file metadata.
- Artifact registry: optional read-only registry files are recognized at `.champcity/artifact-registry.json`, `planning/artifact-registry.json`, `planning/artifacts/artifact-registry.json`, and phase-scoped `planning/phases/<phase>/artifact-registry.json`.
- Hash authority: existing raw SHA-256 utility patterns were present. New pair status computes raw component file SHA-256 by streaming bytes.
- Canonical payload hash authority: not configured. `artifact_pair_status` reports `payloadHash.status = "not_configured"` and does not substitute `JSON.stringify`.
- Current-action authority: no existing workflow engine or transition authority existed. Added read-only support for structured current-action files at `.champcity/current-action.json`, `planning/current-action.json`, `planning/workflow/current-action.json`, and phase-scoped equivalents. If absent, the action returns `not_configured`.
- Review-state authority: no global review queue existed. The catalog uses explicit structured `reviewStatus` values from registry or JSON sidecars only. If no structured review state exists, `review_queue` returns `review_authority_not_configured`.

## Public Toolbox Boundary

- Public seven-toolbox surface preserved: yes.
- New top-level MCP tool added: no.
- Existing artifact actions preserved: yes.
- `artifact_toolbox` public description updated to mention discovery, ID reads, latest selection, pair status, current-action context, and Architect review queues.
- Diagnostic inventory now includes `artifact_toolbox` action metadata.

## Actions Added

### `list_artifacts`

Strict params: `phaseId`, `artifactType`, `workCardId`, `limit`, `cursor`.

Behavior:

- Requires `workspaceId` through the existing toolbox envelope.
- Filters use AND semantics.
- Sorts by `modifiedAt` descending, then `artifactId` ascending.
- Paginates with server-returned numeric cursors.
- Returns repository-relative paths only.

### `read_artifact_by_id`

Strict params: `artifactId`, `component`.

Behavior:

- Resolves by artifact ID, registry ID, or pair ID.
- Default `component` is `preferred`.
- Markdown content is bounded and reports truncation.
- JSON is parsed only when the complete bounded JSON component can be returned.
- Oversized JSON returns metadata/hash and `content_too_large`.

### `latest_artifact`

Strict params: `phaseId`, `artifactType`, `workCardId`, `includeContent`.

Behavior:

- Uses the same structured filters and sort order as `list_artifacts`.
- Returns the first matching artifact.
- Optional content uses the same bounded read policy as `read_artifact_by_id`.

### `artifact_pair_status`

Strict params: `artifactId`.

Behavior:

- Reports Markdown, JSON, registry, identity, and payload hash status separately.
- Computes raw SHA-256 over exact on-disk bytes.
- Reports invalid JSON, missing components, registry path mismatches, ID mismatches, revision mismatches, and hash mismatches.
- Does not repair, rewrite, rehash, register, or update artifacts.

### `current_action_context`

Strict params: `phaseId`.

Behavior:

- Reads only structured current-action JSON authority files.
- Returns current action, expected output, source bundle, controlling files, and blockers.
- Does not infer from prose, branch names, newest files, or builder reports.
- Does not advance or mutate workflow state.

### `review_queue`

Strict params: `phaseId`, `artifactType`, `workCardId`, `limit`, `cursor`.

Behavior:

- Includes only explicit structured states meaning Architect review is pending.
- Normalizes output state to `awaiting_architect_review`.
- Preserves source review status.
- Excludes drafts, operator review, approved, rejected, and WIP states unless explicitly resubmitted for Architect review.
- Sorts by submitted time descending when available, then modified time descending, then artifact ID ascending.

## Artifact ID Resolution

Priority:

1. Registry `artifactId` or `id`.
2. JSON sidecar `artifactId` or `id`.
3. Structured Markdown front matter `artifactId` or `id`.
4. Deterministic derived ID from workspace ID plus normalized logical artifact path.

Derived IDs use SHA-256 and are stable for the same workspace-relative logical identity. They are not treated as evidence that a registry entry exists.

## Metadata Precedence

Priority:

1. Registry record.
2. JSON sidecar.
3. Structured Markdown front matter.
4. Repository path conventions.
5. File metadata.

The implementation does not extract phase IDs, Work Card IDs, statuses, or review decisions from arbitrary prose.

## Pair Synchronization Semantics

- Markdown and JSON existence are evaluated independently.
- Stored component hashes are compared when present.
- Registry path, artifact ID, pair ID, and revision fields are compared when present.
- Missing optional unconfigured authorities are reported explicitly.
- `synchronized` is returned only when configured required checks pass.
- Semantic Markdown/JSON equivalence is not claimed.

## Workspace and Path Protections

- Workspace resolution uses the existing trusted workspace registry.
- All returned paths are workspace-relative.
- Absolute paths, traversal, and metadata paths outside the workspace are rejected.
- Symlink and junction escapes are guarded by realpath containment where files exist.
- Scans are limited to configured workspace roots and bounded artifact roots.
- Dependency, build, release, generated, log, coverage, and git directories are excluded from catalog scans.
- Caller-provided paths, registry paths, hash algorithms, file extensions, search expressions, and executable operations are not accepted by the new actions.

## Tests Added

Added `tests/artifactCatalog.test.ts` covering:

- New action acceptance.
- Existing artifact action preservation.
- Unknown parameter rejection.
- Registry-backed discovery.
- JSON-sidecar discovery.
- Markdown/JSON pair deduplication.
- Stable and derived IDs.
- Phase, type, Work Card, and combined filters.
- Modified-time sorting and artifact-ID tie-breaks.
- Pagination.
- Markdown, JSON, both, preferred-component reads.
- Missing component handling.
- Invalid JSON reporting.
- Large JSON omission.
- SHA-256 reporting.
- Latest-artifact selection and bounded content.
- Pair hash mismatch, missing component, invalid JSON, and no mutation.
- Current-action configured and not-configured behavior.
- Review queue inclusion/exclusion and sorting.
- Unsafe metadata path rejection.
- No absolute paths in action output.

## Validation Commands and Results

Execution lane: normal Windows validation lane, per `docs/dev/VALIDATION_COMMAND_LANES.md`.

- `npm run typecheck`: pass.
- `npm run build`: pass.
- `node --test dist/tests/artifactCatalog.test.js`: first sandbox attempt produced known sandbox-only `spawn EPERM`; rerun in normal Windows lane passed.
- `npm run validate:codex:unit`: pass. This ran `npm test`, which ran build plus `node --test dist/tests/*.test.js`.
- `npm test` result through wrapper: 302 tests passed, 0 failed.
- `git diff --check`: pass, with CRLF working-copy warnings only.

## Build Results

- Production build command: `npm run build`
- Result: pass.

## Packaging Results

- Packaging command: `npm run app:package`
- Result: pass.
- Final portable executable: `C:\Users\chapm\Projects\ChampCity_GPT\release\ChampCity GPT MCP Launcher-0.2.1-x64.exe`
- LastWriteTime: `2026-07-16T14:42:32.433Z`
- Size: `96041947`
- SHA-256: `08ac615da738d930a3d08560efbd5a2e1c6e585e50fe51fed92c2f6b64adee64`
- Packaging log: `logs/package/package-portable-0.2.1.log`
- Temporary portable package processes left by packaging were stopped. No ChampCity packaged processes remained afterward.

## Packaged MCP Registration

Command: repository-owned fixed packaged startup diagnostic via `validatePackagedElectronStartup`.

Result: pass.

Observed packaged diagnostic milestones:

- `app_ready`
- `mcp_subsystem_module_loaded`
- `runtime_versions`
- `mcp_tool_registration_validated`
- `window_created`
- `dom_ready`
- `renderer_initialized`
- `preload_bridge_not_directly_observable`
- `clean_shutdown_requested`
- `will_quit`

Exit code: `0`
Shutdown: `clean`

## Files Changed

- `src/tools/artifactCatalog.ts`
- `src/tools/domainToolboxes.ts`
- `src/server/registerTools.ts`
- `tests/artifactCatalog.test.ts`
- `docs/TOOL_REFERENCE.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_artifact_context_review_toolbox_actions.md`

## Protected Subsystems

- MCP public tool exposure was touched only to update the existing `artifact_toolbox` description and action dispatch. No new top-level MCP tool was added.
- MCP transport, OAuth, Cloudflare, token storage, runtime path behavior, preload API contracts, and write-scope enforcement were not changed.
- Packaging configuration was not changed; existing packaging workflow was run.
- Git commit automation was used only because the prompt explicitly requested a commit after validation.

## Missing Authorities and Resulting Behavior

- Canonical payload hash authority: not configured; reported as `not_configured`.
- Semantic Markdown/JSON equivalence authority: not configured; not implemented.
- Workflow transition authority: not configured; not implemented.
- Approval/revision-request authority: not configured; not implemented.
- Review assignment/ownership authority: not configured; not implemented.
- Historical current-action context: not configured; not implemented.

## Known Limitations

- Catalog discovery is a bounded read model, not a new persistent artifact database.
- Invalid JSON sidecars expose only conservative quoted identity metadata so malformed artifacts can be reported; invalid JSON is not treated as valid payload.
- Current-action context depends on structured current-action JSON files; absent files return `not_configured`.
- Review queue depends on explicit structured review states; prose and directory names are ignored.
- Builder report cannot embed the final self-referential commit hash before commit creation; final commit hash is reported in the final response.

## Manual Validation Required

- Launch the packaged application.
- Reconnect or refresh ChampCity MCP in ChatGPT.
- Confirm the public MCP surface still contains exactly seven toolboxes.
- Ask `artifact_toolbox` for supported actions and confirm all six new actions are available.
- Run the six new actions against real workspace artifacts.
- Confirm existing Builder Report, release-summary, and image-evidence actions still work.

## Fallbacks

No fallback implementation was used.

## Final Git Status Before Commit

At report creation time, expected modified/untracked files were:

```text
 M docs/CHATGPT_CONNECTION_GUIDE.md
 M docs/TOOL_REFERENCE.md
 M src/server/registerTools.ts
 M src/tools/domainToolboxes.ts
?? planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_artifact_context_review_toolbox_actions.md
?? src/tools/artifactCatalog.ts
?? tests/artifactCatalog.test.ts
```
