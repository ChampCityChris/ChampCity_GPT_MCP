# Builder Report: WC-V1-0104B-REPAIR03 Model-Visible Payload Preservation and Receipt Envelope

## Summary

Implemented the approved public MCP result-serialization repair.

Successful public toolbox responses now preserve the substantive toolbox result in model-visible `structuredContent` and attach `champcityDeliveryReceipt` as supplementary metadata. Raw MCP `content` remains unchanged for compatibility.

## Files Changed

- `src/server/resultTelemetry.ts`
- `tests/resultDeliveryTrace.test.ts`
- `tests/httpTransport.test.ts`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `docs/TOOL_REFERENCE.md`
- `docs/SECURITY_MODEL.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104B-REPAIR03_model_visible_payload_preservation_and_receipt_envelope.md`

`docs/SECURITY_MODEL.md` is adjacent to the expected documentation surface. It was changed only to clarify that result acknowledgement is telemetry and does not retrieve, unlock, or reveal hidden payload content.

## Implementation Notes

- Added a centralized structured envelope at `createMeasuredToolResponse()` / `withDeliveryReceipt()`.
- Ordinary toolbox responses now expose `toolbox`, `action`, `ok`, `result`, optional `error`, `warnings`, and `recommendedNextSteps` in `structuredContent`.
- Existing `structuredContent` keys are preserved for compatibility, including bounded-read top-level metadata such as `nextCursor`.
- Bounded text responses now expose the exact returned text chunk at `structuredContent.result.content` while preserving bounded metadata, range, source hash, completion, and cursor data.
- Image and multi-content responses remain valid: binary image bytes stay in MCP image content and are not duplicated into structured JSON.
- Receipt digests still cover the pre-receipt materialized payload domain and do not become self-referential.
- Added a final invariant that rejects successful toolbox serialization if no substantive structured `result` would be model-visible beside the receipt.
- No new public tool, payload database, retrieval action, alternate delivery path, or per-tool serializer implementation was added.

## Protected Subsystems

Touched: public MCP result serialization boundary.

This was explicitly authorized by the Work Card. OAuth, PKCE, endpoint authentication, public tool inventory, write authorization, transport routing, and token/session storage were not changed.

## Scope

Scope did not change during implementation.

No fallback implementation was used.

## Validation

Execution lane used: documented normal Windows Codex validation lane.

- `npm run validate:codex:unit`
  - Result: PASS
  - This ran `npm run test`, including build, TypeScript compile, renderer build, and the full Node test suite.
  - Summary: 430 tests passed, 0 failed.
- `npm run lint`
  - Result: PASS
  - `tsc --noEmit -p tsconfig.json` completed successfully.
- `npm run mcp:self-test -- --json`
  - Result: PASS
  - Summary: 23 checks passed, 0 failed.
- `git diff --check`
  - Result: PASS
  - Warnings only: existing LF-to-CRLF notices from Git.
- `npm run check:public`
  - Result: FAIL
  - Failure was unrelated to this repair: pre-existing private local path matches in `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202G_bounded_text_projection_and_safety_resilient_read_protocol.md`.
  - This Work Card explicitly excludes sanitizing unrelated historical planning records, so no cleanup was performed.

No sandbox-only `spawn EPERM` failure occurred.

## Test Coverage Added

- Serializer-level test proving ordinary successful toolbox payloads survive model-visible structured projection.
- Serializer-level test proving bounded text chunks survive at `structuredContent.result.content`.
- Serializer-level invariant test rejecting a successful receipt-only toolbox response.
- Serializer-level image/multi-content test proving binary image data is not duplicated into structured JSON.
- HTTP transport projection test helper that treats `structuredContent` as the ChatGPT-selected model-visible payload.
- HTTP transport coverage for:
  - short `repo_toolbox.read_file`;
  - `repo_toolbox.status`;
  - `diagnostics_toolbox.describe_toolbox_action`;
  - `diagnostics_toolbox.result_delivery_status`;
  - `diagnostics_toolbox.acknowledge_tool_result`;
  - bounded `repo_toolbox.read_text_lines`.

## Validation Not Performed

- Packaging was not run.
- Runtime promotion was not run.
- Fresh live ChatGPT connector validation was not performed from this environment.

## Remaining Operator Validation

After packaging/promotion/restart, validate in a fresh ChatGPT conversation that:

1. `repo_toolbox.read_file` returns actual file content in the model-visible result.
2. `repo_toolbox.status` returns substantive workspace status.
3. `diagnostics_toolbox.describe_toolbox_action` returns the requested contract.
4. `diagnostics_toolbox.result_delivery_status` returns delivery status rather than another receipt-only response.
5. `diagnostics_toolbox.acknowledge_tool_result` returns acknowledgement status rather than another receipt-only response.
6. Bounded reads expose the exact chunk and cursor metadata through the model-visible result.

## Blockers And Assumptions

- The working tree already contained many unrelated modified and untracked files before this repair. They were not reverted or normalized.
- Publication cleanliness is blocked by an unrelated historical Builder Report containing a private local path.
- Live ChatGPT connector behavior is the final acceptance authority for model-visible payload delivery.
