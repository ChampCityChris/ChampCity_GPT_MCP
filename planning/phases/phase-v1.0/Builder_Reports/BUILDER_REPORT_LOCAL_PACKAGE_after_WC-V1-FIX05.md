# Builder Report - Local Package After WC-V1-FIX05

Work Card: `WC-V1-FIX05`
Branch: `feature/WC-V1-FIX05-clean-public-tool-surface`
Date: 2026-07-02

## Repository Identity

- Repo path: `%USERPROFILE%\Projects\ChampCity_GPT`
- Git toplevel: `%USERPROFILE%/Projects/ChampCity_GPT`
- Remote:
  - `origin https://github.com/ChampCityChris/ChampCity_GPT_MCP.git (fetch)`
  - `origin https://github.com/ChampCityChris/ChampCity_GPT_MCP.git (push)`
- Branch: `feature/WC-V1-FIX05-clean-public-tool-surface`
- Starting HEAD: `89c3dc417690d159242f2cc2821e3782e0c6ab07`
- Final HEAD before package-report commit: `89c3dc417690d159242f2cc2821e3782e0c6ab07`

## Scope

- Package/promote only.
- No source implementation changes.
- No `WC-V1-0401` work.
- No `main` push.
- No `main` merge.
- No force push.
- No release, tag, publication, GitHub Release creation, or GitHub Release edit.
- No live ChatGPT validation.

## Preflight

- `git rev-parse --show-toplevel`: PASS, `%USERPROFILE%/Projects/ChampCity_GPT`.
- `git remote -v`: PASS, remote references `https://github.com/ChampCityChris/ChampCity_GPT_MCP.git`.
- `git branch --show-current`: PASS, `feature/WC-V1-FIX05-clean-public-tool-surface`.
- `git status --short`: PASS, clean before packaging.
- `git rev-parse HEAD`: PASS, `89c3dc417690d159242f2cc2821e3782e0c6ab07`.
- FIX05 Builder Report exists: PASS, `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-FIX05_clean_public_tool_surface.md`.
- FIX05 Builder Report states public ChatGPT `tools/list` now exposes only the seven toolbox tools: PASS.
- FIX05 Builder Report states packaging and runtime promotion were not previously performed: PASS.

## Validation Results

- `npm run typecheck`: PASS.
- `npm test`: PASS, build plus 244 tests passing, 0 failures.
- `npm run lint`: PASS.
- `npm run build`: PASS.
- `npm run check:public`: PASS, publication cleanliness passed, 154 source candidate files checked.
- `npm run mcp:self-test`: PASS, 22 checks passing, 0 failed, 0 warnings.
- `npm run mcp:self-test -- --json`: PASS, JSON `ok: true`, 22 checks passing, exactly 7 public exposed tools.
- `npm run chatgpt:evidence:validate -- --template`: PASS, 7 checks passing, 0 failed, 0 warnings.
- `npm run chatgpt:evidence:validate -- --template --json`: PASS, JSON `ok: true`, 7 checks passing.
- `git diff --check`: PASS.
- `git status --short`: PASS, clean before packaging.
- Post-promotion `npm run mcp:self-test -- --json`: PASS, JSON `ok: true`, 22 checks passing, exactly 7 public exposed tools.
- Post-promotion `npm run check:public`: PASS, publication cleanliness passed, 154 source candidate files checked.
- Post-promotion `git status --short`: PASS, clean before writing this report.

No pre-package validation command failed during this run. Validation commands were run locally with required permissions where needed for Node subprocesses and runtime/package access.

The post-report public/pre-commit safety scan initially failed because this report contained literal private local user-path values. The committed report uses the repository's `%USERPROFILE%` placeholder convention for public-source safety.

## Public Surface Evidence

- Public tool count: 7.
- Public tool names:
  - `repo_toolbox`
  - `git_toolbox`
  - `artifact_toolbox`
  - `diagnostics_toolbox`
  - `integration_toolbox`
  - `browser_toolbox`
  - `knowledge_toolbox`

The JSON MCP self-test reported `ok: true` and `TOOLS_LIST_SCHEMA_VALID` evidence with `exposedToolCount: 7` and the seven toolbox names above.

## Packaging Result

- `npm run app:package-and-promote`: PASS on rerun.
- Initial attempt: package creation succeeded, but runtime promotion failed with `EBUSY` because the existing promoted runtime executable was still running and locked.
- Operator closed the running promoted runtime.
- Rerun result: PASS. Final portable executable was built and promoted.

## Artifact Evidence

- Package version: `0.1.2`
- Source portable executable path: `%USERPROFILE%\Projects\ChampCity_GPT\release\ChampCity GPT MCP Launcher-0.1.2-x64.exe`
- Source portable executable timestamp: `2026-07-02T01:02:09.428Z`
- Source portable executable size: `94322107`
- Source portable executable SHA-256: `afcc985437e27d18f78175364833c6f40569bd004c740ecc62443d6e43d6cb06`
- Promoted runtime executable path: `%USERPROFILE%\Apps\ChampCity_GPT_MCP_Runtime\ChampCity GPT MCP Launcher-live.exe`
- Promoted runtime executable timestamp: `2026-07-02T01:02:09.428Z`
- Promoted runtime executable size: `94322107`
- Promoted runtime executable SHA-256: `afcc985437e27d18f78175364833c6f40569bd004c740ecc62443d6e43d6cb06`
- Source/promoted hash match: yes.

The promoted runtime executable is the final current-version portable executable copied from `release\ChampCity GPT MCP Launcher-0.1.2-x64.exe`. It is not `release\win-unpacked\*` and is not an `.nsis.7z` intermediate artifact.

## Processes Left Running

- No `ChampCity GPT MCP Launcher` or promoted runtime processes were detected after packaging and promotion.

## Live Validation Disclaimer

Live ChatGPT connector validation was not performed by Builder. Operator/Architect validation in a fresh ChatGPT chat is still required after restarting the promoted runtime.

## Next Operator Step

Restart or update the local ChampCity GPT MCP runtime, then open a fresh ChatGPT chat and validate that only the seven toolbox tools are visible.

## Fallback Status

No fallback implementation was used.
