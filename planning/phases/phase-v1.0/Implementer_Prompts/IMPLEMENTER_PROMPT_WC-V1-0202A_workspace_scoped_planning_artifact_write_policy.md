# Implementer Prompt — WC-V1-0202A Workspace-Scoped Planning Artifact Write Policy

Recommended Codex model: GPT-5.6
Recommended reasoning level: High

You are the Implementer for ChampCity GPT MCP.

Implement the approved Work Card:

`planning/phases/phase-v1.0/Work_Cards/WC-V1-0202A_workspace_scoped_planning_artifact_write_policy.md`

Read completely before editing:

1. `AGENTS.MD`
2. `docs/dev/VALIDATION_COMMAND_LANES.md`
3. `planning/phases/phase-v1.0/Architect_Reports/RCA_GREENFIELD_PLANNING_WRITES_REQUIRE_GIT_2026-07-26.md`
4. `planning/phases/phase-v1.0/Work_Cards/WC-V1-0202A_workspace_scoped_planning_artifact_write_policy.md`
5. the final Architect disposition for `WC-V1-0104A-REPAIR01`
6. the approved REPAIR01 Builder Report and resulting current diff/baseline

Do not start implementation if REPAIR01 remains unresolved or its approved baseline cannot be identified without overwriting intermingled work.

## Repository Identity

Expected local repository:

`%USERPROFILE%\Projects\ChampCity_GPT`

Expected remote:

`ChampCityChris/ChampCity_GPT_MCP`

Expected branch:

`dev`

Before editing, verify and report:

1. `Get-Location`
2. `git rev-parse --show-toplevel`
3. `git branch --show-current`
4. `git rev-parse HEAD`
5. `git remote -v`
6. `git status --short`
7. `package.json` exists
8. `AGENTS.MD` was read
9. `docs/dev/VALIDATION_COMMAND_LANES.md` was read
10. REPAIR01 Architect disposition and baseline were read

Stop before editing if repository identity or the dependency baseline is wrong.

## Existing Dirty Worktree

The worktree may contain approved or pending work from earlier passes. Do not reset, clean, stash, restore whole files, checkout-discard, or revert another pass.

Before modifying any already-changed file:

- inspect its complete current diff;
- identify the approved REPAIR01 hunks;
- preserve unrelated runtime-drift, promotion-provenance, planning, and documentation changes;
- make only the changes authorized by WC-V1-0202A.

Do not stage, commit, push, merge, tag, package, promote, publish, release, restart, or reconnect.

## Problem to Correct

The current implementation uses one global `requireGitRoot` boolean for both:

- Markdown/JSON planning artifact persistence; and
- Git-backed patch/source-control mutation.

This blocks greenfield planning workspaces without `.git`. Setting the global flag to false is unsafe because it applies to all workspaces and can weaken patch-target Git enforcement.

Implement a per-workspace, operation-specific authority model. Do not globally disable Git checks.

## Required Policy Schema

Add the exact workspace policy values:

- `git_required`
- `artifact_only`

Extend configured and resolved workspace models with:

- `writePolicy`
- `artifactWriteRoots`

Defaults:

- explicit workspace without `writePolicy`: `git_required`;
- derived workspace from `allowedRoots`: `git_required` unless the legacy migration rule applies;
- explicit `artifact_only` without `artifactWriteRoots`: `planning`.

`artifactWriteRoots` must be server-configured safe workspace-relative directory prefixes. The caller must never pass or override them.

Validate and reject:

- absolute paths;
- drive paths;
- UNC paths;
- traversal;
- empty values;
- URL values;
- wildcard or glob syntax;
- shell metacharacters;
- blocked directory segments;
- paths escaping the workspace after normalization or real-path checks.

Support `.` only when explicitly configured. Return a visible safe warning because it permits artifact-extension writes throughout the workspace.

## Legacy Migration

Deprecate `requireGitRoot` as an operational gate.

Required behavior:

- absent or true: legacy/derived workspaces remain `git_required`;
- false: legacy compatibility may permit only bounded Markdown/JSON artifact persistence and must emit a deprecation warning;
- false must not disable Git requirements for patch proposal/application or any Git mutation;
- explicit workspace `writePolicy` overrides the legacy default;
- no existing source repository silently becomes `artifact_only`.

Do not delete legacy configuration support in this pass.

## Workspace Authority Resolver

Create one internal, deterministic resolver for workspace write authority.

Inputs must come from server configuration and the selected workspace, not from public caller arguments.

The resolver must distinguish at least:

- artifact persistence;
- patch workflow;
- Git mutation.

It should provide safe internal facts such as:

- selected workspace ID;
- policy;
- Git detected yes/no;
- artifact write roots;
- operation allowed/denied;
- structured denial reason.

Do not mutate global `AppConfig` per request.

Update toolbox write routes to resolve the workspace object, not only its root, before invoking write helpers.

For internal/direct helper routes that still accept `root`, resolve that root to an exact configured workspace or use the safe legacy default. Never accept caller-provided policy values.

## Artifact Persistence Rules

Only these operations may use `artifact_only` without Git:

- `repo_toolbox.write_markdown_artifact`
- `repo_toolbox.write_json_artifact`

All existing gates remain mandatory:

- OAuth `files.write`;
- local docs-capable write mode;
- allowed root;
- selected workspace;
- configured artifact write root;
- extension and content validation;
- blocked-file policy;
- size limits;
- overwrite control;
- atomic write;
- symlink, junction, reparse-point, and path-escape denial;
- audit logging.

### Markdown

For `artifact_only`:

- permit only `.md`;
- require target inside a configured artifact root;
- do not call Git;
- preserve SHA-256 and byte-count output;
- deny non-regular existing targets and link/reparse escapes.

For `git_required`, preserve existing Git-root behavior.

### JSON

For `artifact_only`:

- permit only `.json`;
- require target inside a configured artifact root;
- parse and normalize content before write;
- do not call `git check-ignore` or any Git command;
- preserve forbidden-path, overwrite, atomic-write, modified-time, SHA-256, and audit behavior;
- deny config, OAuth, credential, environment, log, release, generated, database, key, browser-profile, symlink, junction, reparse, and escape targets.

For `git_required`, preserve current Git-root and ignore checks where applicable.

Do not allow planning policy to become a generic `package.json` or local-config overwrite mechanism.

## Patch and Git Invariants

The following must require a confirmed Git repository regardless of workspace policy or legacy `requireGitRoot`:

- `repo_toolbox.propose_patch`
- `repo_toolbox.apply_approved_patch`
- `git_toolbox.prepare_work_branch`
- `git_toolbox.stage_paths`
- `git_toolbox.pre_commit_scan`
- `git_toolbox.commit_staged`
- `git_toolbox.push_current_branch`
- `git_toolbox.integrate_to_dev`
- tag/release Git operations
- every future Git mutation path touched by shared helpers

`artifact_only` must receive a structured workspace-policy denial for patch proposal/application.

A non-Git workspace must receive `GIT_REQUIRED` or the project’s approved equivalent for Git-backed operations.

Remove any conditional behavior that allows `requireGitRoot:false` to bypass Git checks in patch application.

Do not change:

- proposal generation semantics;
- proposal ID/hash matching;
- expiry or one-time use;
- patch regular-file and symlink safeguards;
- OAuth scope requirements;
- write-mode requirements;
- Git branch or integration rules.

## Electron Launcher

The fix must be operable without manual JSON editing.

Replace the one global `Require Git Root` control with minimal per-workspace policy controls in the existing Allowed Roots/Workspaces manager.

For each workspace, allow the Operator to:

- view label, safe workspace ID, and root;
- choose `Git-backed repository` (`git_required`);
- choose `Planning artifacts only` (`artifact_only`);
- edit artifact write roots when planning policy is selected;
- see default `planning`;
- see a warning for `.`;
- save and reload the policy.

First-run setup, reset defaults, and newly added ordinary project roots must default to `git_required`.

Explain in the UI:

- planning policy allows only bounded Markdown/JSON artifact persistence;
- patch and Git workflows remain unavailable;
- ChampCity MCP will not automatically run `git init`.

Do not redesign unrelated launcher sections or preload APIs. Extend existing contracts narrowly where required.

## Configuration Persistence and Migration

Read and preserve:

- legacy `allowedRoots` configuration;
- existing `workspaces` configuration;
- default workspace ID;
- labels;
- roots;
- remotes;
- audit log;
- allowed commands;
- unrelated local config fields.

Saving through the launcher must not discard metadata.

Development, installed, and portable runtime config directories must behave identically.

Environment variables retain documented precedence, but no environment value may globally bypass Git-backed mutation requirements.

## Diagnostics

Extend existing safe diagnostics, preferably `diagnostics_toolbox.list_workspaces` and write-access status, with:

- workspace ID;
- `writePolicy`;
- Git detected yes/no/unknown;
- relative artifact write roots;
- artifact persistence available yes/no and safe reason;
- Git-backed mutation available yes/no and safe reason.

Do not return:

- absolute roots;
- local config contents;
- environment dumps;
- tokens, secrets, or credentials.

A non-Git `artifact_only` workspace must be represented as a valid planning workspace, not as an invalid repository.

## Error Semantics

Return structured, distinguishable errors for:

- workspace policy denial;
- Git required for the requested operation;
- target outside artifact roots;
- missing OAuth scope;
- blocked local write mode;
- path/file policy denial;
- overwrite denial.

Do not recommend disabling Git enforcement globally.
Do not automatically initialize Git.

## Tests

Implement every deterministic test numbered 1 through 32 in the Work Card.

At minimum, prove:

- backward-compatible defaults;
- valid Git-backed behavior unchanged;
- non-Git Git-required denials;
- non-Git Markdown/JSON planning writes under approved roots;
- no Git invocation for artifact-only JSON;
- artifact-root boundary enforcement;
- link/reparse/path escape protection;
- OAuth and write-mode gates;
- patch and Git invariants independent of legacy global config;
- multi-workspace isolation;
- migration without metadata loss;
- launcher create/edit/save/reload behavior;
- runtime config consistency;
- safe diagnostics;
- safe audit evidence;
- existing self-test, public safety, OAuth, routing, and proposal tests remain passing.

Use a Git invocation spy or deterministic fixture to prove artifact-only writes do not execute Git.

Include an acceptance-criterion-to-test matrix in the Builder Report. A general unit-suite pass is insufficient.

## Documentation

Update only documentation required by this change:

- `docs/DESKTOP_APP_SETUP.md`
- `docs/SECURITY_MODEL.md`
- `docs/TOOL_REFERENCE.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`

Document:

- per-workspace policy schema;
- artifact write roots;
- legacy migration and deprecation;
- Git invariants;
- launcher controls;
- diagnostics;
- later live validation.

Do not mark live validation passed.

## Builder Report

Create:

`planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202A_workspace_scoped_planning_artifact_write_policy.md`

The report must include:

- verified path, branch, HEAD, remote, and starting/final dirty state;
- REPAIR01 dependency/baseline evidence;
- exact files changed;
- pre-existing changes preserved;
- protected subsystems touched;
- whether scope changed;
- final configuration schema;
- migration behavior;
- write-policy resolver architecture;
- artifact-root enforcement;
- Markdown and JSON behavior;
- proof that artifact-only writes invoke no Git;
- patch and Git invariants;
- launcher controls and persistence;
- diagnostics and redaction;
- audit behavior;
- exact Windows validation lane and commands;
- acceptance-criterion-to-test matrix for all 32 tests;
- validations passed, failed, and not run;
- manual validation steps;
- blockers and assumptions;
- confirmation that no `git init`, staging, commit, push, package, promotion, restart, reconnect, publication, or release occurred.

End with:

`No fallback implementation was used.`

## Validation Lane

Before any child-process-capable command, follow:

`docs/dev/VALIDATION_COMMAND_LANES.md`

Use the normal Windows validation lane. Do not repeatedly retry sandboxed commands after `spawn EPERM`.

Run in order:

1. repository-defined typecheck;
2. focused config/workspace/write-policy tests;
3. focused Markdown/JSON artifact tests;
4. focused patch/Git invariant tests;
5. focused launcher core/adapter/renderer-state tests;
6. repository-defined build;
7. broader unit lane required by touched shared modules;
8. MCP self-test;
9. public safety scan;
10. lint;
11. `git diff --check`.

Do not use Playwright.
Do not package.
Do not promote the runtime.
Do not run or restart the production connector.
Do not perform live ChatGPT validation.

## Stop Conditions

Stop and report rather than improvising if:

- REPAIR01 is unresolved;
- the approved baseline cannot be isolated;
- implementation requires globally disabling Git checks;
- planning artifact writes cannot be bounded to server-configured roots;
- patch/Git invariants cannot be made independent of the legacy global boolean;
- launcher persistence would discard existing metadata;
- a change would alter OAuth, PKCE, DCR, tokens, proposal matching, Git history, packaging, release, promotion, or unrelated UI behavior;
- a fallback is required.

No fallback is authorized.

## Manual Validation After Codex

Report these human checks as not performed:

1. Architect reviews the Builder Report and complete diff.
2. After approval, a separate pass integrates the change.
3. A separate pass packages and promotes the runtime.
4. Operator restarts ChampCity MCP and reconnects ChatGPT.
5. Operator creates or selects a non-Git greenfield workspace in the launcher.
6. Operator sets `Planning artifacts only` with artifact root `planning`.
7. Operator creates Markdown and JSON artifacts under `planning`.
8. Operator confirms a target outside `planning` is denied.
9. Operator confirms patch proposal/application and Git mutation are denied.
10. Operator confirms an existing Git-backed workspace retains normal artifact and patch behavior.
11. Operator confirms diagnostics show policies without absolute paths.

## Remaining Passes

After implementation:

- Architect review;
- authorized Git integration if approved;
- separate package-and-promote pass;
- live connector validation for affected write, patch, filesystem, Git, and multi-workspace CAV cases;
- final evidence and acceptance-matrix disposition.
