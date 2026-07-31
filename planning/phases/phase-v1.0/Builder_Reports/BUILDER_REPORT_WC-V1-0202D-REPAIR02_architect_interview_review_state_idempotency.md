# Builder Report: WC-V1-0202D-REPAIR02 Architect Interview Review-State Idempotency

Work Card: `WC-V1-0202D-REPAIR02_architect_interview_review_state_idempotency.md`  
Parent: `WC-V1-0202D-REPAIR01`  
Status: Implemented  
Git mutation: not performed  
Packaging/promotion/restart/reconnect: not performed

## Plain Correction

The REPAIR01 pass correctly removed the old internal action-shaped boundary and repaired Phase Map behavior, but it missed one Architect Interview review-state defect. Identical Architect Interview content was treated as `already_saved` before the implementation proved the existing target was exact Pending canonical metadata. That meant identical Rejected or RevisionRequested content could incorrectly report Pending idempotency.

This repair makes Architect Interview idempotency strict: identical body content returns `already_saved` only when the existing document is exact Pending canonical metadata for the current Intake and Prompt evidence at the existing revision. Identical reviewed content now fails without modifying the target bytes or review state. Substantively revised reviewed content still increments exactly once and resets to Pending.

## Files Changed

- `src/tools/internal/handoffContracts/architectInterview.ts`
- `tests/submitHandoffOutputsArchitectInterview.test.ts`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202D-REPAIR02_architect_interview_review_state_idempotency.md`

## Implementation Notes

- Added exact Pending idempotency validation before returning `already_saved`.
- The exact Pending check compares the existing metadata envelope to server-derived canonical metadata for the existing artifact revision.
- Identical Rejected and RevisionRequested Architect Interview submissions now return `INVALID_INPUT` and do not write.
- Reviewed submissions with substantively changed body content still use the existing write path, increment revision once, and install fresh Pending metadata.
- No retired save action, wrapper, alias, compatibility adapter, or fallback path was restored.
- Project Planning and Phase Map production behavior was not changed.

## Proof Matrix

| # | Required proof | Status | Evidence |
|---|---|---|---|
| 1 | Identical exact Pending Architect Interview returns `already_saved`. | Proven | Existing focused Architect Interview retry test passed through `artifact_toolbox.submit_handoff_outputs`. |
| 2 | Identical Pending body with altered metadata fails and leaves bytes unchanged. | Proven | Added focused test alters Pending metadata, retries through `artifact_toolbox.submit_handoff_outputs`, asserts `INVALID_INPUT`, and asserts exact bytes unchanged. |
| 3 | Identical Rejected content fails and preserves exact bytes and review state. | Proven | Added focused test sets Rejected disposition, retries identical body through `artifact_toolbox.submit_handoff_outputs`, asserts `INVALID_INPUT`, exact bytes unchanged, and preserved disposition metadata. |
| 4 | Identical RevisionRequested content fails and preserves exact bytes and review state. | Proven | Added focused test covers RevisionRequested with the same byte-preservation and review-state assertions. |
| 5 | Substantively revised Rejected content increments revision once and returns Pending. | Proven | Added focused test revises Rejected content through `artifact_toolbox.submit_handoff_outputs`, asserts revision 2 and Pending metadata. |
| 6 | Substantively revised RevisionRequested content increments revision once and returns Pending. | Proven | Added focused test revises RevisionRequested content through `artifact_toolbox.submit_handoff_outputs`, asserts revision 2 and Pending metadata. |
| 7 | Approved output remains non-overwritable. | Proven | Existing focused Architect Interview Approved-output rejection test passed. |
| 8 | All acceptance paths are exercised through `artifact_toolbox.submit_handoff_outputs`. | Proven | Added and existing acceptance tests use the toolbox action path; direct contract hooks remain only for race/rollback fixture coverage. |
| 9 | Retired action names and modules remain absent; no wrapper, alias, or fallback exists. | Proven | Static `rg` over `src` returned no retired identifiers; `src/tools/saveArchitectInterviewOutput.ts` and `src/tools/saveProjectPlanningOutputs.ts` both returned `False` for existence; action-policy absence test passed. |
| 10 | Project Planning and Phase Map focused tests remain green. | Proven | `npm run validate:codex:unit` passed the focused Project Planning and Phase Map suites. |
| 11 | Typecheck, complete tests, public safety, and release safety pass. | Proven | `npm run typecheck`, `npm run validate:codex:unit`, `npm run check:public`, and `npm run check:release` passed. |
| 12 | Builder Report states the prior REPAIR01 omission plainly and does not claim acceptance beyond proof. | Proven | See `Plain Correction` and this proof matrix. |

## Validation

- `npm run typecheck`
  - Execution lane: normal Windows execution lane.
  - Result: pass.
  - Sandbox-only failure: none.
  - Approved-lane validated: yes.
- `npm run validate:codex:unit`
  - Execution lane: normal Windows execution lane via `scripts/codex-validate.ps1 -Suite unit`.
  - Result: pass, 421/421 tests.
  - Sandbox-only failure: none.
  - Approved-lane validated: yes.
- `npm run check:public`
  - Execution lane: normal Windows execution lane.
  - Result: pass, publication cleanliness, 244 source candidate files checked.
  - Sandbox-only failure: none.
  - Approved-lane validated: yes.
- `npm run check:release`
  - Execution lane: normal Windows execution lane.
  - Result: pass, release cleanliness, 2796 release files checked.
  - Sandbox-only failure: none.
  - Approved-lane validated: yes.

## Operator Validation Pending

- Live ChatGPT connector validation was not performed in this repair.
- Packaging validation was not performed because packaging was prohibited by the work card.

## Scope and Fallback

Protected subsystem touched: no.  
Scope changed during implementation: no.  
Fallback used: no. No fallback implementation was used.  
A fallback may be possible, but was not implemented because architect/operator approval was not provided.
