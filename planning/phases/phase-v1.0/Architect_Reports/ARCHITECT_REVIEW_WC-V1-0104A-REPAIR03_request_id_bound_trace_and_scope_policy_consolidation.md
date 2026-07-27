# Architect Review — WC-V1-0104A-REPAIR03 Request-ID-Bound Trace and Scope-Policy Consolidation

Date: 2026-07-26
Repository: `ChampCityChris/ChampCity_GPT_MCP`
Workspace: `%USERPROFILE%\Projects\ChampCity_GPT`
Branch reviewed: `dev`
Starting HEAD reported by Implementer: `780217aa1046ad8d271d13887ba1121bba419362`
Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104A-REPAIR03_request_id_bound_trace_and_scope_policy_consolidation.md`
Work Card: `planning/phases/phase-v1.0/Work_Cards/WC-V1-0104A-REPAIR03_request_id_bound_trace_and_scope_policy_consolidation.md`
Disposition: RevisionRequested

## Executive Disposition

WC-V1-0104A-REPAIR03 is substantially correct and resolves the architectural causes behind the prior repair churn.

The implementation now uses the MCP SDK's actual `extra.requestId`, removes metadata and claim-order matching, centralizes toolbox action scope policy, evaluates scope per contained call, produces truthful mixed-batch evidence, and applies one field-aware redaction authority to tool-call trace, discovery trace, and HTTP transport error diagnostics.

This is not another failed architecture. The principal design is approved. Two explicit request-identity edge conditions from the controlling Work Card remain incomplete, so Git integration, packaging, runtime promotion, restart, reconnect, and live validation remain blocked pending a narrow REPAIR03 amendment.

Do not create `WC-V1-0104A-REPAIR04`. Correct the two findings below under the existing REPAIR03 authorization and issue a corrected REPAIR03 Builder Report.

## Repository State Reviewed

ChampCity MCP reported:

- Workspace: `champcity_gpt`
- Repository: `ChampCityChris/ChampCity_GPT_MCP`
- Branch: `dev`
- Worktree: dirty
- Tracked modified files: 18
- Untracked files before this review artifact: 34
- Staged files: 0
- Deleted files: 0

The review did not reset, restore, clean, stash, stage, commit, push, integrate, package, promote, restart, reconnect, publish, or release anything. The only repository write performed by this review is this Architect Review artifact.

## Confirmed Acceptance Improvements

The following REPAIR03 outcomes are accepted:

1. The installed SDK contract was correctly inspected. `RequestHandlerExtra.requestId` is available in `@modelcontextprotocol/sdk` 1.29.0.
2. `registerTools.ts` now accepts `(request, extra)` and binds dispatch through `extra.requestId`.
3. Production use of `runWithSelectedToolCallTraceContext`, `claimed`, metadata matching, same-tool fallback, and first-unclaimed fallback was removed.
4. String request identities use a bounded SHA-256-derived internal key while the separately sanitized public diagnostic ID remains capped at 128 characters.
5. Two-call and three-call tests compare the inbound request ID, SDK `extra.requestId`, selected correlation ID, persisted trace ID, and response ID.
6. Reverse completion order no longer affects identity association for distinct request IDs.
7. `src/tools/toolboxActionPolicy.ts` is now the canonical action-to-scope and mapped-operation registry.
8. Supported toolbox action arrays are derived from that registry.
9. HTTP pre-dispatch scope evaluation correctly recognizes `repo_toolbox`, `git_toolbox`, and `integration_toolbox` write actions.
10. Mixed authorized-read and denied-write batches now produce per-call evidence: the denied call is `APP_POLICY_DENIED`; the authorized sibling is `RECEIVED_NOT_DISPATCHED` without the denied sibling's code or message.
11. `src/security/diagnosticRedaction.ts` is used by tool-call traces, discovery traces, and HTTP transport error diagnostics.
12. Arbitrary Windows, UNC, extended Windows, and Unix absolute-path fixtures are covered, including `/etc`, `/usr/local`, `/root`, `/run`, and `/projects`.
13. The actual in-flight HTTP fixture proves `DISPATCHED_NOT_EXECUTED` through a real SDK handler boundary.
14. The internal registered schema baseline remains 31 and the ChatGPT-visible surface remains seven toolboxes plus the bounded image writer when permitted.
15. The reported local validation suite passed: focused 111 tests, broader 353 tests, 22 MCP self-test checks, typecheck, build, public scan, lint, and diff check.

## Findings

### Finding 1 — Duplicate wire request IDs remain silently order-bound

Severity: P0 request-identity acceptance defect

The controlling Work Card states:

> Duplicate wire IDs may be rejected or handled as an explicit ambiguity; they must never cause silent cross-association.

Current behavior:

- `toolCallTraceRequestIdKey` produces the same key for identical wire IDs.
- A trace group may contain two contexts with that same key.
- `runWithToolCallTraceRequestId` calls `findIndex`, removes the first matching context, and then removes the second matching context on the next invocation.
- No duplicate-key validation or ambiguity marker exists.

For the required distinct-ID cases, this is correct. For duplicate wire IDs, identity silently falls back to SDK handler invocation order—the mechanism REPAIR03 was intended to eliminate.

The Builder Report does not identify or test duplicate wire IDs.

Required narrow correction:

1. Detect duplicate representable JSON-RPC request IDs within the parsed `tools/call` batch before SDK dispatch.
2. Do not dispatch an ambiguous duplicate-ID batch.
3. Preserve independent `http_received` evidence for every contained call.
4. Record an explicit safe validation denial only on the duplicate-ID calls, using an existing policy classification such as `INVALID_INPUT` unless a narrowly scoped internal code is demonstrably necessary.
5. Any unique authorized sibling rejected because the batch cannot proceed must remain `RECEIVED_NOT_DISPATCHED` and must not receive the duplicate call's denial message.
6. Add HTTP tests for:
   - two duplicate string IDs;
   - two duplicate numeric IDs;
   - duplicate IDs plus one unique authorized sibling;
   - no `dispatch_started`, toolbox, helper, or result stages for the rejected duplicate calls.

### Finding 2 — Request-ID mismatch is escalated as a transport error for every active call

Severity: P0 evidence-integrity defect

The controlling Work Card requires:

> Record a safe identity-mismatch diagnostic and fail or isolate the trace deterministically without misattribution.

Current behavior:

- `runWithToolCallTraceRequestId` throws a generic `Error` when no context matches `extra.requestId`.
- That throw occurs outside the inner traced tool-error `try/catch` in `registerTools.ts`.
- The HTTP transport catch then iterates every `activeToolCallContext` and records `transport_error` for all of them.

This does prevent context theft, but it misattributes one identity-binding failure as a transport failure on every active call in the request or batch. The direct unit assertion proves only that the binder throws; it does not prove safe production HTTP behavior or an isolated identity-mismatch diagnostic.

Required narrow correction:

1. Introduce a typed internal identity-mismatch error or equivalent deterministic discriminator.
2. Ensure the HTTP transport recognizes that condition separately from a genuine transport exception.
3. Persist a bounded, redacted mismatch diagnostic without selecting or blaming an unrelated call context.
4. Do not add `transport_error` to every active call for an identity mismatch.
5. Complete the HTTP response safely. Existing receipt contexts should remain truthfully classifiable from the stages actually observed, normally `RECEIVED_NOT_DISPATCHED` when no valid dispatch binding occurred.
6. Add a controlled HTTP fixture whose server intentionally calls the binder with an unknown SDK request ID and asserts:
   - no context is stolen;
   - no unrelated context receives `TRANSPORT_ERROR`;
   - no fabricated dispatch/result stage appears;
   - the mismatch diagnostic contains no raw request ID, path, endpoint, secret, content, or stack trace.

## Builder Report Accuracy

The Builder Report accurately describes the principal architecture, request-ID proof, shared action registry, per-call scope semantics, shared redaction, cross-layer distinct-ID tests, in-flight lifecycle fixture, validation commands, dirty-state preservation, and prohibited work not performed.

The report overstates complete acceptance only in these respects:

- it states that an unmatched SDK request ID fails deterministically, but omits that the transport records `TRANSPORT_ERROR` against every active context;
- it does not disposition the Work Card's duplicate-wire-ID ambiguity requirement;
- Test 14 proves no context stealing in a direct binder fixture but does not prove the required production mismatch diagnostic and non-misattribution behavior.

The corrected Builder Report must amend those rows and add exact HTTP tests for Findings 1 and 2.

## Required Amendment Scope

Amend REPAIR03 only. The amendment is limited to:

1. duplicate representable request-ID detection before dispatch;
2. truthful per-call evidence for duplicate-ID batch rejection;
3. typed identity-mismatch handling that does not mark unrelated calls `TRANSPORT_ERROR`;
4. a safe redacted mismatch diagnostic;
5. focused HTTP tests and corrected Builder Report evidence;
6. minimal documentation correction only if current wording claims duplicate-ID support or all mismatch conditions are transport failures.

Do not alter:

- the accepted `extra.requestId` binder architecture for distinct IDs;
- the toolbox action-policy registry design;
- OAuth scope names or token behavior;
- public tool exposure;
- write-mode or patch approval behavior;
- workspace routing;
- Git workflows;
- shared redaction behavior except as needed for the mismatch diagnostic;
- WC-V1-0202A or WC-V1-0202B;
- packaging, promotion, Electron UI, Figma, or release behavior.

Do not create another Work Card.

## Source-Control and Runtime Direction

Do not stage, commit, push, integrate, package, promote, restart, reconnect, publish, release, or perform live connector validation.

After the REPAIR03 amendment and corrected Builder Report are complete, return the existing REPAIR03 package for Architect re-review.

## Final Disposition

WC-V1-0104A-REPAIR03 disposition: RevisionRequested — narrow amendment only

Document.Status=RevisionRequested
