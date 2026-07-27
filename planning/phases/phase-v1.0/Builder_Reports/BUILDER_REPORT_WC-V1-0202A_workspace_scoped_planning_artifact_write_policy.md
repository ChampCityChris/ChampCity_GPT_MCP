# Builder Report - WC-V1-0202A Workspace-Scoped Planning Artifact Write Policy

## Summary

Implemented a per-workspace write authority model with explicit `git_required` and `artifact_only` policies. Planning-only workspaces can now persist bounded Markdown and JSON artifacts under server-configured artifact roots without invoking Git, while patch workflows and Git mutations still require a confirmed Git repository regardless of legacy `requireGitRoot`.

## Repository Identity and Baseline

- Verified working directory: `%USERPROFILE%\Projects\ChampCity_GPT`
- Verified Git top level: `%USERPROFILE%\Projects\ChampCity_GPT`
- Verified branch: `dev`
- Verified HEAD: `e782bde926240ae264c11f9ae51e8ee671fc90ca`
- Verified remote: `ChampCityChris/ChampCity_GPT_MCP`
- Verified `package.json`: present
- Verified `AGENTS.MD`: read before editing
- Verified validation lane document: `docs/dev/VALIDATION_COMMAND_LANES.md` read before validation
- Starting dirty state: clean
- Final dirty state: modified implementation/docs/tests files, plus untracked `src/workspaceAuthority.ts`, `src/workspaceWritePolicy.ts`, and this Builder Report
- REPAIR01 dependency evidence: read the REPAIR01 Builder Report and final Architect closure. REPAIR01 was initially revision-requested, then REPAIR03 final Architect closure approved the overall WC-V1-0104A baseline. Current clean `dev` at the HEAD above was treated as the approved source baseline.

## Files Changed

- `src/workspaceWritePolicy.ts`
- `src/workspaceAuthority.ts`
- `src/config.ts`
- `src/workspaces.ts`
- `src/tools/writeMarkdownArtifact.ts`
- `src/tools/writeJsonArtifact.ts`
- `src/tools/proposePatch.ts`
- `src/tools/applyApprovedPatch.ts`
- `src/tools/domainToolboxes.ts`
- `src/utils/errors.ts`
- `src/utils/errorClassification.ts`
- `electron/launcherCore.ts`
- `electron/renderer/launcher/launcherTypes.ts`
- `electron/renderer/launcherStateAdapter.ts`
- `electron/renderer/RendererApp.tsx`
- `electron/renderer/launcher/screens/SettingsScreen.tsx`
- `electron/renderer/launcher/launcher.css`
- `electron/renderer/renderer.ts`
- `tests/config.test.ts`
- `tests/workspaces.test.ts`
- `tests/writeAccessTools.test.ts`
- `tests/domainToolboxes.test.ts`
- `tests/httpTransport.test.ts`
- `tests/launcherCore.test.ts`
- `tests/toolCallTrace.test.ts`
- `docs/DESKTOP_APP_SETUP.md`
- `docs/SECURITY_MODEL.md`
- `docs/TOOL_REFERENCE.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202A_workspace_scoped_planning_artifact_write_policy.md`

No pre-existing uncommitted work was present at the start of this implementation pass. No unrelated changes were reverted.

## Protected Subsystems

- Touched: files.write-gated artifact persistence and write-action policy enforcement, explicitly scoped by WC-V1-0202A.
- Not touched: OAuth behavior, PKCE, Dynamic Client Registration, token/session storage, MCP HTTP transport, Cloudflare configuration, runtime promotion, packaging/release configuration, public MCP endpoint behavior, server lifecycle/shutdown behavior, and Git commit/push automation.
- Scope changed during implementation: no.

## Final Configuration Schema

Configured workspaces now support:

```json
{
  "workspaceId": "new_project_planning",
  "label": "New Project Planning",
  "root": "%USERPROFILE%\\Projects\\New_Project",
  "writePolicy": "artifact_only",
  "artifactWriteRoots": ["planning"]
}
```

`writePolicy` values are exactly `git_required` and `artifact_only`. Explicit workspaces without `writePolicy` default to `git_required`. Explicit `artifact_only` workspaces without `artifactWriteRoots` default to `["planning"]`. Derived `allowedRoots` workspaces default to `git_required` unless the bounded legacy migration rule applies.

## Migration Behavior

Legacy `requireGitRoot` remains readable but is deprecated as an operational authorization gate. When absent or true, derived workspaces remain `git_required`. When false, non-Git derived workspaces are exposed as bounded `artifact_only` planning workspaces with `["planning"]` and a deprecation warning. Existing Git repositories do not silently become `artifact_only`. Explicit workspace policies override legacy defaults.

Generated launcher/ChatGPT config no longer uses environment values to globally bypass Git-backed mutation requirements.

## Resolver Architecture

Added a deterministic workspace authority resolver that evaluates:

- selected configured workspace;
- operation class: `artifact_persistence`, `patch_workflow`, or `git_mutation`;
- workspace policy;
- Git presence;
- configured artifact write roots;
- target path membership for artifact writes.

The resolver returns safe internal facts including workspace ID, policy, Git detected state, artifact roots, operation allow/deny status, warnings, and denial reason. Public callers cannot supply policy or artifact-root overrides.

## Artifact Root Enforcement

Artifact roots are workspace-relative server configuration only. Validation rejects absolute paths, drive paths, UNC paths, traversal, empty values, URLs, wildcard/glob syntax, shell metacharacters, and blocked segments such as config, logs, release, generated, credentials, dependency folders, and Git internals. Explicit `.` is accepted only as an operator-configured value and emits a visible warning.

Markdown and JSON artifact targets in `artifact_only` workspaces must resolve inside a configured artifact root. Existing file checks reject symlink and non-regular targets, and existing path policy continues to deny escapes.

## Markdown and JSON Behavior

For `artifact_only`:

- Markdown writes permit only `.md`, require target inside an artifact root, skip Git, preserve overwrite control, atomic write, SHA-256, byte-count output, and audit logging.
- JSON writes permit only `.json`, require target inside an artifact root, parse and normalize content, skip `git check-ignore` and other Git commands, and preserve forbidden-path, overwrite, atomic write, modified-time, SHA-256, and audit behavior.

For `git_required`, Git-root behavior is preserved. JSON keeps the existing Git ignore check where applicable.

Proof that artifact-only writes invoke no Git is covered by `tests/writeAccessTools.test.ts`, which executes Markdown and JSON artifact writes with `process.env.PATH = ""`; the test passes, proving no Git executable is required in that policy.

## Patch and Git Invariants

`repo_toolbox.propose_patch`, `repo_toolbox.apply_approved_patch`, and Git mutation actions require a Git-backed workspace. `artifact_only` receives `WORKSPACE_POLICY_DENIED` for patch proposal/application and Git mutations. Non-Git `git_required` receives `GIT_REQUIRED`. `requireGitRoot:false` no longer bypasses patch application Git enforcement.

Proposal generation semantics, proposal ID/hash matching, expiry, one-time use, write-mode gates, OAuth scope requirements, regular-file checks, and symlink safeguards were not changed.

## Launcher Controls and Persistence

The launcher Allowed Roots/Workspaces area now exposes per-workspace policy controls:

- label, safe workspace ID, and root display;
- `Git-backed repository` / `Planning artifacts only` selector;
- artifact-root editing when planning mode is selected;
- default `planning` root display;
- warning for `.` roots;
- copy explaining planning mode is bounded Markdown/JSON only, patch/Git workflows remain unavailable, and the app will not run `git init`.

First-run setup, reset defaults, and newly added ordinary roots default to `git_required`. Launcher read/write preserves workspace IDs, labels, roots, remotes, default workspace ID, audit log, allowed commands, and unrelated config metadata.

## Diagnostics and Redaction

Workspace diagnostics now expose safe policy facts: workspace ID, write policy, Git detected status, relative artifact roots, artifact-persistence availability/reason, Git-mutation availability/reason, and warnings. Diagnostics do not return absolute roots, raw local config, environment dumps, tokens, credentials, or secrets.

## Audit Behavior

Artifact writes continue to audit write events. The selected workspace ID is recorded in audit metadata. Raw artifact contents are not logged. The implementation does not add policy data that would require broad audit schema churn.

## Acceptance-Criterion-to-Test Matrix

| # | Acceptance criterion | Deterministic coverage |
|---|---|---|
| 1 | Explicit workspace without `writePolicy` defaults to `git_required`. | `tests/config.test.ts` |
| 2 | Derived legacy workspace defaults to `git_required` when global setting is absent or true. | `tests/config.test.ts`, `tests/workspaces.test.ts` |
| 3 | Existing Git repo permits current Markdown artifact workflow. | `tests/writeAccessTools.test.ts`, `tests/domainToolboxes.test.ts` |
| 4 | Existing Git repo permits current JSON artifact workflow. | `tests/writeAccessTools.test.ts`, `tests/domainToolboxes.test.ts` |
| 5 | Non-Git `git_required` denies Markdown with Git-required evidence. | `tests/writeAccessTools.test.ts` |
| 6 | Non-Git `git_required` denies JSON with Git-required evidence. | `tests/writeAccessTools.test.ts` |
| 7 | Non-Git `artifact_only` creates Markdown inside `planning`. | `tests/writeAccessTools.test.ts`, `tests/httpTransport.test.ts` |
| 8 | Non-Git `artifact_only` creates normalized JSON inside `planning` without Git. | `tests/writeAccessTools.test.ts` with empty `PATH` |
| 9 | Artifact-only write outside configured roots is denied. | `tests/writeAccessTools.test.ts` |
| 10 | Nested path inside approved artifact root is allowed. | `tests/writeAccessTools.test.ts` |
| 11 | Unsafe artifact-root configuration is rejected. | `tests/config.test.ts` |
| 12 | `.` accepted only explicitly and warns. | `tests/config.test.ts` |
| 13 | Markdown extension enforcement remains active. | `tests/writeAccessTools.test.ts`, existing file-policy tests |
| 14 | JSON extension and parse enforcement remain active. | `tests/writeAccessTools.test.ts` |
| 15 | Blocked config/env/credential/log/release/generated/db/key/profile paths remain denied. | `tests/writeAccessTools.test.ts`, existing file-policy/path-policy tests |
| 16 | Existing-file overwrite remains denied unless `overwrite:true`. | Existing write artifact tests in `tests/writeAccessTools.test.ts` |
| 17 | Symlink, junction, reparse, and escape attempts are denied. | `tests/writeAccessTools.test.ts`, existing path-policy tests |
| 18 | OAuth `files.write` remains mandatory. | `tests/domainToolboxes.test.ts`, `tests/httpTransport.test.ts` |
| 19 | Local write mode remains mandatory. | `tests/writeAccessTools.test.ts`, `tests/httpTransport.test.ts` |
| 20 | Artifact-only denies patch proposal. | `tests/writeAccessTools.test.ts` |
| 21 | Artifact-only denies patch application. | `tests/writeAccessTools.test.ts` |
| 22 | Non-Git patch application denied even with legacy `requireGitRoot:false`. | `tests/writeAccessTools.test.ts` |
| 23 | Git stage, commit, branch, integration, push remain Git-required. | `tests/domainToolboxes.test.ts`, existing git workflow tests |
| 24 | Artifact-only workspace does not weaken separate Git-required workspace. | `tests/domainToolboxes.test.ts`, `tests/workspaces.test.ts` |
| 25 | Legacy `requireGitRoot:false` emits deprecation diagnostics and affects only bounded artifacts. | `tests/config.test.ts`, `tests/workspaces.test.ts`, diagnostics tests |
| 26 | Migration preserves workspace/config metadata. | `tests/launcherCore.test.ts` |
| 27 | Launcher creates, edits, saves, reloads, and displays policies. | `tests/launcherCore.test.ts`, renderer state/types compile coverage |
| 28 | First-run and reset defaults remain Git-backed. | `tests/launcherCore.test.ts`, `tests/config.test.ts` |
| 29 | Runtime config directory loading preserves policies. | `tests/config.test.ts`, `tests/launcherCore.test.ts` |
| 30 | Diagnostics expose policy/capabilities without absolute roots/secrets. | `tests/domainToolboxes.test.ts`, `tests/workspaces.test.ts` |
| 31 | Audit output records workspace ID and artifact result without raw contents. | `tests/writeAccessTools.test.ts`, existing audit assertions |
| 32 | Existing self-test, public scan, OAuth, write-mode, routing, patch matching remain passing. | `npm run validate:codex:unit`, `npm run mcp:self-test -- --json`, `npm run check:public` |

## Validation

All child-process-capable commands were run using the documented normal Windows validation lane.

Passed:

- `npm run typecheck` - normal Windows lane - PASS.
- Focused policy suite: `node --test dist/tests/config.test.js dist/tests/workspaces.test.js dist/tests/writeAccessTools.test.js dist/tests/domainToolboxes.test.js dist/tests/launcherCore.test.js dist/tests/toolCallTrace.test.js` - normal Windows lane - PASS, 106 tests.
- `npm run build` - normal Windows lane - PASS.
- Focused HTTP transport repair check: `node --test dist/tests/httpTransport.test.js` - normal Windows lane - PASS, 66 tests.
- `npm run validate:codex:unit` - normal Windows lane - PASS, 369 tests.
- `npm run mcp:self-test -- --json` - normal Windows lane - PASS, 22 checks.
- `npm run check:public` - normal Windows lane - PASS before and after adding this Builder Report; final scan checked 221 source candidate files.
- `npm run lint` - normal Windows lane - PASS.
- `git diff --check` - local Git diff hygiene - PASS, with only expected LF-to-CRLF working-copy warnings.

Failed during iteration, then fixed:

- `npm run build` in the sandbox failed with the documented `spawn EPERM` class of false failure; the normal Windows lane passed.
- `npm run validate:codex:unit` initially failed two HTTP Markdown write tests because legacy fixtures wrote `new.md` at the workspace root. Those fixtures were corrected to use `planning/new.md`.
- `npm run validate:codex:unit` then failed one remaining instance of the same fixture mismatch. That path was corrected and the final full unit lane passed.

Not run:

- Playwright.
- Packaging.
- Runtime promotion.
- Production connector restart or reconnect.
- Live ChatGPT connector validation.

## Manual Validation Not Performed

1. Architect reviews this Builder Report and the complete diff.
2. After approval, a separately authorized pass integrates the change.
3. A separately authorized pass packages and promotes the runtime.
4. Operator restarts ChampCity MCP and reconnects ChatGPT.
5. Operator creates or selects a non-Git greenfield planning workspace in the launcher.
6. Operator sets `Planning artifacts only` with artifact root `planning`.
7. Operator confirms Markdown and JSON artifacts can be created under `planning`.
8. Operator confirms a target outside `planning` is denied.
9. Operator confirms patch proposal/application and Git mutations are denied.
10. Operator confirms an existing Git-backed workspace retains normal artifact and patch behavior.
11. Operator confirms diagnostics show each workspace policy without exposing absolute paths.

## Confirmed Non-Actions

No project/runtime/operator workspace `git init` was performed. Deterministic tests used temporary Git fixtures where required to prove Git-backed behavior.

No staging, commit, push, merge, tag, package, promotion, restart, reconnect, publication, or release was performed.

## Blockers and Assumptions

No implementation blockers remain. Assumption: the approved REPAIR03 Architect closure for WC-V1-0104A established the current clean `dev` baseline as safe for this work card.

No fallback implementation was used.
