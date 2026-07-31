<!-- CHAMPCITY-METADATA
{
  "schemaVersion": 1,
  "artifactType": "work-card",
  "artifactRevision": 1,
  "participationRole": "gatingReview",
  "identity": {
    "phaseId": "phase-v1.0",
    "workCardId": "WC-V1-0202D-REPAIR02",
    "repairId": "WC-V1-0202D-REPAIR02"
  },
  "sourceRevisions": [
    {
      "path": "planning/phases/phase-v1.0/Work_Cards/WC-V1-0202D-REPAIR01_phase_map_consumer_contract_and_metadata_integrity.md",
      "revision": 2
    },
    {
      "path": "planning/phases/phase-v1.0/Architect_Reports/ARCHITECT_REVIEW_WC-V1-0202D-REPAIR01_unified_contract_boundary_and_phase_map_consumer_integrity.md",
      "revision": 1
    }
  ],
  "workflowData": {
    "title": "Architect Interview Review-State Idempotency",
    "status": "approved_for_implementation",
    "parentWorkCardId": "WC-V1-0202D-REPAIR01",
    "rootWorkCardId": "WC-V1-0202D",
    "executionMode": "one concise MCP repair pass",
    "gitMutationAuthorized": false,
    "additionalRepairAuthorized": false,
    "builderReportPath": "planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202D-REPAIR02_architect_interview_review_state_idempotency.md"
  },
  "documentDisposition": {
    "status": "Approved",
    "notes": "Correct only Architect Interview reviewed-output idempotency and preserve the accepted unified boundary and Phase Map repairs.",
    "reviewedAt": "2026-07-30"
  }
}
CHAMPCITY-METADATA -->

# WC-V1-0202D-REPAIR02 — Architect Interview Review-State Idempotency

Status: Approved for Implementer execution  
Parent: `WC-V1-0202D-REPAIR01`  
Git mutation: prohibited  
Packaging: prohibited until Architect approval of this repair

## Objective

Correct one behavioral defect in the neutral Architect Interview contract:

- identical Rejected or RevisionRequested content must not return `already_saved` or report Pending.

## Required Behavior

For an existing Architect Interview target:

### Pending

Return `already_saved` only when:

- normalized body is identical;
- artifact type is `project-architect-interview`;
- participation role is `gatingReview`;
- artifact revision is the existing revision used for comparison;
- identity exactly matches current Intake and Prompt evidence;
- source revisions exactly match current Intake and Prompt;
- workflow data exactly matches the server-derived contract;
- disposition is exactly `Pending`;
- notes are empty;
- `reviewedAt` is null.

An identical Pending body with any metadata mismatch must fail without changing the file.

### Rejected or RevisionRequested

When the submitted body is unchanged:

- return `INVALID_INPUT` or the existing bounded reviewed-output error;
- preserve the exact existing bytes;
- preserve the existing disposition, notes, and review timestamp;
- do not return `saved` or `already_saved`;
- do not report `disposition: Pending`.

When the submitted body is substantively changed:

- increment artifact revision exactly once;
- derive canonical metadata from current evidence;
- reset disposition to `Pending` with empty notes and null `reviewedAt`;
- preserve all existing path, identity, source-association, race, rollback, and audit protections.

### Approved

Approved Architect Interview output remains non-overwritable.

## Preserve Accepted Implementation

Do not change:

- sole public action `artifact_toolbox.submit_handoff_outputs`;
- neutral contract-module boundary;
- deletion of retired action-shaped modules and identifiers;
- Project Planning behavior;
- Phase Map domain persistence, canonical target, or metadata equality;
- public action policy, old-action rejection, or no-fallback rules;
- workspace authority, non-Git persistence, path containment, symlink protection, evidence recheck, rollback, or audit redaction.

Do not restore any retired save action or compatibility path.

## Authorized Production Surface

```text
src/tools/internal/handoffContracts/architectInterview.ts
tests/submitHandoffOutputsArchitectInterview.test.ts
Builder Report
```

A neutral canonical metadata comparison helper may be reused or adjusted only when necessary. Do not broaden scope.

## Required Proof

Record each item as `Proven`, `OperatorValidationPending`, or `NotProven`.

1. Identical exact Pending Architect Interview returns `already_saved`.
2. Identical Pending body with altered metadata fails and leaves bytes unchanged.
3. Identical Rejected content fails and preserves exact bytes and review state.
4. Identical RevisionRequested content fails and preserves exact bytes and review state.
5. Substantively revised Rejected content increments revision once and returns Pending.
6. Substantively revised RevisionRequested content increments revision once and returns Pending.
7. Approved output remains non-overwritable.
8. All acceptance paths are exercised through `artifact_toolbox.submit_handoff_outputs`.
9. Retired action names and modules remain absent; no wrapper, alias, or fallback exists.
10. Project Planning and Phase Map focused tests remain green.
11. Typecheck, complete tests, public safety, and release safety pass.
12. Builder Report states the prior REPAIR01 omission plainly and does not claim acceptance beyond proof.

## Completion

Create the Builder Report only after proof items 1–11 pass.

Do not package, promote, restart, reconnect, stage, commit, or push in this repair.
