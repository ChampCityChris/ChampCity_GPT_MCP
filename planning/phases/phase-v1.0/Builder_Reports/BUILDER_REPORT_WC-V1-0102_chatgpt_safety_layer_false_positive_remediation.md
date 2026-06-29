# Builder Report - WC-V1-0102 ChatGPT Safety-Layer False Positive Remediation

## Repository Identity

- Repository path inspected: `C:\Users\<you>\Projects\ChampCity_GPT` (actual local path matched the approved project path)
- Git top level inspected: `C:/Users/<you>/Projects/ChampCity_GPT` (actual local path matched the approved project root)
- Remote inspected: `https://github.com/ChampCityChris/ChampCity_GPT_MCP.git`
- Branch inspected: `main`
- Starting git status: clean (`git status --short` returned no output before this task)
- `package.json`: present

## Source Documents Reviewed

- Attached Codex prompt for `WC-V1-0102 - Remediate ChatGPT safety-layer false positives`
- `AGENTS.MD`
- `package.json`
- `src/server/registerTools.ts`
- `src/tools/gitStatus.ts`
- `src/tools/gitWorkflow/getCommitReadiness.ts`
- `src/tools/gitWorkflow/safety.ts`
- `src/utils/git.ts`
- `scripts/check-release-clean.ps1`
- `scripts/check-publication-clean.ps1`
- `docs/TOOL_REFERENCE.md`
- `docs/SECURITY_MODEL.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`
- `planning/phases/phase-v1.0/WORK_CARD_QUEUE_v1.0.md`

## Tools Inventoried

- Existing read/status tools: `git_status`, `git_diff`, `pre_commit_safety_scan`, `get_commit_readiness`, `list_project_files`
- Existing elevated/internal tool: `run_allowed_script`
- Existing registry/exposure helpers: `tools`, `READ_TOOL_NAMES`, `WRITE_TOOL_NAMES`, `getToolExposureDiagnostics`, `createMcpToolsListResult`, `registerTools`
- Existing safety helpers reused: allowed-root resolution, git runner, short status parsing, staged-file listing, public-safety scanner, audit logging

## Facade Tools Added

- `get_workspace_status_summary`
- `get_change_set_readiness_summary`
- `get_release_artifact_summary`
- `get_release_publication_summary`

All four are registered as `files.read` tools and do not require caller-supplied absolute roots.

## Existing Tools Left Unchanged

- `git_status` behavior and schema remain unchanged.
- `get_commit_readiness` behavior and schema remain unchanged.
- `list_project_files` behavior and schema remain unchanged.
- `run_allowed_script` behavior, schema, write-mode gate, allowlist gate, and elevated approval requirement remain unchanged.

## Descriptions And Schemas Changed

- Added four new narrow input schemas using only allowed facade fields:
  - `workspaceId`
  - `targetBranch`
  - `releaseVersion`
  - `tagName`
  - `includeAssets`
- Clarified `run_allowed_script` description as an internal/elevated exception, not a normal public v1.0 status or release workflow.
- Reworded `push_current_branch` description to avoid risky public-facing wording while preserving behavior.
- Existing mutation-capable tool schemas were not broadened.

## Implementation Summary

- Added `src/tools/publicSafeFacade.ts`.
- Reused existing git and safety helpers instead of duplicating low-level source-control logic.
- Added structured status parsing and relative-path outputs for workspace status.
- Added read-only staged/unstaged/untracked and safety-finding summaries for change set readiness.
- Added internal release-version-to-artifact mapping from `package.json` and `electron-builder.json`.
- Added fixed GitHub Release lookup derived from the configured `origin` remote and `tagName`; no command strings are accepted.
- Added the facade tools to MCP registration, read-tool exposure, and tool-call dispatch.

## Security Controls Preserved

- Allowed-root resolution is still enforced through the configured workspace.
- No OAuth, PKCE, token/session storage, write-mode, write-scope, blocked-file, or public-safety checks were weakened.
- The new tools do not stage, commit, push, tag, package, sign, upload, publish, edit releases, or alter release state.
- Tool outputs use repository-relative paths for changed files and release artifacts.
- Tool outputs do not include raw shell/git command output.
- GitHub publication lookup does not return token values and does not print authentication status.

## Tests Added Or Updated

- Added `tests/publicSafeFacade.test.ts`.
- Updated `tests/toolSchema.test.ts`.

Test coverage added:

- Four facade tools are registered.
- Facade tools are read-only and not write tools.
- Facade schemas do not expose mutation-oriented fields.
- Public-facing descriptions avoid the risky phrases listed in the Work Card.
- `get_workspace_status_summary` returns structured repo state with relative changed paths.
- `get_change_set_readiness_summary` reports staged, unstaged, and untracked files without mutating git state.
- `get_release_artifact_summary` uses `releaseVersion` and internally maps to the expected final artifact.
- `get_release_publication_summary` uses `tagName` and returns sanitized release/asset metadata.
- Outputs avoid unredacted local user paths in normal results.
- Existing blocked-file and public-safety tests remain in the full suite.
- `run_allowed_script` remains unavailable as a recommended public status/release path through docs and description wording.

## Documentation Updated

- `docs/TOOL_REFERENCE.md`
- `docs/SECURITY_MODEL.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`
- `planning/phases/phase-v1.0/WORK_CARD_QUEUE_v1.0.md`

Docs now state:

- ChatGPT-facing status/release checks should use the safe facade tools.
- `run_allowed_script` is not the normal v1.0 ChatGPT-facing workflow.
- Live ChatGPT validation is still required before claiming full remediation.
- The tools are part of remediation for `CAV-011`, `CAV-012`, `CAV-013`, `CAV-021`, `CAV-023`, and `CAV-030`.

## Validation Commands And Results

- `pwd`: pass, current directory matched the approved project path.
- `git rev-parse --show-toplevel`: pass, git root matched the approved project root.
- `git remote -v`: pass, origin references `ChampCityChris/ChampCity_GPT_MCP`.
- `Test-Path package.json`: pass, returned `True`.
- `git status --short`: pass at task start, no output.
- `npm run typecheck`: pass.
- `npm test`: first sandboxed run blocked before tests by esbuild `spawn EPERM`; escalated rerun passed with 212 tests, 0 failures.
- `npm run check:public`: pass, 136 source candidate files checked before this report was created.
- `npm run lint`: pass.
- `npm run build`: pass on escalated run because the local build invokes esbuild, which was sandbox-blocked earlier.
- `git diff --check`: pass; Git printed LF/CRLF working-copy warnings only.
- `git status --short`: inspected after validation.
- Final `npm run check:public` after this report was created: pass, 137 source candidate files checked.
- Final `git diff --check` after this report was created: pass; Git printed LF/CRLF working-copy warnings only.
- Final `git status --short` after this report was created: inspected.

## Correction Note - Release Asset Matching

Initial issue:

- `get_release_publication_summary` treated expected release asset matching as exact GitHub asset-name equality.
- That could produce a false negative for the verified `v0.1.2` baseline where the local artifact is `ChampCity GPT MCP Launcher-0.1.2-x64.exe`, the GitHub Release asset is `ChampCity.GPT.MCP.Launcher-0.1.2-x64.exe`, and both represent the same executable by SHA-256 digest.

Fix:

- Added explicit `expectedAssetMatchMethod` output for release publication checks.
- Matching now checks evidence in this order: normalized SHA-256 digest, exact asset name, conservative separator-normalized asset name, size-only weak evidence, then not matched.
- GitHub asset digests such as `sha256:<hex>` are normalized before comparison with the local final artifact hash.
- Size-only evidence is labeled `size_only` and does not set `expectedAssetMatched` to `true`.
- No release assets are downloaded.

Tests added or updated:

- Digest match succeeds when the local artifact name uses spaces, the GitHub asset name uses dots, and SHA-256 values match.
- Exact asset-name matching still succeeds and reports `exact_name`.
- Digest mismatch with a separator-normalized similar name does not report a SHA-256 match.
- Missing local artifact plus no matching asset name returns `expectedAssetMatched: false`, reports `not_matched`, and includes warnings.

Validation for this correction pass:

- `npm run typecheck`: pass.
- `npm test`: initial sandboxed run was blocked by esbuild `spawn EPERM`; escalated rerun passed with 215 tests, 0 failures.
- `npm run check:public`: pass, 137 source candidate files checked.
- `npm run lint`: pass.
- `npm run build`: pass on escalated run because the local build invokes esbuild.
- `git diff --check`: pass; Git printed LF/CRLF working-copy warnings only.
- `git status --short`: inspected.

Release state mutation:

- No GitHub Release was created, edited, deleted, published, or mutated.
- No release asset was uploaded, downloaded, renamed, or deleted.

## Validation Skipped And Reasons

- MCP protocol self-test skipped because WC-V1-0103 has not implemented it yet.
- Live ChatGPT validation was not performed in this Builder pass. Required follow-up: run CAV-011, CAV-012, CAV-013, CAV-021, CAV-023, and CAV-030 from CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md.
- Packaging was skipped because this Work Card did not request packaging.
- UI visual validation was skipped because no Electron UI layout or visual change was made.

## Live ChatGPT Validation Status

Not performed.

Full remediation must not be claimed until the operator validates the new facade tools from a live ChatGPT conversation.

## Remaining Manual Validation Required

- In a new ChatGPT conversation, verify `tools/list` includes the four facade tools.
- Call `get_workspace_status_summary`.
- Call `get_change_set_readiness_summary`.
- Call `get_release_artifact_summary` for a known release version.
- Call `get_release_publication_summary` for a known tag.
- Confirm the known false-positive workflows are no longer required for normal ChatGPT status/release diagnostics.

## Protected Subsystems Touched

Yes - MCP tool discovery/exposure changed in a narrow, approved way for WC-V1-0102.

Changed files:

- `src/server/registerTools.ts`
- `src/tools/publicSafeFacade.ts`

No OAuth/DCR behavior, PKCE behavior, MCP transport behavior, public endpoint behavior, Cloudflare behavior, runtime path/AppData behavior, local config persistence, token/session storage, admin password handling, files.write enforcement, server lifecycle, packaging/release configuration, Figma Make extraction architecture, preload API, or `window.champcity` API behavior was modified.

## Scope Changed

No.

The work stayed limited to the architect-specified safe read-only facade layer, focused tests, docs, and this Builder Report.

## Known Residual Risks

- Live ChatGPT safety-layer behavior is not proven by local tests.
- `workspaceId` currently supports only `default`; a broader public profile/workspace system remains a later Work Card dependency.
- GitHub release lookup can be blocked by network, rate limiting, private repository visibility, or unavailable GitHub API responses; the tool reports blockers instead of mutating state.
- Legacy tools remain registered for compatibility; later profile/toolset work may further restrict public exposure.

## Recommended Next Work Card

`WC-V1-0103 - Add MCP protocol self-test for release validation`, followed by operator-assisted live ChatGPT validation evidence under `WC-V1-0104`.

## Fallback

No fallback implementation was used.

## Final Git Status At Report Creation

```text
 M docs/CHATGPT_CONNECTION_GUIDE.md
 M docs/SECURITY_MODEL.md
 M docs/TOOL_REFERENCE.md
 M planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md
 M planning/phases/phase-v1.0/WORK_CARD_QUEUE_v1.0.md
 M src/server/registerTools.ts
 M tests/toolSchema.test.ts
?? planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0102_chatgpt_safety_layer_false_positive_remediation.md
?? src/tools/publicSafeFacade.ts
?? tests/publicSafeFacade.test.ts
```

Nothing was staged, committed, tagged, pushed, packaged, published, uploaded, or released.
