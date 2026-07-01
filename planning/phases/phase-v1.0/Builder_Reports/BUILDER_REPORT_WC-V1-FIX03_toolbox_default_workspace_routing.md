# Builder Report: WC-V1-FIX03 Toolbox Default Workspace Routing

Date: 2026-07-01
Branch: `feature/WC-V1-FIX03-toolbox-default-workspace-routing`
Repository: `ChampCity_GPT_MCP`

## Root Cause

Packaged Electron runtime can resolve `repoRoot` to the packaged app path, such as `resources/app.asar`, because that path contains the packaged `package.json`. The stable toolbox and public-safe facade default workspace path used `config.repoRoot`, so `workspaceId: default` could point at `app.asar` instead of the operator-configured project workspace. Allowed-root enforcement then correctly rejected the request with `PATH_DENIED`.

## Implementation

- Added an internal configured default workspace root in config loading.
- Added one resolver for default workspace roots that still requires the resolved root to be in `allowedRoots`.
- Routed stable toolbox actions, public-safe facade summaries, Builder Report facade workspace selection, and safe branch workspace selection through that resolver.
- Packaged `app.asar` roots now fail clearly if no configured workspace root exists instead of silently becoming the default workspace.

## Files Changed

- `src/config.ts`
- `src/workspaceRoot.ts`
- `src/tools/domainToolboxes.ts`
- `src/tools/publicSafeFacade.ts`
- `src/tools/builderReportFacade.ts`
- `src/tools/gitWorkflow/prepareGitWorkBranch.ts`
- `tests/config.test.ts`
- `tests/domainToolboxes.test.ts`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-FIX03_toolbox_default_workspace_routing.md`

## Tests Added Or Updated

- Config tests now prove packaged `resources/app.asar` roots use the configured allowed root as the default workspace.
- Config tests now prove packaged app roots fail clearly when no workspace config exists.
- Domain toolbox tests now prove packaged runtime-shaped config routes:
  - `repo_toolbox.read_file`
  - `repo_toolbox.status`
  - `git_toolbox.status`
  - `artifact_toolbox.builder_report_summary`
- Domain toolbox tests also prove arbitrary workspace IDs and `params.root` smuggling fail safely.
- Legacy root-explicit `read_project_file` and `git_status` behavior remains unchanged.

## Validation Results

- `npm run typecheck`: PASS
- `npm test`: PASS after sandbox escalation; initial sandbox run hit `spawn EPERM` during esbuild service startup.
- `npm run lint`: PASS
- `npm run build`: PASS after sandbox escalation for esbuild child process startup.
- `npm run check:public`: PASS
- `npm run mcp:self-test`: PASS after sandbox escalation; initial sandbox run hit `spawn EPERM` in subprocess-backed checks.
- `npm run mcp:self-test -- --json`: PASS after sandbox escalation.
- `npm run chatgpt:evidence:validate -- --template`: PASS
- `npm run chatgpt:evidence:validate -- --template --json`: PASS

`git diff --check` and final `git status --short` are still to be run after this report is written.

## Package / Promote

Package and promote was not performed. The prompt requested package/promote only if authorized by the operator, and no explicit package/promote authorization was provided for this implementation pass.

Promoted runtime executable path and SHA-256: not applicable.

## Confirmations

- Legacy tools were not removed.
- No public `root` field was added to toolbox schemas.
- Allowed-root enforcement was preserved.
- Arbitrary roots from ChatGPT toolbox callers are still rejected.
- `main` was not pushed, merged, or modified.
- Live ChatGPT validation was not performed by Builder. Operator/Architect must validate in a fresh ChatGPT chat after package promotion.
