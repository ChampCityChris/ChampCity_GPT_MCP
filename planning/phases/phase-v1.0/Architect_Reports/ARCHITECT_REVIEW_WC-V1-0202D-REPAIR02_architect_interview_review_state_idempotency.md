<!-- CHAMPCITY-METADATA
{
  "schemaVersion": 1,
  "artifactType": "architect-report",
  "artifactRevision": 1,
  "participationRole": "gatingReview",
  "identity": {
    "phaseId": "phase-v1.0",
    "workCardId": "WC-V1-0202D-REPAIR02"
  },
  "sourceRevisions": [
    {
      "path": "planning/phases/phase-v1.0/Work_Cards/WC-V1-0202D-REPAIR02_architect_interview_review_state_idempotency.md",
      "revision": 1
    },
    {
      "path": "planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202D-REPAIR02_architect_interview_review_state_idempotency.md",
      "revision": 1
    }
  ],
  "workflowData": {
    "title": "Architect Review - WC-V1-0202D-REPAIR02 Architect Interview Review-State Idempotency",
    "disposition": "RepairRequired",
    "repairWorkCardId": "WC-V1-0202D-REPAIR03",
    "packagingAuthorized": false
  },
  "documentDisposition": {
    "status": "RevisionRequested",
    "notes": "The Architect Interview idempotency defect is corrected, but stale compiled retired modules remain in dist and would be packaged. A clean-build repair is required before packaging.",
    "reviewedAt": "2026-07-30"
  }
}
CHAMPCITY-METADATA -->

# Architect Review — WC-V1-0202D-REPAIR02 Architect Interview Review-State Idempotency

## Disposition

`RepairRequired` before packaging.

## Accepted REPAIR02 Behavior

The targeted Architect Interview defect is corrected:

- exact Pending content returns `already_saved` only when complete canonical metadata matches;
- identical Pending content with altered metadata fails without changing bytes;
- identical Rejected and RevisionRequested content fails and preserves review state;
- substantively revised reviewed content increments once and returns to Pending;
- Approved output remains non-overwritable;
- all acceptance paths execute through `artifact_toolbox.submit_handoff_outputs`;
- the retired source modules and identifiers remain absent from `src`;
- no wrapper, alias, compatibility adapter, or fallback was restored.

## Blocking Finding — Retired Compiled Modules Remain in the Package Input

After the independent build and release-validation lane, the built tree still contains:

```text
dist/src/tools/saveArchitectInterviewOutput.js
dist/src/tools/saveProjectPlanningOutputs.js
dist/tests/saveArchitectInterviewOutput.test.js
dist/tests/saveProjectPlanningOutputs.test.js
```

This is caused by the build running TypeScript compilation over the existing `dist` directory without cleaning obsolete outputs first.

The duplicate Architect Interview and Project Planning test-suite execution in the validation output is direct evidence that stale compiled tests remain active.

This is not limited to tests. `electron-builder.json` includes:

```text
dist/**/*
```

and explicitly unpacks:

```text
dist/src/**/*
```

Therefore the two retired production modules would be shipped in the packaged application even though their TypeScript sources were deleted. That violates the hard-replacement requirement and proof item 9 of REPAIR02.

## Required Correction

A production build must begin from a clean generated-output tree so deleted source modules cannot survive as packaged JavaScript.

The correction must:

- clean the generated `dist` tree before TypeScript and renderer compilation;
- apply to normal build, test, validation, and packaging entry points;
- leave no retired production or test module in `dist` after a build;
- eliminate duplicate stale test-suite execution;
- add release-safety proof that retired compiled modules are absent;
- avoid manual one-time deletion as the solution.

## Independent Validation

```text
typecheck: passed
build: passed
tests: 421/421 passed
public safety: passed
release safety: passed
HEAD unchanged: 10fc3caa6fa063569f27072c14153b4fe7aab74b
```

These lanes passed because the current build and release checks do not reject stale compiled outputs. The result is therefore not packaging-safe.

## Packaging Decision

Do not package or promote until WC-V1-0202D-REPAIR03 is approved.

No Git operation was performed by this review.
