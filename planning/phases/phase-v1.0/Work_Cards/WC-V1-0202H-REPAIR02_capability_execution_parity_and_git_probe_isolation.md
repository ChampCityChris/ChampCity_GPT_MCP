# WC-V1-0202H-REPAIR02 — Capability Execution Parity and Git-Probe Isolation

## Identity

- ID: `WC-V1-0202H-REPAIR02`
- Parent: `WC-V1-0202H-REPAIR01`
- Priority: P0
- Branch: `dev`
- Required Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202H-REPAIR02_capability_execution_parity_and_git_probe_isolation.md`

## Verified Residual Defects

1. `repo_toolbox.status` reports `gitOperations: "disabled"` but still executes Git branch/status probes when `.git` exists.
2. Release diagnostics can report `RELEASE_INSPECTION_UNAVAILABLE` while release summary execution remains allowed.
3. Public proof covers `propose_patch` denial for `patchWorkflow: "disabled"` but not `apply_approved_patch` denial.

## Verified Causes

- `getGeneralWorkspaceStatus()` calls `optionalGitSummary(workspace.root)` without checking `capabilities.gitInspection.available`.
- `release_inspection` authority does not apply the same prerequisites as the centralized `releaseInspection` capability summary. It does not reject:
  - `gitOperations: "disabled"`; or
  - a Git workspace that is not explicitly release-capable.
- Focused tests do not exercise `apply_approved_patch` through the public toolbox under explicit patch disablement.

## Smallest Authorized Correction

Use the existing workspace capability summary and authority functions. Do not introduce another capability evaluator.

1. Gate optional Git status collection on the existing Git-inspection capability.
2. When Git inspection is disabled or unavailable, return bounded optional Git status without starting a Git process.
3. Make `release_inspection` execution use the same prerequisites as the centralized release-inspection capability result.
4. Add public-tool negative proof that `apply_approved_patch` is denied when `patchWorkflow: "disabled"`.

No new capability names, operation classes, registries, release paths, or fallback authorities are authorized.

## Required Behavior

### Git-disabled general status

Git-backed workspace with `gitOperations: "disabled"`
→ `repo_toolbox.status` or `workspace_safety_status`
→ centralized capability reports Git inspection disabled
→ no Git subprocess starts
→ result reports bounded disabled Git status
→ filesystem, artifact, and general diagnostic results remain available according to their own capabilities.

### Release-authority parity

Release summary request
→ resolve workspace
→ evaluate the existing release-inspection capability prerequisites
→ reject before release-file, Git-remote, or network inspection when:
- release operations are disabled;
- Git inspection is disabled or unavailable; or
- the workspace is not explicitly release-capable
→ reported capability and execution outcome agree.

### Patch-application denial proof

workspace with `patchWorkflow: "disabled"`
→ public `repo_toolbox.apply_approved_patch` request
→ existing patch authority rejects before proposal consumption or file mutation
→ result is `WORKSPACE_POLICY_DENIED`
→ repository and pending proposal state remain unchanged.

## Must Remain Unchanged

- Accepted non-Git read, search, status, safety, Markdown-write, and JSON-write behavior.
- Existing capability names and configuration schema.
- Existing explicit-disablement reporting added by Repair01.
- Existing localized non-Git Git-toolbox results.
- Existing Git-backed status, diff, history, staging, commit, push, readiness, and integration safeguards.
- Existing release summary behavior for authorized release-capable workspaces.
- Existing OAuth, write-mode, path, artifact, patch, trace, and redaction controls.
- Repair01 evidence sanitation and truthful publication reporting.

## Explicitly Out of Scope

- Workspace-model redesign.
- New release configuration fields.
- New public tools or actions.
- Changes to package, promotion, restart, reconnect, or live ChatGPT behavior.
- Sanitizing the older `WC-V1-0202G` Builder Report.
- Broad documentation changes.
- Staging, committing, pushing, integrating, packaging, publishing, or releasing.

## Authorized File Surface

Expected production files:

- `src/tools/workspaceStatusFacade.ts`
- `src/workspaceAuthority.ts`
- `src/workspaceCapabilities.ts` only if required to expose one shared existing-prerequisite helper without changing semantics

Expected tests:

- `tests/domainToolboxes.test.ts`
- `tests/publicSafeFacade.test.ts`
- `tests/writeAccessTools.test.ts` or the existing patch-authority test file

Required report:

- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202H-REPAIR02_capability_execution_parity_and_git_probe_isolation.md`

Any adjacent file must be technically justified in the Builder Report.

## Acceptance Criteria

1. `repo_toolbox.status` starts no Git process when `gitOperations: "disabled"`, even when `.git` exists.
2. `workspace_safety_status` starts no Git process under the same condition.
3. Disabled Git status is bounded and does not claim Git inspection occurred.
4. `release_inspection` execution rejects when `gitOperations: "disabled"`.
5. `release_inspection` execution rejects a Git workspace that is not explicitly release-capable.
6. Both release summary actions reject before release-file reads, Git remote inspection, or network fetch in all denied cases.
7. Authorized release-capable workspaces preserve existing release summary behavior.
8. `apply_approved_patch` returns `WORKSPACE_POLICY_DENIED` when `patchWorkflow: "disabled"`.
9. Rejected patch application does not consume a proposal, change a file, or mutate Git state.
10. Public diagnostics and execution return consistent capability outcomes.
11. Existing Git and non-Git regression suites remain passing.
12. No duplicate authority, fallback implementation, or alternate release mechanism is introduced.
13. Repair02 and parent Repair01 evidence remain publication-clean; any older out-of-scope failure is reported accurately.

Proof must exercise public toolbox entry points. Payload assertions alone are insufficient where the criterion requires proving that no Git, file, remote, network, or mutation operation occurred.

## Validation

Run after final Builder Report bytes are written:

1. Typecheck.
2. Focused Git-probe, release-authority, and patch-application tests.
3. Full regression suite and build.
4. MCP self-test.
5. Lint.
6. `git diff --check`.
7. Publication-cleanliness check.

## Stop Conditions

Stop and report rather than broaden scope if correction requires:

- a new capability or configuration schema;
- a second authority calculation;
- changes to accepted non-Git read/write behavior;
- changes to package or promotion contracts;
- modification of unrelated historical records.

## Binary Completion Rule

`Git-disabled general status starts no Git process`

+ `release execution and reporting use identical prerequisites`

+ `patch proposal and application disablement are both proven`

+ `accepted behavior remains intact`

+ `repair evidence remains clean and truthful`

+ `no alternate authority is introduced`

= `PASS`

Anything less is `RevisionRequired`.

## Document Disposition

`Document.Status=ApprovedForImplementation`
