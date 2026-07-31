<!-- CHAMPCITY-METADATA
{
  "schemaVersion": 1,
  "artifactType": "work-card",
  "artifactRevision": 2,
  "participationRole": "gatingReview",
  "identity": {
    "phaseId": "phase-v1.0",
    "workCardId": "WC-V1-0202D-REPAIR01",
    "repairId": "WC-V1-0202D-REPAIR01"
  },
  "sourceRevisions": [
    {
      "path": "planning/phases/phase-v1.0/Work_Cards/WC-V1-0202D_unified_handoff_output_submission_action.md",
      "revision": 1
    },
    {
      "path": "planning/phases/phase-v1.0/Architect_Reports/ARCHITECT_REVIEW_WC-V1-0202D_unified_handoff_output_submission_action.md",
      "revision": 2
    }
  ],
  "workflowData": {
    "title": "Unified Contract Boundary and Phase Map Consumer Integrity",
    "status": "approved_for_implementation",
    "parentWorkCardId": "WC-V1-0202D",
    "executionMode": "one bounded MCP repair pass",
    "gitMutationAuthorized": false,
    "additionalRepairAuthorized": false,
    "builderReportPath": "planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202D-REPAIR01_phase_map_consumer_contract_and_metadata_integrity.md"
  },
  "documentDisposition": {
    "status": "Approved",
    "notes": "Complete the actual unified internal replacement and correct the Phase Map consumer contract. Public-name removal alone is not acceptance.",
    "reviewedAt": "2026-07-30"
  }
}
CHAMPCITY-METADATA -->

# WC-V1-0202D-REPAIR01 — Unified Contract Boundary and Phase Map Consumer Integrity

Status: Approved for Implementer execution  
Parent: `WC-V1-0202D`  
Git mutation: prohibited  
Packaging: prohibited until Architect approval of this repair

## Objective

Correct four defects:

1. remove the old action-shaped Architect Interview and Project Planning implementation boundary;
2. persist the validated Phase Map domain where ChampCity A/I reads it;
3. constrain Phase Map output to the canonical target family;
4. require complete canonical metadata equality for Phase Map `already_saved`.

## Required Change 1 — Complete the Internal Hard Replacement

The unified registry must be the real production implementation boundary.

The following production pattern is prohibited:

```text
submit_handoff_outputs registry
→ saveArchitectInterviewOutput(...)
→ saveProjectPlanningOutputs(...)
```

Required result:

- Architect Interview, Project Planning, and Phase Map are implemented as neutral handoff-contract handlers registered under `submit_handoff_outputs`;
- shared parsing, evidence resolution, revision, transaction, rollback, hashing, and canonical serialization are extracted into neutral internal helpers where useful;
- production source contains no exported action-shaped implementation named:

```text
saveArchitectInterviewOutput
SaveArchitectInterviewOutputParamsSchema
saveProjectPlanningOutputs
SaveProjectPlanningOutputsParamsSchema
```

- `submitHandoffOutputs.ts` does not import or call those retired implementation names;
- old modules are deleted or restructured into neutral internal modules that do not represent a retired save action;
- no alias, wrapper, compatibility adapter, fallback dispatcher, or translated old call remains;
- all three contract behaviors are exercised through `artifact_toolbox.submit_handoff_outputs`.

Merely renaming the functions while preserving the same old action-shaped module boundary is not sufficient.

## Required Change 2 — Persist the Validated Phase Map Domain

Phase Map validation must return one normalized phase array.

Installed canonical metadata must include:

```json
{
  "workflowData": {
    "contractId": "phase-map-output-submission-v1",
    "requiredTitle": "Phase Map",
    "requiredDomainBlocks": ["champcity-phase-map"],
    "phases": ["<complete normalized validated phase objects>"]
  }
}
```

Each phase contains only:

```text
phaseId
title
order
purpose
dependsOn
sourceReferences
```

The metadata phase array must exactly match the validated domain block. Do not parse one representation for validation and independently reconstruct another for persistence.

## Required Change 3 — Enforce the Canonical Phase Map Target

The Approved handoff target is accepted only when it exactly matches the server-derived path:

```text
planning/project/Phase_Map/PHASE_MAP_<project-slug>.md
```

Requirements:

- derive `<project-slug>` from the merged current Approved Project Profile and Project Roadmap identity;
- require the handoff target to equal the derived target;
- reject alternate `planning/` directories, alternate filenames, absolute paths, traversal, symlink, and reparse-point paths;
- update fixtures to use the target family produced by ChampCity A/I;
- never accept caller-supplied paths.

## Required Change 4 — Complete Phase Map `already_saved` Equality

Return `already_saved` only when the normalized body and complete canonical metadata exactly match the server-derived Pending document using the existing artifact revision.

The comparison includes:

- artifact type `phase-map`;
- role `gatingReview`;
- artifact revision;
- identity;
- Profile, Roadmap, and Handoff source revisions;
- complete workflow data, including `phases`;
- disposition `Pending`;
- empty notes;
- null `reviewedAt`.

Any metadata mismatch must fail without modifying the target. Do not silently repair metadata during an identical-body retry.

## Preserve Accepted Behavior

Preserve:

- sole public action `artifact_toolbox.submit_handoff_outputs`;
- exactly three supported handoff kinds;
- strict contract-specific output slots;
- current Architect Interview and Project Planning behavioral protections;
- old public action names remaining unsupported;
- no generic writer fallback or caller-authority fallback;
- workspace authority, path containment, symlink protection, evidence recheck, rollback, audit redaction, and non-Git artifact persistence.

## Authorized Production Surface

Expected changes may include:

```text
src/tools/submitHandoffOutputs.ts
src/tools/saveArchitectInterviewOutput.ts                 [delete or neutralize]
src/tools/saveProjectPlanningOutputs.ts                    [delete or neutralize]
src/tools/internal/handoffContracts/*                      [new neutral modules]
src/tools/internal/canonicalSubmission/*                   [new neutral helpers]
tests/saveArchitectInterviewOutput.test.ts                 [rename or replace]
tests/saveProjectPlanningOutputs.test.ts                   [rename or replace]
tests/submitHandoffOutputsPhaseMap.test.ts
focused absence/registry tests
Builder Report
```

Do not alter unrelated MCP, Git, release, browser, or repository-write behavior.

## Required Proof

Record each item as `Proven`, `OperatorValidationPending`, or `NotProven`.

1. `submit_handoff_outputs` remains the sole public workflow-output submission action.
2. Old public action calls remain unsupported and do not translate to the unified action.
3. Production registry code does not import or call `saveArchitectInterviewOutput` or `saveProjectPlanningOutputs`.
4. Production source exports none of the four retired action-shaped function/schema names.
5. Architect Interview behavior passes through the unified registry boundary.
6. Project Planning behavior passes through the unified registry boundary.
7. Phase Map behavior passes through the unified registry boundary.
8. No wrapper, alias, compatibility adapter, generic writer fallback, or caller-path fallback exists.
9. Installed Phase Map metadata contains the complete normalized `workflowData.phases` array.
10. MCP-produced Phase Map satisfies the current ChampCity A/I consumer contract.
11. Only `planning/project/Phase_Map/PHASE_MAP_<project-slug>.md` is accepted.
12. Alternate paths are rejected without writes.
13. Exact body and complete Pending metadata equality returns `already_saved`.
14. Metadata mismatch leaves existing bytes unchanged and does not return `already_saved`.
15. Create, revision, reviewed-output rejection, Approved-output protection, evidence-race rejection, rollback, and cleanup pass for all applicable contracts.
16. Typecheck, complete tests, public safety, and release safety pass.
17. The repair Builder Report states plainly that WC-V1-0202D retained old internal action-shaped engines and that this repair removed them.

## Completion

Create the repair Builder Report only after proof items 1–16 pass.

Do not package, promote, restart, reconnect, stage, commit, or push in this repair.
