# Builder Report - Runtime Drift Diagnostics And Promotion Provenance v0.3.0

## Summary

The active-runtime failure was caused by source/runtime version drift: the corrected `0.3.0` source was present, but the active promoted runtime was still the `0.2.1` portable copy.

This pass preserved the existing pending-patch proposal protocol, added bounded runtime/workspace drift diagnostics, added runtime promotion provenance manifest output, validated the source, packaged `0.3.0`, promoted it to the development runtime copy, and restarted the launcher.

Live HTTP MCP verification is blocked because the restarted packaged launcher process is running but the local HTTP server is not listening on `127.0.0.1:3333`; the packaged app starts that listener through the launcher UI action, not from process launch alone. No fallback implementation was added.

## Repository Verification

- Working directory verified: `%USERPROFILE%\Projects\ChampCity_GPT`
- Git top-level verified: `%USERPROFILE%\Projects\ChampCity_GPT`
- Remote verified: `https://github.com/ChampCityChris/ChampCity_GPT_MCP.git`
- Starting branch: `dev`
- Starting HEAD: `780217aa1046ad8d271d13887ba1121bba419362`
- Package version: `0.3.0`
- Initial dirty state preserved:
  - `M planning/phases/phase-v1.0/04_operator_intake_interview.md`
  - `M planning/phases/phase-v1.0/Live_Connector_Evidence/README.md`

No Git staging, commit, push, merge, rebase, reset, clean, stash, tag, or release publication was performed.

## Source Verification

Inspected:

- `src/tools/applyApprovedPatch.ts`
- `src/tools/domainToolboxes.ts`
- `src/server/registerTools.ts`
- `src/pendingPatches.ts`
- `tests/writeAccessTools.test.ts`
- `tests/applyApprovedPatch.integration.test.ts`
- `docs/SECURITY_MODEL.md`
- `docs/TOOL_REFERENCE.md`
- `docs/RELEASE_NOTES.md`

Findings:

- `apply_approved_patch` accepts `patch`, optional `proposalId`, and optional `patchHash`.
- It does not accept `approvalToken`.
- `repo_toolbox.apply_approved_patch` rejects unknown params through strict action schema validation.
- Patch and elevated modes both require an exact, live, unused pending proposal for the same workspace root.
- Proposal mismatch, expiry, reuse, or hash failure remains `PATCH_DENIED`.
- Proposal failures are not caught and converted into local elevated-token approval challenges.
- Proposals are marked used only after successful `git apply` and post-apply symlink checks.

The token-removal source implementation already existed in `0.3.0`; no patch-approval implementation rewrite was made.

## Changes Made

- `src/tools/domainToolboxes.ts`
  - Extended `diagnostics_toolbox.runtime_status` with:
    - `runtimePackageVersion`
    - `selectedWorkspacePackageVersion`
    - `packageVersionMatch`
    - `runtimeSourceCommit`
    - `selectedWorkspaceHead`
    - `runtimeDriftDetected`
  - Retained backward-compatible `packageVersion`, `commit`, and `branch` fields.
  - Added a clear warning when runtime/workspace package versions definitely differ.

- `scripts/promote-runtime-exe.mjs`
  - Preserved current artifact safeguards for final portable executables.
  - Added `runtime-manifest.json` writing after copy and SHA-256 comparison succeed.
  - Manifest write failure now fails promotion.

- `tests/domainToolboxes.test.ts`
  - Added focused runtime-status tests for matching versions, mismatched versions, missing workspace package metadata, redaction, and backward-compatible `packageVersion`.

- `tests/promoteRuntimeProvenance.test.ts`
  - Added focused manifest helper tests for non-secret provenance shape and replace-safe local writes.

- `docs/SECURITY_MODEL.md`
- `docs/TOOL_REFERENCE.md`
- `docs/RELEASE_NOTES.md`
  - Documented runtime drift diagnostics, package/promote activation requirement, and promotion provenance.

## Validation

Execution lane for validation commands: documented normal Windows lane outside the sandbox. No sandbox-only `spawn EPERM` failure was used as evidence.

| Command | Lane | Exit Code | Result |
| --- | --- | ---: | --- |
| `node --check scripts\promote-runtime-exe.mjs` | sandbox, syntax-only | 0 | Pass |
| `npm run validate:codex:unit` | normal Windows validation lane | 0 | Pass, 311 tests |
| `npm run typecheck` | normal Windows validation lane | 0 | Pass |
| `npm run build` | normal Windows validation lane | 0 | Pass |
| `npm test` | normal Windows validation lane | 0 | Pass, 311 tests |
| `npm run check:public` | normal Windows validation lane | 0 | Pass, final rerun checked 183 source candidate files |
| `npm run check:release` | normal Windows validation lane | 0 | Pass, final rerun checked 2788 release files |

Regression evidence:

- `writeAccessTools.test.ts` includes `apply_approved_patch reports proposal failures in elevated mode instead of requesting an approval token`.
- The test passed in both `npm run validate:codex:unit` and `npm test`.
- The expected error is proposal-specific hash mismatch text, not `APPROVAL_REQUIRED` and not `Local elevated approval token is invalid.`

## Packaging And Promotion Evidence

Command:

```powershell
npm run app:package-and-promote
```

Execution lane: normal Windows packaging lane outside the sandbox.

Exit code: `0`

Final artifact:

- Path: `release\ChampCity GPT MCP Launcher-0.3.0-x64.exe`
- Size: `96045155`
- LastWriteTime: `2026-07-24T17:04:40.205Z`
- SHA-256: `31426f7dc7fc0c4b315da887e9ffac34bc2d6c955a5f9c2dcc3a956e254db5c0`

Promoted runtime copy:

- Path: `%USERPROFILE%\Apps\ChampCity_GPT_MCP_Runtime\ChampCity GPT MCP Launcher-live.exe`
- Size: `96045155`
- LastWriteTime: `2026-07-24T17:04:40.205Z`
- SHA-256: `31426f7dc7fc0c4b315da887e9ffac34bc2d6c955a5f9c2dcc3a956e254db5c0`

The packaged artifact hash and promoted runtime-copy hash match exactly.

Runtime manifest evidence, path redacted:

```json
{
  "packageVersion": "0.3.0",
  "sourceCommit": "780217a",
  "sourceArtifactSha256": "31426f7dc7fc0c4b315da887e9ffac34bc2d6c955a5f9c2dcc3a956e254db5c0",
  "runtimeCopySha256": "31426f7dc7fc0c4b315da887e9ffac34bc2d6c955a5f9c2dcc3a956e254db5c0",
  "promotedAt": "2026-07-24T17:04:41.257Z"
}
```

Prior `0.2.1` artifact was not deleted.

## Runtime Restart Evidence

Before promotion, identified and stopped only ChampCity launcher/runtime processes:

- `ChampCity GPT MCP Launcher`
- `ChampCity GPT MCP Launcher-0.2.1-x64`

After promotion, restarted:

- `%USERPROFILE%\Apps\ChampCity_GPT_MCP_Runtime\ChampCity GPT MCP Launcher-live.exe`

Observed running after restart:

- `ChampCity GPT MCP Launcher-live`
- associated portable extraction child processes named `ChampCity GPT MCP Launcher`

Processes left running after packaging:

- The promoted launcher runtime and its associated portable extraction child processes.

## Live Runtime Verification

Blocked.

Attempted:

- Started promoted runtime executable.
- Probed `http://127.0.0.1:3333/health`.
- Checked local TCP listeners on port `3333`.

Result:

- `/health` timed out or could not connect.
- No `Get-NetTCPConnection` listener was returned for local port `3333`.
- Therefore `diagnostics_toolbox.runtime_status`, `diagnostics_toolbox.write_access_status`, and live `repo_toolbox.propose_patch` / `repo_toolbox.apply_approved_patch` calls could not be executed against the active HTTP MCP runtime from Codex.

Reason:

- The packaged launcher process does not auto-start the HTTP MCP listener on process launch.
- The supported packaged path starts the listener through the launcher UI action `Start Local HTTP MCP Server`.
- No CLI or authorized fallback path was available for Codex to start that in-process listener.

Not performed:

- Live `diagnostics_toolbox.runtime_status`.
- Live `diagnostics_toolbox.write_access_status`.
- Live strict unknown-param check for `approvalToken`.
- Live exact proposal apply.
- Live mismatched-proposal `PATCH_DENIED` check.
- Live ChatGPT connector refresh/reconnect validation.

A fallback may be possible, but was not implemented because architect/operator approval was not provided.

## Scope And Safety

- Protected subsystems touched: packaging/promotion workflow and MCP diagnostics output, both explicitly scoped by the prompt.
- Protected subsystems not touched: OAuth behavior, PKCE, MCP HTTP transport, public endpoint behavior, Cloudflare tunnel behavior, token/session storage, admin password handling, write-scope enforcement, server lifecycle/shutdown behavior, server start/stop/restart behavior, package publication, git commit/push automation, preload API shape, and `window.champcity` API shape.
- Scope did not change during implementation.
- No fallback implementation was used.
- No ChampCity_AI files were modified.
- Existing unrelated planning-file modifications were preserved.

## Remaining Operator Validation

1. In the promoted launcher, click `Start Local HTTP MCP Server`.
2. Confirm `http://127.0.0.1:3333/health` returns status ok.
3. Restart or reconnect the ChampCity MCP ChatGPT app so cached schemas are refreshed.
4. Ask for `diagnostics_toolbox.runtime_status`.
5. Confirm runtime and selected workspace package versions both report `0.3.0`.
6. Confirm no runtime-drift warning appears.
7. Ask for `diagnostics_toolbox.write_access_status`.
8. Generate and apply an exact pending proposal through `repo_toolbox.propose_patch` and `repo_toolbox.apply_approved_patch`.
9. Confirm no local elevated approval token or UI approval control is requested.
10. Send a deliberate `approvalToken` param to `repo_toolbox.apply_approved_patch` and confirm strict unknown-param rejection.
11. Run a mismatched non-mutating proposal probe and confirm proposal-specific `PATCH_DENIED`, not `APPROVAL_REQUIRED`.
12. Review any disposable validation diff and clean it up through its defined cleanup path.

## Final Git Status

```text
 M docs/RELEASE_NOTES.md
 M docs/SECURITY_MODEL.md
 M docs/TOOL_REFERENCE.md
 M planning/phases/phase-v1.0/04_operator_intake_interview.md
 M planning/phases/phase-v1.0/Live_Connector_Evidence/README.md
 M scripts/promote-runtime-exe.mjs
 M src/tools/domainToolboxes.ts
 M tests/domainToolboxes.test.ts
?? planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_RUNTIME_DRIFT_PROMOTION_PROVENANCE_v0.3.0.md
?? tests/promoteRuntimeProvenance.test.ts
```

The two pre-existing unrelated planning modifications remain present and were not edited by this pass:

- `planning/phases/phase-v1.0/04_operator_intake_interview.md`
- `planning/phases/phase-v1.0/Live_Connector_Evidence/README.md`
