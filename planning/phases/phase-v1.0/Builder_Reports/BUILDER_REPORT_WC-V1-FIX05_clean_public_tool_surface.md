# Builder Report - WC-V1-FIX05 Clean Public Tool Surface

Work Card: `WC-V1-FIX05`
Branch: `feature/WC-V1-FIX05-clean-public-tool-surface`
Date: 2026-07-01

## Problem Summary

The public ChatGPT MCP surface had accumulated legacy top-level tools, obsolete direct Figma/Figma Make tools, and an elevated script entrypoint that should not be visible as normal public connector tools. The v1 toolbox architecture requires a clean seven-tool public surface while preserving safe internal implementations where toolbox routers still need them.

## Decisions

- Obsolete direct Figma tools and direct Figma/Figma Make implementation code were removed.
- Future Figma support belongs under `integration_toolbox` as a governed broker path.
- `create_codex_ui_handoff_prompt` was removed from the Figma-specific public/action path.
- Public ChatGPT `tools/list` now exposes only the seven toolbox tools.
- `.json` artifact writing was added as `repo_toolbox.write_json_artifact`.
- A hidden internal gated schema was added for `write_json_artifact` so diagnostics and self-test classify the toolbox-backed JSON write path consistently; it is not exposed publicly.
- Patch proposal/application capability was preserved under `repo_toolbox.propose_patch` and `repo_toolbox.apply_approved_patch`.
- `run_allowed_script` is hidden from the public MCP tool surface without adding a replacement public script tool.
- Figma and Figma Make are represented as safe `broker_not_implemented` placeholders under `integration_toolbox`, with no arbitrary upstream MCP passthrough.

## Files Changed

- `README.md`
- `docs/CHAMPCITY_NET_ENDPOINT.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `docs/DESKTOP_APP_SETUP.md`
- `docs/SECURITY_MODEL.md`
- `docs/TOOL_REFERENCE.md`
- `electron/launcherCore.ts`
- `electron/main.ts`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`
- `planning/phases/phase-v1.0/WORK_CARD_QUEUE_v1.0.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-FIX05_clean_public_tool_surface.md`
- `src/server/registerTools.ts`
- `src/tools/domainToolboxes.ts`
- `src/tools/inputLimits.ts`
- `src/tools/writeJsonArtifact.ts`
- `src/validation/mcpSelfTest.ts`
- `tests/domainToolboxes.test.ts`
- `tests/httpTransport.test.ts`
- `tests/launcherDiagnostics.test.ts`
- `tests/mcpSelfTest.test.ts`
- `tests/toolSchema.test.ts`
- `tests/writeAccessTools.test.ts`

Deleted obsolete direct Figma/Figma Make implementation files:

- `src/figma/codexUiPrompt.ts`
- `src/figma/figmaClient.ts`
- `src/figma/figmaConfig.ts`
- `src/figma/figmaExtract.ts`
- `src/figma/figmaHandoff.ts`
- `src/figma/figmaMakeFileHandoff.ts`
- `src/figma/figmaMakeHandoff.ts`
- `src/figma/figmaMcpClient.ts`
- `src/figma/figmaMcpConfig.ts`
- `src/figma/figmaUrl.ts`
- `src/tools/figma/index.ts`
- `tests/figma.test.ts`

## Tests Added Or Updated

- Public tool schema tests now assert the exact seven public toolbox tools and verify legacy/Figma tools are absent from public exposure.
- HTTP transport tests now call toolbox actions and verify direct legacy tool calls are rejected.
- Domain toolbox tests now cover JSON artifact writing, patch proposal/application routing, static Figma broker placeholders, and removal of obsolete artifact handoff actions.
- Write access tests now cover `write_json_artifact` allow/deny behavior, JSON normalization, extension enforcement, invalid JSON rejection, and blocked/generated path enforcement.
- Launcher diagnostics tests now expect broker-placeholder Figma status rather than direct Figma configuration status.
- MCP self-test fixtures were updated to validate the seven-tool public surface and hidden `run_allowed_script` exposure.

## Validation Command Results

- `npm run typecheck`: PASS.
- `npm test`: initial sandbox run failed earlier with `spawn EPERM` from the esbuild subprocess. Local execution then exposed one HTTP transport test issue where the no-`files.write` case did not pass the authenticated scope into the MCP server factory. The test was corrected to use the scoped server factory. The generated `dist` directory was removed before the final rerun so stale compiled Figma tests could not mask deleted source. Final local execution PASS, 244 tests passing.
- `npm run lint`: PASS.
- `npm run build`: PASS with local execution because esbuild subprocesses are sandbox-blocked.
- `npm run check:public`: PASS, 166 source candidate files checked.
- Internal staged pre-commit safety scan: initial sandbox invocation failed with `spawn EPERM` while git inspected staged files; local execution PASS, 22 scanned files, 0 blockers, 0 warnings.
- `npm run mcp:self-test`: PASS, 22 checks passing.
- `npm run mcp:self-test -- --json`: PASS, JSON output `ok: true`, 22 checks passing, 30 internal registered tools, 9 required gated tools, and exactly 7 public exposed tools.
- `npm run chatgpt:evidence:validate -- --template`: PASS, 7 checks passing.
- `npm run chatgpt:evidence:validate -- --template --json`: PASS, JSON output `ok: true`, 7 checks passing.
- `git diff --check`: PASS after this report update.
- `git status --short`: completed after this report update; only expected WC-V1-FIX05 files were modified, deleted, or untracked before staging.

## Public Tool Surface Before / After

Before WC-V1-FIX05, public `tools/list` exposed 38 visible tools, including legacy top-level tools, direct Figma/Figma Make tools, and `run_allowed_script`.

After WC-V1-FIX05, public `tools/list` exposes exactly these seven toolbox tools:

- `repo_toolbox`
- `git_toolbox`
- `artifact_toolbox`
- `diagnostics_toolbox`
- `integration_toolbox`
- `browser_toolbox`
- `knowledge_toolbox`

## Security Confirmations

- No arbitrary roots accepted.
- No public `root` field added to toolbox schemas.
- Allowed-root enforcement preserved.
- Blocked-file policy preserved.
- Write-mode policy preserved.
- OAuth scope handling preserved.
- No arbitrary MCP passthrough.
- No `figma_toolbox`.
- Obsolete Figma legacy tools removed.
- Patch safety behavior preserved.
- JSON writing restricted to safe `.json` artifacts.
- Legacy internal implementations retained where needed.

## Live Validation Disclaimer

Live ChatGPT connector validation was not performed by Builder. Operator/Architect validation in a fresh ChatGPT chat is still required after package promotion.

## Packaging Status

Packaging and runtime promotion were not performed. No package, promote, release, tag, merge, or main-branch operation was performed.

## Fallback Status

No fallback implementation was used.
