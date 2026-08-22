# WC-V1-0104B-REPAIR03 — Model-Visible Payload Preservation and Receipt Envelope

## Identity

- ID: `WC-V1-0104B-REPAIR03`
- Parent: `WC-V1-0104B-REPAIR02`
- Priority: P0
- Branch: `dev`
- Required Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104B-REPAIR03_model_visible_payload_preservation_and_receipt_envelope.md`

## Verified Defect

Successful public MCP toolbox calls can expose `structuredContent` containing only `champcityDeliveryReceipt` while the substantive result remains only in raw MCP text content.

If the ChatGPT connector selects or prioritizes `structuredContent`, the model receives a receipt without the requested file content, status, contract, acknowledgement, or delivery-status payload.

This affects ordinary toolbox results, bounded text reads, `result_delivery_status`, `acknowledge_tool_result`, and `describe_toolbox_action`. It is a public result-serialization defect, not a prompt or tool-call wording defect.

## Verified Cause

- Ordinary toolbox actions return `{ toolbox, action, ok, result }` and are materialized as JSON text content.
- `withDeliveryReceipt()` adds or creates `structuredContent` at the final public response boundary.
- When no prior structured result exists, the created `structuredContent` contains only `champcityDeliveryReceipt`.
- Bounded reads place the returned text chunk in MCP content but expose metadata-only structured content.
- Existing tests inspect raw `content` and receipt presence but do not simulate a connector projection that chooses `structuredContent` as the model-visible payload.

## Explicit Protected-Subsystem Authorization

This card explicitly authorizes a narrowly bounded change to the public MCP result serialization boundary.

Authorized objective:

> Preserve the complete substantive successful result in model-visible `structuredContent` and attach the delivery receipt as supplementary metadata.

This authorization does not extend to OAuth, PKCE, request routing, toolbox business logic, public tool inventory, write authorization, transport authentication, endpoint configuration, or telemetry architecture beyond what is necessary to preserve the result payload.

## Smallest Authorized Correction

1. At the final measured public response boundary, construct a structured envelope containing the substantive toolbox result and the receipt.
2. Preserve existing raw MCP content for compatibility.
3. For bounded reads, include the actual returned text chunk and its bounded-read metadata in the structured result.
4. Ensure `result_delivery_status` and `acknowledge_tool_result` expose their own substantive status result; a receipt must not replace or recursively hide that result.
5. Add a final invariant rejecting or repairing any successful public toolbox response whose structured result contains only receipt metadata.
6. Clarify in public tool documentation that acknowledgement is telemetry only and does not retrieve, unlock, or reveal a hidden payload.

Do not patch individual toolbox actions one by one when the final serializer can preserve their existing result generically.

## Required Structured Result

For an ordinary successful toolbox call, the model-visible structured result must preserve this semantic shape:

```json
{
  "toolbox": "repo_toolbox",
  "action": "read_file",
  "ok": true,
  "result": {
    "relativePath": "README.md",
    "content": "...",
    "sha256": "..."
  },
  "champcityDeliveryReceipt": {
    "schemaVersion": 1,
    "correlationId": "...",
    "resultAttemptId": "...",
    "payloadSha256": "..."
  }
}
```

The receipt may be omitted where recursion prevention requires it, but it may never replace the substantive result.

For bounded reads, `structuredContent.result` must contain the exact returned chunk plus applicable range, completion, continuation cursor, source hash, and retry guidance already returned by the bounded-read contract.

## Must Remain Unchanged

- Existing toolbox result semantics and action-specific payload fields.
- Existing raw MCP `content` compatibility.
- Existing delivery receipt identity, digest domain, correlation, trace, and acknowledgement telemetry unless a narrow adjustment is required to avoid recursive receipt-only results.
- Existing bounded-read limits, cursor integrity, source hashes, line ranges, sections, retry rules, and content redaction.
- Existing OAuth, scope, write-mode, path, file, Git, release, audit, and error-classification safeguards.
- Existing tool names, toolbox names, action names, schemas, and public inventory.
- Existing successful and denied operation behavior outside response projection.

## Explicitly Out of Scope

- Prompt or embedded-agent instruction changes as the primary fix.
- Per-tool duplication of structured envelope logic.
- New payload-retrieval actions.
- Treating acknowledgement as permission to access content.
- Storing complete result payloads in telemetry or audit logs.
- Changing the receipt into a content-retrieval protocol.
- General MCP transport redesign.
- OAuth, PKCE, Cloudflare, packaging, promotion, or launcher changes.
- Sanitizing unrelated historical planning records.
- Staging, committing, pushing, integrating, packaging, publishing, or releasing.

## Authorized File Surface

Expected production files:

- `src/server/resultTelemetry.ts`
- `src/server/registerTools.ts` only if required at the final measured response boundary
- `src/tools/textProjection.ts` only if bounded structured output cannot be preserved generically
- receipt/tool-description source only as required for the telemetry-only clarification

Expected tests:

- `tests/httpTransport.test.ts`
- `tests/resultDeliveryTrace.test.ts` or the existing result-telemetry test file
- bounded text-projection tests only if needed

Required report:

- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104B-REPAIR03_model_visible_payload_preservation_and_receipt_envelope.md`

Any adjacent file must be identified and technically justified in the Builder Report.

## Acceptance Criteria

1. Short `repo_toolbox.read_file` exposes the requested file content at `structuredContent.result.content` plus receipt metadata.
2. `repo_toolbox.status` exposes its substantive status at `structuredContent.result` plus receipt metadata.
3. `diagnostics_toolbox.describe_toolbox_action` exposes the requested action contract in the model-visible structured result.
4. `diagnostics_toolbox.result_delivery_status` exposes its substantive delivery status and is not receipt-only.
5. `diagnostics_toolbox.acknowledge_tool_result` exposes its substantive acknowledgement status and is not receipt-only.
6. Bounded reads expose the exact returned chunk in the model-visible structured result together with bounded range, completion, cursor, and source metadata.
7. Successful toolbox results preserve their existing raw MCP content.
8. Receipt digests continue to cover the intended substantive payload domain and do not become self-referential.
9. A successful public toolbox response cannot leave the final serializer with `structuredContent` whose only meaningful field is `champcityDeliveryReceipt`.
10. Receipt and acknowledgement documentation states that acknowledgement is telemetry only and does not retrieve or unlock payload content.
11. Existing error, denial, image, binary, and multi-content responses remain valid and are not coerced into an unsafe JSON-only format.
12. Existing result trace, correlation, acknowledgement, and failure-attribution regressions remain passing.
13. No substantive result content is newly persisted in logs, traces, receipts, or audit records.
14. No duplicate serializer, alternate delivery path, fallback payload store, or per-tool envelope implementation is introduced.
15. Fresh live ChatGPT validation confirms the model receives substantive payloads rather than receipt-only results.

## Required Proof

Add one shared ChatGPT-projection-style test helper that selects `structuredContent` as the model-visible payload and asserts the substantive result survives.

Use that helper against at least:

- short file read;
- workspace status;
- toolbox action description;
- delivery status;
- acknowledgement;
- bounded text read.

Tests that inspect only `content[0].text` are insufficient for these criteria.

Also prove:

- receipt-only success cannot pass the final response invariant;
- receipt generation for delivery-status and acknowledgement actions does not create a recursive hidden-payload loop;
- binary/image response handling remains valid.

## Validation

Run after final Builder Report bytes are written:

1. Typecheck.
2. Focused result-telemetry, HTTP transport, and bounded-projection tests.
3. Full regression suite and build.
4. MCP self-test.
5. Lint.
6. `git diff --check`.
7. Publication-cleanliness check.
8. Fresh live ChatGPT connector validation after runtime promotion/restart.

The Builder Report must distinguish repository validation from the required post-promotion live connector validation.

## Stop Conditions

Stop and report rather than broaden scope if correction requires:

- a new payload database or retrieval service;
- persistence of full result content in telemetry;
- a new public tool or action;
- changes to OAuth, PKCE, endpoint authentication, or tool authorization;
- per-tool serializer duplication;
- changes to unrelated toolbox business logic.

## Binary Completion Rule

`every successful model-visible structured result preserves the substantive payload`

+ `receipt metadata remains supplementary`

+ `bounded chunks survive structured projection`

+ `delivery-status and acknowledgement are not recursive receipt-only results`

+ `raw MCP compatibility and existing safeguards remain intact`

+ `fresh ChatGPT validation confirms usable payload delivery`

+ `no alternate payload store or duplicate serializer is introduced`

= `PASS`

Anything less is `RevisionRequired`.

## Document Disposition

`Document.Status=ApprovedForImplementation`
