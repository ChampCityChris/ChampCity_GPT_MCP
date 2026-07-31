# WC-V1-0202C-REPAIR01 — Contract Identity, Revision Submission, and Retry Integrity

Status: Approved for Implementer execution  
Parent: `WC-V1-0202C`  
Repository: `%USERPROFILE%\Projects\ChampCity_GPT`  
Remote: `ChampCityChris/ChampCity_GPT_MCP`  
Expected branch: `dev`  
Git mutation: prohibited  
Required Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202C-REPAIR01_contract_identity_revision_submission_and_retry_integrity.md`

This repair is the controlling instruction for defects found during Architect review of WC-V1-0202C. The parent Work Card remains unchanged. Do not reopen or rewrite the parent card.

## Objective

Correct four bounded contract defects in `artifact_toolbox.save_project_planning_outputs`:

1. Project Profile and Roadmap identity incorrectly includes handoff-only identity fields.
2. An unchanged rejected or revision-requested bundle can be rewritten as Pending without a substantive revision.
3. `already_saved` does not verify all application-owned workflow data.
4. The handoff/source association and reconciliation contract are not fully validated.

No other MCP architecture is reopened.

## Defect 1 — Output Identity Includes Handoff Identity

### Current failure

The action merges identity from Intake, Prompt, Interview, and the Project Planning handoff.

The actual ChampCity A/I handoff uses an identity such as:

```text
handoffKind=project-planning
```

That is handoff identity, not Project Profile or Project Roadmap identity.

### Required correction

Derive output identity only from the verified:

- Project Intake;
- Architect Interview Prompt;
- Project Architect Interview.

The three source identities must be mutually compatible. Conflicts fail before writing.

Do not copy handoff-only identity fields into either output.

The handoff remains a source revision and contract authority, but not an output-identity source.

## Defect 2 — Review Disposition Can Be Cleared Without Revision

### Authority boundary

ChampCity A/I owns Operator review actions and writes:

```text
Approved
Rejected
RevisionRequested
```

The MCP action owns canonical persistence when ChatGPT submits new or revised Profile and Roadmap bodies.

The MCP action may set both outputs to `Pending` only when the submission contains a substantive bundle revision. It may not erase an A/I review disposition merely because the same bodies were submitted again.

### Current failure

When existing outputs are `Rejected` or `RevisionRequested`, identical submitted bodies do not qualify for `already_saved`. The action proceeds to rebuild canonical metadata with `Document.Status=Pending`, even though no body changed.

### Required correction

Apply these rules:

```text
Existing Pending pair + identical bodies + identical authority
→ already_saved; no bytes or revisions change

Existing Rejected or RevisionRequested pair + both bodies identical
→ reject as no substantive revision; preserve both files byte-for-byte

Existing Rejected or RevisionRequested pair + at least one body changed
→ accept as a substantive bundle revision
→ both outputs return to Pending
→ only each document whose body changed increments artifactRevision
→ unchanged companion retains its artifactRevision

Existing Approved target
→ block the entire pair
```

Do not add a caller-controlled disposition field.

Do not move Operator review authority into ChampCity_GPT.

## Defect 3 — `already_saved` Ignores Workflow Data

### Current failure

The retry check verifies bodies, identity, source revisions, and Pending status but does not verify the derived output `workflowData`.

A pair with stale or incorrect reconciliation metadata can therefore be reported as `already_saved`.

### Required correction

`already_saved` requires exact equality for both outputs across:

- normalized body;
- artifact type;
- participation role;
- identity;
- source revisions;
- application-owned workflow data;
- Pending disposition with blank notes and null reviewedAt.

If bodies are identical but canonical authority metadata differs, do not return `already_saved`. Rewrite only when the existing target is otherwise compatible and the rewrite is authorized by the rules above; otherwise fail without changing either file.

## Defect 4 — Incomplete Handoff and Source Validation

The action must verify the complete association chain:

```text
Prompt sourceRevisions
→ exact current Intake revision

Interview sourceRevisions
→ exact current Intake revision
→ exact current Prompt revision

Project Planning handoff sourceRevisions
→ exact current Intake revision
→ exact current Prompt revision
→ exact current Interview revision
```

Reject unrelated sources even when artifact types and revisions happen to match.

Enforce reconciliation consistency:

```text
greenfield
→ repositoryReviewRequired=false

reconciliation-required
→ repositoryReviewRequired=true

needs-attention
→ save refused
```

Normalize `legacyPlanningPaths` and `sourceEvidencePaths` by:

- rejecting unsafe paths;
- removing duplicates;
- preserving first-occurrence order.

The normalized values become the canonical output workflow data.

## Authorized Production Surface

Production changes are limited to:

```text
src/tools/saveProjectPlanningOutputs.ts
```

Test changes are limited to:

```text
tests/saveProjectPlanningOutputs.test.ts
```

Create the required Builder Report.

No change to `saveArchitectInterviewOutput.ts`, toolbox registration, OAuth, audit schema, transport, runtime, packaging, ChampCity_AI, or the shared contract is authorized unless a concrete compile failure directly caused by this repair requires a minimal import-only correction.

## Explicit Non-Scope

Do not:

- edit or replace WC-V1-0202C;
- modify ChampCity A/I;
- change the approved submission contract;
- add a new public tool or action;
- add caller-controlled identity, path, source revision, role, revision, workflow data, or disposition fields;
- change Operator bundle-review behavior;
- add open-ended prose-quality evaluation;
- add dependencies;
- package, promote, restart, reconnect, stage, commit, push, merge, reset, clean, stash, tag, or publish.

## Required Proof

Record each item as `DeterministicallyProven`, `OperatorValidationPending`, or `NotProven`.

1. Output identity is derived from Intake, Prompt, and Interview only; handoff-only identity fields are absent.
2. Conflicting Intake, Prompt, or Interview identity fails without writes.
3. Prompt-to-Intake and Interview-to-Intake/Prompt associations are exact and unrelated evidence fails.
4. Reconciliation mode and `repositoryReviewRequired` consistency is enforced.
5. Legacy and source-evidence path arrays are safely normalized and deduplicated in first-occurrence order.
6. Pending identical complete pair returns `already_saved` only when workflow data and all canonical authority fields also match.
7. RevisionRequested identical pair is rejected and preserved byte-for-byte.
8. Rejected identical pair is rejected and preserved byte-for-byte.
9. A substantive revision to one document returns both outputs to Pending, increments only the changed document revision, and preserves the unchanged companion revision.
10. A substantive revision to both documents increments each exactly once and returns both to Pending.
11. Approved or incompatible target still blocks the entire pair.
12. Atomic rollback, evidence-race protection, result redaction, audit redaction, non-Git persistence, and existing Architect Interview save behavior remain passing.
13. `npm run typecheck`, `npm run validate:codex:unit`, `npm run mcp:self-test`, and `npm run check:public` pass in approved lanes.
14. Live greenfield and existing-project calls remain `OperatorValidationPending` for WC27.

Any deterministic `NotProven` item remains inside WC-V1-0202C-REPAIR01. Do not create REPAIR02 merely to move ordinary corrections.

## Builder Report

Create the Builder Report only after proof items 1–13 pass.

It must include:

- repository, branch, remote, HEAD, and dirty-tree inventories;
- exact files changed;
- corrected identity derivation;
- exact disposition/revision-submission state table;
- complete retry equality contract;
- source-association and reconciliation validation;
- path deduplication behavior;
- all proof results;
- validation commands and lanes;
- confirmation that ChampCity_AI and the shared contract were not modified;
- confirmation that no Git operation occurred;
- exact sentence: `No fallback implementation was used.`
