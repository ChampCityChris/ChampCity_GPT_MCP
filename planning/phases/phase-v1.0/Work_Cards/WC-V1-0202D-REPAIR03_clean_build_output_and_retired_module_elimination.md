<!-- CHAMPCITY-METADATA
{
  "schemaVersion": 1,
  "artifactType": "work-card",
  "artifactRevision": 1,
  "participationRole": "gatingReview",
  "identity": {
    "phaseId": "phase-v1.0",
    "workCardId": "WC-V1-0202D-REPAIR03",
    "repairId": "WC-V1-0202D-REPAIR03"
  },
  "sourceRevisions": [
    {
      "path": "planning/phases/phase-v1.0/Work_Cards/WC-V1-0202D-REPAIR02_architect_interview_review_state_idempotency.md",
      "revision": 1
    },
    {
      "path": "planning/phases/phase-v1.0/Architect_Reports/ARCHITECT_REVIEW_WC-V1-0202D-REPAIR02_architect_interview_review_state_idempotency.md",
      "revision": 1
    }
  ],
  "workflowData": {
    "title": "Clean Build Output and Retired Module Elimination",
    "status": "approved_for_implementation",
    "parentWorkCardId": "WC-V1-0202D-REPAIR02",
    "rootWorkCardId": "WC-V1-0202D",
    "executionMode": "one concise build-integrity repair pass",
    "gitMutationAuthorized": false,
    "additionalRepairAuthorized": false,
    "builderReportPath": "planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202D-REPAIR03_clean_build_output_and_retired_module_elimination.md"
  },
  "documentDisposition": {
    "status": "Approved",
    "notes": "Ensure every build starts from a clean generated-output tree so deleted retired modules cannot remain active or be packaged.",
    "reviewedAt": "2026-07-30"
  }
}
CHAMPCITY-METADATA -->

# WC-V1-0202D-REPAIR03 — Clean Build Output and Retired Module Elimination

Status: Approved for Implementer execution  
Parent: `WC-V1-0202D-REPAIR02`  
Git mutation: prohibited  
Packaging: prohibited until Architect approval of this repair

## Objective

Correct one build-integrity defect:

- obsolete compiled JavaScript remains in `dist` after its TypeScript source is deleted, allowing retired implementation modules and stale tests to remain active and enter package input.

## Current Verified Failure

The current built tree contains:

```text
dist/src/tools/saveArchitectInterviewOutput.js
dist/src/tools/saveProjectPlanningOutputs.js
dist/tests/saveArchitectInterviewOutput.test.js
dist/tests/saveProjectPlanningOutputs.test.js
```

The current test lane executes stale and current Architect Interview and Project Planning suites because `dist/tests` is not cleaned before compilation.

`electron-builder.json` packages `dist/**/*` and unpacks `dist/src/**/*`, so stale retired production modules would be shipped.

## Required Change 1 — Clean Generated Output Before Build

Every production build must begin with a clean generated-output tree.

Required behavior:

- remove the complete generated `dist` directory before TypeScript compilation;
- rebuild all required MCP, Electron, renderer, and test outputs from current source;
- use a repository-owned cross-platform script or equivalent deterministic implementation;
- fail clearly if the generated tree cannot be removed;
- do not silently continue with a partially cleaned tree.

The clean step must be part of the actual shared build path used by:

```text
npm run build
npm test
validate:codex:unit
validate:codex:build
packaging
```

Do not rely on the Operator or Implementer manually deleting `dist` before individual commands.

## Required Change 2 — Retired Output Absence

After a successful build, these paths must not exist:

```text
dist/src/tools/saveArchitectInterviewOutput.js
dist/src/tools/saveProjectPlanningOutputs.js
dist/tests/saveArchitectInterviewOutput.test.js
dist/tests/saveProjectPlanningOutputs.test.js
```

No compiled alias, copied compatibility module, source map, declaration, or alternate generated file may preserve those retired action-shaped module names.

The source boundary already accepted in REPAIR01 and REPAIR02 must remain unchanged.

## Required Change 3 — Release-Safety Enforcement

Add deterministic validation that fails when retired compiled modules or other deleted action-shaped output names are present in package input.

At minimum, release safety must reject generated production files matching the retired module names under `dist/src`.

The normal test lane must execute only the current test files. The stale duplicate Architect Interview and Project Planning suite execution must disappear.

Do not satisfy this requirement by excluding the retired production files from packaging while leaving them in `dist`. The build output itself must be correct.

## Preserve Accepted Implementation

Do not change:

- `artifact_toolbox.submit_handoff_outputs` behavior;
- the neutral Architect Interview and Project Planning contract modules;
- Phase Map domain persistence, canonical target, or metadata equality;
- Architect Interview review-state correction from REPAIR02;
- public action policy or retired-call rejection;
- workspace authority, OAuth, audit, repository-write, browser, Git, or release semantics beyond clean generated-output enforcement.

Do not restore retired source modules, wrappers, aliases, or fallback paths.

## Authorized Production Surface

Expected changes are limited to:

```text
package.json
scripts/* clean-build helper or existing build script
scripts/check-release-clean.ps1 or equivalent release-safety check
focused build/release tests
Builder Report
```

Do not change handoff contract production logic unless required only to remove an accidental build dependency on a retired module.

## Required Proof

Record each item as `Proven`, `OperatorValidationPending`, or `NotProven`.

1. A normal build removes a pre-existing stale file from `dist` before compilation.
2. The four verified retired compiled files are absent after build.
3. No retired action-shaped module name exists anywhere under `dist/src` after build.
4. The test lane executes only current Architect Interview and Project Planning suites, without stale duplicates.
5. Release safety fails when a retired compiled production module is deliberately introduced into package input.
6. Release safety passes after a clean current build.
7. `electron-builder.json` package input contains no retired implementation module after build.
8. Source-level retired modules and identifiers remain absent.
9. Unified Architect Interview, Project Planning, and Phase Map focused tests remain green.
10. Typecheck, clean build, complete tests, public safety, and release safety pass.
11. Builder Report states plainly that stale compiled retired modules remained after REPAIR02 and that this repair eliminated the recurrence.

## Completion

Create the Builder Report only after proof items 1–10 pass.

Do not package, promote, restart, reconnect, stage, commit, or push in this repair.
