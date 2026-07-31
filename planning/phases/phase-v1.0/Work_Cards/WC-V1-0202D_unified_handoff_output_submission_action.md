<!-- CHAMPCITY-METADATA
{
  "schemaVersion": 1,
  "artifactType": "work-card",
  "artifactRevision": 1,
  "participationRole": "gatingReview",
  "identity": {
    "phaseId": "phase-v1.0",
    "workCardId": "WC-V1-0202D"
  },
  "sourceRevisions": [
    {
      "path": "planning/phases/phase-v1.0/Work_Cards/WC-V1-0202C_project_planning_bundle_submission_action.md",
      "revision": 2
    },
    {
      "path": "planning/phases/phase-v1.0/Work_Cards/WC-V1-0202C-REPAIR01_contract_identity_revision_submission_and_retry_integrity.md",
      "revision": 1
    }
  ],
  "workflowData": {
    "title": "Unified Handoff Output Submission Action",
    "status": "approved_for_implementation",
    "executionMode": "one bounded MCP replacement pass",
    "gitMutationAuthorized": false,
    "additionalRepairAuthorized": false,
    "builderReportPath": "planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202D_unified_handoff_output_submission_action.md"
  },
  "documentDisposition": {
    "status": "Approved",
    "notes": "Replace workflow-specific save actions with one handoff-bound canonical submission action. No compatibility wrappers or fallback behavior.",
    "reviewedAt": "2026-07-30"
  }
}
CHAMPCITY-METADATA -->

# WC-V1-0202D — Unified Handoff Output Submission Action

Status: Approved for Implementer execution  
Phase: phase-v1.0  
Git mutation: prohibited

## Objective

Create one public MCP workflow-output persistence action:

```text
artifact_toolbox.submit_handoff_outputs
```

It replaces, rather than supplements:

```text
artifact_toolbox.save_architect_interview_output
artifact_toolbox.save_project_planning_outputs
```

The new action must support these handoff kinds in this pass:

```text
architect-interview
project-planning
phase-map
```

Future workflow kinds must be added as internal contract-registry entries, not as new public save actions.

No dependency gate is encoded in this card. The Operator controls repository execution and promotion order.

## Public Invocation Contract

```json
{
  "action": "submit_handoff_outputs",
  "workspaceId": "<configured workspace ID>",
  "params": {
    "handoffKind": "architect-interview | project-planning | phase-map",
    "outputs": {
      "<contract-defined output slot>": "<complete substantive Markdown body>"
    }
  }
}
```

`handoffKind` is a selector only. It does not grant authority.

The caller must not supply:

- target paths;
- artifact types;
- identity;
- source revisions;
- artifact revisions;
- participation roles;
- disposition;
- canonical metadata;
- overwrite or force flags;
- migration or Git instructions.

Unknown params, output slots, handoff kinds, and metadata-like body fields must be rejected.

## Required Contract Registry

Implement one internal registry keyed by `handoffKind`. Each entry must define:

- qualifying current Approved handoff predicate;
- exact required output-slot names;
- exact target fields resolved from handoff workflow data;
- expected output artifact types and participation roles;
- source-association validation;
- identity derivation;
- required headings and/or domain blocks;
- single-file or atomic bundle behavior;
- revision rules;
- Pending-disposition rules;
- `saved` and `already_saved` equality rules;
- reviewed-output revision rules;
- audit classification.

Adding a future handoff kind must require only an internal registry entry and tests. It must not add another top-level or toolbox save action.

## Contract 1 — Architect Interview

Selector:

```text
handoffKind = architect-interview
```

Outputs:

```json
{
  "architectInterviewMarkdown": "<complete substantive Interview Markdown>"
}
```

Required behavior:

- resolve exactly one current Approved Architect Interview prompt/handoff authority;
- derive the exact Interview target and canonical identity from current source evidence;
- preserve the existing source-association and revision-integrity behavior;
- create or substantively revise one canonical Interview document;
- write `Pending` after a valid new or revised submission;
- identical current Pending content returns `already_saved`;
- identical Rejected or RevisionRequested content is rejected and does not clear review disposition;
- no caller-supplied path or metadata.

## Contract 2 — Project Planning

Selector:

```text
handoffKind = project-planning
```

Outputs:

```json
{
  "projectProfileMarkdown": "<complete Project Profile Markdown>",
  "projectRoadmapMarkdown": "<complete Project Roadmap Markdown>"
}
```

Required behavior:

- preserve all accepted WC-V1-0202C and REPAIR01 protections;
- resolve exactly one current Approved `project-planning-output-submission-v1` handoff;
- validate Intake → Prompt → Interview → Handoff association;
- derive Profile and Roadmap targets and metadata exclusively from canonical evidence;
- require both bodies in one call;
- write atomically as a pair;
- roll back both files on any failure;
- preserve complete metadata equality for `already_saved`;
- require substantive revision before clearing Rejected or RevisionRequested status;
- increment only changed document bodies;
- return both documents to Pending after a valid bundle revision.

## Contract 3 — Phase Map

Selector:

```text
handoffKind = phase-map
```

Outputs:

```json
{
  "phaseMapMarkdown": "<complete Phase Map Markdown>"
}
```

Required handoff authority:

- exactly one current Approved `generated-handoff` with `handoffKind: phase-map`;
- stable Phase Map submission contract identifier;
- current Approved Project Profile source revision;
- current Approved Project Roadmap source revision;
- exact Phase Map output target;
- current project identity;
- required title and domain-block rules.

Required output validation:

- exact `# Phase Map` heading;
- exactly one `champcity-phase-map` fenced JSON block;
- non-empty phase array;
- each phase has `phaseId`, `title`, integer `order`, `purpose`, `dependsOn`, and `sourceReferences`;
- unique phase IDs and orders;
- dependency references resolve to phase IDs in the same map;
- no self-dependency or dependency cycles;
- no persisted completion fields;
- source references are repository-relative strings;
- body contains no canonical metadata delimiters or caller-authored authority fields.

Required persistence behavior:

- derive target, identity, source revisions, artifact type `phase-map`, role `gatingReview`, revision, and Pending disposition from the handoff;
- identical current Pending content returns `already_saved`;
- Approved output is not overwritten;
- identical Rejected or RevisionRequested content is rejected;
- a substantive revision increments the Phase Map artifact revision and returns it to Pending;
- evidence is rechecked immediately before install;
- failure leaves the existing target unchanged and removes temporary files.

## Hard Replacement Requirements

Remove these actions from the active MCP interface:

```text
save_architect_interview_output
save_project_planning_outputs
```

Required removal surface:

- `SUPPORTED_ARTIFACT_ACTIONS`;
- toolbox dispatch branches;
- exported active schemas and action-specific entry modules when no longer internally required;
- MCP tool inventory and self-test required-action lists;
- active capability documentation and current examples;
- current production tests that invoke the retired action names.

Do not retain wrappers, aliases, compatibility dispatch, deprecated action routing, or automatic translation from old calls.

An old action call must return unsupported/invalid action. It must never invoke the new engine.

## No Fallback Rule

The following are prohibited:

```text
submit_handoff_outputs fails
→ call an old save action
```

```text
submit_handoff_outputs fails
→ call write_markdown_artifact
```

```text
submit_handoff_outputs fails
→ accept caller path or canonical metadata
```

When the new action fails:

- return the exact bounded failure;
- make no file change;
- leave workflow incomplete;
- write only redacted audit information allowed by current policy.

## Security and Authority Requirements

Preserve or strengthen:

- configured workspace resolution;
- workspace write authority;
- path containment;
- Markdown-only target policy;
- symlink/reparse-point rejection;
- canonical parser and serializer reuse;
- input-size limits;
- unknown-key rejection;
- metadata delimiter rejection;
- atomic installation where required;
- evidence recheck before install;
- rollback and temporary-file cleanup;
- redacted audit logging;
- no Git requirement for canonical artifact persistence.

The general action must not become an arbitrary file writer.

## Authorized Production Surface

Expected changes are limited to:

```text
src/tools/domainToolboxes.ts
src/tools/submitHandoffOutputs.ts                  [new]
src/tools/internal handoff contract modules        [new or extracted]
src/tools/saveArchitectInterviewOutput.ts          [remove or reduce to non-exported shared internals only]
src/tools/saveProjectPlanningOutputs.ts            [remove or reduce to non-exported shared internals only]
src/validation/chatgptEvidence.ts
src/validation/mcpSelfTest.ts
current active documentation/capability declarations
focused tests
```

Internal canonical parsing/serialization helpers may be extracted into a neutral shared module. Do not duplicate them per contract.

## Non-Scope

Do not:

- add Phase Interview or Phase Planning registry entries in this card;
- accept arbitrary output slot names;
- accept caller-supplied paths or metadata;
- retain retired save-action compatibility;
- change repository-write tools;
- change Git tools or release behavior;
- add dependencies;
- perform Git operations;
- promote, package, restart, or reconnect the MCP server.

## Required Proof

Record each item as `Proven`, `OperatorValidationPending`, or `NotProven`.

1. `submit_handoff_outputs` is registered under `artifact_toolbox`.
2. Only the three authorized handoff kinds are accepted.
3. Output slots are strict and contract-specific.
4. Architect Interview create, idempotent retry, substantive revision, and unchanged reviewed-output rejection pass.
5. Project Planning atomic save, rollback, idempotency, one-document revision, and unchanged reviewed-bundle rejection pass.
6. Phase Map create, idempotent retry, substantive revision, and unchanged reviewed-output rejection pass.
7. Phase Map schema rejects malformed blocks, duplicate IDs/orders, unknown dependencies, cycles, completion fields, and unsafe references.
8. All targets, metadata, identity, source revisions, roles, revisions, and Pending status are server-derived.
9. Evidence changes before install fail without changing targets.
10. Old action names are absent from active production action inventory and dispatch.
11. Calls to old actions fail and do not route to the new action.
12. No compatibility wrapper, generic writer fallback, or caller-path fallback exists.
13. Public-safety, MCP registration, and release-safety checks pass.
14. `npm run typecheck` and the complete approved test lane pass.
15. Builder Report accurately distinguishes deterministic proof from later live ChampCity A/I integration.

## Completion

Create the Builder Report only after proof items 1–14 pass. Live application calls are integration evidence and may remain outside this Builder Report.

No Git operation, package, promotion, restart, or reconnect is authorized.
