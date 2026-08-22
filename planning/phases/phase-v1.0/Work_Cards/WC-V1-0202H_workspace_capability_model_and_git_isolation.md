# WC-V1-0202H — Workspace Capability Model and Git Isolation

## Work Card Identity

- ID: `WC-V1-0202H`
- Title: Workspace Capability Model and Git Isolation
- Phase: v1.0 — ChatGPT Connector and Safety-Layer Reliability
- Priority: P0
- Type: Workspace authority correction and diagnostic separation
- Repository: `%USERPROFILE%\Projects\ChampCity_GPT`
- Remote: `ChampCityChris/ChampCity_GPT_MCP`
- Branch at authorization: `dev`
- Starting HEAD at authorization: `db6aa399716db271f2b38a6927de33f0f29a55ec`
- Controlling RCA: `planning/phases/phase-v1.0/Architect_Reports/CODE_REVIEW_RCA_OPENAI_SAFETY_LAYER_FALSE_POSITIVES_AND_GIT_COUPLING_2026-07-31.md`
- Related prior repair: `WC-V1-0202B-REPAIR01 — Canonical Markdown Alignment and Git Authority Removal`
- Required Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202H_workspace_capability_model_and_git_isolation.md`

## Authorization Basis

The controlling RCA confirmed that Revisionary is a valid target workspace even though it is not a Git repository. File reads and canonical Markdown artifact persistence are available. The `revisionary` workspace ID is correct because it identifies the project being served; `champcity_gpt` identifies the MCP service repository and is not an appropriate substitute.

The current implementation partially removed Git from artifact persistence, but Git remains embedded in general workspace diagnostics and terminology:

- `diagnostics_toolbox.public_safety_status` calls a Git change-set readiness function;
- `repo_toolbox.status` resolves through a Git-required facade;
- `publicSafeFacade.resolveWorkspaceContext` rejects any workspace without `.git`;
- the persisted default policy name is `git_required` even when artifact persistence is valid without Git;
- runtime diagnostics compare the ChampCity GPT service package/source identity against the selected target project; and
- tests encode those cross-project comparisons as desired drift detection.

This card is authorized to make Git an optional, isolated capability. Git must not be an implicit prerequisite for a ChampCity workspace, planning workflow, file read, artifact write, or general safety diagnostic.

## Sequencing and Isolation

This card may begin after the shared files touched by `WC-V1-0104B` and `WC-V1-0202G` are stable. If implementation branches overlap in `domainToolboxes.ts`, `toolboxActionPolicy.ts`, `registerTools.ts`, `workspaces.ts`, or diagnostics tests, implement sequentially and preserve earlier approved behavior.

The repository contains an unrelated tracked modification outside this work card: `docs/CHATGPT_CONNECTION_GUIDE.md`. Preserve it and every other unrelated change discovered at implementation start exactly. Do not reset, restore whole files, clean, stash, discard, stage, commit, push, merge, integrate, package, promote, restart, reconnect, publish, or release.

## Objective

Replace the Git-centered workspace mental model with independent capabilities and isolate all Git requirements to explicit Git or release operations.

After implementation:

- a directory can be a valid ChampCity workspace without `.git`;
- repository reads and searches operate on allowed filesystem workspaces, not only Git repositories;
- canonical Markdown and JSON artifact persistence depends on write authority, allowed roots, path policy, evidence rules, and file safety—not Git;
- general workspace status and safety diagnostics work for non-Git workspaces;
- Git status, diff, history, staging, commit, push, and source-control readiness remain available only through explicit Git actions;
- absence of Git produces a localized capability result, not a workflow-wide error;
- service-runtime provenance describes ChampCity GPT itself;
- target-workspace diagnostics describe the selected project without comparing unrelated package versions or commits; and
- `GIT_REQUIRED` cannot escape from non-Git operations.

## Mandatory Implementation Scope

### 1. Introduce an independent workspace capability model

Create a typed capability model expected to contain at least:

- `filesystemAccess`
- `artifactPersistence`
- `patchWorkflow`
- `gitInspection`
- `gitMutation`
- `releaseInspection`
- `releasePublication`

Each capability must report:

- `available: boolean`
- stable `reasonCode`
- bounded human-readable reason
- configuration source
- detected prerequisites
- warnings

Suggested capability semantics:

#### Filesystem access

Available when:

- the workspace is registered;
- the root is within configured allowed roots;
- the root exists and is a directory;
- path-policy and reparse/symlink controls remain enforceable.

Must not require Git.

#### Artifact persistence

Available when:

- filesystem access is available;
- OAuth `files.write` is granted for the call;
- local write mode permits the operation;
- target path passes allowed-root, extension, file, overwrite, artifact-root, and evidence controls.

Must not require Git.

#### Patch workflow

Available according to explicit patch policy and existing proposal/approval safeguards. Git may be relevant to source-code patch governance only when explicitly configured, but absence of Git must not affect unrelated artifact writes.

#### Git inspection

Available only when `.git` is detected and Git commands are operational.

#### Git mutation

Available only when Git inspection is available, workspace configuration permits mutation, OAuth/write mode permit the specific operation, and existing branch/safety controls pass.

#### Release inspection/publication

Available only for explicitly release-capable workspaces. These capabilities may require Git and repository coordinates, but their failure must remain local to release actions.

### 2. Migrate persisted workspace policy safely

Current persisted values:

- `git_required`
- `artifact_only`

Required migration behavior:

- continue accepting both legacy values during configuration load;
- translate them into independent capabilities;
- do not rewrite local configuration automatically unless an explicit migration action is separately authorized;
- emit a bounded deprecation warning for legacy policy terminology;
- do not interpret `git_required` as a requirement for reads, searches, artifact persistence, or general diagnostics;
- preserve `artifact_only` restrictions on Git mutation and configured artifact roots;
- add a future-facing configuration schema using capability fields or a clearer profile name;
- document exact compatibility behavior.

A permitted model is:

```ts
workspaceCapabilities: {
  artifactPersistence: "enabled" | "disabled";
  patchWorkflow: "enabled" | "disabled";
  gitOperations: "auto" | "disabled";
  releaseOperations: "auto" | "disabled";
}
```

The implementer may choose a different bounded schema if it satisfies the same authority separation and migration requirements.

### 3. Refactor workspace authority by operation class

Replace the current broad non-artifact fallback that treats most operation classes as Git-backed.

Required operation classes:

- `filesystem_read`
- `workspace_diagnostics`
- `artifact_persistence`
- `patch_workflow`
- `git_inspection`
- `git_mutation`
- `release_inspection`
- `release_publication`

Required rules:

- `filesystem_read` never requires Git;
- `workspace_diagnostics` never requires Git;
- `artifact_persistence` never requires Git;
- `patch_workflow` follows explicit patch capability, not an inferred Git default;
- only `git_inspection`, `git_mutation`, and explicitly Git-backed release operations may return a not-Git result;
- error text must identify the exact requested capability rather than stating that the whole workspace is invalid.

### 4. Replace Git-backed `repo_toolbox.status`

`repo_toolbox.status` currently delegates to `getWorkspaceStatusSummary`, which requires `.git` and returns branch/change information.

Change `repo_toolbox.status` into a general workspace status action.

Required result fields:

- workspace ID and label;
- root availability without exposing absolute path;
- filesystem access capability;
- read capability;
- artifact persistence capability;
- patch capability;
- Git inspection/mutation capability summaries;
- release capability summaries;
- configured artifact roots;
- write-mode summary;
- audit-log health summary;
- warnings;
- no branch, staged-file, or dirty-tree fields unless presented inside an optional nested Git capability result obtained without throwing.

Existing callers needing source-control status must use:

`git_toolbox.status`

Update documentation and unsupported/deprecation recommendations accordingly.

### 5. Replace misleading `public_safety_status`

The action name `public_safety_status` currently implies a general safety assessment but executes Git change-set readiness.

Required replacement:

`diagnostics_toolbox.workspace_safety_status`

Required checks:

- workspace registration;
- allowed-root containment;
- root existence/type;
- path-policy readiness;
- file-policy readiness;
- write-mode state;
- OAuth scope state for the caller;
- artifact-root configuration;
- audit/trace storage health;
- filesystem read capability;
- artifact persistence capability;
- patch capability;
- Git capabilities reported separately as optional information;
- no Git requirement for overall success.

Compatibility behavior for `public_safety_status`:

- retain as a deprecated alias for one release cycle if required for current callers;
- alias must return the new workspace safety result, not Git readiness;
- include a deprecation field recommending `workspace_safety_status`;
- remove the alias only through a separately reviewed public-contract change.

Git change-set readiness remains:

`git_toolbox.readiness_summary`

### 6. Confine Git checks to `git_toolbox`

Required Git-toolbox behavior for a non-Git workspace:

- return `ok: true` with a structured capability result such as `status: not_git_repository` for read-only inspection actions; or
- return a localized typed error such as `GIT_CAPABILITY_UNAVAILABLE` if existing response conventions require `ok: false`.

Preferred behavior for read-only Git actions is a nonexceptional capability result because absence of Git is a normal workspace state.

Write Git actions must remain denied and must identify only the requested Git operation.

`GIT_REQUIRED` may remain as a legacy internal code, but public results should migrate to an explicit capability-unavailable code. It must not be classified as a general workspace-policy denial.

### 7. Separate service runtime provenance from target workspace diagnostics

Refactor `buildRuntimeScopeToolDiagnostics` and related tests.

Required service-runtime fields:

- ChampCity GPT runtime package version;
- ChampCity GPT runtime source commit when available;
- packaged/development runtime mode;
- executable/source provenance;
- promotion/restart drift only relative to the ChampCity GPT service repository or packaged runtime metadata.

Required target-workspace fields:

- selected workspace ID/label;
- filesystem availability;
- capability summary;
- optional project metadata such as package name/version when present, clearly labeled as target project metadata;
- optional Git HEAD/branch only when Git is detected;
- no comparison between target package version and ChampCity GPT runtime package version;
- no comparison between target Git HEAD and ChampCity GPT runtime source commit.

When `workspaceId=champcity_gpt`, a separately labeled service-repository alignment check may compare the runtime to its own source workspace.

When another workspace is selected, alignment must be `not_applicable`, not mismatch or unknown drift.

### 8. Refactor `publicSafeFacade.ts`

Split the current Git-required workspace resolver into focused helpers:

- `resolveFilesystemWorkspaceContext`
- `resolveGitWorkspaceContext`
- `resolveReleaseWorkspaceContext`

Required behavior:

- filesystem resolver verifies registration/root/path safety only;
- Git resolver builds on filesystem resolver and returns a Git capability result;
- release resolver explicitly verifies release prerequisites;
- general status does not import or call Git safety functions;
- Git branch/status parsing remains in the Git-specific path.

Consider moving Git-only functions out of `publicSafeFacade.ts` into a clearer module such as:

- `gitReadinessFacade.ts`
- `releaseSafetyFacade.ts`
- `workspaceStatusFacade.ts`

Do not continue expanding one mixed facade.

### 9. Correct `list_workspaces` and write-access language

`diagnostics_toolbox.list_workspaces` and `write_access_status` already report separate artifact and Git capabilities, but wording remains Git-centered.

Required changes:

- identify `revisionary` as a valid workspace with filesystem/artifact capabilities;
- report `gitDetected: false` as informational, not as a workspace warning unless a Git action was requested;
- replace `writePolicy: git_required` as the primary public authority with the capability summary;
- preserve a `legacyWritePolicy` field temporarily when needed for compatibility;
- do not recommend creating a Git repository unless the Operator asks to use Git functions;
- explicitly state that Git absence does not affect reads or artifact persistence.

### 10. Correct error taxonomy and recommendations

Required behavior:

- general workspace calls cannot return `GIT_REQUIRED`;
- Git capability unavailability is not a security-policy denial;
- non-Git workspace status must be successful;
- recommendations must be operation-specific;
- no response should suggest changing the workspace ID from `revisionary` to `champcity_gpt` merely to satisfy Git;
- no response should imply ChampCity GPT exists primarily to operate on its own repository.

### 11. Add non-Git first-class fixtures

Create deterministic tests using a registered allowed-root directory with:

- no `.git` directory;
- planning/project Markdown inputs;
- configured docs write mode;
- optional artifact roots;
- no package.json requirement.

The fixture must prove the full planning-document lifecycle independently of Git.

### 12. Preserve explicit Git workflows

This card is not authorization to remove Git tooling from users who choose it.

Existing Git features must remain available for Git-backed workspaces:

- status;
- diff;
- history inspection;
- pre-commit scan;
- readiness;
- branch preparation;
- staging;
- commit;
- push;
- integration.

Their safeguards must remain unchanged unless required solely to consume the new capability model.

## Expected Production Files

Expected modified files:

- `src/workspaces.ts`
- `src/workspaceAuthority.ts`
- `src/workspaceWritePolicy.ts`
- `src/tools/publicSafeFacade.ts`
- `src/tools/domainToolboxes.ts`
- `src/tools/toolboxActionPolicy.ts`
- `src/utils/errorClassification.ts`
- `src/utils/errors.ts` if adding explicit capability codes
- configuration parsing/types for workspace capability migration
- diagnostics and workspace documentation
- focused tests.

Expected new files may include:

- `src/workspaceCapabilities.ts`
- `src/tools/workspaceStatusFacade.ts`
- `src/tools/gitReadinessFacade.ts`
- `src/tools/releaseSafetyFacade.ts`

Keep the capability authority centralized. Do not duplicate capability calculations in every toolbox branch.

## Required Deterministic Acceptance Tests

1. A registered non-Git workspace resolves successfully for filesystem reads.
2. `repo_toolbox.read_file` succeeds without `.git`.
3. `repo_toolbox.list_files` succeeds without `.git`.
4. `repo_toolbox.search_files` succeeds without `.git`.
5. `repo_toolbox.inspect_text_file` and bounded reads from `WC-V1-0202G` succeed without `.git`.
6. Canonical Markdown artifact write succeeds without `.git` when OAuth/write/path/evidence controls pass.
7. Canonical JSON artifact write succeeds without `.git` when permitted.
8. `repo_toolbox.status` succeeds and reports workspace capabilities without Git.
9. `diagnostics_toolbox.workspace_safety_status` succeeds without Git.
10. Deprecated `public_safety_status`, if retained, returns workspace safety rather than Git readiness.
11. `git_toolbox.status` on a non-Git workspace returns localized not-Git capability state.
12. `git_toolbox.diff` and history inspection fail or return unavailable only locally to those actions.
13. Git write actions remain denied for a non-Git workspace.
14. A failed Git action does not change subsequent repository/artifact capability results.
15. `list_workspaces` reports Revisionary-like workspace as valid and artifact-capable.
16. `write_access_status` reports Git absence as informational.
17. No general workspace operation emits `GIT_REQUIRED`.
18. `GIT_REQUIRED` or replacement capability code appears only for explicit Git/release operations.
19. Legacy `git_required` configuration loads without requiring Git for reads/artifact writes.
20. Legacy `artifact_only` configuration preserves artifact-root and Git-mutation restrictions.
21. New capability configuration loads deterministically.
22. Configuration migration does not rewrite files automatically.
23. Runtime diagnostics for a non-ChampCity target report alignment as `not_applicable`.
24. Runtime package version is not compared to an unrelated target package version.
25. Runtime source commit is not compared to an unrelated target Git HEAD.
26. When selecting `champcity_gpt`, service-repository alignment remains available and correctly labeled.
27. Existing Git-backed workspace workflows remain passing.
28. Existing release-specific Git requirements remain localized and documented.
29. Existing OAuth, write-mode, path, reparse/symlink, artifact, patch, trace, image, and redaction tests remain passing.
30. Public top-level tool count remains unchanged.
31. No test recommends initializing Git for a non-Git planning workflow.
32. No source path uses selected target workspace package mismatch as runtime drift unless the target is explicitly the ChampCity GPT service repository.

## Documentation Requirements

Update:

- `docs/TOOL_REFERENCE.md`
- `docs/SECURITY_MODEL.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `docs/RELEASE_NOTES.md`
- workspace configuration examples
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`

Documentation must state:

- a ChampCity workspace is an allowed project directory, not necessarily a Git repository;
- workspace IDs identify served projects and need not match the MCP service repository;
- `revisionary` is a correct example of a separate project workspace;
- Git capabilities are optional and isolated;
- artifact persistence does not require Git;
- general workspace safety does not imply source-control readiness;
- service runtime provenance and target project metadata are separate concepts;
- legacy policy names are compatibility inputs, not current authority semantics.

## Validation Requirements

Read `docs/dev/VALIDATION_COMMAND_LANES.md` before child-process-capable commands.

Run in order:

1. repository-defined typecheck;
2. focused workspace capability, non-Git fixture, diagnostics, public-safe facade, and runtime-provenance tests;
3. repository-defined build;
4. broader repository unit lane for all touched shared modules;
5. repository-defined MCP self-test;
6. `npm run check:public` if present;
7. lint;
8. `git diff --check`.

Do not use Playwright.
Do not package or promote.
Do not start, stop, or restart the active connector.
Do not reconnect ChatGPT.
Do not perform live connector validation under this implementation card.

## Builder Report Requirements

The Builder Report must include:

- repository identity and starting HEAD;
- starting/final dirty state;
- exact files changed;
- preservation of the unrelated `docs/CHATGPT_CONNECTION_GUIDE.md` modification and all other unrelated work;
- old workspace policy model and new capability model;
- legacy migration mapping;
- operation-class authority table;
- exact list of functions no longer requiring Git;
- `public_safety_status` compatibility disposition;
- `repo_toolbox.status` behavior change;
- service-runtime versus target-workspace diagnostic separation;
- non-Git fixture evidence;
- explicit proof that reads and artifact writes execute no Git commands;
- acceptance-test mapping;
- validation commands and results;
- validation not performed;
- blockers and assumptions;
- confirmation that existing Git workflows remain available for Git-backed workspaces;
- confirmation that nothing was staged, committed, pushed, integrated, packaged, promoted, restarted, reconnected, published, or released.

## Stop Conditions

Stop before or during implementation rather than improvising if:

- removing Git from general diagnostics would weaken allowed-root or path safety;
- legacy policy migration cannot preserve current artifact-only restrictions;
- runtime provenance cannot be separated from target workspace state without changing package/promotion contracts beyond this card;
- the only proposed fix is to initialize Git in Revisionary;
- the only proposed fix is to route Revisionary operations through `champcity_gpt` workspace ID;
- implementation would remove existing Git tools rather than isolate them;
- implementation requires rewriting user workspace configuration automatically;
- implementation conflicts with approved `WC-V1-0104B` or `WC-V1-0202G` contracts;
- a live connector is required for deterministic tests.

## Manual Validation After Codex

After Architect approval and separately authorized package/promotion/reconnect:

1. list configured workspaces and confirm Revisionary is valid without Git;
2. run general workspace status and safety diagnostics for Revisionary;
3. read the Revisionary Project Intake, Interview Prompt, and approved Architect Interview;
4. write a temporary approved Markdown draft through the authorized planning path;
5. confirm no `GIT_REQUIRED` appears in those operations;
6. call `git_toolbox.status` against Revisionary and confirm the failure is localized and non-destructive;
7. immediately repeat a file read and artifact write to prove the Git result did not poison the workspace;
8. select `champcity_gpt` and confirm service-runtime alignment remains available only there;
9. select Revisionary and confirm ChampCity GPT package/source versions are not compared to the target project.

These live steps are not authorized under this implementation card.

## Remaining Passes

After implementation:

- Architect review of the Builder Report;
- reconciliation with approved `WC-V1-0104B` and `WC-V1-0202G` results;
- separately authorized integration/commit if approved;
- separately authorized package and promotion;
- live Revisionary workflow validation;
- live safety false-positive canary matrix;
- final acceptance-matrix disposition.

## Document Disposition

Document.Status=ApprovedForImplementation
