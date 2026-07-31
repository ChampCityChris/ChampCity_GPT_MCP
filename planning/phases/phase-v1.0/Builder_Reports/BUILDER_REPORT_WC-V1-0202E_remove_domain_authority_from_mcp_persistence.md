# Builder Report - WC-V1-0202E Remove Domain Authority from MCP Persistence

## Summary

Completed the approved deletion-only cleanup pass. This Work Card only deleted contaminated MCP-owned workflow persistence code and intentionally did not add a replacement tool, alias, wrapper, fallback, migration path, or compatibility behavior.

## Files Changed

- `src/tools/internal/handoffContracts/architectInterview.ts` deleted
- `src/tools/internal/handoffContracts/projectPlanning.ts` deleted
- `src/tools/submitHandoffOutputs.ts` deleted
- `src/tools/internal/canonicalSubmission/canonicalMarkdown.ts` deleted
- `src/tools/domainToolboxes.ts`
- `src/tools/toolboxActionPolicy.ts`
- `src/validation/mcpSelfTest.ts`
- `src/validation/chatgptEvidence.ts`
- `tests/submitHandoffOutputsArchitectInterview.test.ts` deleted
- `tests/submitHandoffOutputsProjectPlanning.test.ts` deleted
- `tests/submitHandoffOutputsPhaseMap.test.ts` deleted
- `tests/toolboxActionPolicy.test.ts`
- `tests/domainToolboxes.test.ts`
- `tests/mcpSelfTest.test.ts`
- `tests/chatgptEvidence.test.ts`
- `docs/SECURITY_MODEL.md`
- `docs/TOOL_REFERENCE.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `planning/phases/phase-v1.0/Live_Connector_Evidence/CHATGPT_LIVE_CONNECTOR_EVIDENCE_TEMPLATE.md`

## Scope and Boundaries

- Protected subsystem touched: yes, the MCP public action inventory/exposure path was touched only as explicitly authorized by the Work Card to remove `artifact_toolbox.submit_handoff_outputs`.
- Scope changed during implementation: no.
- Fallback implementation used: no.
- No fallback implementation was used.
- No replacement writer, alias, wrapper, fallback, or migration behavior was added.
- Git mutation, packaging, promotion, restart, and reconnect were not performed.

## Validation

- `npm run validate:codex`
  - Execution lane: documented Codex validation wrapper, rerun outside sandbox after the known sandbox-only `spawn EPERM` esbuild failure.
  - Result: PASS.
  - Evidence: full test suite reported 376 tests, 37 suites, 376 pass, 0 fail; wrapper also ran `npm run build`.
  - Sandbox-only failure occurred: yes, first sandbox run failed at `renderer:build` with `spawn EPERM`.
  - Approved lane result: validated outside sandbox and passed.
- `npm run check:public`
  - Execution lane: normal shell command.
  - Result: PASS publication cleanliness; checked 247 source candidate files.
- `npm run check:release`
  - Execution lane: normal shell command.
  - Result: PASS release cleanliness; checked 2798 release files.

## Proof Matrix

| # | Required proof | Status | Evidence |
|---|---|---|---|
| 1 | `architectInterview.ts` is deleted. | Proven | `Test-Path` returned `False`; file absent. |
| 2 | `projectPlanning.ts` is deleted. | Proven | `Test-Path` returned `False`; file absent. |
| 3 | `submitHandoffOutputs.ts` is deleted. | Proven | `Test-Path` returned `False`; file absent. |
| 4 | `canonicalSubmission/canonicalMarkdown.ts` is deleted when no production reference remains. | Proven | `Test-Path` returned `False`; no production reference remains. |
| 5 | `artifact_toolbox.submit_handoff_outputs` is no longer registered, discoverable, or callable. | OperatorValidationPending | Local inventory/policy/callable-path tests prove absence in source and local MCP behavior; real ChatGPT connector visibility still requires operator validation in a fresh ChatGPT conversation. |
| 6 | `handoffKind`, domain output-slot registration, and domain contract registry code are absent from production source. | Proven | `rg` over `src` found no production matches for `handoffKind`, `SUPPORTED_HANDOFF_KINDS`, `HANDOFF_OUTPUT_CONTRACT_REGISTRY`, domain kinds, or output-slot terms. |
| 7 | No production code scans planning evidence to authorize a write for Architect Interview, Project Planning, or Phase Map. | Proven | Domain persistence modules were deleted; `rg` over `src` found no Architect Interview, Project Planning, or Phase Map production authority terms. |
| 8 | No production code constructs canonical workflow metadata for those outputs. | Proven | Canonical helper and submission module deleted; `rg` found no production references for `canonicalMetadata`, `sourceRevisions`, or `workflowData.phases`. |
| 9 | No production code validates Project Planning headings or Phase Map schema as part of persistence. | Proven | Domain validators deleted; `rg` over `src` found no Project Planning, Phase Map, or `champcity-phase-map` matches. |
| 10 | No production code enforces document disposition or reviewed-output rules for those outputs. | Proven | Domain submission modules deleted; `rg` over `src/tools` and `src/validation` found no `documentDisposition` or reviewed-output terms. |
| 11 | The three domain-authority test suites are deleted. | Proven | The three `tests/submitHandoffOutputs*.test.ts` files were deleted. |
| 12 | Documentation no longer claims that the MCP owns those workflow decisions. | Proven | The four scoped docs/templates were updated; targeted `rg` found no domain-authority claims in those files. |
| 13 | No replacement writer, alias, wrapper, fallback, or migration behavior was added. | Proven | No new writer was added; `artifact_toolbox` rejects `submit_handoff_outputs`; `repo_toolbox.write_markdown_artifact` was not changed. |
| 14 | Unrelated public tools and generic safety behavior remain unchanged. | Proven | Full validation, public cleanliness, and release cleanliness passed. |
| 15 | Typecheck passes. | Proven | `npm run validate:codex` passed through the repository test/build wrapper. |
| 16 | Clean build passes. | Proven | `npm run validate:codex` ran `npm run build` successfully. |
| 17 | Complete tests pass. | Proven | `npm run validate:codex` completed 376/376 passing tests. |
| 18 | Public safety and release safety pass. | Proven | `npm run check:public` and `npm run check:release` passed. |
| 19 | Builder Report states plainly that this Work Card only deleted contaminated code and intentionally did not add a replacement tool. | Proven | This report states that in Summary and Scope sections. |

## Remaining Operator Validation

- In a fresh ChatGPT connector conversation against the intended runtime, confirm `artifact_toolbox` no longer lists `submit_handoff_outputs`.
- Attempting `artifact_toolbox` with `action: "submit_handoff_outputs"` should return unsupported action behavior, not execute a write.
