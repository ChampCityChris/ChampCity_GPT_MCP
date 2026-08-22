# Builder Report - WC-V1-0202H-REPAIR02

## Summary

Implemented capability execution parity and Git-probe isolation for `WC-V1-0202H-REPAIR02`.

Result: `PASS` with one pre-existing out-of-scope publication-cleanliness failure recorded below.

## Files Changed

- `src/tools/workspaceStatusFacade.ts`
- `src/workspaceAuthority.ts`
- `src/tools/domainToolboxes.ts`
- `src/validation/mcpSelfTest.ts`
- `tests/domainToolboxes.test.ts`
- `tests/publicSafeFacade.test.ts`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202H-REPAIR02_capability_execution_parity_and_git_probe_isolation.md`

`src/tools/domainToolboxes.ts` was touched because `diagnostics_toolbox.workspace_safety_status` built broader runtime diagnostics before dispatch, which could start runtime Git probes before returning workspace safety status. The safety-status actions now dispatch directly to `getWorkspaceSafetyStatus()`.

`src/validation/mcpSelfTest.ts` was touched because the self-test release-summary fixture needed to be explicitly release-capable under the repaired release authority.

## Implementation Notes

- `repo_toolbox.status` and `workspace_safety_status` now return bounded Git status from the centralized `gitInspection` capability when Git inspection is disabled or unavailable.
- Disabled Git status reports `git_inspection_disabled` with `GIT_OPERATIONS_DISABLED` and does not collect branch/status details.
- Non-Git workspaces keep the existing bounded `not_git_repository` status.
- `release_inspection` authority now evaluates the centralized `releaseInspection` capability before release summary execution.
- Release summary execution now denies `gitOperations: "disabled"` and Git workspaces that are not explicitly release-capable before release artifact checks, Git remote probes, or network fetches.
- Existing artifact-only release denial is preserved.
- Public `repo_toolbox.apply_approved_patch` denial is proven for `patchWorkflow: "disabled"` without consuming the pending proposal, mutating files, or changing Git state.

## Protected Subsystems

No protected subsystem was intentionally changed.

No OAuth, PKCE, MCP transport, public endpoint, token/session storage, write-scope enforcement, Cloudflare, packaging, runtime path, preload API, or `window.champcity` API behavior was changed.

## Scope

Scope did not change during implementation.

The only adjacent production changes were the two technically required items noted above:

- direct safety-status dispatch in `src/tools/domainToolboxes.ts`;
- explicit release-capable self-test fixture setup in `src/validation/mcpSelfTest.ts`.

## Fallbacks

No fallback implementation was used.

## Validation

Execution lane: normal Windows execution through the repository validation wrapper or direct compiled Node tests after `npm run build`.

Performed:

- `node --check src/tools/workspaceStatusFacade.ts` - PASS
- `node --check src/workspaceAuthority.ts` - PASS
- `node --check tests/domainToolboxes.test.ts` - PASS
- `npm run build` - PASS
- `node --test dist/tests/domainToolboxes.test.js dist/tests/publicSafeFacade.test.js dist/tests/mcpSelfTest.test.js` - PASS, 47/47 tests
- `npm run validate:codex:unit` - PASS, 425/425 tests
- `npm run lint` - PASS
- `npm run mcp:self-test` - PASS, 23/23 checks
- `git diff --check` - PASS; emitted line-ending normalization warnings only
- Private-local-path and token-pattern check against the Repair02 report - PASS, no matches
- Private-local-path and token-pattern check against the Repair01 report - PASS, no matches
- `npm run check:public` - FAIL due pre-existing out-of-scope `WC-V1-0202G` Builder Report private local value matches

Initial validation finding:

- First `npm run validate:codex:unit` run failed because release-positive fixtures were not explicitly release-capable and because `workspace_safety_status` still built broader runtime diagnostics before dispatch. Both were corrected, and focused plus full unit validation passed afterward.

Publication-cleanliness note:

- The global publication-cleanliness check failed on `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202G_bounded_text_projection_and_safety_resilient_read_protocol.md`.
- The failure matched a private local Windows user path and local username.
- That older `WC-V1-0202G` report is explicitly out of scope for this work card and was not modified.
- Repair02 and parent Repair01 reports were checked directly for the same sensitive patterns and had no matches.

## Operator Validation

No subjective UI or visual validation is required.

For ChatGPT/MCP live validation, operator may verify in a new ChatGPT conversation:

- `repo_toolbox.status` on a Git-backed workspace with `gitOperations: "disabled"` reports disabled Git inspection without branch/status details.
- `diagnostics_toolbox.workspace_safety_status` under the same workspace reports the same bounded disabled Git status.
- `artifact_toolbox.release_artifact_summary` and `artifact_toolbox.release_publication_summary` reject when Git operations are disabled or the workspace is not release-capable.
- `repo_toolbox.apply_approved_patch` rejects when `patchWorkflow: "disabled"`.

## Blockers And Assumptions

No blockers remain.

Assumption: Existing explicit release-capable definition remains `workspaceId === "champcity_gpt"` or a configured workspace `remote`.

## Binary Completion

- Git-disabled general status starts no Git process: PASS
- Release execution and reporting use identical centralized prerequisites: PASS
- Patch proposal and application disablement are both proven: PASS
- Accepted behavior remains intact: PASS
- Repair evidence remains clean and truthful: PASS for Repair02 and parent Repair01; global check still fails on older out-of-scope WC-V1-0202G evidence
- No alternate authority is introduced: PASS
