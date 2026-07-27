# WC-V1-0202A — Workspace-Scoped Planning Artifact Write Policy

## Work Card Identity

- ID: `WC-V1-0202A`
- Title: Workspace-Scoped Planning Artifact Write Policy
- Phase: v1.0 — ChatGPT Connector and Safety-Layer Reliability
- Parent planning area: `WC-V1-0202 — Implement v1.0 permission modes and toolsets`
- Priority: P0
- Type: Write-authority architecture correction
- Owner mode: Architect specifies; Codex/Implementer implements; Architect reviews; Operator performs later live validation
- Repository: `%USERPROFILE%\Projects\ChampCity_GPT`
- Remote: `ChampCityChris/ChampCity_GPT_MCP`
- Expected branch: `dev`
- Source RCA: `planning/phases/phase-v1.0/Architect_Reports/RCA_GREENFIELD_PLANNING_WRITES_REQUIRE_GIT_2026-07-26.md`
- Required Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202A_workspace_scoped_planning_artifact_write_policy.md`

## Dependency and Baseline Rule

This Work Card overlaps shared toolbox and diagnostics files with `WC-V1-0104A-REPAIR01`.

Do not begin implementation until:

1. the REPAIR01 Builder Report has received Architect disposition; and
2. the Implementer can identify the approved source baseline without overwriting intermingled work.

If the repository remains dirty, inspect every target-file diff and preserve unrelated or already-approved changes. Do not reset, clean, stash, restore whole files, or discard another pass.

## Problem Statement

ChampCity MCP uses one global `requireGitRoot` boolean for both bounded planning-artifact persistence and Git-backed source mutation.

This blocks legitimate Markdown and JSON planning artifacts in greenfield workspaces that have not yet been initialized as Git repositories. Disabling the global flag is not a safe workaround because it affects every workspace and weakens Git enforcement for patch application.

The application must distinguish:

- artifact persistence in an explicitly configured planning workspace; and
- Git-backed mutation and source-control workflows.

## Objective

Introduce a server-defined, per-workspace write policy that permits bounded planning-artifact persistence without Git while preserving mandatory Git enforcement for patch and Git workflows.

The solution must be usable through the Electron launcher. It must not require the Operator to hand-edit JSON.

## Required Policy Model

Add a workspace write-policy enum:

- `git_required`
- `artifact_only`

Use the exact names above unless an existing repository convention requires an equivalent enum. Do not use a caller-supplied boolean.

### `git_required`

This is the default.

- The workspace must be a confirmed Git repository for Markdown and JSON artifact writes.
- Patch proposal/application and every Git workflow require Git.
- Existing mature repository behavior remains unchanged.

### `artifact_only`

This is an explicit Operator-selected planning policy.

Allowed operations:

- `repo_toolbox.write_markdown_artifact`
- `repo_toolbox.write_json_artifact`

Denied operations:

- `repo_toolbox.propose_patch`
- `repo_toolbox.apply_approved_patch`
- all Git mutation actions;
- arbitrary scripts or arbitrary file mutation;
- source-control integration, push, tag, package, promotion, or release operations.

Read-only file operations remain available under normal read scope and path policy.

## Artifact Write Roots

Add a server-configured workspace field:

- `artifactWriteRoots`: array of workspace-relative directory prefixes.

Rules:

1. Used only by `artifact_only` workspaces.
2. Default to `planning` when omitted for an explicitly configured `artifact_only` workspace.
3. Values must be normalized safe relative directories.
4. Absolute paths, drive paths, UNC paths, traversal, empty values, wildcards, shell syntax, URLs, and blocked directory segments are invalid.
5. The caller cannot override or add artifact roots.
6. A Markdown or JSON target must resolve inside one configured artifact root.
7. `.` may be supported only as an explicit Operator selection and must produce a visible warning because it grants artifact-extension writes throughout the workspace.
8. No configured artifact root may escape the selected workspace root after resolution or real-path checks.

## Configuration Schema

Extend explicit configured workspaces to support:

```json
{
  "workspaceId": "new_project_planning",
  "label": "New Project Planning",
  "root": "%USERPROFILE%\\Projects\\New_Project",
  "writePolicy": "artifact_only",
  "artifactWriteRoots": ["planning"]
}
```

Existing fields remain supported:

- `workspaceId`
- `label`
- `root`
- optional `remote`

Existing explicit workspaces without `writePolicy` default to `git_required`.

Derived workspaces created from legacy `allowedRoots` default to `git_required`, subject only to the legacy migration rule below.

## Legacy `requireGitRoot` Migration

Deprecate the global field as an operational authorization gate.

Required compatibility behavior:

- absent or `true`: legacy/derived workspaces use `git_required`;
- `false`: allow legacy Markdown/JSON artifact persistence through an artifact-only compatibility policy and emit a safe deprecation warning;
- `false` must never disable Git requirements for patch proposal, patch application, staging, commit, branch, integration, push, tag, package, promotion, or release workflows;
- explicit per-workspace `writePolicy` overrides the legacy default for that workspace;
- no existing source repository silently changes to `artifact_only`.

If mapping `requireGitRoot:false` safely requires an artifact-root default, use `planning` and document the migration. Do not treat the entire workspace as an unrestricted artifact root without explicit Operator selection.

## Workspace Resolution

Extend configured and resolved workspace models with safe policy metadata:

- `writePolicy`
- `artifactWriteRoots`

Add one internal resolver for operation authority. It must evaluate:

- selected workspace;
- requested operation class;
- workspace policy;
- Git presence;
- configured artifact roots;
- OAuth scope and local write mode where applicable.

Do not mutate global `AppConfig` per request.

Toolbox write routes must resolve the workspace object, not only the root, before invoking write helpers.

Internal/direct helper routes that still accept `root` must map the root to an exact configured workspace or use the safe legacy default. A caller must never pass `writePolicy`, `artifactWriteRoots`, or a Git-bypass value.

## Operation Classes

Implement explicit internal operation classes or equivalent deterministic logic:

### Artifact persistence

Applies only to:

- Markdown artifact write;
- JSON artifact write.

Requirements:

- OAuth `files.write`;
- local write mode permitting docs writes;
- selected workspace policy permits artifact persistence;
- target inside configured artifact root for `artifact_only`;
- Git required when policy is `git_required`;
- extension, path, blocked-file, size, overwrite, symlink/reparse-point, atomic-write, and audit controls.

### Git-backed patch workflow

Applies to:

- patch proposal;
- patch application.

Requirements:

- confirmed Git repository regardless of workspace artifact policy or legacy global setting;
- existing proposal, hash, write-mode, scope, patch-path, regular-file, and audit controls remain unchanged.

`artifact_only` workspaces must receive a structured policy denial before patch proposal/application.

### Git workflow

All Git status/readiness actions may return a structured `not_git_repository` or `GIT_REQUIRED` result where appropriate.

All Git mutation actions require a confirmed Git repository regardless of policy.

## Markdown Artifact Requirements

For `artifact_only`:

- allow only `.md`;
- require target inside an artifact write root;
- preserve existing overwrite control;
- preserve atomic temporary-file write and rename;
- deny symlinks, junctions, reparse-point escapes, and non-regular existing targets;
- preserve audit metadata and SHA-256 result;
- do not call Git.

For `git_required`, preserve current Git-root behavior.

## JSON Artifact Requirements

For `artifact_only`:

- allow only `.json`;
- require target inside an artifact write root;
- parse and normalize JSON before write;
- preserve blocked-file and forbidden-path rules;
- do not call `git check-ignore` or another Git command;
- preserve overwrite, atomic write, symlink/reparse-point, size, audit, modified-time, and SHA-256 controls.

For `git_required`, retain the Git-root and ignore checks where currently appropriate.

Do not allow artifact-only JSON writes to become an unrestricted `package.json`, config, OAuth-store, local-config, or credential-file mutation path.

## Patch and Git Invariants

The following require a confirmed Git repository in every configuration:

- `propose_patch`
- `apply_approved_patch`
- `git_toolbox.prepare_work_branch`
- `git_toolbox.stage_paths`
- `git_toolbox.pre_commit_scan`
- `git_toolbox.commit_staged`
- `git_toolbox.push_current_branch`
- `git_toolbox.integrate_to_dev`
- tag/release Git operations
- any future Git mutation action

Remove any dependency that allows `config.requireGitRoot === false` to bypass these checks.

Do not alter proposal matching, patch hashes, expiry, one-time use, write modes, or OAuth scope semantics.

## Electron Launcher Requirements

Replace the single global `Require Git Root` control with a minimal per-workspace policy editor.

The Allowed Roots/Workspaces manager must allow the Operator to:

1. view the workspace label, safe workspace ID, and root;
2. select `Git-backed repository` or `Planning artifacts only`;
3. edit artifact write roots when planning mode is selected;
4. see the default `planning` artifact root;
5. see a warning when `.` is selected;
6. save and reload the policy without hand-editing JSON.

First-run setup, reset defaults, and newly added ordinary project roots must default to `git_required`.

The UI must explain:

- planning mode allows only bounded Markdown/JSON artifact persistence;
- patch and Git workflows remain unavailable until the workspace is configured as Git-backed and Git is initialized;
- the application does not automatically run `git init`.

Do not redesign unrelated launcher sections.

## Configuration Migration and Persistence

The launcher and backend must safely read:

- legacy `allowedRoots` files;
- existing `workspaces` files without policy fields;
- new workspace policy fields.

Saving must not discard:

- workspace IDs;
- labels;
- roots;
- remotes;
- default workspace selection;
- audit configuration;
- allowed commands;
- unrelated local config fields.

Packaged, portable, and development runtime config paths must preserve identical policy behavior.

Do not expose absolute roots through public diagnostics or generated ChatGPT notes.

## Diagnostics Requirements

Extend an existing safe diagnostic, preferably `diagnostics_toolbox.list_workspaces` and write-access status, to report:

- workspace ID;
- `writePolicy`;
- Git detected: yes/no/unknown;
- relative artifact write roots;
- artifact persistence available: yes/no;
- safe artifact-persistence denial reason;
- Git-backed mutation available: yes/no;
- safe Git-mutation denial reason.

Do not return:

- absolute roots;
- private local paths;
- raw config;
- tokens or credentials;
- unrestricted environment data.

`repo_toolbox.status` for a non-Git planning workspace must not present Git absence as an invalid workspace. It may report that repository status is unavailable while artifact persistence remains available.

## Error Semantics

Use structured errors that distinguish:

- workspace policy denial;
- Git required for the selected operation;
- target outside artifact write roots;
- OAuth scope missing;
- local write mode blocked;
- path/file policy denial;
- overwrite denial.

Do not tell the user to disable Git enforcement globally.

Do not suggest automatic `git init` as the only remedy.

## Expected Files

Expected implementation may include:

- `src/config.ts`
- `src/workspaces.ts`
- a focused workspace write-policy module under `src/security`, `src/tools`, or `src/workspaces`
- `src/tools/domainToolboxes.ts`
- `src/tools/writeMarkdownArtifact.ts`
- `src/tools/writeJsonArtifact.ts`
- `src/tools/proposePatch.ts`
- `src/tools/applyApprovedPatch.ts`
- `src/tools/gitWorkflow/*` only where needed to enforce invariant checks
- `src/security/filePolicy.ts`
- `src/security/pathPolicy.ts` only if required for artifact-root enforcement
- `src/utils/git.ts`
- `src/utils/errors.ts` only if a new structured error code is required
- `electron/launcherCore.ts`
- `electron/main.ts`
- preload/API types only if required by existing launcher architecture
- focused renderer files for the Allowed Roots/Workspaces manager
- `tests/config.test.ts`
- `tests/workspaces.test.ts`
- `tests/writeAccessTools.test.ts`
- `tests/domainToolboxes.test.ts`
- patch/Git workflow tests
- launcher core, adapter, preload, and renderer tests
- `docs/DESKTOP_APP_SETUP.md`
- `docs/SECURITY_MODEL.md`
- `docs/TOOL_REFERENCE.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`
- the required Builder Report

Do not modify unrelated UI, OAuth, connector, runtime promotion, trace, release, or Figma code.

## Required Deterministic Tests

1. Explicit workspace without `writePolicy` defaults to `git_required`.
2. Derived legacy workspace defaults to `git_required` when global setting is absent or true.
3. Existing Git repository permits current Markdown artifact workflow under valid gates.
4. Existing Git repository permits current JSON artifact workflow under valid gates.
5. Non-Git `git_required` workspace denies Markdown artifact write with structured Git-required evidence.
6. Non-Git `git_required` workspace denies JSON artifact write with structured Git-required evidence.
7. Non-Git `artifact_only` workspace creates Markdown inside `planning`.
8. Non-Git `artifact_only` workspace creates normalized JSON inside `planning` without executing Git.
9. Artifact-only write outside configured artifact roots is denied.
10. Nested path inside an approved artifact root is allowed.
11. Absolute, traversal, wildcard, URL, and blocked artifact-root configuration is rejected.
12. `.` is accepted only explicitly and produces a safe warning.
13. Markdown extension enforcement remains active.
14. JSON extension and parse enforcement remain active.
15. Blocked config, environment, credential, log, release, generated, database, key, and browser-profile paths remain denied.
16. Existing-file overwrite remains denied unless `overwrite:true`.
17. Symlink, junction, reparse-point, and escape attempts are denied.
18. OAuth `files.write` remains mandatory.
19. Local write mode remains mandatory.
20. Artifact-only workspace denies patch proposal.
21. Artifact-only workspace denies patch application.
22. Non-Git patch application is denied even when legacy `requireGitRoot:false` is loaded.
23. Git stage, commit, branch, integration, and push remain Git-required.
24. One artifact-only workspace does not weaken a separate Git-required workspace.
25. Legacy `requireGitRoot:false` produces deprecation diagnostics and only affects bounded artifact persistence.
26. Existing configuration migrates without losing workspace IDs, labels, roots, remotes, default selection, audit settings, or allowed commands.
27. Launcher creates, edits, saves, reloads, and displays both policies.
28. First-run and reset defaults remain Git-backed.
29. Packaged/runtime config directory loading preserves policies.
30. Diagnostics expose policy and capabilities without absolute roots or secrets.
31. Audit output records selected workspace ID and artifact-only persistence result without raw contents.
32. Existing MCP self-test, public safety scan, OAuth, write-mode, workspace routing, and patch proposal matching remain passing.

## Validation Requirements

Before any command that may spawn child processes, read `docs/dev/VALIDATION_COMMAND_LANES.md` and use the approved normal Windows lane.

Run in order:

1. repository-defined typecheck;
2. focused config/workspace/write-policy tests;
3. focused Markdown/JSON artifact tests;
4. focused patch and Git invariant tests;
5. focused launcher configuration and UI-state tests;
6. repository-defined build;
7. broader unit lane required by shared modules;
8. MCP self-test;
9. public safety scan;
10. lint;
11. `git diff --check`.

Do not use Playwright.
Do not package.
Do not promote the runtime.
Do not restart or reconnect the active connector.
Do not perform live ChatGPT validation.

## Builder Report Requirements

Create:

`planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202A_workspace_scoped_planning_artifact_write_policy.md`

The report must include:

- repository identity, branch, HEAD, remote, and starting/final dirty state;
- dependency/baseline confirmation for REPAIR01;
- files changed;
- pre-existing changes preserved;
- protected subsystems touched;
- configuration schema and migration behavior;
- workspace policy resolver architecture;
- artifact root enforcement;
- Markdown and JSON non-Git behavior;
- patch and Git invariants;
- launcher controls and persistence;
- diagnostic output fields and redaction;
- exact validation commands and Windows lane;
- acceptance-criterion-to-test matrix for all 32 tests;
- validation passed, failed, and not run;
- operator validation steps;
- blockers and assumptions;
- explicit confirmation that no Git initialization, staging, commit, push, package, promotion, restart, reconnect, publication, or release occurred;
- explicit statement: `No fallback implementation was used.`

## Stop Conditions

Stop and report instead of improvising if:

- the approved post-REPAIR01 baseline cannot be established;
- implementation requires disabling Git checks globally;
- a planning workspace cannot be constrained to server-configured artifact roots;
- patch or Git invariants cannot be enforced independently of legacy `requireGitRoot`;
- UI persistence would discard existing workspace metadata;
- a change would alter OAuth, PKCE, DCR, token storage, patch proposal matching, Git history, packaging, release, runtime promotion, or unrelated UI behavior;
- a fallback architecture is required.

No fallback is authorized.

## Manual Validation After Codex

Report these steps as not performed:

1. Architect reviews the Builder Report and complete diff.
2. After approval, a separately authorized pass integrates the change.
3. A separately authorized pass packages and promotes the runtime.
4. Operator restarts ChampCity MCP and reconnects ChatGPT.
5. Operator creates or selects a non-Git greenfield planning workspace in the launcher.
6. Operator sets `Planning artifacts only` with artifact root `planning`.
7. Operator confirms a Markdown and JSON artifact can be created under `planning`.
8. Operator confirms a target outside `planning` is denied.
9. Operator confirms patch proposal/application and Git mutations are denied.
10. Operator confirms an existing Git-backed workspace retains normal artifact and patch behavior.
11. Operator confirms diagnostics show each workspace policy without exposing absolute paths.

## Remaining Passes

After implementation:

- Architect review;
- authorized Git integration if approved;
- separate package-and-promote pass;
- live connector validation for CAV-014, CAV-015, CAV-016, CAV-017, CAV-019, CAV-021, and multi-workspace routing;
- final evidence capture and acceptance-matrix disposition.

## Document Disposition

Document.Status=ApprovedForImplementation
