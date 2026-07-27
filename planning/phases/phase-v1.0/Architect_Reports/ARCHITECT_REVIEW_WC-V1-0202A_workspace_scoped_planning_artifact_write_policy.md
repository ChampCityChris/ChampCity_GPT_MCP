# Architect Review — WC-V1-0202A Workspace-Scoped Planning Artifact Write Policy

Date: 2026-07-27
Repository: `ChampCityChris/ChampCity_GPT_MCP`
Workspace: `%USERPROFILE%\Projects\ChampCity_GPT`
Branch reviewed: `dev`
Starting HEAD reported by Implementer: `e782bde926240ae264c11f9ae51e8ee671fc90ca`
Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202A_workspace_scoped_planning_artifact_write_policy.md`
Work Card: `planning/phases/phase-v1.0/Work_Cards/WC-V1-0202A_workspace_scoped_planning_artifact_write_policy.md`
Disposition: RevisionRequested

## Executive Disposition

WC-V1-0202A is not approved for Git integration, packaging, runtime promotion, restart, reconnect, or live ChatGPT connector validation.

The implementation establishes a useful foundation: per-workspace `git_required` and `artifact_only` policy fields, server-controlled artifact roots, structured workspace-authority errors, non-Git Markdown/JSON persistence, patch and Git policy checks, launcher editing controls, safe diagnostics, and broad regression coverage. The current source also passes an independently executed typecheck and the complete 369-test repository suite.

However, five contract defects remain. Two affect the core authorization boundary, one violates an explicit status requirement, one weakens artifact path safety, and one prevents reliable launcher configuration management. The Builder Report therefore overstates all 32 acceptance criteria as complete.

Do not create a sequence of separate repair cards. Complete one consolidated WC-V1-0202A closure correction addressing every finding and every required adversarial fixture in this review, then update the existing Builder Report for another full review.

## Repository State Reviewed

ChampCity MCP reported:

- Workspace: `champcity_gpt`
- Repository: `ChampCityChris/ChampCity_GPT_MCP`
- Branch: `dev`
- Starting HEAD: `e782bde926240ae264c11f9ae51e8ee671fc90ca`
- Worktree: dirty with WC-V1-0202A implementation files only
- Tracked modified files: 27
- Untracked files before this review artifact: 3
- Staged files: 0
- Deleted files: 0

Independent validation executed during Architect review:

- `npm run typecheck`: PASS
- `npm test`: PASS, 369 tests
- HEAD before and after validation remained `e782bde926240ae264c11f9ae51e8ee671fc90ca`

The review did not reset, restore, clean, stash, stage, commit, push, merge, integrate, package, promote, restart, reconnect, publish, or release anything. The only repository write performed by this review is this Architect Review artifact.

## Confirmed Improvements

The following implementation elements are materially correct and should be preserved:

1. Explicit configured workspaces support `writePolicy: git_required | artifact_only`.
2. Explicit `artifact_only` workspaces without an `artifactWriteRoots` field default to `planning`.
3. Unsafe artifact-root values such as absolute paths, traversal, URLs, glob syntax, shell metacharacters, and selected blocked segments are rejected.
4. `.` requires explicit configuration and produces a visible warning.
5. Markdown and JSON helpers resolve the selected workspace through server configuration rather than accepting caller-controlled policy fields.
6. `artifact_only` Markdown and normalized JSON writes can complete without invoking Git.
7. Patch proposal and application consult workspace authority before proceeding.
8. Git toolbox mutation and readiness actions consult workspace authority.
9. OAuth `files.write` and local write-mode gates remain separate from workspace policy.
10. Structured errors distinguish `WORKSPACE_POLICY_DENIED`, `GIT_REQUIRED`, and `TARGET_OUTSIDE_ARTIFACT_ROOTS`.
11. Workspace diagnostics return safe policy and capability metadata without absolute roots.
12. Launcher configuration round-trips policy fields and unrelated metadata through its core persistence layer.
13. Public MCP exposure and the approved trace architecture remain unchanged.

These improvements are substantial, but they do not cure the findings below.

## Findings

### Finding 1 — Git authorization is based on a `.git` marker, not a confirmed Git repository

Severity: P0 authorization defect

The Work Card repeatedly requires a **confirmed Git repository** for:

- `git_required` Markdown and JSON writes;
- patch proposal and patch application;
- all Git mutation workflows.

`src/workspaceWritePolicy.ts` implements:

```ts
export function detectGitRepository(root: string): boolean {
  return fs.existsSync(path.join(root, ".git"));
}
```

That test does not confirm Git repository validity. It treats any file or directory named `.git` as authority. The current test `keeps legacy requireGitRoot false Git repositories git_required` explicitly creates an empty `.git` directory and treats it as a valid Git repository, which proves the test is validating the weak implementation rather than the required contract.

Consequences include:

- a fabricated empty `.git` directory authorizes `git_required` artifact persistence;
- a fabricated empty `.git` directory permits `propose_patch`, which performs no Git command after the authority decision;
- a valid Git worktree whose `.git` entry is a file is accepted accidentally by marker existence, but not actually validated;
- a selected workspace rooted inside a valid parent Git worktree but without its own `.git` marker is treated as non-Git even though existing repository logic can identify an enclosing Git root;
- Git status diagnostics and mutation availability can be reported incorrectly.

Required correction:

- replace marker existence with one canonical Git-repository confirmation authority;
- use a bounded Git-native check such as `git rev-parse --is-inside-work-tree` and resolve the actual top-level repository where required;
- define whether a configured workspace may be a subdirectory of a Git worktree and enforce that definition consistently;
- support normal repositories and worktrees with `.git` files;
- reject fabricated or corrupt `.git` markers;
- preserve the invariant that an `artifact_only` persistence operation performs no Git command;
- ensure all `git_required`, patch, and Git workflow decisions use the same confirmed result.

Mandatory fixtures:

1. Empty fake `.git` directory is not a confirmed repository.
2. Arbitrary `.git` file is not accepted unless Git confirms the worktree.
3. Normal initialized repository is accepted.
4. Git worktree `.git` file is accepted when Git confirms it.
5. Configured subdirectory behavior is explicitly tested according to the chosen contract.
6. `artifact_only` Markdown/JSON success still performs no Git command.

### Finding 2 — `repo_toolbox.status` still rejects a non-Git planning workspace

Severity: P0 explicit acceptance failure

The Work Card states:

> `repo_toolbox.status` for a non-Git planning workspace must not present Git absence as an invalid workspace. It may report that repository status is unavailable while artifact persistence remains available.

The implemented route remains:

```ts
repo_toolbox.status
  -> getWorkspaceStatusSummary(...)
  -> resolveWorkspaceContext(...)
```

`src/tools/publicSafeFacade.ts` still contains:

```ts
if (!fs.existsSync(path.join(workspace.root, ".git"))) {
  throw new AppError("GIT_REQUIRED", "Configured workspace is not a git repository.");
}
```

Therefore a valid non-Git `artifact_only` workspace receives `GIT_REQUIRED` instead of a safe workspace status. No current test exercises the required non-Git status behavior.

Required correction:

- make `repo_toolbox.status` workspace-aware rather than Git-presence-dependent;
- return safe workspace metadata, write policy, artifact persistence capability, and `repositoryStatusAvailable: false` or equivalent when Git is unavailable;
- do not invent branch, cleanliness, or changed-file counts when Git status cannot be obtained;
- keep `git_toolbox.status` semantics distinct if it is intended to remain Git-specific;
- use the canonical confirmed-Git authority from Finding 1.

Mandatory fixture:

- a non-Git `artifact_only` workspace returns `ok: true`, identifies artifact persistence as available, identifies Git status/mutation as unavailable, and exposes no absolute path.

### Finding 3 — Markdown artifact writes do not enforce the complete blocked-path invariant

Severity: P0 path-policy defect

The Work Card requires blocked configuration, environment, credential, log, release, generated, database, key, and browser-profile paths to remain denied.

`writeJsonArtifact` applies both:

- `assertFilePolicyAllowsPath(...)`; and
- `forbiddenFinding(...)` from Git workflow safety.

`writeMarkdownArtifact` applies only:

- `assertMarkdownArtifactPath(...)`, which delegates to `filePolicy.ts`.

The current file policy blocks `.git`, `node_modules`, `appdata`, selected environment/key/database extensions, and browser-profile patterns. It does not generally block directory segments such as:

- `config`;
- `logs`;
- `release`;
- `generated`;
- `dist`;
- `coverage`;
- credential or secret directories.

As a result, an `artifact_only` workspace configured with root `.` can write `.md` artifacts into those directories. Even a normal `planning` root can permit paths such as `planning/config/private.md` because artifact-root validation checks containment, not blocked nested segments.

Required correction:

- create one artifact-target forbidden-path authority shared by Markdown and JSON writes;
- enforce blocked segments at any depth, not only at workspace-root prefixes;
- preserve safe planning directories and existing `.env.example` behavior where applicable;
- keep JSON parsing/normalization and Git-ignore behavior separate from common path policy;
- ensure explicit `.` never becomes a bypass around blocked paths.

Mandatory fixtures must cover Markdown and JSON attempts under at least:

- `config`;
- `logs`;
- `release`;
- `generated`;
- `dist` or build output;
- credential/secret directory names;
- database/key/browser-profile targets;
- nested blocked paths under `planning`;
- blocked paths while artifact root is `.`.

### Finding 4 — An explicit `artifact_only` workspace accepts an empty artifact-root list

Severity: P1 bounded-authority defect

The configuration normalizer uses:

```ts
const artifactRootConfig = workspace.artifactWriteRoots ?? defaultArtifactWriteRootsForPolicy(writePolicy);
const artifactRoots = artifactRootConfig.length > 0
  ? normalizeArtifactWriteRoots(...)
  : { roots: [], warnings: [] };
```

Therefore:

```json
{
  "writePolicy": "artifact_only",
  "artifactWriteRoots": []
}
```

is accepted with no artifact roots. This bypasses the normalizer’s own requirement that at least one root be present and creates inconsistent behavior between an omitted field and an explicitly empty field. The launcher can create this state when the Operator clears the artifact-root input.

Required correction:

Choose and document one deterministic rule:

- treat an empty list as invalid; or
- normalize an empty list to the default `planning` root.

Apply the same rule in backend loading, launcher validation, renderer state, migration, and tests. The preferred fail-safe behavior is to reject an explicit empty list and keep omission as the only route to the default.

Mandatory fixtures:

- backend config loading;
- launcher core validation;
- renderer edit/save behavior;
- save/reload round trip.

### Finding 5 — Launcher workspace identity and default selection are not robust under normal editing

Severity: P1 launcher persistence defect

The launcher creates workspace IDs from the selected folder basename:

```ts
workspaceId: deriveWorkspaceId(label, `workspace_${index + 1}`)
```

It does not compare against IDs already in the configuration. Two roots with the same basename under different parent directories receive the same workspace ID. The backend then rejects the saved configuration because workspace IDs must be unique.

The removal handler also removes the workspace record but does not update or clear `defaultWorkspaceId`. Removing the default workspace leaves a stale default ID and causes later validation/save failure.

These behaviors violate the required create/edit/save/reload launcher workflow and were not covered by the launcher tests.

Required correction:

- use the same deterministic unique-ID allocator used by the backend or expose one shared pure utility;
- preserve existing workspace IDs during edits;
- generate a collision-free ID when adding a new root with a duplicate basename;
- when the default workspace is removed, clear it or deterministically select the remaining sole workspace according to existing default rules;
- do not silently rewrite unrelated workspace IDs;
- ensure Allowed Roots and workspace rows remain synchronized.

Mandatory fixtures:

1. Add two roots with the same basename and save/reload successfully.
2. Remove a non-default workspace and preserve the default.
3. Remove the default from a multi-workspace configuration and clear the stale default.
4. Remove the default leaving one workspace and apply the documented deterministic default behavior.
5. Preserve labels, remotes, policy, artifact roots, and passthrough metadata during all cases.

## Additional Evidence Integrity Finding

Severity: P0 report disposition defect

The Builder Report marks all 32 acceptance criteria PASS, but the current evidence does not cover:

- actual Git repository confirmation;
- fake or corrupt `.git` markers;
- worktree `.git` files;
- configured subdirectories of Git repositories;
- non-Git `repo_toolbox.status`;
- Markdown writes to blocked directory classes;
- nested blocked paths under allowed artifact roots;
- explicit empty `artifactWriteRoots`;
- duplicate launcher workspace IDs;
- stale `defaultWorkspaceId` after removal.

The independently passing 369-test suite confirms that these cases are absent from the suite. Broad suite success cannot substitute for the missing semantic fixtures.

The updated Builder Report must map every corrected boundary to a named assertion and must not state that no local defect is known unless the final adversarial review has exercised these cases.

## Required Consolidated Closure Scope

Complete all of the following in one WC-V1-0202A closure pass:

1. Introduce one trustworthy, worktree-aware Git confirmation authority.
2. Route all Git-required artifact, patch, Git workflow, catalog, and status decisions through that authority.
3. Make `repo_toolbox.status` succeed safely for non-Git planning workspaces.
4. Create one shared blocked artifact-target path policy for Markdown and JSON.
5. Enforce a deterministic nonempty-root rule for `artifact_only`.
6. Fix launcher workspace-ID collision and stale-default handling.
7. Add the complete adversarial fixture set listed in Findings 1–5.
8. Re-review all 32 original acceptance criteria against actual assertions.
9. Update documentation and the existing Builder Report to describe only proven behavior.
10. Run a mandatory Implementer self-review of the full source diff after all tests pass.

Do not broaden this closure into OAuth, PKCE, DCR, token storage, trace architecture, public tool exposure, patch proposal matching, Git history, packaging, runtime promotion, Figma, or unrelated UI work.

## Validation Direction

After correction, run at minimum:

1. typecheck;
2. focused workspace authority and Git-confirmation tests;
3. focused Markdown/JSON path-policy tests;
4. focused patch and Git invariant tests;
5. non-Git repository-status tests;
6. launcher collision/default/edit/save/reload tests;
7. build;
8. full repository unit suite;
9. MCP self-test;
10. public safety scan;
11. lint;
12. `git diff --check`.

Do not use Playwright. Do not package, promote, restart, reconnect, or perform live connector validation.

## Source-Control and Runtime Direction

Do not stage, commit, push, integrate, package, promote, restart, reconnect, publish, release, or perform live ChatGPT connector validation for the current WC-V1-0202A implementation.

Those actions remain blocked until the consolidated closure pass receives Architect approval.

## Final Disposition

WC-V1-0202A disposition: RevisionRequested

Document.Status=RevisionRequested
