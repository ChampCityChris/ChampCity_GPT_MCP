# Builder Report - WC-V1-0202F-REPAIR01 Create-Only Concurrency and Transaction Safety

## Objective

Repair the accepted generic `artifact_toolbox.create_markdown_artifact` action for create-only concurrency, parent path revalidation, and truthful rollback failure reporting without changing the public action contract.

## Repository Verification

- Current working directory: `<PROJECT_REPO>`
- Git top-level: `<PROJECT_REPO>`
- Remote: `https://github.com/ChampCityChris/ChampCity_GPT_MCP.git`
- Starting branch: `dev`
- Starting HEAD: `2e8558fcd49eb0c3c702a7d31c843a5f8e682c14`
- `package.json`: present

## Files Changed

- `src/tools/createMarkdownArtifact.ts`
- `tests/createMarkdownArtifact.test.ts`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202F-REPAIR01_create_only_concurrency_and_transaction_safety.md`

## Implementation Summary

- Replaced missing-target temp-rename creation with exclusive final-path open using `wx`.
- On exclusive-create conflict, rereads the final target as a regular safe file and returns `already_saved` only for exact byte equality.
- Different concurrent bytes now surface the existing generic `DESTINATION_EXISTS` conflict and preserve the winning file.
- Added parent-chain creation and validation one segment at a time, with `lstat`, reparse/symlink checks, and realpath containment checks after create or `EEXIST`.
- Revalidates the complete parent chain immediately before final create or replace.
- Preserves existing overwrite snapshot comparison before replacement.
- Verifies rollback by rereading restored bytes.
- Surfaces rollback failure as `VERIFICATION_FAILED` with bounded redacted diagnostic summaries for original and rollback failures.
- Added deterministic internal test hooks for race placement and failure injection only; no public params, response fields, hashes, locks, or fallback flows were added.

## Tests Added Or Extended

- Concurrent missing-target create with different bytes: one `saved`, one conflict, winner preserved.
- Concurrent missing-target create with identical bytes: one `saved`, one `already_saved`.
- Target appears after missing-target observation with `overwrite=false`: not overwritten.
- Exclusive-create failure after final file creation: created file removed, temp files absent.
- Newly created parent segments are revalidated.
- Parent symlink or junction introduced after initial resolution is rejected without outside write when the platform fixture is available.
- Final parent path swapped after chain validation is rejected before installation when the platform fixture is available.
- Successful rollback restores exact original bytes and removes temp files.
- Injected rollback write failure surfaces rollback failure.
- Injected rollback verification mismatch surfaces rollback failure.
- Action inventory remains bounded and `submit_handoff_outputs` remains unsupported.

## Proof Matrix

1. Missing-target installation is atomically create-only and cannot replace a concurrent winner: Proven.
2. Concurrent identical creation returns one `saved` and one `already_saved` without rewriting the winner: Proven.
3. Concurrent different creation returns one `saved` and one conflict while preserving the winner: Proven.
4. A target appearing after the initial check is never overwritten when `overwrite=false`: Proven.
5. Parent directories are validated after creation or concurrent appearance: Proven.
6. The complete final parent chain is revalidated immediately before installation: Proven.
7. Symlink, junction, reparse-point, and containment protections remain effective under the added race hooks: Proven in the normal Windows validation lane with platform-permitted fixture guards.
8. Successful rollback restores and verifies exact original bytes: Proven.
9. Rollback failure is surfaced truthfully and is never suppressed: Proven.
10. Temporary files are removed across create, replacement, verification, and rollback paths: Proven.
11. The public request and response contracts are unchanged: Proven.
12. Content remains opaque and exact: Proven.
13. No workflow, application, schema, review, hash-token, or domain authority is introduced: Proven.
14. Existing generic workspace, artifact-root, file-policy, size, write-mode, OAuth, and audit safeguards remain effective: Proven.
15. `submit_handoff_outputs` remains absent and unsupported: Proven.
16. Typecheck passes: Proven.
17. Clean build passes: Proven.
18. Complete tests pass: Proven.
19. Public safety passes: Proven.
20. Release safety passes: Proven.
21. The repair Builder Report acknowledges the original concurrency, parent-path, and rollback gaps: Proven by this report.

## Validation Commands And Results

Execution lane: normal Windows validation lane, per `docs/dev/VALIDATION_COMMAND_LANES.md`.

- `npm run validate:codex:unit`: pass. This ran `npm run test`, which ran `npm run build` and `node --test dist/tests/*.test.js`.
- `npm run test` result through wrapper: 398 tests passed, 0 failed.
- `npm run typecheck`: pass.
- `npm run check:public`: pass. Output: `PASS publication cleanliness`; checked 254 source candidate files after this report was added.
- `npm run check:release`: pass. Output: `PASS release cleanliness`; checked 2798 release files.

No sandbox-only validation failure occurred. The relevant child-process-heavy validation was run in the approved normal Windows lane.

## Protected Subsystems

Protected subsystem touched: no.

OAuth, PKCE, MCP HTTP transport, MCP endpoint behavior, Cloudflare configuration, runtime path behavior, config persistence, token storage, admin password handling, write-scope enforcement, server lifecycle, packaging/release configuration, Figma Make architecture, preload APIs, and `window.champcity` APIs were not changed.

## Scope

Scope changed during implementation: no.

The repair stayed within the authorized production and test surface. No dependencies were added. No public schema, response shape, action inventory expansion, alias, wrapper, domain adapter, application callback, workflow behavior, hash token, or caller-visible locking behavior was added.

## Packaging, Promotion, And Git

- Packaging performed: no.
- Runtime promotion performed: no.
- Git staging performed: no.
- Git commit performed: no.
- Git push performed: no.

## Remaining Operator Validation

- Optional: run the repaired action from a real ChatGPT MCP conversation if operator acceptance requires live connector confirmation.
- No Electron UI visual validation is required for this repair.
- No packaged executable validation was performed because packaging was prohibited by the work card.

## Blockers Or Assumptions

- No blockers encountered.
- Assumption: deterministic local tests are sufficient for the storage-transaction repair because the public MCP exposure contract was not changed.

## Fallbacks

No fallback implementation was used.
