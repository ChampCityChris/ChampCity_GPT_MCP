<!-- CHAMPCITY-METADATA
{
  "schemaVersion": 1,
  "artifactType": "architect-report",
  "artifactRevision": 2,
  "participationRole": "gatingReview",
  "identity": {
    "phaseId": "phase-v1.0",
    "workCardId": "WC-V1-0202D"
  },
  "sourceRevisions": [
    {
      "path": "planning/phases/phase-v1.0/Work_Cards/WC-V1-0202D_unified_handoff_output_submission_action.md",
      "revision": 1
    },
    {
      "path": "planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202D_unified_handoff_output_submission_action.md",
      "revision": 1
    }
  ],
  "workflowData": {
    "title": "Architect Review - WC-V1-0202D Unified Handoff Output Submission Action",
    "disposition": "RepairRequired",
    "repairWorkCardId": "WC-V1-0202D-REPAIR01",
    "packagingAuthorized": false
  },
  "documentDisposition": {
    "status": "RevisionRequested",
    "notes": "The public action names were replaced, but the unified implementation boundary was not completed and the Phase Map persistence contract remains incompatible with ChampCity A/I. Repair is required before packaging.",
    "reviewedAt": "2026-07-30"
  }
}
CHAMPCITY-METADATA -->

# Architect Review — WC-V1-0202D Unified Handoff Output Submission Action

## Disposition

`RepairRequired` before packaging.

The implementation successfully removed the retired action names from public MCP policy and dispatch. Calls to the retired names fail as unsupported, and the deterministic validation lane is green.

The Work Card nevertheless was not completed as written. The Builder Report reported a completed hard replacement even though the unified registry still invokes the old action-shaped exported implementations.

## Blocking Finding 1 — Old Action-Shaped Implementations Remain the Real Execution Boundary

`src/tools/submitHandoffOutputs.ts` imports and calls:

```text
saveArchitectInterviewOutput
saveProjectPlanningOutputs
```

The corresponding production modules still export:

```text
saveArchitectInterviewOutput
SaveArchitectInterviewOutputParamsSchema
saveProjectPlanningOutputs
SaveProjectPlanningOutputsParamsSchema
```

The registry therefore removes the old public labels but delegates Architect Interview and Project Planning execution to the old action-shaped engines. This does not satisfy the Work Card requirement to remove or reduce those implementations to neutral internal contract components.

This is not a public compatibility fallback. It is incomplete hard-replacement work hidden behind the new dispatcher.

Required correction:

- make the unified handoff contract registry the actual production implementation boundary;
- extract neutral canonical evidence, validation, revision, transaction, and persistence helpers;
- implement Architect Interview, Project Planning, and Phase Map as neutral registry contract handlers;
- remove the old action-shaped exported functions and schemas from production source;
- delete the old modules or rename/restructure them so no production module or export represents a retired save action;
- prohibit the unified registry from importing a retired action-shaped implementation;
- test all three contracts through `artifact_toolbox.submit_handoff_outputs`;
- add absence tests for retired production identifiers and imports.

Renaming an import while leaving the same action-shaped module boundary is not sufficient.

## Blocking Finding 2 — Phase Map Metadata Is Not Readable by ChampCity A/I

The Phase Map body validator parses the `champcity-phase-map` block but discards the validated phase array. The installed metadata omits:

```text
workflowData.phases
```

ChampCity A/I reads the authoritative Phase Map domain from that field. A Phase Map saved by the current MCP implementation would therefore be classified as malformed.

Required correction:

- validation returns one normalized validated phase array;
- installed metadata persists that exact array as `workflowData.phases`;
- tests prove the resulting document satisfies the ChampCity A/I consumer contract.

## Blocking Finding 3 — Phase Map Target Policy Is Too Broad

The current implementation accepts any Markdown target under `planning/`. The actual canonical target family is:

```text
planning/project/Phase_Map/PHASE_MAP_<project-slug>.md
```

The server must derive the expected path from current project identity and require an exact match with the Approved handoff target.

## Blocking Finding 4 — Phase Map `already_saved` Equality Is Incomplete

An identical Pending body can return `already_saved` without verifying complete expected canonical metadata. Workflow data, notes, review timestamp, or other metadata can be wrong and still be accepted.

Required correction:

- compare the complete existing metadata with server-derived expected metadata using the existing revision;
- return `already_saved` only for exact body and metadata equality;
- otherwise fail without changing the target.

## Builder Report Integrity

The Builder Report statement that the hard replacement was complete is inaccurate. The repair report must explicitly state that the original implementation retained old internal action-shaped engines and that REPAIR01 removed them.

## Independent Validation

```text
npm run typecheck: passed
npm test: 395/395 passed
release checks: passed
public safety: passed
release safety: passed
HEAD unchanged: 10fc3caa6fa063569f27072c14153b4fe7aab74b
```

These passing lanes do not negate the implementation-boundary and cross-repository contract defects above.

## Packaging Decision

Do not package or promote until WC-V1-0202D-REPAIR01 is approved.

No Git operation was performed by this review.
