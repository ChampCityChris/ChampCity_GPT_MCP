# Root Cause Analysis — Greenfield Planning Artifact Writes Incorrectly Require Git

Date: 2026-07-26
Repository: `ChampCityChris/ChampCity_GPT_MCP`
Workspace reviewed: `champcity_gpt`
Branch observed: `dev`
Severity: P0 workflow blocker
Disposition: Corrective action required

## Incident Statement

A valid greenfield planning workspace was configured at a real allowed workspace path. The workspace contained legitimate planning files but had not yet been initialized as a Git repository. ChampCity MCP refused to persist durable planning artifacts because the write path treated every repository write as a Git-backed repository mutation.

The refusal protected source-code repositories from invisible mutation, but it also prevented the intended Capture, Frame, and Plan workflow from creating the artifacts that normally precede repository initialization.

## Executive Finding

The reported problem is valid.

ChampCity MCP currently uses one global `requireGitRoot` boolean as both:

1. a safety requirement for source-code and patch mutation; and
2. a prerequisite for bounded Markdown and JSON artifact persistence.

Those are different authorities and should not share one gate.

Git must remain mandatory for patch application, source mutation, staging, commit, branch, integration, and release workflows. Git should not be mandatory for creating approved planning artifacts inside an explicitly configured planning-only workspace.

The correct repair is a server-defined, per-workspace write policy with operation-specific enforcement. Disabling Git enforcement globally is not an acceptable fix.

## Repository Evidence

### 1. Git enforcement is global

`src/config.ts` defines `AppConfig.requireGitRoot` as one boolean for the entire server. It defaults to `true` through:

`CHAMPCITY_GPT_REQUIRE_GIT_ROOT`, local `requireGitRoot`, or the hardcoded default.

The explicit workspace configuration currently supports:

- `workspaceId`
- `label`
- `root`
- optional `remote`

It has no workspace-specific write policy or workspace-specific Git requirement.

### 2. Markdown artifact writes use the global Git gate

`src/tools/writeMarkdownArtifact.ts` resolves and validates the allowed path, then calls `assertInsideGitRepo` whenever `config.requireGitRoot` is true.

Therefore a safe `.md` artifact in an allowed non-Git planning workspace is denied before the atomic write occurs.

### 3. JSON artifact writes use the same global Git gate

`src/tools/writeJsonArtifact.ts` also calls `assertInsideGitRepo` whenever `config.requireGitRoot` is true.

In addition, its path validation calls `git check-ignore` through `isIgnored`. That means merely setting the global flag to false does not establish a clean non-Git artifact path; JSON persistence still invokes Git-oriented logic.

### 4. Patch application also depends on the same global boolean

`src/tools/applyApprovedPatch.ts` only verifies patch targets are inside a Git repository when `config.requireGitRoot` is true.

Consequently, setting the global boolean to false to unblock a planning workspace also weakens the Git guarantee for patch application across every configured workspace. This is an unacceptable coupling.

### 5. The launcher exposes the same global model

The Electron launcher configuration and renderer expose one `requireGitRoot` checkbox. First-run setup hardcodes it to true. The UI cannot distinguish a mature source repository from a greenfield planning workspace.

### 6. Existing workspace diagnostics tolerate non-Git roots

`src/workspaces.ts` already treats branch and remote as optional diagnostics and returns `unknown` when `.git` is absent. The workspace registry can therefore represent non-Git roots. The write layer, not workspace resolution, is the blocking boundary.

## Root Cause

The root cause is an authority-modeling defect.

The application models Git presence as a property of the entire MCP runtime rather than as:

- a property of the selected workspace; and
- a requirement of the specific operation being performed.

This conflates two distinct classes of write:

### Artifact persistence

Bounded creation or overwrite of approved Markdown and JSON planning artifacts, protected by:

- configured allowed root;
- explicit workspace selection;
- OAuth `files.write`;
- local write mode;
- extension and path policy;
- blocked-file policy;
- overwrite control;
- atomic write;
- audit evidence.

### Git-backed mutation

Patch application, source changes, staging, commit, branch, integration, push, and release behavior, protected by:

- all artifact/file safety controls that apply;
- confirmed Git repository identity;
- working-tree and branch evidence;
- proposal or workflow gates;
- Git-native diff and rollback evidence.

The current global boolean makes these authorities inseparable.

## Why the Obvious Workarounds Are Wrong

### Initialize an empty Git repository immediately

This unblocks the current check but fabricates a source-control lifecycle before the project has reached the point where the Operator intends to establish it. It also forces workflow sequencing to satisfy an implementation shortcut rather than project governance.

### Set `requireGitRoot` to false globally

This is unsafe. It affects every configured workspace and weakens patch-target Git enforcement. It also does not cleanly remove every Git dependency from JSON artifact writing.

### Add a special-case path exception

A hardcoded directory exception would create hidden policy and would not solve multi-workspace routing. The policy must be explicit, server-configured, diagnosable, and workspace-scoped.

## Required Architecture

Introduce a server-defined per-workspace write policy.

Recommended policy enum:

- `git_required`
- `artifact_only`

### `git_required`

Default and backward-compatible policy for source repositories.

- Markdown and JSON artifact writes require the selected workspace to be a Git repository.
- Patch proposal/application and every Git workflow require Git.
- Existing source-repository behavior remains unchanged.

### `artifact_only`

Explicit Operator-selected policy for greenfield planning workspaces.

Allowed:

- `repo_toolbox.write_markdown_artifact`
- `repo_toolbox.write_json_artifact`

Only when all normal OAuth, write-mode, allowed-root, path, extension, overwrite, atomic-write, audit, file-type, symlink/reparse-point, and size controls pass.

Denied:

- patch proposal and application;
- arbitrary source-file writes;
- staging, commit, branch, integration, push, tag, package, or release actions;
- arbitrary command execution;
- any Git workflow when `.git` is absent.

### Artifact write scopes

An `artifact_only` workspace must also define server-side artifact write scopes. Recommended field:

`artifactWriteRoots`

Properties:

- array of safe workspace-relative directory prefixes;
- no absolute paths;
- no traversal;
- no caller override;
- default `planning` when omitted for an explicitly configured `artifact_only` workspace;
- `.` may be accepted only as an explicit Operator choice and must be clearly warned because it permits artifact extensions throughout that workspace;
- Markdown and JSON artifacts must resolve inside one configured artifact root.

This prevents `artifact_only` from becoming a generic `.json` overwrite path for files such as `package.json` unless the Operator explicitly grants a scope that contains it.

## Configuration and Migration

Extend explicit workspace configuration with:

```json
{
  "workspaceId": "new_project_planning",
  "label": "New Project Planning",
  "root": "%USERPROFILE%\\Projects\\New_Project",
  "writePolicy": "artifact_only",
  "artifactWriteRoots": ["planning"]
}
```

Existing workspaces without `writePolicy` must default to `git_required`.

The legacy global `requireGitRoot` field should be deprecated, not silently repurposed.

Recommended compatibility behavior:

- absent or `true`: derived/legacy workspaces use `git_required`;
- `false`: legacy artifact writes may map to `artifact_only` only for Markdown/JSON persistence, with a startup deprecation warning;
- patch application and all Git workflows remain Git-required regardless of the legacy global setting.

The server must not allow `requireGitRoot:false` to disable Git requirements for patch or Git operations.

## Write-Policy Resolution

Create one policy resolver based on the selected workspace and operation. Do not mutate global `AppConfig` per request.

The resolver should return safe internal facts such as:

- workspace ID;
- workspace write policy;
- Git detected yes/no;
- artifact write roots;
- whether artifact persistence is allowed;
- whether Git-backed mutation is allowed;
- structured denial reason.

Toolbox routes should resolve the workspace object, not only its root, before invoking a write helper.

Direct/internal helper routes that still accept a root must map that root to an exact configured workspace or use the safe legacy default. Caller-supplied policy values are prohibited.

## JSON Artifact Correction

`writeJsonArtifact` must not call `git check-ignore` in an `artifact_only` non-Git workspace.

The reusable non-Git path policy must retain:

- blocked file/directory rules;
- extension enforcement;
- configured artifact-root enforcement;
- symlink/reparse-point denial;
- size limits;
- overwrite control;
- atomic write;
- audit logging.

Git ignore checks may remain an additional check for `git_required` repositories.

## Patch and Git Invariants

The following must require a confirmed Git repository regardless of artifact policy or legacy global configuration:

- `propose_patch` when used as the controlled source-mutation workflow;
- `apply_approved_patch`;
- stage;
- commit;
- branch preparation;
- integration;
- push;
- tag and release Git operations;
- Git readiness and mutation workflows where repository identity is required.

Read-only repository file access remains independent of Git unless a specific Git diagnostic is requested.

## Launcher Requirement

The fix must be usable without hand-editing JSON.

Replace the single global `Require Git Root` control with a minimal per-workspace write-policy control in the Allowed Roots/Workspaces manager.

For each workspace, the Operator must be able to select:

- `Git-backed repository` (`git_required`)
- `Planning artifacts only` (`artifact_only`)

When `Planning artifacts only` is selected, the UI must expose artifact write roots and default them to `planning`.

The UI must explain that planning mode permits only bounded Markdown/JSON artifact persistence and does not enable patch or Git workflows.

Existing `allowedRoots` configuration must migrate safely to explicit workspace entries or continue to function as `git_required` derived workspaces. No existing source repository may silently become `artifact_only`.

## Diagnostics Requirement

`diagnostics_toolbox.list_workspaces`, write-access status, or another existing safe diagnostic should report, without exposing absolute roots:

- workspace ID;
- write policy;
- Git detected yes/no;
- artifact write roots as relative values;
- artifact persistence available yes/no and reason;
- Git-backed mutation available yes/no and reason.

This prevents another opaque `GIT_REQUIRED` failure and gives the Architect evidence of which authority blocked the call.

## Required Acceptance Tests

1. Existing configured workspace without `writePolicy` defaults to `git_required`.
2. Existing Git repository continues to allow bounded Markdown/JSON writes under current gates.
3. Non-Git `git_required` workspace rejects Markdown and JSON writes with a structured Git-required error.
4. Non-Git `artifact_only` workspace permits Markdown creation inside an approved artifact root.
5. Non-Git `artifact_only` workspace permits normalized JSON creation inside an approved artifact root without invoking Git.
6. Artifact writes outside configured artifact roots are denied.
7. Path traversal, absolute artifact roots, blocked files, symlinks/reparse points, and disallowed extensions remain denied.
8. Existing-file overwrite remains denied unless `overwrite:true`.
9. OAuth `files.write` and local write mode remain mandatory.
10. `artifact_only` cannot propose or apply a patch.
11. `apply_approved_patch` always requires a Git repository, even under legacy `requireGitRoot:false`.
12. Git stage, commit, branch, integration, and push remain Git-required.
13. Legacy `requireGitRoot:false` emits a deprecation warning and does not weaken patch/Git invariants.
14. Multi-workspace routing applies the selected workspace policy only; one planning workspace does not weaken another source repository.
15. Diagnostics report policy and capability without absolute paths or secrets.
16. Launcher can create, edit, save, reload, and display both workspace policies.
17. First-run and reset defaults remain `git_required`.
18. Existing configuration files migrate without data loss.
19. Packaged/runtime config loading preserves workspace policy.
20. Audit entries distinguish artifact-only persistence from Git-backed mutation denial.

## Scope Boundary

This correction does not authorize:

- automatic `git init`;
- automatic remote creation;
- automatic branch or commit creation;
- arbitrary non-Git file writes;
- caller-selected write policy;
- weakening OAuth or write mode;
- weakening path, blocked-file, symlink, extension, size, overwrite, or audit controls;
- changing patch approval semantics;
- packaging, runtime promotion, or live connector validation in the implementation pass.

## Implementation Sequencing

This change overlaps shared MCP toolbox and diagnostics code with WC-V1-0104A-REPAIR01. It must not be implemented against an unresolved intermingled baseline.

Begin implementation only after the REPAIR01 Builder Report receives Architect disposition and the approved baseline is clearly established. Preserve all approved REPAIR01 behavior.

## Disposition

A new scoped Work Card is required for workspace policy, artifact persistence, launcher configuration, diagnostics, migration, and tests.

Document.Status=Approved
