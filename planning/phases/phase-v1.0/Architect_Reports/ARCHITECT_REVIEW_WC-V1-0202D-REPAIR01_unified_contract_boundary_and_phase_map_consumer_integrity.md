<!-- CHAMPCITY-METADATA
{
  "schemaVersion": 1,
  "artifactType": "architect-report",
  "artifactRevision": 1,
  "participationRole": "gatingReview",
  "identity": {
    "phaseId": "phase-v1.0",
    "workCardId": "WC-V1-0202D-REPAIR01",
    "repairId": "WC-V1-0202D-REPAIR01"
  },
  "sourceRevisions": [
    {
      "path": "planning/phases/phase-v1.0/Work_Cards/WC-V1-0202D-REPAIR01_phase_map_consumer_contract_and_metadata_integrity.md",
      "revision": 2
    },
    {
      "path": "planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202D-REPAIR01_phase_map_consumer_contract_and_metadata_integrity.md",
      "revision": 1
    }
  ],
  "workflowData": {
    "title": "Architect Review - WC-V1-0202D-REPAIR01 Unified Contract Boundary and Phase Map Consumer Integrity",
    "disposition": "RepairRequired",
    "repairWorkCardId": "WC-V1-0202D-REPAIR02",
    "packagingAuthorized": false
  },
  "documentDisposition": {
    "status": "RevisionRequested",
    "notes": "The internal hard replacement and Phase Map corrections are accepted, but Architect Interview reviewed-output idempotency is incorrect and the Builder Report overstates proof item 15.",
    "reviewedAt": "2026-07-30"
  }
}
CHAMPCITY-METADATA -->

# Architect Review — WC-V1-0202D-REPAIR01

## Disposition

`RepairRequired` before packaging.

## Accepted Implementation

The repair correctly completed the internal hard replacement:

- `submitHandoffOutputs.ts` imports neutral contract handlers rather than retired action-shaped engines.
- `src/tools/saveArchitectInterviewOutput.ts` and `src/tools/saveProjectPlanningOutputs.ts` are absent from the active source tree.
- Production source contains none of the retired function or schema identifiers.
- Architect Interview, Project Planning, and Phase Map are routed through `artifact_toolbox.submit_handoff_outputs`.
- No public compatibility action, alias, translated old call, generic writer fallback, or caller-path fallback was found.

The Phase Map corrections are also present:

- validated phases are persisted in `workflowData.phases`;
- the target is restricted to `planning/project/Phase_Map/PHASE_MAP_<project-slug>.md`;
- identical Pending content requires complete server-derived metadata equality before returning `already_saved`;
- alternate paths and stale metadata are rejected without modifying the target.

## Blocking Finding — Architect Interview Reviewed Output Is Misclassified as `already_saved`

In `src/tools/internal/handoffContracts/architectInterview.ts`, identical-body handling is:

```text
if existing.body === body
→ return already_saved
```

The branch does not require:

```text
existing.disposition === Pending
```

It also does not compare the complete existing metadata with the expected server-derived Pending metadata.

Consequences:

- an unchanged `Rejected` Architect Interview returns `already_saved`;
- an unchanged `RevisionRequested` Architect Interview returns `already_saved`;
- the response reports `disposition: Pending` even though the existing file remains Rejected or RevisionRequested;
- the required substantive-revision rule is bypassed;
- the caller can receive a false completion result.

The focused Architect Interview tests cover identical Pending retry but do not test unchanged Rejected or RevisionRequested content. The passing suite therefore does not prove the behavior claimed in proof item 15.

## Required Correction

For Architect Interview:

- `already_saved` is valid only for an exact Pending canonical document;
- identical Rejected or RevisionRequested content must fail without changing bytes or review state;
- a substantive reviewed-output revision must increment the artifact revision and reset disposition to Pending;
- complete expected Pending metadata equality must be required for identical-body idempotency;
- tests must exercise these paths through `artifact_toolbox.submit_handoff_outputs`.

## Independent Validation

```text
npm run typecheck: passed
npm test: 418/418 passed
build: passed
public safety: passed
release safety: passed
HEAD unchanged: 10fc3caa6fa063569f27072c14153b4fe7aab74b
```

These passing lanes omit the reviewed Architect Interview retry case described above.

## Packaging Decision

Do not package or promote until WC-V1-0202D-REPAIR02 is approved.

No Git operation was performed by this review.
