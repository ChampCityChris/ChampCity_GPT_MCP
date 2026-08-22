# Architect Review: WC-V1-0202H-REPAIR02 — Capability Execution Parity and Git-Probe Isolation

## Disposition

`Architect.Disposition=Pass`

`WC-V1-0202H-REPAIR02` passes inspection.

The repair closes the three residual defects authorized by the Work Card: Git-disabled general status no longer starts Git processes, release-summary execution now uses the same centralized prerequisites as release capability reporting, and public patch-application denial is proven without consuming proposal state or mutating repository state.

## Repository State Verified

- Workspace: `champcity_gpt`
- Repository: `ChampCityChris/ChampCity_GPT_MCP`
- Branch: `dev`
- HEAD before and after Architect validation: `db6aa399716db271f2b38a6927de33f0f29a55ec`
- Worktree: dirty from the existing combined Phase v1.0 implementation corpus
- Staged files: none

Builder Report reviewed:

`planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202H-REPAIR02_capability_execution_parity_and_git_probe_isolation.md`

## Production Review

### 1. Git-disabled status probing is isolated

`src/tools/workspaceStatusFacade.ts` now gates optional Git status collection on `capabilities.gitInspection.available`.

When Git inspection is unavailable, `getGeneralWorkspaceStatus()` returns a bounded status derived from the centralized capability result instead of calling the Git helper. Explicit disablement returns:

- status: `git_inspection_disabled`
- reason code: `GIT_OPERATIONS_DISABLED`
- no branch data
- no changed-path count
- no Git process

Non-Git workspaces retain their separate `not_git_repository` result.

Both `diagnostics_toolbox.workspace_safety_status` and the deprecated `public_safety_status` alias dispatch directly to workspace safety evaluation before broader runtime diagnostics are built. This prevents unrelated runtime Git probing from preceding the requested safety result.

### 2. Release execution and reporting use the same prerequisites

`src/workspaceAuthority.ts` now evaluates `release_inspection` through `buildWorkspaceCapabilitySummary(...).releaseInspection` rather than duplicating a narrower `.git` check.

Release-summary execution is therefore denied when:

- release operations are explicitly disabled;
- Git inspection is disabled;
- Git is unavailable;
- the workspace is not explicitly release-capable; or
- the legacy artifact-only restriction applies.

The real release entry points still call `resolveReleaseWorkspaceContext()` before release-file, remote, or network inspection. Execution and public capability reporting now agree.

Authorized release-capable workspaces preserve the existing release artifact and publication-summary behavior.

### 3. Patch application denial is proven without mutation

The public `repo_toolbox.apply_approved_patch` test creates a valid pending proposal while patch workflow is enabled, then invokes application against the same workspace with `patchWorkflow: "disabled"`.

The test verifies:

- result code is `WORKSPACE_POLICY_DENIED`;
- target file bytes remain unchanged;
- the pending proposal store remains unchanged;
- Git working status remains unchanged.

This proves authority rejection occurs before proposal consumption or patch application.

## Proof Quality

The focused tests do more than assert payload fields:

- a fake Git executable records a marker if any forbidden Git process starts;
- release denial traps release-path inspection, Git process invocation, and network `fetch`;
- patch denial snapshots file bytes, pending proposal state, and Git status.

The tests therefore prove the required absence of side effects through public toolbox entry points.

## Adjacent Changes

The following adjacent files were technically justified and remain within the repair boundary:

- `src/tools/domainToolboxes.ts`: safety-status actions bypass broader runtime diagnostics that could initiate unrelated Git probes.
- `src/validation/mcpSelfTest.ts`: the positive release-summary fixture now declares release-capable workspace metadata required by the corrected authority.

No capability name, operation class, registry, release mechanism, or fallback authority was added.

## Independent Validation

Architect-run validation results:

- Typecheck: PASS
- Build: PASS
- Full regression suite: PASS
- Tests: 425 passed, 0 failed
- MCP self-test: PASS within the full regression lane
- Repair02 and Repair01 publication cleanliness: PASS
- Complete release checks: FAIL only because of the pre-existing, explicitly out-of-scope `WC-V1-0202G` Builder Report

The remaining global publication failure does not identify the Repair02 report, the Repair01 report, or the parent `WC-V1-0202H` report. It is accurately disclosed and excluded by the controlling Repair02 Work Card.

## Acceptance Assessment

1. Git-disabled `repo_toolbox.status` starts no Git process: PASS.
2. Git-disabled workspace safety status starts no Git process: PASS.
3. Disabled Git status is bounded and truthful: PASS.
4. Release inspection rejects when Git operations are disabled: PASS.
5. Release inspection rejects non-release-capable Git workspaces: PASS.
6. Both release summaries reject before file, remote, or network inspection: PASS.
7. Authorized release behavior remains intact: PASS.
8. `apply_approved_patch` returns `WORKSPACE_POLICY_DENIED` under patch disablement: PASS.
9. Rejected patch application preserves proposal, file, and Git state: PASS.
10. Public diagnostics and execution agree: PASS.
11. Existing Git and non-Git regressions remain passing: PASS.
12. No duplicate authority, fallback, or alternate release mechanism: PASS.
13. Repair evidence remains clean and truthful: PASS.

## Binary Completion Rule

`Git-disabled general status starts no Git process`

+ `release execution and reporting use identical prerequisites`

+ `patch proposal and application disablement are both proven`

+ `accepted behavior remains intact`

+ `repair evidence remains clean and truthful`

+ `no alternate authority is introduced`

= `PASS`

No additional Repair02 implementation pass is required.

`Document.Status=Approved`
