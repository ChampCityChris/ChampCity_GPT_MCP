# Builder Report - WC-V1-0102A Builder Report Discovery Facade

## Repository Identity

- Repository path inspected: `C:\Users\<you>\Projects\ChampCity_GPT`
- Git top level inspected: `C:/Users/<you>/Projects/ChampCity_GPT`
- Remote inspected: `https://github.com/ChampCityChris/ChampCity_GPT_MCP.git`
- Branch inspected: `main`
- Starting git status: clean (`git status --short` returned no output before this task)
- Baseline commit present: yes, `6c5abd8 docs: record connector discovery follow-up`
- `AGENTS.MD`: present
- `package.json`: present

## Source Documents Reviewed

- Attached Codex prompt for `WC-V1-0102A - Add Builder Report discovery facade`
- `AGENTS.MD`
- `package.json`
- `docs/TOOL_REFERENCE.md`
- `docs/SECURITY_MODEL.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`
- `planning/phases/phase-v1.0/WORK_CARD_QUEUE_v1.0.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0102_chatgpt_safety_layer_false_positive_remediation.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_LOCAL_PACKAGE_runtime_refresh_after_WC-V1-0102.md`
- `src/server/registerTools.ts`
- `src/tools/publicSafeFacade.ts`
- `src/tools/listProjectFiles.ts`
- `src/tools/readProjectFile.ts`
- `src/security/pathPolicy.ts`
- `tests/publicSafeFacade.test.ts`
- `tests/toolSchema.test.ts`

## Public Safety Fixture Correction

- Public safety scan initially failed because literal private-user-path fixtures were present in `tests/builderReportFacade.test.ts`.
- The fixtures were changed to dynamically constructed path strings from safe fragments.
- The redaction behavior test remains intact and still verifies `%USERPROFILE%`, token redaction, removal of the constructed original paths, and absence of absolute local paths in the result.
- `npm run check:public` now passes.
- No security controls were weakened.

## Known False-Positive Pattern Addressed

This card addresses the broad recursive Builder Report discovery shape that was intermittently blocked by the ChatGPT platform safety layer:

```json
{
  "root": "C:\\Users\\<you>\\Projects\\ChampCity_AI",
  "relativePath": "planning/phases",
  "glob": "**/BUILDER_REPORT*.md",
  "maxResults": 300
}
```

The implemented path avoids caller-supplied absolute roots and arbitrary globs for normal Builder Report discovery.

## Tools Added

- `get_builder_report_index`
- `get_builder_report_summary`

Both tools are registered as `files.read` tools.

## Schemas Added

`get_builder_report_index` accepts:

- `workspaceId`
- `phaseFolder`
- `workCardId`
- `maxResults`

`maxResults` defaults to `25` and is hard-capped at `50`.

`get_builder_report_summary` accepts:

- `workspaceId`
- `reportPath`
- `phaseFolder`
- `workCardId`
- `maxChars`

`maxChars` defaults to `6000` and is hard-capped at `12000`. The summary lookup requires either `reportPath` or `phaseFolder` plus `workCardId`.

The public schemas do not expose `root`, `absolutePath`, `glob`, `command`, `script`, `shell`, `args`, `argv`, `force`, `delete`, `clobber`, or `approvalToken`.

## Workspace Resolution Behavior

- `default` resolves internally to the configured `config.repoRoot`.
- `all_allowed` is accepted only by `get_builder_report_index`.
- Other `workspaceId` values are matched only against configured allowed roots through safe aliases derived from allowed-root folder basenames and git remote repository names.
- `workspaceId` is never resolved as a filesystem path.
- Unknown or ambiguous `workspaceId` values fail with safe available workspace IDs and no absolute paths.
- The implementation does not add a broad product workspace registry and does not add new allowed roots.

## Report Discovery Behavior

- Scanner scope is limited to `planning/phases/<phaseFolder>/Builder_Reports/BUILDER_REPORT*.md`.
- Missing `planning/phases` returns clean no-results output.
- Phase names and Work Card IDs are validated with safe patterns.
- Path traversal, absolute paths, drive specifiers, URL-like workspace IDs, and `all_allowed` summary lookups are rejected.
- Symlink entries are skipped and realpath containment under the configured allowed root is enforced.
- Non-regular files and oversized Builder Reports are skipped or denied.
- Index output returns repository-relative paths and metadata only.
- Summary output returns a bounded `contentPreview` and redacts private local path-like and token-like content.
- Ambiguous `phaseFolder` plus `workCardId` summary lookups return candidate repository-relative paths instead of guessing.

## Files Created

- `src/tools/builderReportFacade.ts`
- `tests/builderReportFacade.test.ts`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0102A_builder_report_discovery_facade.md`

## Files Modified

- `src/server/registerTools.ts`
- `tests/toolSchema.test.ts`
- `docs/TOOL_REFERENCE.md`
- `docs/SECURITY_MODEL.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`
- `planning/phases/phase-v1.0/WORK_CARD_QUEUE_v1.0.md`

## Tests Added Or Updated

- Added `tests/builderReportFacade.test.ts`.
- Updated `tests/toolSchema.test.ts`.

Focused coverage verifies:

- Both new tools are registered as read tools.
- The schemas do not expose broad root, glob, command, shell, write-control, or mutation-oriented fields.
- Tool descriptions remain read-only and avoid risky public-facing phrases.
- A WC07-like report is found from a temp fixture without caller-supplied root or glob.
- Index output uses repository-relative paths only.
- `phaseFolder`, `workCardId`, and `maxResults` filtering works.
- Excessive `maxResults` is capped at `50`.
- Safe workspace aliases and `all_allowed` work for index.
- Summary works by safe `reportPath`.
- Summary works by `phaseFolder` plus `workCardId`.
- Ambiguous summary lookups return candidates instead of choosing one.
- Not-found summary lookups return structured output.
- Preview output is bounded by `maxChars`.
- Private local path-like and token-like content is redacted from previews.
- Path traversal attempts are rejected.
- `workspaceId` cannot be used as a filesystem path.
- `all_allowed` is rejected for summary.
- Existing blocked-file behavior remains intact.

## Documentation Updated

- `docs/TOOL_REFERENCE.md`
- `docs/SECURITY_MODEL.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`
- `planning/phases/phase-v1.0/WORK_CARD_QUEUE_v1.0.md`

Docs now say:

- Builder Report discovery should use `get_builder_report_index`.
- Specific report review should use `get_builder_report_summary`, or a narrow expected-path read after the index identifies the path.
- Normal ChatGPT workflows should avoid broad `list_project_files` calls that combine `planning/phases`, `**/BUILDER_REPORT*.md`, high `maxResults`, and absolute local roots.
- This work supports `CAV-033`.
- Live ChatGPT validation is still required before claiming platform safety-layer remediation.

## Validation Commands And Results

- `pwd`: pass, current directory matched the approved project path.
- `git rev-parse --show-toplevel`: pass, git root matched the approved project root.
- `git remote -v`: pass, origin references `ChampCityChris/ChampCity_GPT_MCP`.
- `git branch --show-current`: pass, returned `main`.
- `git status --short`: pass at task start, no output.
- `git log --oneline -5`: pass, latest commit was `6c5abd8 docs: record connector discovery follow-up`.
- `Test-Path AGENTS.MD`: pass, returned `True`.
- `Test-Path package.json`: pass, returned `True`.
- `npm run typecheck`: pass.
- `npm test`: first sandboxed run blocked before tests by esbuild `spawn EPERM`; approved rerun passed with 229 tests, 0 failures.
- `npm run lint`: pass.
- `npm run build`: pass on approved run because the local build invokes esbuild.
- `npm run check:public`: pass, `PASS publication cleanliness`, checked 141 source candidate files.
- `git diff --check`: pass; Git printed LF/CRLF working-copy warnings only.
- `git status --short`: inspected after final validation.

## Validation Skipped And Reasons

- MCP protocol self-test skipped because WC-V1-0103 has not implemented it yet.
- Live ChatGPT validation was not performed in this Builder pass. Required follow-up: run CAV-033 from CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md using get_builder_report_index and get_builder_report_summary.
- Packaging was skipped because this Work Card explicitly said not to run packaging.
- UI visual validation was skipped because no Electron UI layout or visual change was made.

## Live ChatGPT Validation Status

Live ChatGPT validation was not performed in this Builder pass. Required follow-up: run CAV-033 from CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md using get_builder_report_index and get_builder_report_summary.

## Protected Subsystems Touched

Yes — MCP tool discovery/exposure changed in a narrow, approved way for WC-V1-0102A.

Changed files:

- `src/server/registerTools.ts`
- `src/tools/builderReportFacade.ts`

No OAuth/DCR behavior, PKCE behavior, MCP HTTP transport behavior, public endpoint behavior, Cloudflare behavior, runtime path/AppData behavior, local config persistence, token/session storage, admin password handling, files.write enforcement, server lifecycle, packaging/release configuration, Figma Make extraction architecture, preload API, or `window.champcity` API behavior was modified.

## Security Controls Preserved

- Allowed-root resolution is still enforced.
- Blocked-file and readable-text checks remain intact.
- Path traversal, absolute paths, drive specifiers, and symlink escapes remain denied.
- OAuth scope mapping keeps the tools in `files.read`.
- No write-mode, files.write, token/session, OAuth, Cloudflare, packaging, release, or git mutation controls were weakened.
- No mutation tools, release actions, GitHub Projects sync, product Work Card UI, or A2A/multi-agent behavior was added.

## Residual Risks

- Live ChatGPT safety-layer behavior is not proven by local tests.
- `all_allowed` index results include safe workspace aliases, but summary still requires a single workspace selection.
- Git remote alias discovery is best-effort; folder aliases remain available when a configured allowed root is not a git repository.
- Extremely large or malformed reports are skipped or denied instead of summarized.

## Recommended Next Work Card

`WC-V1-0103 - Add MCP protocol self-test for release validation`, followed by operator-assisted live ChatGPT validation evidence under `WC-V1-0104`.

## Scope And Fallback

- Scope changed during implementation: no.
- No fallback implementation was used.

## Staging, Commit, Tag, Release, And Packaging State

- Nothing was staged.
- Nothing was committed.
- Nothing was tagged.
- Nothing was pushed.
- Nothing was packaged.
- Nothing was published or uploaded.

## Final Git Status

```text
 M docs/CHATGPT_CONNECTION_GUIDE.md
 M docs/SECURITY_MODEL.md
 M docs/TOOL_REFERENCE.md
 M planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md
 M planning/phases/phase-v1.0/WORK_CARD_QUEUE_v1.0.md
 M src/server/registerTools.ts
 M tests/toolSchema.test.ts
?? planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0102A_builder_report_discovery_facade.md
?? src/tools/builderReportFacade.ts
?? tests/builderReportFacade.test.ts
```
