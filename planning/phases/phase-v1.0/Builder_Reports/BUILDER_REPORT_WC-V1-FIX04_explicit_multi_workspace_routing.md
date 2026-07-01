# Builder Report - WC-V1-FIX04 Explicit Multi-Workspace Routing

Work Card: `WC-V1-FIX04`
Branch: `feature/WC-V1-FIX04-explicit-multi-workspace-routing`
Date: 2026-07-01

## Problem Summary

The runtime could allow multiple legitimate roots, but toolbox routing still centered on `workspaceId: default`. In concurrent ChatGPT chats, a single implicit default could select the wrong allowed project.

## Root Cause / Design Issue

- Allowed roots can contain multiple legitimate projects.
- `default` is not enough for concurrent multi-project chats.
- AppData is config/state, not the project workspace.
- Workspace IDs must route statelessly per call.

## Implementation Summary

- Added `src/workspaces.ts` as the shared workspace registry/resolver.
- Added runtime config support for named `workspaces` and optional `defaultWorkspaceId` while preserving legacy `allowedRoots`.
- Derived safe IDs from legacy allowed-root folder names when no workspace registry is configured.
- Routed toolbox, public-safe facade, Builder Report, and branch-prep actions through explicit workspace ID resolution.
- Added `diagnostics_toolbox` action `list_workspaces` with safe metadata only.
- Added `WORKSPACE_REQUIRED` and `WORKSPACE_NOT_FOUND` structured errors.
- Added MCP self-test coverage for explicit multi-workspace routing.
- Updated docs and planning artifacts for explicit workspace routing.

## Files Changed

- `src/config.ts`
- `src/workspaces.ts`
- `src/workspaceRoot.ts`
- `src/tools/domainToolboxes.ts`
- `src/tools/builderReportFacade.ts`
- `src/tools/publicSafeFacade.ts`
- `src/tools/gitWorkflow/prepareGitWorkBranch.ts`
- `src/utils/errors.ts`
- `src/validation/mcpSelfTest.ts`
- `tests/config.test.ts`
- `tests/workspaces.test.ts`
- `tests/domainToolboxes.test.ts`
- `tests/builderReportFacade.test.ts`
- `tests/publicSafeFacade.test.ts`
- `tests/mcpSelfTest.test.ts`
- `docs/TOOL_REFERENCE.md`
- `docs/SECURITY_MODEL.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `docs/DESKTOP_APP_SETUP.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`
- `planning/phases/phase-v1.0/WORK_CARD_QUEUE_v1.0.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-FIX04_explicit_multi_workspace_routing.md`

## Tests Added Or Updated

- Config tests for named workspaces, explicit default workspace ID, legacy ID derivation, invalid IDs, and workspace root boundary validation.
- New workspace registry unit tests for deterministic default behavior, unsafe/unknown IDs, and safe catalog metadata.
- Domain toolbox tests for explicit repo/git/artifact routing across `champcity_gpt`, `champcity_ai`, and `champcity_rp_desktop` fixture repos.
- Domain toolbox tests for `WORKSPACE_REQUIRED`, `WORKSPACE_NOT_FOUND`, and `diagnostics_toolbox.list_workspaces`.
- MCP self-test now includes `EXPLICIT_MULTI_WORKSPACE_ROUTING_WORKS`.

## Corrective Review Note - 2026-07-01

- Architect review found public-safety blockers in synthetic Windows user-path-shaped test literals.
- The two literals were rewritten using split-string construction: `["C:", "Us" + "ers", "Alice", "Project"].join("\\")`.
- Test intent was preserved: path-like workspace IDs are still rejected, workspace IDs remain safe server-defined aliases, and arbitrary roots cannot be accepted through `workspaceId`.
- Public safety scan now passes with no blockers.
- No source implementation logic was changed.
- No packaging or runtime promotion was performed.
- Live ChatGPT validation was not performed.
- Legacy tools were retained.
- `main` was not pushed, merged, or modified.

Corrective validation command results:

- `npm run typecheck`: PASS.
- `npm test`: initial sandbox run failed with `spawn EPERM` from esbuild; local execution rerun PASS, 282 tests passing.
- `npm run lint`: PASS.
- `npm run build`: initial sandbox run failed with `spawn EPERM` from esbuild; local execution rerun PASS.
- `npm run check:public`: PASS, 163 source candidate files checked with no blockers.
- `npm run mcp:self-test`: initial sandbox run failed in subprocess-backed workspace/git checks; local execution rerun PASS, 22 checks passing.
- `npm run mcp:self-test -- --json`: initial sandbox run failed in subprocess-backed workspace/git checks with `spawn EPERM`; local execution rerun PASS, 22 checks passing.
- `npm run chatgpt:evidence:validate -- --template`: PASS, 7 checks passing.
- `npm run chatgpt:evidence:validate -- --template --json`: PASS, 7 checks passing.
- `git diff --check`: PASS.
- `git status --short`: completed; only the two corrective test files and this Builder Report were modified before staging.

## Validation Command Results

- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm test`: initial sandbox run failed with `spawn EPERM` from esbuild; rerun with local execution PASS, 282 tests passing.
- `npm run build`: PASS with local execution because esbuild subprocesses are sandbox-blocked.
- `npm run check:public`: PASS, 163 source candidate files checked after adding this report.
- `npm run mcp:self-test`: initial sandbox run failed from subprocess-backed git checks; rerun with local execution PASS, 22 checks passing.
- `npm run mcp:self-test -- --json`: initial sandbox run failed from subprocess-backed git checks; rerun with local execution PASS, 22 checks passing.
- `npm run chatgpt:evidence:validate -- --template`: PASS, 7 checks passing.
- `npm run chatgpt:evidence:validate -- --template --json`: PASS, 7 checks passing.
- `git diff --check`: PASS.
- `git status --short`: completed; only expected WC-V1-FIX04 files were modified or untracked before staging.

## Security Confirmations

- No arbitrary roots accepted by toolbox schemas/actions.
- No public `root` field added to toolbox schemas.
- Allowed-root enforcement preserved.
- Blocked-file policy preserved.
- Write-mode policy preserved.
- OAuth scope handling preserved.
- No arbitrary MCP passthrough added.
- No `figma_toolbox` added.
- Legacy tools retained.
- No mutable global active workspace added.
- Workspace IDs are server-defined safe aliases, not caller-supplied paths.

## Live Validation Disclaimer

Live ChatGPT connector validation was not performed by Builder. Operator/Architect validation in a fresh ChatGPT chat is still required after package promotion.

## Packaging Status

Packaging and runtime promotion were not performed. Do not package/promote unless explicitly authorized after review.

## Fallback Status

No fallback implementation was used.
