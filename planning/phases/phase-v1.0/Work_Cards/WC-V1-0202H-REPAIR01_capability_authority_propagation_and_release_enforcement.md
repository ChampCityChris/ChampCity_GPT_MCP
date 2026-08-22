# WC-V1-0202H-REPAIR01 — Capability Authority Propagation and Release Enforcement

## Identity

- ID: `WC-V1-0202H-REPAIR01`
- Parent: `WC-V1-0202H`
- Priority: P0
- Branch: `dev`
- Required Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202H-REPAIR01_capability_authority_propagation_and_release_enforcement.md`

## Observed Defects

1. Public workspace diagnostics can report a capability as available even when explicit workspace configuration disables it.
2. Release summary actions remain callable for a Git workspace configured with `releaseOperations: "disabled"`.
3. General diagnostics for a non-Git workspace still attempt a Git subprocess before returning a successful non-Git result.
4. The submitted `WC-V1-0202H` Builder Report introduced private workstation identifiers and inaccurately attributed the entire publication-cleanliness failure to an older report.

## Verified Causes

- `listWorkspaceCatalog()` constructs a `ResolvedWorkspace` without copying `workspaceCapabilities` and also derives top-level availability through compatibility helpers that ignore explicit overrides.
- `write_access_status` republishes those non-authoritative compatibility fields.
- `legacyWorkspaceCapabilityConfig()` derives its displayed capability values from `writePolicy` rather than preserving explicit capability configuration.
- `resolveReleaseWorkspaceContext()` checks only for `.git`; the real release facades do not call the existing `release_inspection` authority.
- `buildRuntimeScopeToolDiagnostics()` requests the selected target HEAD through Git before checking whether Git inspection is available.
- The final Builder Report was written with local path/user values and `check:public` was not rerun against its final bytes before the report claimed the remaining failure was unrelated.

## Smallest Authorized Correction

Use the existing workspace registry, capability model, and workspace-authority functions. Do not redesign them.

1. Preserve explicit `workspaceCapabilities` whenever configured workspace data is converted to a resolved workspace.
2. Make `list_workspaces`, `write_access_status`, and `repo_toolbox.status` derive capability reporting from the same centralized capability result used by execution.
3. Ensure compatibility metadata cannot contradict explicit configured capabilities.
4. Route release inspection actions through the existing `release_inspection` authority before reading release state.
5. Do not invoke Git for target workspace HEAD or branch when Git inspection is unavailable.
6. Sanitize the `WC-V1-0202H` Builder Report and produce a public-clean Repair01 report with truthful final validation results.

No second workspace registry, alternate capability evaluator, fallback authority, or duplicate release path is authorized.

## Required Production Sequences

### Configured capability denial

explicit workspace capability set to `disabled`
→ public toolbox call resolves the configured workspace
→ centralized capability authority evaluates the operation
→ `list_workspaces`, `write_access_status`, and `repo_toolbox.status` report the same disabled state
→ the corresponding operation is denied through the existing localized authority
→ no public result claims the capability is available.

### Release inspection denial

Git workspace with `releaseOperations: "disabled"`
→ public `artifact_toolbox.release_artifact_summary` or `release_publication_summary` call
→ release workspace resolves
→ existing `release_inspection` authority is evaluated
→ request is rejected locally before release files, remotes, or network publication metadata are inspected
→ ordinary workspace reads and diagnostics remain unaffected.

### Non-Git general diagnostics

registered non-Git workspace
→ `diagnostics_toolbox.workspace_safety_status` or `repo_toolbox.status`
→ filesystem and capability state are evaluated
→ no target Git subprocess is started
→ successful general workspace result reports Git as optional and unavailable.

### Final evidence validation

final Repair01 Builder Report bytes written
→ publication-cleanliness check reruns
→ neither the `WC-V1-0202H` report nor the Repair01 report is identified as containing private workstation values
→ any remaining failure names only genuinely pre-existing out-of-scope records.

## Must Remain Unchanged

- Approved non-Git filesystem read, search, status, safety, Markdown-write, and JSON-write behavior.
- Existing workspace IDs and configured roots.
- Existing capability names and configuration schema.
- Existing localized non-Git results for Git inspection.
- Existing Git-backed status, diff, history, staging, commit, push, readiness, and integration safeguards.
- Existing OAuth, write-mode, path, symlink/reparse, artifact-root, evidence, trace, and redaction controls.
- Runtime-versus-target alignment behavior already corrected for unrelated workspaces.

## Explicitly Out of Scope

- Redesigning the workspace capability model.
- Adding new capability names or operation classes.
- Reopening accepted non-Git planning workflow behavior.
- Changing package, promotion, restart, reconnect, or live ChatGPT behavior.
- Sanitizing the older `WC-V1-0202G` Builder Report.
- Broad documentation rewrites.
- Staging, committing, pushing, integrating, packaging, publishing, or releasing.

## Authorized File Surface

Expected production files:

- `src/workspaces.ts`
- `src/workspaceCapabilities.ts`
- `src/tools/workspaceStatusFacade.ts`
- `src/tools/publicSafeFacade.ts`
- `src/tools/domainToolboxes.ts`

`src/workspaceAuthority.ts` may change only if narrowly required to consume the already-defined release authority consistently.

Expected tests:

- `tests/workspaces.test.ts`
- `tests/domainToolboxes.test.ts`
- `tests/publicSafeFacade.test.ts`
- focused HTTP transport tests only if required to prove the public MCP boundary.

Required report:

- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202H-REPAIR01_capability_authority_propagation_and_release_enforcement.md`

Any adjacent file must be identified and technically justified in the Builder Report.

## Acceptance Criteria

1. Explicit `artifactPersistence: "disabled"` is reported disabled by all public workspace diagnostics and the write operation is denied.
2. Explicit `patchWorkflow: "disabled"` is reported disabled and patch proposal/application remain denied.
3. Explicit `gitOperations: "disabled"` is reported disabled even when `.git` exists, and Git inspection does not execute.
4. Explicit `releaseOperations: "disabled"` is reported disabled and both release summary actions reject before release inspection.
5. Enabled/default configurations preserve previously accepted behavior.
6. `list_workspaces`, `write_access_status`, `repo_toolbox.status`, and operation execution never contradict one another.
7. Compatibility fields preserve legacy names without overriding or misreporting explicit capabilities.
8. General diagnostics for a non-Git target execute no target Git command.
9. A denied Git or release action does not alter subsequent read, status, safety, or artifact results.
10. Existing Git-backed and non-Git workflow regression suites remain passing.
11. No duplicate authority, fallback implementation, or alternate release mechanism is introduced.
12. Final publication checking no longer identifies either the `WC-V1-0202H` Builder Report or the Repair01 Builder Report; any remaining older failure is reported accurately as out of scope.

Proof must exercise the public toolbox entry points. Config-parser-only tests and direct helper assertions are insufficient.

## Validation

Run after final report bytes are written:

1. Typecheck.
2. Focused capability-authority and release tests.
3. Public toolbox or HTTP integration tests for each enabled/disabled override.
4. Full regression suite and build.
5. MCP self-test.
6. Lint.
7. `git diff --check`.
8. Publication-cleanliness check.

The Builder Report must distinguish repair-specific results from any older out-of-scope publication blocker.

## Stop Conditions

Stop and report rather than broaden scope if correction requires:

- a new registry or capability schema;
- server-side capability state separate from workspace configuration;
- changes to accepted read/write path safety;
- changes to package or promotion contracts;
- modification of unrelated historical planning records.

## Binary Completion Rule

`explicit capabilities govern execution and every public diagnostic consistently`

+ `release-disabled workspaces cannot enter release inspection`

+ `general non-Git diagnostics start no target Git process`

+ `accepted Git and non-Git behavior remains intact`

+ `final repair evidence is publication-clean and truthful`

+ `no alternate authority is introduced`

= `PASS`

Anything less is `RevisionRequired`.

## Document Disposition

`Document.Status=ApprovedForImplementation`
