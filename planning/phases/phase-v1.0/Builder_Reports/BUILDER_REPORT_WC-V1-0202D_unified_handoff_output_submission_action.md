# Builder Report: WC-V1-0202D Unified Handoff Output Submission Action

Work Card: `WC-V1-0202D_unified_handoff_output_submission_action.md`  
Status: Implemented  
Execution mode: one bounded MCP replacement pass  
Git mutation: not performed

## Summary

Implemented `artifact_toolbox.submit_handoff_outputs` as the single public handoff-output persistence action for:

- `architect-interview`
- `project-planning`
- `phase-map`

The retired public action names `save_architect_interview_output` and `save_project_planning_outputs` were removed from active artifact toolbox policy and dispatch. They now return unsupported/invalid action through the normal toolbox unsupported-action path and do not route to the unified action.

## Files Changed

- `src/tools/submitHandoffOutputs.ts`
- `src/tools/domainToolboxes.ts`
- `src/tools/toolboxActionPolicy.ts`
- `src/tools/saveArchitectInterviewOutput.ts`
- `src/tools/saveProjectPlanningOutputs.ts`
- `src/validation/chatgptEvidence.ts`
- `src/validation/mcpSelfTest.ts`
- `tests/saveArchitectInterviewOutput.test.ts`
- `tests/saveProjectPlanningOutputs.test.ts`
- `tests/submitHandoffOutputsPhaseMap.test.ts`
- `tests/toolboxActionPolicy.test.ts`
- `docs/TOOL_REFERENCE.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `docs/SECURITY_MODEL.md`
- `planning/phases/phase-v1.0/Live_Connector_Evidence/CHATGPT_LIVE_CONNECTOR_EVIDENCE_TEMPLATE.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202D_unified_handoff_output_submission_action.md`

## Implementation Notes

- Added an internal handoff contract registry keyed by `handoffKind`.
- Mapped Architect Interview and Project Planning through the unified registry while preserving existing canonical evidence, revision, idempotency, and rollback behavior.
- Added Phase Map authority resolution, schema validation, cycle detection, source-reference safety, canonical metadata derivation, Pending disposition install, idempotency, reviewed-output rejection, approved-output protection, evidence recheck, rollback, and temp cleanup.
- Replaced active public artifact toolbox action inventory and dispatch with `submit_handoff_outputs`.
- Updated self-test, ChatGPT evidence validation, docs, and focused tests.

## Proof Matrix

| # | Required proof | Status | Evidence |
|---|---|---|---|
| 1 | `submit_handoff_outputs` is registered under `artifact_toolbox`. | Proven | `toolboxActionPolicy` and `mcp_tool_inventory` tests passed in `npm run validate:codex:unit`. |
| 2 | Only the three authorized handoff kinds are accepted. | Proven | `SubmitHandoffOutputsParamsSchema` uses `architect-interview`, `project-planning`, `phase-map`; tests cover strict accepted paths. |
| 3 | Output slots are strict and contract-specific. | Proven | Per-kind strict output schemas; existing caller-authority/unknown-param tests pass. |
| 4 | Architect Interview create, idempotent retry, substantive revision, and unchanged reviewed-output rejection pass. | Proven | `tests/saveArchitectInterviewOutput.test.ts` passed. |
| 5 | Project Planning atomic save, rollback, idempotency, one-document revision, and unchanged reviewed-bundle rejection pass. | Proven | `tests/saveProjectPlanningOutputs.test.ts` passed. |
| 6 | Phase Map create, idempotent retry, substantive revision, and unchanged reviewed-output rejection pass. | Proven | `tests/submitHandoffOutputsPhaseMap.test.ts` passed. |
| 7 | Phase Map schema rejects malformed blocks, duplicate IDs/orders, unknown dependencies, cycles, completion fields, and unsafe references. | Proven | `tests/submitHandoffOutputsPhaseMap.test.ts` passed. |
| 8 | Targets, metadata, identity, source revisions, roles, revisions, and Pending status are server-derived. | Proven | Canonical parse assertions in Architect Interview, Project Planning, and Phase Map tests passed. |
| 9 | Evidence changes before install fail without changing targets. | Proven | Race/rollback tests for all three handoff kinds passed. |
| 10 | Old action names are absent from active production action inventory and dispatch. | Proven | Policy/dispatch updated; old-action negative tests passed. |
| 11 | Calls to old actions fail and do not route to the new action. | Proven | Old-action negative tests passed with `INVALID_INPUT`. |
| 12 | No compatibility wrapper, generic writer fallback, or caller-path fallback exists. | Proven | Unified dispatch has no old-action branches; strict schemas reject caller paths; no fallback calls were implemented. |
| 13 | Public-safety, MCP registration, and release-safety checks pass. | Proven | `npm run validate:codex:unit`, `npm run check:public`, and `npm run check:release` passed. |
| 14 | `npm run typecheck` and the complete approved test lane pass. | Proven | `npm run typecheck` passed; `npm run validate:codex:unit` passed 395/395 tests. |
| 15 | Builder Report distinguishes deterministic proof from later live ChampCity A/I integration. | Proven | This report records deterministic local proof; live ChatGPT/ChampCity A/I validation remains operator-controlled. |

## Validation

- `npm run typecheck`
  - Execution lane: normal Windows execution lane.
  - Result: pass.
  - Sandbox-only failure: none.
  - Approved-lane validated: yes.
- `npm run validate:codex:unit`
  - Execution lane: normal Windows execution lane via `scripts/codex-validate.ps1 -Suite unit`.
  - Result: pass, 395/395 tests.
  - Sandbox-only failure: none.
  - Approved-lane validated: yes.
- `npm run check:public`
  - Execution lane: normal Windows execution lane.
  - Result: pass, publication cleanliness.
- `npm run check:release`
  - Execution lane: normal Windows execution lane.
  - Result: pass, release cleanliness.

Two deterministic Phase Map test assertion-order failures occurred during development and were corrected before the final passing run. No sandbox `spawn EPERM` or sandbox-only validation failure occurred.

## Operator Validation Pending

- Live ChatGPT connector discovery should confirm `artifact_toolbox` exposes `submit_handoff_outputs` and does not list the retired action names.
- Live handoff submission should be exercised only with current Approved ChampCity A/I evidence and operator-approved substantive Markdown bodies.
- No package, promotion, restart, reconnect, commit, push, or live MCP server mutation was performed.

## Scope and Fallback

Protected subsystem touched: MCP tool discovery/exposure and toolbox dispatch were touched only as explicitly authorized by WC-V1-0202D.  
Scope changed during implementation: no.  
Fallback used: no. No fallback implementation was used.
