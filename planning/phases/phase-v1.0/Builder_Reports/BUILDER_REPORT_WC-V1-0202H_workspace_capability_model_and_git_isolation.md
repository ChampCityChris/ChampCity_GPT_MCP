# Builder Report: WC-V1-0202H - Workspace Capability Model and Git Isolation

## Repository Identity

- Repository root: `%USERPROFILE%\Projects\ChampCity_GPT`
- Git top-level: `%USERPROFILE%/Projects/ChampCity_GPT`
- Remote: `https://github.com/ChampCityChris/ChampCity_GPT_MCP.git`
- Package manifest: `package.json` present
- Starting HEAD/final HEAD: `db6aa399716db271f2b38a6927de33f0f29a55ec`

## Dirty State

Starting dirty state included unrelated tracked and untracked changes, including the known unrelated `docs/CHATGPT_CONNECTION_GUIDE.md` modification and multiple WC-V1-0104B/WC-V1-0202G files. No reset, restore, clean, stash, stage, commit, push, merge, package, promote, restart, reconnect, publish, or release was performed.

Final dirty state remains unstaged. This card intentionally added or modified only the files listed below; unrelated dirty files were preserved.

## Files Changed for This Card

- `src/workspaceCapabilities.ts`
- `src/tools/workspaceStatusFacade.ts`
- `src/workspaceWritePolicy.ts`
- `src/workspaceAuthority.ts`
- `src/workspaces.ts`
- `src/config.ts`
- `src/tools/publicSafeFacade.ts`
- `src/tools/domainToolboxes.ts`
- `src/tools/toolboxActionPolicy.ts`
- `src/tools/writeJsonArtifact.ts`
- `src/utils/errors.ts`
- `src/utils/errorClassification.ts`
- `tests/config.test.ts`
- `tests/domainToolboxes.test.ts`
- `tests/toolCallTrace.test.ts`
- `tests/toolboxActionPolicy.test.ts`
- `tests/workspaces.test.ts`
- `tests/writeAccessTools.test.ts`
- `docs/TOOL_REFERENCE.md`
- `docs/SECURITY_MODEL.md`
- `docs/DESKTOP_APP_SETUP.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `docs/RELEASE_NOTES.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202H_workspace_capability_model_and_git_isolation.md`

## Old and New Authority Models

Old model:

- `git_required` and `artifact_only` were the primary public authority terms.
- `repo_toolbox.status` used Git status.
- `diagnostics_toolbox.public_safety_status` used Git change-set readiness.
- `publicSafeFacade` exposed one Git-required workspace resolver.
- Runtime diagnostics compared service package/source state against unrelated selected target workspaces.

New model:

- `src/workspaceCapabilities.ts` centralizes independent capabilities:
  - `filesystemAccess`
  - `artifactPersistence`
  - `patchWorkflow`
  - `gitInspection`
  - `gitMutation`
  - `releaseInspection`
  - `releasePublication`
- Each capability reports `available`, stable `reasonCode`, bounded `reason`, `configurationSource`, `detectedPrerequisites`, and `warnings`.
- `git_required` and `artifact_only` remain accepted compatibility inputs, not general authority semantics.
- `GIT_CAPABILITY_UNAVAILABLE` is localized to explicit Git/patch/release capability misses and is classified as execution/local-capability state, not general workspace policy.

## Legacy Migration Mapping

- `git_required`: accepted without rewriting config; no Git requirement for reads, searches, artifact persistence, or general diagnostics.
- `artifact_only`: accepted without rewriting config; preserves artifact-root restrictions and disables Git mutation.
- `requireGitRoot:false` derived non-Git workspaces remain bounded planning workspaces as before.
- New optional config schema accepted:

```json
{
  "workspaceCapabilities": {
    "artifactPersistence": "enabled",
    "patchWorkflow": "enabled",
    "gitOperations": "auto",
    "releaseOperations": "auto"
  }
}
```

No automatic local configuration rewrite is performed.

## Operation-Class Authority Table

| Operation class | Git required | Authority |
| --- | --- | --- |
| `filesystem_read` | No | Registered workspace, allowed-root, root availability, path policy |
| `workspace_diagnostics` | No | Registered workspace, allowed-root, root availability, path/file/write/audit checks |
| `artifact_persistence` | No | `files.write`, write mode, allowed-root, file policy, artifact-root/evidence/overwrite controls |
| `patch_workflow` | Yes when patch capability requires source Git safeguards | Explicit patch capability, write scope/mode, Git-backed patch safeguards |
| `git_inspection` | Yes | Git repository detection only |
| `git_mutation` | Yes | Git inspection, `files.write`, elevated mode, policy and branch safeguards |
| `release_inspection` | Yes for current release-capable workspaces | Explicit release capability and Git/repository coordinates |
| `release_publication` | Yes | Release inspection plus Git mutation prerequisites |

## Functions No Longer Requiring Git

- `repo_toolbox.status`
- `diagnostics_toolbox.workspace_safety_status`
- `diagnostics_toolbox.public_safety_status` compatibility alias
- `diagnostics_toolbox.list_workspaces`
- `diagnostics_toolbox.write_access_status` workspace authority summary
- `writeJsonArtifact`
- `writeMarkdownArtifact` authority path remains Git-independent
- `resolveWorkspaceAuthority(..., "artifact_persistence")`
- `resolveWorkspaceAuthority(..., "filesystem_read")`
- `resolveWorkspaceAuthority(..., "workspace_diagnostics")`
- `resolveFilesystemWorkspaceContext`
- Runtime diagnostics for non-`champcity_gpt` target workspaces

## Public Safety Status Disposition

- Added `diagnostics_toolbox.workspace_safety_status`.
- Retained `diagnostics_toolbox.public_safety_status` as a deprecated alias for one release cycle.
- The alias now returns workspace safety/capability status, not Git change-set readiness.
- Git change-set readiness remains under `git_toolbox.readiness_summary`.

## Repo Status Behavior Change

`repo_toolbox.status` now returns general workspace status with:

- workspace ID and label;
- redacted root availability;
- filesystem/read/artifact/patch capabilities;
- optional nested Git inspection/mutation/status information;
- release capability summaries;
- artifact roots;
- write-mode summary;
- audit-log health;
- warnings and legacy compatibility metadata.

Branch/dirty-tree information is nested under optional Git status and is not required for non-Git workspaces.

## Runtime and Target Diagnostic Separation

- Runtime fields now describe ChampCity GPT MCP runtime package version, source commit, runtime mode, and provenance.
- Target workspace fields describe selected workspace package metadata and optional Git HEAD.
- Alignment is `not_applicable` for non-`champcity_gpt` workspaces.
- Runtime package version is not compared to unrelated target package version.
- Runtime source commit is not compared to unrelated target Git HEAD.
- Service-repository alignment remains available when the selected workspace is the ChampCity GPT service repository.

## Non-Git Fixture Evidence

Added deterministic coverage for a registered `revisionary`-like non-Git workspace:

- `repo_toolbox.read_file` succeeds.
- `repo_toolbox.list_files` succeeds.
- `repo_toolbox.search_files` succeeds.
- `repo_toolbox.status` succeeds and reports `not_git_repository` only inside optional Git status.
- `diagnostics_toolbox.workspace_safety_status` succeeds.
- Deprecated `public_safety_status` returns the new safety result.
- Markdown artifact write succeeds without `.git`.
- JSON artifact write succeeds without `.git`.
- `git_toolbox.status` and `git_toolbox.diff` return localized `not_git_repository`.
- Patch proposal fails locally with `GIT_CAPABILITY_UNAVAILABLE`.
- Subsequent general results do not emit `GIT_REQUIRED`.

## Proof Artifact Writes Execute No Git Commands

- `writeJsonArtifact` no longer imports or calls `isIgnored`/`git check-ignore`.
- `writeMarkdownArtifact` continues to use workspace authority, path policy, file policy, and audit only.
- Existing `artifact_only creates Markdown and normalized JSON under configured planning roots without Git` test clears `PATH` and passes.
- New non-Git `git_required` fixture writes Markdown and JSON successfully without `.git`.

## Acceptance-Test Mapping

- Covered directly by tests: 1-17, 19-27, 30-32.
- Covered by code path and existing tests: 18 and 28-29. Explicit Git workflows remain under existing Git workflow suites and passed in the unit lane.
- Live ChatGPT acceptance remains not performed under this card by instruction.

## Validation

All validation followed `docs/dev/VALIDATION_COMMAND_LANES.md`.

- `pnpm typecheck`
  - Lane: sandbox shell, TypeScript no-emit.
  - Result: PASS.
  - Sandbox-only failure: none.
- `npm run validate:codex:unit`
  - First lane: sandbox.
  - Result: FAIL with documented `spawn EPERM` during esbuild.
  - Approved lane rerun: normal Windows execution with escalation.
  - Result: PASS, 419 tests passed.
- `npm run validate:codex:build`
  - Lane: normal Windows execution with escalation.
  - Result: PASS.
- `npm run mcp:self-test`
  - First lane: sandbox.
  - Result: FAIL with documented child-process/Git spawn failures.
  - Approved lane rerun: normal Windows execution with escalation.
  - Result: PASS, 23 checks passed.
- `npm run check:public`
  - Lane: normal Windows execution with escalation.
  - Result: FAIL due pre-existing unrelated private-path matches in `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202G_bounded_text_projection_and_safety_resilient_read_protocol.md`.
  - This file was unrelated to WC-V1-0202H and was not modified.
- `npm run lint`
  - Lane: sandbox shell, TypeScript no-emit.
  - Result: PASS.
- `git diff --check`
  - Lane: sandbox shell.
  - Result: PASS; line-ending warnings only.

## Validation Not Performed

- No Playwright.
- No package or promotion.
- No connector start/stop/restart.
- No ChatGPT reconnect.
- No live ChatGPT connector validation.
- No staging, commit, push, merge, integration, publish, or release.

## Blockers and Assumptions

- `npm run check:public` is blocked by unrelated pre-existing WC-V1-0202G Builder Report content containing local private path text.
- Assumption: retaining legacy `GIT_REQUIRED` inside explicit low-level Git/release internals is acceptable while public general workspace operations use `GIT_CAPABILITY_UNAVAILABLE` or nested `not_git_repository`.

## Git Workflow Preservation

Existing Git-backed workflows remain available and passed in the unit validation lane:

- status;
- diff;
- history inspection;
- pre-commit scan;
- readiness;
- branch preparation;
- staging;
- commit;
- push;
- integration.

## Confirmation

Nothing was staged, committed, pushed, integrated, packaged, promoted, restarted, reconnected, published, or released.

No fallback implementation was used.
