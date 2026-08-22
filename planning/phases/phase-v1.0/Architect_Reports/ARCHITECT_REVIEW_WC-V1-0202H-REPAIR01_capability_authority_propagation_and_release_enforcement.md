# Architect Review: WC-V1-0202H-REPAIR01 — Capability Authority Propagation and Release Enforcement

## Disposition

`Architect.Disposition=RevisionRequired`

`WC-V1-0202H-REPAIR01` does not pass inspection.

The repair correctly propagates configured capability overrides through the workspace catalog, write-access diagnostics, runtime target-HEAD gating, and explicit `releaseOperations: "disabled"` rejection. However, two production paths still execute behavior that contradicts the centralized capability result.

## Repository State Verified

- Workspace: `champcity_gpt`
- Repository: `ChampCityChris/ChampCity_GPT_MCP`
- Branch: `dev`
- HEAD before and after Architect validation: `db6aa399716db271f2b38a6927de33f0f29a55ec`
- Worktree: dirty from the existing combined Phase v1.0 implementation corpus
- Staged files: none

Builder Report reviewed:

`planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202H-REPAIR01_capability_authority_propagation_and_release_enforcement.md`

## Confirmed Correct Behavior

- Configured `workspaceCapabilities` now survive workspace catalog conversion.
- `list_workspaces` and `write_access_status` receive the caller's `files.write` scope state.
- Catalog compatibility fields derive from the centralized capability summary.
- Explicit artifact, patch, Git, and release disablement is reported consistently by the new focused test fixture.
- Explicit `releaseOperations: "disabled"` rejects both release summary actions before file, remote, or network inspection; the tests prove `fetch` is not called.
- Runtime target HEAD inspection is skipped when `git_inspection` authority is unavailable.
- The parent `WC-V1-0202H` Builder Report and the Repair01 Builder Report are no longer identified by publication-cleanliness checking.
- No duplicate workspace registry, alternate capability evaluator, fallback authority, or alternate release path was introduced.

## Blocking Findings

### 1. `repo_toolbox.status` still executes Git when Git operations are explicitly disabled

`src/tools/workspaceStatusFacade.ts` correctly builds `capabilities.gitInspection`, but then calls:

`optionalGitSummary(workspace.root)`

unconditionally.

`optionalGitSummary()` checks only whether `.git` exists. When it does, it runs:

- `git branch --show-current`
- `git status --short --untracked-files=all`

Therefore a Git-backed workspace configured with `gitOperations: "disabled"` receives a status payload reporting `GIT_OPERATIONS_DISABLED` while the same request still performs Git inspection.

This directly violates Repair01 acceptance criterion 3:

> Explicit `gitOperations: "disabled"` is reported disabled even when `.git` exists, and Git inspection does not execute.

The new test `public toolbox diagnostics and execution honor explicit disabled workspace capabilities` verifies the returned reason code but does not detect the hidden Git calls.

Required correction:

1. Gate optional Git status collection on `capabilities.gitInspection.available`.
2. When Git is explicitly disabled, return a bounded optional Git status such as `git_operations_disabled` without starting a Git process.
3. Add a deterministic test that fails if `runGit` is invoked by `repo_toolbox.status` or `workspace_safety_status` under explicit Git disablement.

### 2. Release execution still does not use the same availability rules as release reporting

`src/workspaceCapabilities.ts` reports release inspection available only when:

- Git inspection is available; and
- the workspace is explicitly release-capable through `workspaceId === "champcity_gpt"` or configured remote metadata.

`src/workspaceAuthority.ts` does not apply those same rules for `release_inspection`. It denies only when:

- `releaseOperations` is explicitly disabled;
- the legacy policy is `artifact_only`; or
- `.git` is absent.

It does not deny when:

- `gitOperations: "disabled"`; or
- the Git workspace is not explicitly release-capable.

`resolveReleaseWorkspaceContext()` now consumes this incomplete authority. Consequently, public diagnostics can report `RELEASE_INSPECTION_UNAVAILABLE` while a release summary action is still allowed to inspect release state.

Examples still permitted by execution but denied by reporting:

1. Git workspace with `gitOperations: "disabled"` and `releaseOperations: "auto"`.
2. Git workspace with no configured remote and a workspace ID other than `champcity_gpt`.

This violates Repair01 acceptance criterion 6:

> `list_workspaces`, `write_access_status`, `repo_toolbox.status`, and operation execution never contradict one another.

Required correction:

1. Make `release_inspection` authority use the same prerequisites as `capabilities.releaseInspection`.
2. Do not create a second release-capability calculation.
3. Add public-tool negative tests for both cases above.
4. Prove denial occurs before release-file reads, Git remote inspection, or network fetch.

### 3. Explicit patch-application denial lacks the required public proof

The focused disabled-capability test proves `propose_patch` is denied when `patchWorkflow: "disabled"`, but it does not exercise `apply_approved_patch` under that explicit override.

The implementation appears to check patch authority early, but the Work Card explicitly requires both proposal and application denial through public toolbox entry points. Add the missing negative proof without redesigning the patch flow.

## Independent Validation

Architect-run validation results:

- Typecheck: PASS
- Build: PASS
- Full regression suite: PASS
- Tests: 423 passed, 0 failed
- MCP self-test coverage: PASS within the repository validation lane
- Publication cleanliness: repair-specific evidence PASS
- Complete release checks: FAIL only because of the pre-existing, explicitly out-of-scope `WC-V1-0202G` Builder Report

The remaining publication failure is accurately disclosed and does not itself fail Repair01. The production authority defects above do.

## Acceptance Assessment

1. Artifact disablement reporting and execution: PASS.
2. Patch proposal disablement: PASS.
3. Patch application disablement proof: FAIL.
4. Git disablement reporting: PASS.
5. Git disablement prevents all status-path Git execution: FAIL.
6. Release disablement rejects before inspection: PASS.
7. Release execution and reporting use identical prerequisites: FAIL.
8. Non-Git target runtime HEAD inspection is skipped: PASS.
9. Enabled/default regression behavior: PASS.
10. Repair evidence sanitation and truthful remaining blocker: PASS.
11. No duplicate authority or fallback mechanism: PASS.

## Required Implementer Return

Keep the next pass limited to the three findings above:

1. Gate `optionalGitSummary()` through existing Git-inspection capability.
2. Align `release_inspection` authority with the existing centralized release capability prerequisites.
3. Add missing negative public proof for explicit patch-application disablement and the two release inconsistency cases.
4. Update the Builder Report and rerun validation after final report bytes are written.

Do not redesign the workspace model, add capability names, alter accepted non-Git read/write behavior, sanitize the older `0202G` report, or modify package/promotion contracts.

## Binary Completion Rule

`explicit capabilities govern execution and every public diagnostic consistently`

+ `Git-disabled status starts no Git process`

+ `release execution uses the same prerequisites as release reporting`

+ `patch proposal and application denial are both proven`

+ `accepted Git and non-Git behavior remains intact`

+ `repair evidence remains publication-clean and truthful`

+ `no alternate authority is introduced`

= `PASS`

The current implementation does not satisfy this rule.

`Document.Status=RevisionRequested`
