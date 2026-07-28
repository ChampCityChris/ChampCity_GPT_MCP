# WC-V1-0202B-REPAIR01 — Canonical Markdown Alignment and Git Authority Removal

## Identity

- Parent: `WC-V1-0202B`
- Repository: `%USERPROFILE%\Projects\ChampCity_GPT`
- Branch: `dev`
- Execution: one continuous bounded task
- Git mutation: prohibited
- Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202B-REPAIR01_canonical_markdown_alignment_and_git_authority_removal.md`

## Failure Evidence

A live call to:

`artifact_toolbox.save_architect_interview_output`

for workspace `revisionary` failed with:

`Expected exactly one current Approved Project Intake. count: 0`

The workspace contains the required current evidence as canonical Markdown:

- `planning/project/Project_Intake/PROJECT_INTAKE_revisionary.md`
- `planning/project/Project_Architect_Interview_Prompts/PROJECT_ARCHITECT_INTERVIEW_PROMPT_revisionary.md`

The action incorrectly searches for `.json` evidence and serializes the obsolete field-based Markdown format.

The same workspace is also denied artifact persistence because it is configured `git_required` and is not a Git repository. Git is not artifact or workflow authority.

## Objective

Make `artifact_toolbox.save_architect_interview_output` consume and create the current ChampCity canonical Markdown protocol, and remove Git detection as an authorization gate for artifact persistence.

## Exact Changes

### 1. Use canonical Markdown evidence

Primary file:

- `src/tools/saveArchitectInterviewOutput.ts`

Read current protocol reference through ChampCity MCP before editing:

- ChampCity_AI `src/shared/documents/canonicalMarkdown.ts`

The action must:

- discover `.md` files only in the exact Intake and Prompt directories;
- require the file to begin with `<!-- CHAMPCITY-METADATA`;
- parse the JSON metadata between the canonical delimiters;
- validate the complete metadata object;
- preserve the Markdown body separately;
- ignore unmanaged or historical Markdown;
- stop reading legacy JSON siblings.

Resolve exactly one current Approved Intake with:

- `artifactType=project-intake`;
- readable canonical metadata;
- nonhistorical participation role;
- positive artifact revision;
- `documentDisposition.status=Approved`.

Resolve exactly one current Approved Prompt with:

- `artifactType=project-architect-interview-prompt`;
- `participationRole=nonReviewHandoff`;
- exact Intake path and revision in `sourceRevisions`;
- `workflowData.architectOutputTargets.markdown`.

### 2. Write the current canonical Interview

The target remains application-derived from the Prompt and must stay under:

`planning/project/Project_Architect_Interviews/`

Serialize the Interview using the canonical metadata comment envelope, not field lines.

Required metadata:

- `schemaVersion: 1`
- `artifactType: project-architect-interview`
- `artifactRevision: 1` for first save, otherwise existing revision plus one
- `participationRole: gatingReview`
- `identity`: derived from current Intake and Prompt metadata identity
- `sourceRevisions`: exact current Intake and Prompt paths and revisions
- `workflowData: {}`
- `documentDisposition.status: Pending`
- `documentDisposition.notes: ""`
- `documentDisposition.reviewedAt: null`

The caller supplies only `markdownBody` through the existing toolbox action.

Existing behavior remains:

- identical current Pending content returns `already_saved` without rewriting;
- changed nonapproved content increments revision exactly once;
- Approved output cannot be overwritten;
- malformed, stale, or identity-mismatched output cannot be overwritten;
- no JSON sibling is created;
- installation is atomic and verified with the same canonical parser.

Delete obsolete field-based parsing and serialization from this action. Do not preserve dual-format compatibility.

### 3. Remove Git as artifact-persistence authority

Primary files:

- `src/workspaceAuthority.ts`
- `src/workspaces.ts`

Required rule:

> Artifact persistence authority derives from configured workspace membership, allowed-root containment, OAuth scope, local write mode, operation-specific path policy, and canonical evidence. Git state never authorizes or denies artifact or workflow persistence.

For operation `artifact_persistence`:

- do not require `.git`;
- do not require `gitDetected=true`;
- do not return `GIT_REQUIRED` because a workspace is not a Git repository;
- retain configured artifact-root restrictions for `artifact_only` workspaces;
- retain all allowed-root, traversal, symlink, reparse-point, file-type, write-mode, and OAuth controls.

For explicit Git operations only:

- Git detection may remain a technical prerequisite for executing the requested Git command;
- Git status, branches, commits, and repository state remain non-authoritative for application artifacts and workflow progression.

Do not rename persisted workspace-policy values or add a configuration migration in this repair.

Update workspace diagnostics so Revisionary reports artifact persistence available even when `gitDetected=false`. The reason must not describe Git as artifact authority.

## Non-Scope

Do not:

- add a new top-level MCP tool;
- change the `artifact_toolbox` public schema;
- change OAuth, PKCE, HTTP transport, Cloudflare, or connector discovery;
- modify ChampCity_AI source or prompts;
- add JSON sidecars or legacy compatibility readers;
- introduce Git into Revisionary;
- initialize a Git repository;
- perform Git mutation;
- package, promote, restart, or reconnect the runtime.

## Required Evidence

Record each item as `Proven` or `NotProven`:

1. Current canonical `.md` Intake is resolved without a JSON sibling.
2. Current canonical `.md` Prompt is resolved without a JSON sibling.
3. Saved Interview begins with the canonical metadata delimiter.
4. Saved metadata matches the current ChampCity canonical contract.
5. Saved body exactly preserves submitted substantive Markdown after newline normalization.
6. No obsolete field-based envelope or JSON sibling is produced.
7. Revisionary permits artifact persistence with `gitDetected=false`.
8. Git remains gated only for explicit Git operations.
9. Retry, revision, Approved-target refusal, atomic verification, and rollback work.
10. The live Revisionary save action succeeds and returns a Pending Interview path.

Any `NotProven` item means the repair is incomplete. Continue correcting this same Work Card; do not create another repair.

## Deterministic Validation

Add or update focused tests for:

- canonical Markdown parsing and serialization;
- `.md` Intake and Prompt resolution;
- unmanaged, malformed, duplicate, stale, and historical evidence rejection;
- identity and source-revision derivation;
- first save, retry, revision, and Approved-target refusal;
- no JSON sibling;
- verification rollback;
- non-Git configured workspace artifact persistence;
- Git mutation denial for a non-Git workspace;
- diagnostics reporting artifact persistence independently of Git;
- unchanged toolbox action discovery and action-level scope enforcement.

Use the approved Windows validation lane and run:

- `npm run typecheck`
- `npm run validate:codex:unit`
- `npm run mcp:self-test`
- `npm run check:public`

Tests are supporting evidence. The live action is acceptance evidence.

## Running Acceptance

After deterministic validation, use the configured `revisionary` workspace and call:

```text
artifact_toolbox
  action: save_architect_interview_output
  workspaceId: revisionary
  params.markdownBody: complete substantive Revisionary Architect Interview
```

Prove:

- the action returns `saved`;
- the target is `planning/project/Project_Architect_Interviews/PROJECT_ARCHITECT_INTERVIEW_revisionary.md`;
- disposition is `Pending`;
- the file is readable by current ChampCity_AI canonical Markdown parsing;
- the complete body is present;
- no JSON sibling exists;
- a repeated identical call returns `already_saved` without increasing revision.

Do not substitute a fixture-only result for this live workspace call.

## Builder Report

Create the required Builder Report only after all ten evidence items are Proven.

Include:

- exact files changed;
- exact protocol defect removed;
- exact Git-authority defect removed;
- validation commands and execution lanes;
- live Revisionary call result;
- resulting relative path, revision, disposition, size, and hash;
- confirmation no JSON sibling exists;
- confirmation no Git operation occurred;
- remaining Operator validation;
- `No fallback implementation was used.`

## Manual Validation After Codex

The Operator will open Revisionary in ChampCity_AI and confirm the new Pending Architect Interview appears, is fully readable, and has usable disposition controls.

## Completion

This repair is complete only when the live Revisionary call succeeds through the existing artifact toolbox action and ChampCity_AI can read the resulting canonical Interview.
