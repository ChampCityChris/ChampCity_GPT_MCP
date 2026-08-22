# Builder Report: WC-V1-0202H-REPAIR01 - Capability Authority Propagation and Release Enforcement

## Repository Identity

- Repository root: `%USERPROFILE%\Projects\ChampCity_GPT`
- Git top-level: `%USERPROFILE%/Projects/ChampCity_GPT`
- Remote: `https://github.com/ChampCityChris/ChampCity_GPT_MCP.git`
- Package manifest: `package.json` present
- Branch: `dev`

## Scope

Implemented `WC-V1-0202H-REPAIR01` only. The repair used the existing workspace registry, capability summary, and workspace authority functions. No duplicate registry, alternate evaluator, fallback authority, or alternate release path was introduced.

## Files Changed

- `src/workspaceCapabilities.ts`
- `src/workspaces.ts`
- `src/workspaceAuthority.ts`
- `src/tools/publicSafeFacade.ts`
- `src/tools/domainToolboxes.ts`
- `tests/workspaces.test.ts`
- `tests/domainToolboxes.test.ts`
- `tests/publicSafeFacade.test.ts`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202H_workspace_capability_model_and_git_isolation.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202H-REPAIR01_capability_authority_propagation_and_release_enforcement.md`

The prior WC-V1-0202H Builder Report was changed only to sanitize local workstation path values. That report edit was required by this Repair01 Work Card.

## Implementation Summary

- Preserved configured `workspaceCapabilities` when workspace catalog entries are converted into resolved workspace data.
- Made catalog compatibility fields and legacy capability metadata preserve explicit disabled overrides instead of re-deriving from `writePolicy`.
- Made `diagnostics_toolbox.list_workspaces`, `diagnostics_toolbox.write_access_status`, and `repo_toolbox.status` report from the centralized capability summary.
- Kept non-Git Git-toolbox results localized as `GIT_CAPABILITY_UNAVAILABLE`, while explicit `gitOperations: "disabled"` reports policy denial and `GIT_OPERATIONS_DISABLED`.
- Routed release artifact and publication summaries through existing `release_inspection` workspace authority before release files, remotes, local artifact metadata, or GitHub release metadata are inspected.
- Prevented runtime diagnostics from reading selected target workspace HEAD when target Git inspection authority is unavailable.
- Sanitized private workstation path values from the WC-V1-0202H Builder Report.

## Acceptance Evidence

- Explicit `artifactPersistence: "disabled"` is reported disabled by catalog, write-access status, and repo status; Markdown artifact write is denied with `WORKSPACE_POLICY_DENIED`.
- Explicit `patchWorkflow: "disabled"` is reported disabled by catalog and repo status; patch proposal is denied with `WORKSPACE_POLICY_DENIED`.
- Explicit `gitOperations: "disabled"` is reported disabled even when `.git` exists; Git toolbox status reports `WORKSPACE_POLICY_DENIED`.
- Explicit `releaseOperations: "disabled"` is reported disabled; both public release summary actions reject before release-state reads. The test fixture also confirms `fetch` is not called.
- Registered non-Git workspace reads, list, search, general status, safety status, Markdown writes, and JSON writes remain accepted.
- Runtime status for a non-Git target reports target HEAD as `unknown`.
- Enabled/default Git and non-Git workflow behavior remained covered by the existing regression suite.
- No fallback implementation was used.

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
  - First approved rerun result: FAIL, one Repair01 expectation needed the existing non-Git `GIT_CAPABILITY_UNAVAILABLE` reason.
  - Final approved rerun result: PASS, 423 tests passed.
- `npm run validate:codex:build`
  - Lane: normal Windows execution with escalation.
  - Result: PASS.
- `npm run mcp:self-test -- --json`
  - Lane: normal Windows execution with escalation.
  - Result: PASS, `ok: true`, 23 checks passed.
- `npm run lint`
  - Lane: sandbox shell, TypeScript no-emit.
  - Result: PASS.
- `git diff --check`
  - Lane: sandbox shell.
  - Result: PASS; line-ending warnings only.
- `npm run check:public`
  - Lane: sandbox shell.
  - Result: FAIL.
  - Repair-specific result: the sanitized WC-V1-0202H Builder Report was not identified.
  - Remaining failure: out-of-scope pre-existing private workstation values in `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202G_bounded_text_projection_and_safety_resilient_read_protocol.md`.

## Validation Not Performed

- No Playwright.
- No packaging.
- No promotion.
- No connector start, stop, restart, or reconnect.
- No live ChatGPT connector validation.
- No staging, commit, push, merge, integration, publish, or release.

## Protected Subsystems

No OAuth, PKCE, MCP transport, public endpoint, Cloudflare, runtime path, local config persistence, token/session storage, admin password, write-scope enforcement, server lifecycle, packaging, preload API, or `window.champcity` contract was modified.

`src/workspaceAuthority.ts` was touched narrowly to consume the existing Git and release authority consistently and to distinguish explicit disabled Git configuration from ordinary non-Git unavailability.

## Scope Discipline

Scope did not change during implementation. The out-of-scope WC-V1-0202G Builder Report was not sanitized.

## Remaining Operator Validation

- In a future live ChatGPT connector session, verify `diagnostics_toolbox.list_workspaces`, `diagnostics_toolbox.write_access_status`, `repo_toolbox.status`, and `artifact_toolbox.release_*` behavior against real configured workspaces if operator-level connector evidence is required.
- If full publication cleanliness is required, authorize a separate task to sanitize the out-of-scope WC-V1-0202G Builder Report.

## Blockers and Assumptions

- `npm run check:public` remains blocked by the older WC-V1-0202G report named above.
- Assumption: preserving the existing localized non-Git Git-toolbox result while making explicit Git disablement a policy-denied result satisfies compatibility and Repair01 authority requirements.

No fallback implementation was used.
