# Builder Report: WC-V1-0202D-REPAIR01 Phase Map Consumer Contract and Metadata Integrity

Work Card: `WC-V1-0202D-REPAIR01_phase_map_consumer_contract_and_metadata_integrity.md`  
Parent: `WC-V1-0202D`  
Status: Implemented  
Git mutation: not performed  
Packaging/promotion/restart/reconnect: not performed

## Plain Correction

The WC-V1-0202D implementation retained old internal action-shaped engines for Architect Interview and Project Planning. It removed the public action names, but `submit_handoff_outputs` still imported and called `saveArchitectInterviewOutput` and `saveProjectPlanningOutputs`. That did not satisfy the hard replacement requirement.

This repair removed that internal action-shaped boundary. Architect Interview and Project Planning now live under neutral handoff contract modules, and shared canonical Markdown parsing/serialization/hash helpers live under a neutral canonical submission helper.

## Files Changed

- `src/tools/submitHandoffOutputs.ts`
- `src/tools/internal/canonicalSubmission/canonicalMarkdown.ts`
- `src/tools/internal/handoffContracts/architectInterview.ts`
- `src/tools/internal/handoffContracts/projectPlanning.ts`
- `src/tools/saveArchitectInterviewOutput.ts` deleted
- `src/tools/saveProjectPlanningOutputs.ts` deleted/removed from active source by move to neutral contract module
- `tests/submitHandoffOutputsArchitectInterview.test.ts`
- `tests/submitHandoffOutputsProjectPlanning.test.ts`
- `tests/submitHandoffOutputsPhaseMap.test.ts`
- `tests/saveArchitectInterviewOutput.test.ts` deleted by rename
- `tests/saveProjectPlanningOutputs.test.ts` deleted/removed from active tests by rename
- `tests/toolboxActionPolicy.test.ts`
- `docs/TOOL_REFERENCE.md`
- `docs/SECURITY_MODEL.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202D-REPAIR01_phase_map_consumer_contract_and_metadata_integrity.md`

## Implementation Notes

- `submitHandoffOutputs.ts` imports and calls `submitArchitectInterviewContract` and `submitProjectPlanningContract`, not retired save-action functions.
- Production `src` no longer contains `saveArchitectInterviewOutput`, `SaveArchitectInterviewOutputParamsSchema`, `saveProjectPlanningOutputs`, or `SaveProjectPlanningOutputsParamsSchema`.
- Phase Map validation now returns the normalized phase domain and persists that exact domain in canonical metadata `workflowData.phases`.
- Phase Map target acceptance is restricted to `planning/project/Phase_Map/PHASE_MAP_<project-slug>.md`, with `<project-slug>` derived from merged current Approved Project Profile and Project Roadmap identity.
- Phase Map `already_saved` now requires identical normalized body and complete Pending canonical metadata equality. Identical body with stale metadata fails without modifying bytes.

## Proof Matrix

| # | Required proof | Status | Evidence |
|---|---|---|---|
| 1 | `submit_handoff_outputs` remains the sole public workflow-output submission action. | Proven | `SUPPORTED_ARTIFACT_ACTIONS` contains `submit_handoff_outputs`; absence test proves retired actions are absent. |
| 2 | Old public action calls remain unsupported and do not translate to the unified action. | Proven | Architect Interview and Project Planning tests call retired action names and receive `INVALID_INPUT`. |
| 3 | Production registry code does not import or call `saveArchitectInterviewOutput` or `saveProjectPlanningOutputs`. | Proven | Static scan over `src` returned no prohibited names; absence test passed. |
| 4 | Production source exports none of the four retired action-shaped function/schema names. | Proven | Static scan over `src` returned no prohibited names; absence test passed. |
| 5 | Architect Interview behavior passes through the unified registry boundary. | Proven | `tests/submitHandoffOutputsArchitectInterview.test.ts` passed through `artifact_toolbox.submit_handoff_outputs`. |
| 6 | Project Planning behavior passes through the unified registry boundary. | Proven | `tests/submitHandoffOutputsProjectPlanning.test.ts` passed through `artifact_toolbox.submit_handoff_outputs`. |
| 7 | Phase Map behavior passes through the unified registry boundary. | Proven | `tests/submitHandoffOutputsPhaseMap.test.ts` passed through `artifact_toolbox.submit_handoff_outputs`. |
| 8 | No wrapper, alias, compatibility adapter, generic writer fallback, or caller-path fallback exists. | Proven | Dispatch contains no retired action branches; strict schemas and negative tests passed. |
| 9 | Installed Phase Map metadata contains complete normalized `workflowData.phases`. | Proven | Phase Map test asserts the exact normalized phase array in canonical metadata. |
| 10 | MCP-produced Phase Map satisfies current ChampCity A/I consumer contract. | Proven | Canonical target and `workflowData.phases` tests passed locally; live ChampCity A/I integration remains operator validation. |
| 11 | Only `planning/project/Phase_Map/PHASE_MAP_<project-slug>.md` is accepted. | Proven | Canonical target derivation implemented from identity `projectSlug`; alternate path test passed. |
| 12 | Alternate paths are rejected without writes. | Proven | Traversal and alternate `planning/phases/...` target tests passed. |
| 13 | Exact body and complete Pending metadata equality returns `already_saved`. | Proven | Phase Map create/retry test passed. |
| 14 | Metadata mismatch leaves existing bytes unchanged and does not return `already_saved`. | Proven | Phase Map stale metadata identical-body retry test passed. |
| 15 | Create, revision, reviewed-output rejection, Approved-output protection, evidence-race rejection, rollback, and cleanup pass for applicable contracts. | Proven | Architect Interview, Project Planning, and Phase Map focused tests passed. |
| 16 | Typecheck, complete tests, public safety, and release safety pass. | Proven | `npm run typecheck`, `npm run validate:codex:unit`, `npm run check:public`, and `npm run check:release` passed. |
| 17 | Repair Builder Report states plainly that WC-V1-0202D retained old internal action-shaped engines and this repair removed them. | Proven | See “Plain Correction” above. |

## Validation

- `npm run typecheck`
  - Execution lane: normal Windows execution lane.
  - Result: pass.
  - Sandbox-only failure: none.
  - Approved-lane validated: yes.
- `npm run validate:codex:unit`
  - Execution lane: normal Windows execution lane via `scripts/codex-validate.ps1 -Suite unit`.
  - Result: pass, 418/418 tests.
  - Sandbox-only failure: none.
  - Approved-lane validated: yes.
- `npm run check:public`
  - Execution lane: normal Windows execution lane.
  - Result: pass, publication cleanliness.
- `npm run check:release`
  - Execution lane: normal Windows execution lane.
  - Result: pass, release cleanliness.

## Operator Validation Pending

- Live ChatGPT connector discovery should confirm only `artifact_toolbox.submit_handoff_outputs` is available for workflow output submission.
- Live ChampCity A/I Phase Map submission should confirm the consumer reads `planning/project/Phase_Map/PHASE_MAP_<project-slug>.md` and canonical metadata `workflowData.phases`.

## Scope and Fallback

Protected subsystem touched: MCP toolbox action dispatch/exposure boundaries were touched only as explicitly authorized by the parent card and this repair.  
Scope changed during implementation: no.  
Fallback used: no. No fallback implementation was used.  
A fallback may be possible, but was not implemented because architect/operator approval was not provided.
