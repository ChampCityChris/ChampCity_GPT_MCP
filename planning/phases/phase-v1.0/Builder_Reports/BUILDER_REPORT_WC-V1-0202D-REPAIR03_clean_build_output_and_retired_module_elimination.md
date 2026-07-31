# Builder Report: WC-V1-0202D-REPAIR03 Clean Build Output and Retired Module Elimination

Work Card: `WC-V1-0202D-REPAIR03_clean_build_output_and_retired_module_elimination.md`  
Parent: `WC-V1-0202D-REPAIR02`  
Status: Implemented  
Git mutation: not performed  
Packaging/promotion/restart/reconnect: not performed

## Plain Correction

After REPAIR02, deleted retired TypeScript source modules were gone, but stale compiled JavaScript still remained in `dist`. Because the build did not clean generated output first, those stale retired modules and stale tests could stay active and remain package input.

This repair makes the shared build path remove `dist` before compilation. The same path is used by `npm run build`, `npm test`, `validate:codex:unit`, `validate:codex:build`, and packaging entrypoints that call `mcp:build`. Release safety now also rejects retired compiled production modules under `dist/src`.

## Files Changed

- `package.json`
- `scripts/clean-dist.mjs`
- `scripts/check-release-clean.ps1`
- `tests/buildOutputCleanliness.test.ts`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202D-REPAIR03_clean_build_output_and_retired_module_elimination.md`

## Implementation Notes

- Added `clean:dist` as a repository-owned Node script.
- Updated `mcp:build` to run `npm run clean:dist` before `tsc` and renderer build.
- Preserved the existing `npm run build`, `npm test`, validation wrapper, and packaging paths by letting them inherit the shared `mcp:build` path.
- Extended `check-release-clean.ps1` to scan `dist/src` package input for retired compiled production module filenames.
- Added tests proving build-script wiring and release-safety rejection for a deliberately introduced retired production module.
- Did not change handoff contract behavior, public action policy, OAuth, workspace authority, Git behavior, or `electron-builder.json`.

## Proof Matrix

| # | Required proof | Status | Evidence |
|---|---|---|---|
| 1 | A normal build removes a pre-existing stale file from `dist` before compilation. | Proven | Seeded all four stale retired files in `dist`, ran `npm run build`, and confirmed the build output showed `clean:dist` before `tsc`. |
| 2 | The four verified retired compiled files are absent after build. | Proven | `Test-Path` returned `False` for all four specified paths after build and after the final validation build. |
| 3 | No retired action-shaped module name exists anywhere under `dist/src` after build. | Proven | `rg` over `dist/src` for the retired names returned no matches. |
| 4 | The test lane executes only current Architect Interview and Project Planning suites, without stale duplicates. | Proven | `validate:codex:unit` output showed only `submitHandoffOutputsArchitectInterview.test.js` and `submitHandoffOutputsProjectPlanning.test.js`; total tests dropped to 402 after stale duplicate suites disappeared. |
| 5 | Release safety fails when a retired compiled production module is deliberately introduced into package input. | Proven | Added `build output cleanliness` test creates a fake `dist/src/tools/saveArchitectInterviewOutput.js` in a temp repo and asserts `check-release-clean.ps1` fails. |
| 6 | Release safety passes after a clean current build. | Proven | `npm run check:release` passed after clean build/current validation. |
| 7 | `electron-builder.json` package input contains no retired implementation module after build. | Proven | `electron-builder.json` still includes `dist/**/*` and unpacks `dist/src/**/*`; `dist/src` contains no retired module names after build. |
| 8 | Source-level retired modules and identifiers remain absent. | Proven | `rg` over `src` for retired function/schema names returned no matches. |
| 9 | Unified Architect Interview, Project Planning, and Phase Map focused tests remain green. | Proven | `npm run validate:codex:unit` passed those focused suites through `artifact_toolbox.submit_handoff_outputs`. |
| 10 | Typecheck, clean build, complete tests, public safety, and release safety pass. | Proven | `npm run typecheck`, `npm run build`, `npm run validate:codex:unit`, `npm run check:public`, and `npm run check:release` passed. |
| 11 | Builder Report states plainly that stale compiled retired modules remained after REPAIR02 and that this repair eliminated the recurrence. | Proven | See `Plain Correction` above. |

## Validation

- `npm run build`
  - Execution lane: normal Windows execution lane.
  - Result: pass.
  - Sandbox-only failure: none.
  - Approved-lane validated: yes.
  - Notes: seeded stale retired files were removed by `clean:dist` before compilation.
- `npm run typecheck`
  - Execution lane: normal Windows execution lane.
  - Result: pass.
  - Sandbox-only failure: none.
  - Approved-lane validated: yes.
- `npm run validate:codex:unit`
  - Execution lane: normal Windows execution lane via `scripts/codex-validate.ps1 -Suite unit`.
  - Result: pass, 402/402 tests.
  - Sandbox-only failure: none.
  - Approved-lane validated: yes.
- `npm run check:public`
  - Execution lane: normal Windows execution lane.
  - Result: pass, publication cleanliness, 248 source candidate files checked.
  - Sandbox-only failure: none.
  - Approved-lane validated: yes.
- `npm run check:release`
  - Execution lane: normal Windows execution lane.
  - Result: pass, release cleanliness, 2796 release files checked.
  - Sandbox-only failure: none.
  - Approved-lane validated: yes.

## Validation Not Performed

- Packaging was not performed because the work card prohibited packaging until Architect approval.
- Live ChatGPT connector validation was not performed because this repair only changed build-output hygiene and release safety.

## Operator Validation Pending

- Architect/operator can review the generated `dist` tree after build and confirm no retired output names exist.
- Architect/operator can decide whether packaging should be authorized in a separate step.

## Scope and Fallback

Protected subsystem touched: release safety/build package-input enforcement only, as explicitly authorized by the repair card.  
Scope changed during implementation: no.  
Fallback used: no. No fallback implementation was used.  
A fallback may be possible, but was not implemented because architect/operator approval was not provided.
