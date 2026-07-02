# Builder Report - WC-V1-FIX01 Safe Git Work Branch Tool

## Summary

Implemented `prepare_git_work_branch`, a gated MCP tool that prepares `dev` or a generated Work Card feature branch without exposing arbitrary branch names, shell commands, push, merge, rebase, reset, stash, delete, force, tag, or checkout-path behavior.

`WC-V1-0401 remains paused until this safe branch workflow tool is reviewed, committed, and available through MCP.`

## Repository Identity

- Repository path inspected: `%USERPROFILE%\Projects\ChampCity_GPT`
- Git top level inspected: `%USERPROFILE%\Projects\ChampCity_GPT`
- Remote inspected: `https://github.com/ChampCityChris/ChampCity_GPT_MCP.git`
- Starting branch: `dev`
- Feature branch used: `feature/WC-V1-FIX01-safe-branch-workflow-tool`
- Baseline commit required by prompt: present, `830fc58a48a731ecd65d7191685f8cb4a60dc4f5`
- `AGENTS.MD`: present
- `package.json`: present

## Prerequisite Package Report Status

- Package report path: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_LOCAL_PACKAGE_main_after_WC-V1-0104.md`
- Package report was present: yes
- Package report was already committed to `dev`: yes
- Package report commit hash: `7d74ce7e42f6aacbf340936213bdb85a1785b352`
- Package report commit created by this task: no
- Package report pushed by this task: no
- Prerequisite dirty-file branch hygiene was skipped because the working tree was clean and the report was already committed on `dev`.

## Source Documents Reviewed

- Attached Codex prompt for `WC-V1-FIX01 - Add safe git work-branch operation tool`
- `AGENTS.MD`
- `package.json`
- `docs/TOOL_REFERENCE.md`
- `docs/SECURITY_MODEL.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`
- `planning/phases/phase-v1.0/WORK_CARD_QUEUE_v1.0.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0101_chatgpt_connector_acceptance_matrix.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0102_chatgpt_safety_layer_false_positive_remediation.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0102A_builder_report_discovery_facade.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0103_mcp_protocol_self_test.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104_live_chatgpt_connector_evidence_capture.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_LOCAL_PACKAGE_main_after_WC-V1-0104.md`
- `src/server/registerTools.ts`
- `src/tools/gitWorkflow/safety.ts`
- `src/tools/gitWorkflow/safeStageChanges.ts`
- `src/tools/gitWorkflow/commitValidatedChanges.ts`
- `src/tools/gitWorkflow/pushCurrentBranch.ts`
- `src/tools/gitWorkflow/getCommitReadiness.ts`
- `src/tools/gitWorkflow/audit.ts`
- `src/utils/git.ts`
- `src/security/pathPolicy.ts`
- `src/validation/mcpSelfTest.ts`
- `tests/gitWorkflow.test.ts`
- `tests/toolSchema.test.ts`
- `tests/mcpSelfTest.test.ts`

## Files Created

- `src/tools/gitWorkflow/prepareGitWorkBranch.ts`
- `tests/gitWorkBranch.test.ts`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-FIX01_safe_git_work_branch_tool.md`

## Files Modified

- `src/server/registerTools.ts`
- `src/validation/mcpSelfTest.ts`
- `tests/toolSchema.test.ts`
- `docs/TOOL_REFERENCE.md`
- `docs/SECURITY_MODEL.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`
- `planning/phases/phase-v1.0/WORK_CARD_QUEUE_v1.0.md`

## Tool Added

- Tool name: `prepare_git_work_branch`
- Classification: write/gated tool
- Required OAuth scope for HTTP callers: `files.write`
- Required local write mode: `elevated`
- Registered with `WRITE_TOOL_NAMES`
- Hidden from `tools/list` when only `files.read` is granted
- Hidden from `tools/list` when local write mode is below `elevated`

## Input Schema

```ts
{
  workspaceId?: "default" | string;
  branchKind: "dev" | "feature";
  workCardId?: string;
  slug?: string;
  baseBranch?: "main" | "dev";
  createIfMissing?: boolean;
}
```

Runtime validation is stricter than the public JSON schema:

- `workspaceId` uses safe workspace aliases only and is never treated as a filesystem path.
- `branchKind: "dev"` prepares only `dev`.
- `branchKind: "feature"` prepares only `feature/<workCardId>-<slug>`.
- `workCardId` is required for feature branches.
- `workCardId` must match `WC-V1-0000` or `WC-V1-FIX00`.
- `slug` must be lowercase kebab-case; if omitted, the safe default is `work-branch`.
- `baseBranch` is limited to `main` or `dev`.
- `createIfMissing` defaults to `true`.
- Unknown input fields are rejected.

## Branch Safety Rules

Allowed generated target branches:

- `dev`
- `feature/WC-V1-xxxx-lowercase-kebab-slug`
- `feature/WC-V1-FIXxx-lowercase-kebab-slug`

Rejected target behavior:

- `main` as the active target branch
- arbitrary branch names
- `origin/main`
- `refs/heads/...`
- path traversal fragments
- spaces
- semicolons
- backslashes
- double dots
- `.lock` suffix
- leading dash
- `@{`
- ASCII control characters
- detached HEAD
- dirty working tree
- staged changes
- unstaged changes
- untracked files
- missing base branch
- existing target branch not based on the selected base branch

The implementation also calls `git check-ref-format --branch <candidate>` through fixed argument-array subprocess execution.

The tool does not push, merge, rebase, reset, stash, delete branches, tag, force, run arbitrary commands, accept shell arguments, accept `approvalToken`, or expose raw local root paths in normal output.

## Tests Added Or Updated

- Added `tests/gitWorkBranch.test.ts`.
- Updated `tests/toolSchema.test.ts`.
- Updated `src/validation/mcpSelfTest.ts` required gated-tool coverage.

Focused coverage includes:

- Creates `dev` from `main` in a temporary clean repo.
- Switches to existing `dev` in a temporary clean repo.
- Creates a feature branch from `dev`.
- Rejects target `main`.
- Rejects unsafe Work Card ID and slug fragments.
- Rejects missing `workCardId` for feature branches.
- Rejects dirty working tree.
- Rejects staged changes.
- Rejects untracked files.
- Rejects detached HEAD.
- Verifies the implementation does not call push.
- Verifies the implementation does not call merge, rebase, reset, stash, or branch deletion.
- Rejects an existing target branch that is not based on the selected base branch.
- Verifies schema excludes unsafe fields such as `root`, `absolutePath`, `command`, `script`, `shell`, `args`, `argv`, `approvalToken`, `force`, `reset`, `merge`, `rebase`, `stash`, `delete`, and `clobber`.
- Verifies exposure only with `files.write` and `writeMode elevated`.
- Verifies MCP self-test required gated tools include `prepare_git_work_branch`.

## Documentation Updated

- `docs/TOOL_REFERENCE.md`
- `docs/SECURITY_MODEL.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`
- `planning/phases/phase-v1.0/WORK_CARD_QUEUE_v1.0.md`

Docs now state:

- Active Work Cards should use `dev` or `feature/WC-V1-xxxx-*` / `feature/WC-V1-FIXxx-*`.
- `main` is reserved for stable release or baseline checkpoints.
- `prepare_git_work_branch` is the safe MCP way to prepare branches.
- The tool refuses dirty trees and detached HEAD.
- The tool cannot switch to `main` as an active work branch.
- The tool cannot push, merge, rebase, reset, stash, delete, force, tag, or run arbitrary commands.
- After branch preparation, the normal sequence is validate, stage reviewed files, pre-commit scan, commit, push the current `dev` or feature branch, and merge to `main` only at a stable checkpoint.

## Validation Commands And Results

- `pwd`: pass, current directory matched the approved project path.
- `git rev-parse --show-toplevel`: pass, git root matched the approved project root.
- `git remote -v`: pass, origin references `ChampCityChris/ChampCity_GPT_MCP`.
- `git branch --show-current`: pass, initially returned `dev`; after branch setup returned `feature/WC-V1-FIX01-safe-branch-workflow-tool`.
- `git status --short`: pass at implementation start, no output.
- `git rev-parse HEAD`: pass, returned `7d74ce7e42f6aacbf340936213bdb85a1785b352`.
- `git log --oneline -12`: pass, included `830fc58a48a731ecd65d7191685f8cb4a60dc4f5`.
- `Test-Path AGENTS.MD`: pass.
- `Test-Path package.json`: pass.
- `npm run typecheck`: pass.
- `npm run build`: initial sandboxed run failed with esbuild `spawn EPERM`; approved rerun passed.
- `node --test dist/tests/gitWorkBranch.test.js dist/tests/toolSchema.test.js dist/tests/mcpSelfTest.test.js`: initial sandboxed run failed with Node test-runner `spawn EPERM`; approved rerun passed, 38 tests passed and 0 failed.
- Final `npm run typecheck`: pass.
- Final `npm test`: pass on approved run; 261 tests passed, 0 failed.
- Final `npm run lint`: pass.
- Final `npm run build`: pass on approved run because the renderer build invokes esbuild.
- Final `npm run check:public`: pass, 153 source candidate files checked.
- Final `npm run mcp:self-test`: pass, 14 checks passed, 0 failed.
- Final `npm run mcp:self-test -- --json`: pass, `ok: true`, 14 passed, 0 failed, 31 registered tools, 8 required gated tools.
- Final `npm run chatgpt:evidence:validate -- --template`: pass, 7 checks passed, 0 failed.
- Final `npm run chatgpt:evidence:validate -- --template --json`: pass, `ok: true`, 7 passed, 0 failed.
- Final `git diff --check`: pass; Git printed LF/CRLF working-copy warnings only.
- Final `git status --short`: inspected before staging and commit.

## Validation Skipped And Reasons

- Packaging: skipped because this Work Card explicitly forbids packaging.
- Live ChatGPT connector validation: not performed by Builder; operator validation in a new ChatGPT conversation is still required.
- Browser automation, screenshots, and UI visual validation: skipped because this is not a UI task and Playwright/browser validation was not authorized.
- Release, tag, GitHub Release, signing, upload, or publication validation: skipped because this Work Card forbids those actions.

## Protected Subsystems Touched

Yes.

Touched in the narrow scope authorized by this Work Card:

- MCP tool discovery/exposure: `prepare_git_work_branch` was added to the registered tool list and gated exposure.
- `files.write` / write-scope enforcement: `prepare_git_work_branch` was classified as a write/gated tool and restricted to `files.write` plus local `writeMode elevated`.

Not touched:

- OAuth and Dynamic Client Registration
- OAuth behavior
- PKCE behavior
- MCP HTTP transport
- MCP endpoint behavior
- Public `/mcp` endpoint behavior
- Cloudflare tunnel configuration or behavior
- Runtime path/AppData config behavior
- Local config persistence behavior
- Token/session storage
- Admin password handling
- Server lifecycle/shutdown/start/stop/restart behavior
- Packaging/release configuration
- Git commit/push automation behavior beyond adding the branch-preparation tool
- Figma Make extraction architecture
- Existing preload API contracts
- Existing `window.champcity` API shape

## Security Controls Preserved

- OAuth `files.write` is still required for HTTP callers.
- Local write mode `elevated` is still required.
- No `approvalToken` was added to the tool schema.
- No arbitrary shell, command, script, args, or raw branch-name input was added.
- Existing safe stage, commit, push, public-safety scan, blocked-file, allowed-root, and audit logging patterns remain intact.
- The tool output uses generated branch names and repository-relative git status only.
- No secrets, tokens, `.env`, local config, logs, release artifacts, generated output, packaged executables, or runtime binaries were created or modified.

## Residual Risks

- Local deterministic tests do not prove live ChatGPT tool visibility or safety-layer behavior.
- The tool prepares branches but does not solve broader pull/rebase/release automation; those remain later Work Card scope.
- Existing target branch ancestry checks use local branch state only; remote branch synchronization remains outside this narrow tool.

## Scope And Fallback

- Scope changed during implementation: no.
- No fallback implementation was used.
- A fallback may be possible, but was not implemented because architect/operator approval was not provided.

## Staging, Commit, Push, Main, And Packaging State At Report Creation

- Anything staged: no.
- Implementation commit hash: pending final validation and commit; reported in the final Codex response because a commit cannot contain its own stable hash.
- Anything pushed: pending final validation.
- Push target: `origin/feature/WC-V1-FIX01-safe-branch-workflow-tool` if validation passes.
- Anything pushed to `main`: no.
- Anything merged to `main`: no.
- Force push used: no.
- `main` modified by this task: no.
- Packaging run: no.

## Final Branch And Status At Report Creation

- Final branch at report creation: `feature/WC-V1-FIX01-safe-branch-workflow-tool`
- Final `git status --short` before staging:

```text
 M docs/CHATGPT_CONNECTION_GUIDE.md
 M docs/SECURITY_MODEL.md
 M docs/TOOL_REFERENCE.md
 M planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md
 M planning/phases/phase-v1.0/WORK_CARD_QUEUE_v1.0.md
 M src/server/registerTools.ts
 M src/validation/mcpSelfTest.ts
 M tests/toolSchema.test.ts
?? planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-FIX01_safe_git_work_branch_tool.md
?? src/tools/gitWorkflow/prepareGitWorkBranch.ts
?? tests/gitWorkBranch.test.ts
```

## Recommended Next Work Card

After this fix is reviewed, committed, pushed, and available through MCP, resume `WC-V1-0401 - Harden OAuth/DCR as the sole public connector path`.
