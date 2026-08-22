# Architect Review: WC-V1-0202H — Workspace Capability Model and Git Isolation

## Disposition

`Architect.Disposition=RevisionRequired`

`WC-V1-0202H` does not pass inspection.

The implementation successfully makes registered non-Git workspaces usable for repository reads, general status, workspace safety diagnostics, Markdown/JSON artifact persistence, and localized Git-action failure. However, the configured capability model is not yet the controlling authority across all public diagnostics and release entry points.

## Repository State Verified

- Workspace: `champcity_gpt`
- Repository: `ChampCityChris/ChampCity_GPT_MCP`
- Branch: `dev`
- HEAD before and after Architect validation: `db6aa399716db271f2b38a6927de33f0f29a55ec`
- Worktree: dirty from the existing combined Phase v1.0 implementation corpus
- Staged files: none

The Builder Report reviewed was:

`planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202H_workspace_capability_model_and_git_isolation.md`

## Confirmed Correct Behavior

The following portions of the card are materially implemented:

- Registered directories no longer require `.git` for filesystem reads and searches.
- `repo_toolbox.status` returns general workspace status with Git represented as optional capability state.
- `diagnostics_toolbox.workspace_safety_status` works without Git.
- `public_safety_status` is retained as a deprecated workspace-safety alias rather than Git readiness.
- Markdown and JSON artifact writes can succeed in an authorized non-Git workspace.
- Patch workflow and Git mutation remain denied when their required capability is unavailable.
- `git_toolbox.status`, `diff`, and history inspection return localized not-Git results instead of invalidating the workspace.
- Runtime-versus-target package comparison is marked `not_applicable` for unrelated target workspaces.
- No alternate workspace registry, shadow persistence engine, or duplicate Git implementation was introduced.

These corrections are substantial, but they do not satisfy the binary completion rule because the new configuration authority is bypassed in several public paths.

## Blocking Findings

### 1. Configured capability overrides are ignored by public workspace catalog and write-access diagnostics

`src/workspaces.ts` creates a temporary `ResolvedWorkspace` inside `listWorkspaceCatalog()` but does not copy `workspace.workspaceCapabilities` into that object before calling `buildWorkspaceCapabilitySummary()`.

As a result, explicit configuration such as:

- `artifactPersistence: "disabled"`
- `gitOperations: "disabled"`
- `releaseOperations: "disabled"`

is lost when `diagnostics_toolbox.list_workspaces` builds its public capability summary.

The same catalog also calculates top-level `artifactPersistenceAvailable` and `gitMutationAvailable` through compatibility helpers that ignore explicit capability overrides. `diagnostics_toolbox.write_access_status` then republishes those compatibility fields rather than the centralized capability summary.

This permits public diagnostics to claim that artifact persistence or Git mutation is available while the actual authority layer correctly denies the operation. The application therefore exposes two conflicting descriptions of the same workspace.

`legacyWorkspaceCapabilityConfig()` also derives values solely from `writePolicy`, so `repo_toolbox.status.legacyCompatibility` can misstate the explicit capability configuration.

The current tests prove that capability configuration parses, but do not prove that configured overrides control:

- `list_workspaces`;
- `write_access_status`;
- `repo_toolbox.status` compatibility reporting;
- actual operation authorization and reported availability as one consistent result.

This violates the card requirement for one centralized capability authority and accurate public workspace reporting.

Required correction:

1. Preserve `workspaceCapabilities` whenever a configured workspace is converted to a resolved workspace.
2. Derive all public capability reporting from the same centralized authority used by execution.
3. Remove or clearly isolate compatibility fields that can contradict the authoritative capability summary.
4. Add public-tool tests with explicit enabled and disabled overrides for every capability class.

### 2. Release actions bypass the new release-capability authority

`src/workspaceAuthority.ts` defines `release_inspection` and `release_publication`, including enforcement of `workspaceCapabilities.releaseOperations === "disabled"`.

No production release facade calls that authority.

In `src/tools/publicSafeFacade.ts`, `resolveReleaseWorkspaceContext()` delegates to `resolveGitWorkspaceContext()`, which checks only for `.git`. Consequently:

- a Git workspace configured with `releaseOperations: "disabled"` can still use release artifact/publication summary actions;
- release capability is effectively inferred from Git presence rather than explicit release capability;
- the newly introduced release authority exists but is not the authority for the real release entry points.

This directly conflicts with the work card requirement that release inspection/publication be available only for explicitly release-capable workspaces and that failure remain local to release actions.

Required correction:

1. Route release inspection facades through `resolveWorkspaceAuthority(..., "release_inspection")`.
2. Reserve `release_publication` for any actual publication mutation path.
3. Add positive and negative public-tool tests proving that `releaseOperations: "disabled"` is enforced even when `.git` exists.

### 3. General diagnostics still invoke Git for every selected target workspace

`buildRuntimeScopeToolDiagnostics()` in `src/tools/domainToolboxes.ts` unconditionally calls Git for the selected target workspace to obtain a HEAD value.

That function is executed before the diagnostics action switch, including general actions such as `workspace_safety_status`. The failure is caught and represented as `unknown`, so the user-visible action succeeds, but Git is still invoked as a hidden runtime dependency for a non-Git target.

The work card explicitly requires target Git HEAD/branch to be optional and read only when Git is detected. The current tests prove that no false runtime alignment comparison is reported, but they do not prove that no Git process is attempted for a non-Git target.

Required correction:

- detect target Git capability first;
- do not invoke Git for target HEAD/branch when Git inspection is unavailable;
- add a production-path test that fails if a Git subprocess is attempted for general non-Git workspace diagnostics.

### 4. The submitted Builder Report fails its own required publication-cleanliness check

Independent `release_checks` found private workstation identifiers in both:

- the previously known `WC-V1-0202G` Builder Report; and
- `BUILDER_REPORT_WC-V1-0202H_workspace_capability_model_and_git_isolation.md` itself.

The `0202H` Builder Report states that `check:public` failed only because of the older unrelated `0202G` record. That statement is not accurate for the final submitted report.

The older record remains a separate pre-existing blocker. The current `0202H` report is part of this implementation output and must be publication-clean before this work card can pass its required validation boundary.

Required correction:

- remove private local path/user values from the `0202H` Builder Report without weakening its evidence;
- rerun `check:public` after the final report bytes are written;
- report all remaining failures accurately.

## Independent Validation

Architect-run validation produced:

- Typecheck: PASS
- Build: PASS
- Full regression suite: PASS
- Tests: 419 passed, 0 failed
- MCP self-test coverage: PASS within the repository validation lane
- Release checks: FAIL at publication cleanliness

The green automated suite does not cover the configured-capability authority bypasses described above.

## Acceptance Assessment

- Non-Git filesystem reads/searches: PASS
- Non-Git general workspace status/safety: PASS
- Non-Git artifact persistence when authorized: PASS
- Localized Git-action unavailability: PASS
- Explicit capability configuration controls public catalog reporting: FAIL
- Explicit capability configuration controls write-access reporting: FAIL
- Explicit release capability controls release facades: FAIL
- General non-Git diagnostics avoid Git process dependency: FAIL
- Final Builder Report passes publication cleanliness: FAIL
- No duplicate authority or fallback mechanism introduced: PASS

## Required Implementer Return

The next pass must remain bounded to authority propagation and proof:

1. Make configured capability overrides flow through every resolved workspace and public diagnostic.
2. Make execution and reporting consume the same centralized capability result.
3. Route release facades through release capability authority.
4. Avoid target Git invocation when Git inspection is unavailable.
5. Add focused public HTTP/toolbox tests for explicit disabled and enabled capability configurations.
6. Correct the `0202H` Builder Report and rerun the complete validation lane after its final bytes are written.

Do not redesign the workspace model, add a second registry, reopen accepted non-Git read/write behavior, or modify unrelated planning records.

## Binary Completion Rule

`registered workspace usable without Git`

+ `configured capabilities govern execution and public reporting consistently`

+ `Git and release requirements remain isolated to their explicit actions`

+ `general diagnostics do not invoke Git for non-Git targets`

+ `final evidence passes required validation`

+ `no alternate authority introduced`

= `PASS`

The current implementation does not satisfy this rule.

`Document.Status=RevisionRequested`
