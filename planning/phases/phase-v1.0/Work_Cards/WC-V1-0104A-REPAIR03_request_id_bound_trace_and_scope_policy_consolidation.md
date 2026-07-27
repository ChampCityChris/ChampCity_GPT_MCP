# WC-V1-0104A-REPAIR03 — Request-ID-Bound Trace and Scope-Policy Consolidation

## Work Card Identity

- ID: `WC-V1-0104A-REPAIR03`
- Parent Work Card: `WC-V1-0104A`
- Prior Repairs: `WC-V1-0104A-REPAIR01`, `WC-V1-0104A-REPAIR02`
- Title: Request-ID-Bound Trace and Scope-Policy Consolidation
- Phase: v1.0 — ChatGPT Connector and Safety-Layer Reliability
- Priority: P0
- Type: Final bounded corrective consolidation
- Repository: `%USERPROFILE%\Projects\ChampCity_GPT`
- Remote: `ChampCityChris/ChampCity_GPT_MCP`
- Branch at authorization: `dev`
- Controlling code review: `planning/phases/phase-v1.0/Architect_Reports/CODE_REVIEW_RCA_WC-V1-0104A_TRACE_REPAIR_CHURN_2026-07-26.md`
- Controlling Architect Review: `planning/phases/phase-v1.0/Architect_Reports/ARCHITECT_REVIEW_WC-V1-0104A-REPAIR02_trace_boundary_classification_redaction_evidence.md`
- Required Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104A-REPAIR03_request_id_bound_trace_and_scope_policy_consolidation.md`

## Authorization Basis

The code review determined that the remaining defects share three architectural causes:

1. trace dispatch identity is selected by metadata and assumed handler order even though the installed MCP SDK request-handler contract supplies the JSON-RPC request ID through handler metadata;
2. OAuth scope requirements are duplicated across HTTP transport, public tool exposure, and individual toolbox switch cases;
3. trace, discovery, toolbox, and HTTP-error diagnostics use separate partial redactors.

REPAIR03 is authorized to consolidate those three authorities and close the remaining trace defects. It is not authorization for another broad observability redesign.

This is intended to be the final implementation repair for WC-V1-0104A. Do not plan or create REPAIR04. If a required SDK identity capability cannot be verified locally, stop before editing and report exact declaration/compiler evidence.

## Sequencing and Isolation

Do not implement or prepare any portion of:

- `WC-V1-0202A — Workspace-Scoped Planning Artifact Write Policy`;
- `WC-V1-0202B — Content-Only Canonical Document Submission Protocol`;
- any packaging, promotion, release, or live connector pass.

The repository is heavily dirty. Preserve all unrelated work. Do not reset, restore whole files, clean, stash, discard, stage, commit, push, integrate, package, promote, restart, reconnect, publish, or release.

## Objective

Replace the remaining assumption-based trace plumbing with:

- exact JSON-RPC request-ID binding at SDK dispatch;
- one complete toolbox action-policy registry used by both HTTP and toolbox enforcement;
- one field-aware diagnostic redaction authority used by every persistence path affected by an MCP request.

The resulting trace must report each call truthfully, including mixed batches, without changing the 31-schema internal registry, ChatGPT-visible public surface, OAuth semantics, write modes, workspace routing, or tool behavior.

## Mandatory Repair Scope

### 1. Verify and use the installed SDK request identity

Before editing production code, inspect the installed `@modelcontextprotocol/sdk` v1.29.0 TypeScript declarations or compile a minimal local type fixture proving the low-level request handler receives a second argument containing `requestId`.

Expected handler shape:

```ts
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  // extra.requestId is the inbound JSON-RPC request ID
});
```

Required outcome:

- `registerTools.ts` accepts the handler metadata argument;
- dispatch trace binding uses `extra.requestId`;
- the implementation does not infer request identity from tool name, action, workspace, path, arguments, or handler invocation order.

Stop before production edits if the installed declaration/compiler does not expose `extra.requestId`.

### 2. Remove the metadata/claim-order selector

Delete the production mechanism based on:

- `runWithSelectedToolCallTraceContext`;
- mutable `claimed` flags;
- same-tool fallback;
- first-unclaimed fallback;
- metadata-priority selection by tool/action/workspace/path.

Replace it with an exact request-ID binder, expected as a small API such as:

```ts
runWithToolCallTraceRequestId(requestId, handler)
```

Required behavior:

- a non-batch HTTP call binds the context matching the SDK request ID;
- batch calls bind independently by request ID;
- string and numeric IDs are supported;
- null or missing IDs remain receipt-only unless the SDK dispatches them with a representable request identity;
- raw string IDs are not used as unbounded map keys; use a bounded canonical key or digest internally;
- the public diagnostic ID remains the separately sanitized/capped value;
- no metadata fallback is permitted when an HTTP trace group exists;
- STDIO or non-HTTP calls with no trace context continue to execute normally;
- an HTTP handler invocation with no matching context must not steal another call’s context. Record a safe identity-mismatch diagnostic and fail or isolate the trace deterministically without misattribution.

Distinct request IDs are required for valid batch-call identity. Duplicate wire IDs may be rejected or handled as an explicit ambiguity; they must never cause silent cross-association.

### 3. Create one toolbox action-policy registry

Create a shared module, expected as:

`src/tools/toolboxActionPolicy.ts`

It must define every currently supported toolbox action exactly once with at least:

- toolbox name;
- action name;
- required OAuth scope: `files.read` or `files.write`;
- mapped internal operation name where local write-mode enforcement uses an existing internal tool policy.

The current required policy is:

#### `repo_toolbox`

Read:

- `status`
- `list_files`
- `read_file`
- `search_files`

Write:

- `write_markdown_artifact` → `write_markdown_artifact`
- `write_json_artifact` → `write_json_artifact`
- `propose_patch` → `propose_patch`
- `apply_approved_patch` → `apply_approved_patch`

#### `git_toolbox`

Read:

- `status`
- `diff`
- `pre_commit_scan`
- `readiness_summary`
- `inspect_history`

Write:

- `prepare_work_branch` → `prepare_git_work_branch`
- `stage_paths` → `safe_stage_changes`
- `commit_staged` → `commit_validated_changes`
- `push_current_branch` → `push_current_branch`
- `integrate_to_dev` → `integrate_to_dev`

#### `artifact_toolbox`

All currently supported actions are read-scoped.

#### `diagnostics_toolbox`

All currently supported actions are read-scoped.

#### `integration_toolbox`

Read:

- `list_supported_services`
- `get_service_status`
- `list_service_capabilities`
- `validate_service_configuration`

Write:

- `prepare_external_handoff` → `write_markdown_artifact`

#### `browser_toolbox`

All currently supported actions are read-scoped.

#### `knowledge_toolbox`

All currently supported actions are read-scoped.

Required implementation rules:

- supported action lists must be derived from this registry or exhaustively validated against it;
- the HTTP transport and toolbox router must query the same registry;
- remove individual `assertFilesWrite(...)` calls from action switch branches after equivalent centralized enforcement is proven;
- keep action-level enforcement as defense in depth through the shared registry;
- local write-mode checks continue to use the mapped internal operation;
- unknown or malformed actions remain application validation failures and must not become executable.

### 4. Evaluate OAuth scope per contained call

Replace the single body-level denial string with structured per-call scope evaluations.

For each parsed `tools/call`, determine:

- public tool name;
- toolbox action when safely extractable;
- required scope;
- allowed or denied;
- safe denial code and message when denied.

Top-level `workspace_write_attached_image` requires `files.write`.

Direct non-public or legacy names must preserve their existing safe public-surface rejection and existing scope behavior. Do not expose them.

If the current HTTP transport rejects an entire JSON-RPC batch when one call lacks scope, preserve that external behavior but record truthful per-call evidence:

- the independently denied call is `APP_POLICY_DENIED` with `OAUTH_SCOPE_DENIED` and its own denial message;
- an independently authorized sibling that was not dispatched because the batch was rejected is `RECEIVED_NOT_DISPATCHED`;
- the authorized sibling receives no other call’s denial code or denial message;
- batch response metadata may use a route such as `batch-scope-denied`;
- two denied calls with different requirements retain their own call-specific messages.

Do not change OAuth token semantics, scope names, or public exposure.

### 5. Consolidate diagnostic redaction

Create one shared field-aware module, expected as:

`src/security/diagnosticRedaction.ts`

It must provide separate bounded functions for:

- free-form diagnostic text;
- JSON-RPC IDs;
- structured route values;
- endpoint and host values.

Use this authority in:

- `src/server/toolCallTrace.ts`;
- `src/server/discoveryTrace.ts` or immediately before discovery persistence;
- HTTP transport error diagnostics;
- any request-derived fields persisted by those paths.

Required behavior:

- any Windows drive-absolute path is redacted;
- UNC and extended-length Windows paths are redacted;
- any free-form Unix absolute path is redacted, including `/etc`, `/usr/local`, `/root`, `/run`, `/projects`, and arbitrary configured roots;
- structured approved route values such as `/mcp`, `/health`, and OAuth metadata route paths remain usable only through the route sanitizer;
- full HTTP, HTTPS, WS, and WSS endpoints are redacted or reduced to explicitly approved route-only values;
- caller-controlled string JSON-RPC IDs are sanitized and capped at 128 characters;
- numeric and null IDs remain representable;
- discovery-trace IDs are sanitized before persistence and again when read if backward compatibility requires it;
- request-derived host, forwarded-host, user-agent, and error fields are bounded and sanitized;
- OAuth material, credential-like values, keyed content, patch/file/prompt text, and stack traces remain redacted.

Remove or delegate the overlapping trace and HTTP-error sanitizers. Do not maintain separate regex authorities for the same diagnostic boundary.

### 6. Prove exact request-ID association

Tests must prove cross-layer identity, not only internal trace consistency.

Create a controlled server/handler fixture that returns or otherwise exposes the selected trace correlation ID for each request. Compare:

- input JSON-RPC request ID;
- SDK `extra.requestId`;
- selected trace correlation ID;
- persisted trace JSON-RPC ID;
- JSON-RPC response ID.

Required duplicate-call cases:

- two identical calls with distinct string request IDs;
- three identical calls with distinct IDs;
- delayed or intentionally varied completion order;
- no context stealing or unclaimed valid context;
- an unknown request ID cannot bind another call’s context.

The production implementation must not depend on the order in which SDK handlers run.

### 7. Prove actual HTTP lifecycle boundaries

Add an HTTP-level `DISPATCHED_NOT_EXECUTED` fixture without adding a production-only delay setting.

A permitted test pattern is:

1. send an actual HTTP `tools/call`;
2. bind through `extra.requestId`;
3. record `dispatch_started`;
4. block the controlled handler on a deferred promise before toolbox/helper/result completion;
5. query the persisted trace while the request remains in flight;
6. assert `DISPATCHED_NOT_EXECUTED` and the exact request ID;
7. release the handler and cleanly complete the request.

Retain HTTP evidence for:

- malformed receipt without dispatch;
- action-aware toolbox scope denial before dispatch;
- truthful mixed-batch scope handling;
- successful full lifecycle;
- transport failure.

Direct trace tests may remain for `RESULT_RETURNED` without HTTP completion if an HTTP fixture is not technically feasible.

### 8. Correct tests, documentation, and evidence

Replace or rewrite tests that validate the removed claim-order mechanism.

Correct trace-related claims in:

- `docs/RELEASE_NOTES.md`;
- `docs/SECURITY_MODEL.md`;
- `docs/TOOL_REFERENCE.md`;
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`.

Inspect `docs/CHATGPT_CONNECTION_GUIDE.md`; change it only if a surviving statement becomes inaccurate.

Documentation must state:

- internal registry baseline remains 31 schemas;
- public exposure remains seven stable toolboxes plus the bounded image writer when permitted;
- exact dispatch correlation uses SDK request identity;
- toolbox scope requirements come from one shared action-policy registry;
- mixed-batch evidence is per call;
- trace and discovery persistence use shared field-aware redaction;
- live ChatGPT validation remains NOT_RUN.

The Builder Report must identify every removed heuristic and every surviving limitation. Do not label an assumption or stop condition as PASS.

## Expected Files

Expected new files:

- `src/tools/toolboxActionPolicy.ts`
- `src/security/diagnosticRedaction.ts`

Expected modified files:

- `src/server/registerTools.ts`
- `src/server/toolCallTrace.ts`
- `src/server/discoveryTrace.ts`
- `src/transports/httpTransport.ts`
- `src/tools/domainToolboxes.ts`
- `src/tools/common.ts` only if required to consume shared classification/redaction behavior
- focused trace, transport, toolbox-policy, and discovery tests
- trace-related documentation listed above
- required Builder Report

Do not modify:

- `scripts/promote-runtime-exe.mjs`
- `tests/promoteRuntimeProvenance.test.ts`
- Electron UI
- packaging or release configuration
- WC-V1-0202A or WC-V1-0202B implementation files

## Required Deterministic Acceptance Tests

The implementation must include explicit proof for all of the following:

1. Local SDK declaration/compiler fixture proves handler metadata exposes `requestId`.
2. Every supported toolbox action exists exactly once in the action-policy registry.
3. Supported-action arrays and action-policy registry cannot drift.
4. `repo_toolbox.write_markdown_artifact` with only `files.read` is denied before dispatch.
5. One write-capable `git_toolbox` action with only `files.read` is denied before dispatch.
6. `integration_toolbox.prepare_external_handoff` with only `files.read` is denied before dispatch.
7. A read-scoped toolbox action remains dispatchable with `files.read`.
8. Mixed batch: authorized read plus denied write produces truthful independent classifications.
9. Mixed batch: authorized sibling contains no denied sibling’s code/message.
10. Two separately denied calls retain call-specific denial messages.
11. Two identical calls with distinct IDs bind to the correct correlation and response IDs.
12. Three identical calls with distinct IDs do not cross-associate.
13. Delayed or reversed completion does not affect identity binding.
14. Unknown request ID cannot steal an existing context.
15. No valid batch context remains unmatched after all handlers complete.
16. Existing malformed-call receipt behavior remains passing.
17. Actual in-flight HTTP call is observed as `DISPATCHED_NOT_EXECUTED`.
18. Successful HTTP lifecycle remains fully correlated.
19. `/etc`, `/usr/local`, `/root`, `/run`, `/projects`, and an arbitrary configured root are redacted from free text.
20. A denied absolute `requestedPath` HTTP fixture is redacted in `recent_tool_calls`.
21. A malicious string ID in a mixed discovery/tool-call batch is redacted in both tool-call and discovery persistence.
22. HTTP transport error diagnostics redact arbitrary Windows, UNC, and Unix absolute paths.
23. Route sanitizer preserves approved route fields but rejects or redacts arbitrary path-like values.
24. Numeric/null/safe short IDs remain supported and string IDs remain capped at 128.
25. Existing AppError policy-versus-execution classifications remain passing.
26. Internal registered schema count remains 31.
27. ChatGPT-visible tool exposure remains unchanged.
28. Existing OAuth, session, workspace, write-mode, patch, Git, retention, and corrupt-line tests remain passing.
29. No WC-V1-0202A or WC-V1-0202B behavior appears in the source diff.
30. No claim-order selector, `claimed` field, same-tool fallback, or first-unclaimed fallback remains in production source.

## Validation Requirements

Read `docs/dev/VALIDATION_COMMAND_LANES.md` before child-process-capable commands and use the documented normal Windows lane.

Run in order:

1. repository-defined typecheck;
2. focused SDK identity, action-policy, trace, discovery, and HTTP tests;
3. repository-defined build;
4. broader repository unit lane for touched shared modules;
5. repository-defined MCP self-test;
6. `npm run check:public` if present;
7. lint;
8. `git diff --check`.

Do not use Playwright.
Do not package or promote.
Do not start, stop, or restart the active connector.
Do not reconnect ChatGPT.
Do not perform live connector validation.

## Builder Report Requirements

The REPAIR03 Builder Report must include:

- repository identity and starting HEAD;
- starting/final dirty state;
- exact files changed;
- preservation method;
- local proof that `extra.requestId` exists;
- removed claim-order code and replacement request-ID binder;
- complete action-policy table;
- per-call mixed-batch scope semantics;
- shared redaction API and all consumers;
- actual HTTP lifecycle evidence;
- exact acceptance-test mapping;
- validation commands, lane, and results;
- validation not performed;
- blockers and assumptions;
- confirmation that WC-V1-0202A and WC-V1-0202B were untouched;
- confirmation that nothing was staged, committed, pushed, integrated, packaged, promoted, restarted, reconnected, published, or released;
- exact statement: `No fallback implementation was used.`

## Stop Conditions

Stop before or during implementation rather than improvising if:

- the installed SDK declaration/compiler does not expose `extra.requestId`;
- request-ID binding requires changing the public MCP schema;
- the SDK supplies an identity that cannot be matched to parsed HTTP request IDs;
- truthful per-call scope evidence requires changing OAuth semantics rather than only authorization lookup;
- shared redaction cannot preserve structured routes without allowing arbitrary paths;
- completing REPAIR03 would require WC-V1-0202A or WC-V1-0202B work;
- a fallback or new trace architecture beyond this card appears necessary.

## Manual Validation After Codex

After Architect approval and separately authorized integration/package/promotion:

1. package and promote the approved runtime;
2. restart ChampCity MCP and reconnect the ChatGPT connector;
3. open a new ChatGPT conversation;
4. perform a safe read call and query `recent_tool_calls` by `since`, `correlationId`, and `publicToolName`;
5. perform a write action with insufficient scope and confirm pre-dispatch `APP_POLICY_DENIED`;
6. validate a mixed allowed/denied batch if the live client permits it;
7. reproduce a host-reported blocked call when available;
8. confirm no secret, full endpoint, absolute path, raw string ID content, prompt/file/patch content, or stack trace appears.

These steps are not authorized under REPAIR03 implementation.

## Remaining Passes

After REPAIR03 implementation:

- Architect disposition of the REPAIR03 Builder Report;
- authorized Git integration only if approved;
- implementation of separately approved WC-V1-0202A and WC-V1-0202B in their own sequence;
- separately authorized package-and-promote pass;
- live ChatGPT connector validation;
- final evidence and acceptance-matrix disposition.

## Document Disposition

Document.Status=ApprovedForImplementation
