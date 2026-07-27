# Implementer Prompt — WC-V1-0104A-REPAIR03 Request-ID-Bound Trace and Scope-Policy Consolidation

Recommended Codex model: GPT-5.6
Recommended reasoning level: High

You are the Implementer for ChampCity GPT MCP.

Implement the final bounded repair Work Card:

`planning/phases/phase-v1.0/Work_Cards/WC-V1-0104A-REPAIR03_request_id_bound_trace_and_scope_policy_consolidation.md`

This pass must simplify the implementation. Do not add another heuristic layer to the REPAIR02 design.

## Read Before Editing

Read completely:

1. `AGENTS.MD`
2. `docs/dev/VALIDATION_COMMAND_LANES.md`
3. `planning/phases/phase-v1.0/Work_Cards/WC-V1-0104A_mcp_tool_call_dispatch_trace.md`
4. `planning/phases/phase-v1.0/Work_Cards/WC-V1-0104A-REPAIR01_contract_compliant_mcp_tool_call_trace.md`
5. `planning/phases/phase-v1.0/Work_Cards/WC-V1-0104A-REPAIR02_trace_boundary_classification_redaction_evidence.md`
6. `planning/phases/phase-v1.0/Architect_Reports/ARCHITECT_REVIEW_WC-V1-0104A-REPAIR02_trace_boundary_classification_redaction_evidence.md`
7. `planning/phases/phase-v1.0/Architect_Reports/CODE_REVIEW_RCA_WC-V1-0104A_TRACE_REPAIR_CHURN_2026-07-26.md`
8. `planning/phases/phase-v1.0/Work_Cards/WC-V1-0104A-REPAIR03_request_id_bound_trace_and_scope_policy_consolidation.md`

REPAIR03 controls this implementation. Preserve accepted REPAIR01/REPAIR02 behavior unless this card explicitly replaces it.

## Repository Verification

Expected repository:

`%USERPROFILE%\Projects\ChampCity_GPT`

Expected remote:

`ChampCityChris/ChampCity_GPT_MCP`

Expected branch:

`dev`

Before editing, verify and report:

1. `Get-Location`
2. `git rev-parse --show-toplevel`
3. `git branch --show-current`
4. `git rev-parse HEAD`
5. `git remote -v`
6. `git status --short`
7. `package.json` exists
8. `AGENTS.MD` was read
9. `docs/dev/VALIDATION_COMMAND_LANES.md` was read

Stop before editing if repository identity is wrong.

## Dirty Worktree Preservation

The worktree contains intermingled parent, repair, runtime-drift, promotion-provenance, planning, and unrelated documentation changes.

Do not:

- reset;
- clean;
- stash;
- restore whole files;
- checkout over changes;
- discard unrelated hunks;
- stage;
- commit;
- push;
- integrate;
- package;
- promote;
- restart;
- reconnect;
- publish;
- release.

Before modifying each tracked file:

1. inspect its current diff;
2. identify the REPAIR03-specific hunk;
3. preserve unrelated runtime-drift, promotion-provenance, planning, and accepted repair work;
4. avoid whole-file replacement.

Do not modify:

- `scripts/promote-runtime-exe.mjs`
- `tests/promoteRuntimeProvenance.test.ts`

## Stop-First SDK Verification

Before any production edit, prove locally that the installed SDK handler metadata exposes the inbound JSON-RPC request ID.

The lockfile currently resolves `@modelcontextprotocol/sdk` to `1.29.0`.

Inspect the installed declarations, expected under a path such as:

`node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.d.ts`

or compile a minimal TypeScript fixture against the installed package.

The proof must establish that this compiles:

```ts
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const requestId: string | number = extra.requestId;
  // ...
});
```

Adapt the exact local type annotation to the SDK’s exported `RequestId` type if necessary.

Record the exact local declaration path or compiler proof in the Builder Report.

If the installed package does not expose `extra.requestId`, stop before editing production code and report the exact declaration/compiler output. Do not implement another metadata-order fallback.

## Protected Scope

REPAIR03 authorizes narrow changes to:

- trace request-ID binding;
- toolbox action scope metadata;
- HTTP per-call scope evaluation;
- trace/discovery/HTTP diagnostic redaction;
- trace-related tests and documentation.

It does not authorize changes to:

- the 31-schema internal registry;
- ChatGPT-visible public tools;
- OAuth authorization, DCR, PKCE, token, or refresh-session behavior;
- scope names or token grants;
- local write modes;
- patch proposal or approval semantics;
- workspace routing;
- Git workflow behavior;
- runtime-drift or promotion-provenance implementation;
- packaging or release configuration;
- Electron UI;
- Figma behavior;
- `WC-V1-0202A`;
- `WC-V1-0202B`.

Do not add a dependency.

## Implementation Task 1 — Create the Canonical Toolbox Action Policy

Create:

`src/tools/toolboxActionPolicy.ts`

This module must be the single authority for current toolbox action scope requirements.

Use a strongly typed exhaustive record. A suitable design is:

```ts
export interface ToolboxActionPolicy {
  requiredScope: "files.read" | "files.write";
  mappedInternalOperation?: string;
}

export const TOOLBOX_ACTION_POLICY = {
  repo_toolbox: {
    status: { requiredScope: "files.read" },
    // ...
  },
  // ...
} as const;
```

The exact current policy is defined in the Work Card. Implement it without additions or omissions.

Required exports should include equivalents of:

- `TOOLBOX_TOOL_NAMES`;
- per-toolbox supported action arrays derived from policy keys;
- `getToolboxActionPolicy(toolbox, action)`;
- `requiredScopeForPublicToolCall(publicToolName, action)`;
- mapped internal operation lookup for local write-mode enforcement.

Refactor `src/tools/domainToolboxes.ts` to consume this registry.

Required behavior:

- remove duplicated supported-action declarations or validate them exhaustively against the registry;
- centralize OAuth scope checking in `runToolboxAction` after safe input parsing and before the action handler;
- centralize mapped local write-mode enforcement for `files.write` actions;
- remove individual action-branch `assertFilesWrite(...)` calls after equivalent centralized enforcement is proven;
- preserve all action parameter schemas and handler behavior;
- unknown actions remain `INVALID_INPUT` and never execute.

Avoid circular imports. The new policy module should own stable toolbox/action metadata rather than importing the full toolbox router.

## Implementation Task 2 — Replace Claim-Order Binding With Exact SDK Request-ID Binding

Refactor `src/server/toolCallTrace.ts` and `src/server/registerTools.ts`.

Delete:

- `runWithSelectedToolCallTraceContext`;
- `claimed` fields or casts;
- metadata-based matching;
- same-tool fallback;
- first-unclaimed fallback.

Add an exact binder, expected as:

```ts
runWithToolCallTraceRequestId(requestId, handler)
```

In `registerTools.ts`, use the SDK handler metadata:

```ts
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  return runWithToolCallTraceRequestId(extra.requestId, async () => {
    // existing public dispatch and trace stages
  });
});
```

Internal key requirements:

- numeric IDs use a stable bounded numeric key;
- string IDs use a digest or bounded canonical key so raw untrusted content is not retained as an internal map key;
- the same key function is used for parsed HTTP contexts and SDK `extra.requestId`;
- distinct request IDs select distinct contexts regardless of tool metadata or invocation order;
- valid batch contexts are consumed exactly once;
- no context may be selected by metadata fallback;
- no call may steal another request ID’s context.

Behavior outside HTTP trace groups:

- STDIO and direct local server use continue normally without HTTP receipt tracing.

Identity mismatch behavior:

- if a trace group exists but `extra.requestId` has no matching parsed context, do not choose another context;
- record a safe isolated identity-mismatch diagnostic or fail that invocation deterministically;
- do not expose raw request-ID content;
- do not convert every sibling context into the same mismatch error.

Keep malformed receipt-only contexts. Do not weaken SDK request validation.

## Implementation Task 3 — Per-Call HTTP Scope Evaluation

Replace `mcpScopeDenial(...)` with structured per-call evaluation using the canonical action policy.

For each parsed `tools/call`, determine:

- request-ID-bound trace context;
- public tool name;
- toolbox action where extractable;
- required scope;
- allowed or denied;
- safe denial message.

Scope rules:

- known toolbox actions use `TOOLBOX_ACTION_POLICY`;
- `workspace_write_attached_image` requires `files.write`;
- direct registered legacy names preserve existing read/write classification and public-surface rejection;
- unknown public names or malformed actions are not made executable; preserve current safe dispatcher validation.

Keep action-level scope checks in the toolbox router as defense in depth through the same policy authority.

### Mixed-batch semantics

Preserve the current external behavior if one denied call causes the whole HTTP batch to return 403, but make trace evidence truthful.

For a batch containing:

- authorized `repo_toolbox.read_file`; and
- denied `repo_toolbox.write_markdown_artifact` with only `files.read`:

record:

- write call: `APP_POLICY_DENIED`, `OAUTH_SCOPE_DENIED`, call-specific files.write message;
- read call: `RECEIVED_NOT_DISPATCHED`, no policy code, no write denial message;
- both calls: their own request IDs and correlations;
- response route: a safe batch scope-denial route.

For two separately denied calls, preserve each call’s own required-scope message.

Do not stamp one body-level denial onto every context.

## Implementation Task 4 — Shared Field-Aware Diagnostic Redaction

Create:

`src/security/diagnosticRedaction.ts`

Provide bounded APIs equivalent to:

```ts
sanitizeDiagnosticText(value: string): string
sanitizeDiagnosticJsonRpcId(value: unknown): string | number | null | undefined
sanitizeDiagnosticRoute(value: unknown): string | undefined
sanitizeDiagnosticEndpoint(value: unknown): string | undefined
```

The names may differ, but field semantics must remain separate.

### Free text

Redact:

- every Windows drive-absolute path;
- UNC paths;
- Windows extended-length paths;
- every Unix absolute path in free text, including unknown/custom first segments;
- full HTTP/HTTPS/WS/WSS endpoints;
- OAuth and credential material;
- keyed patch/content/prompt/file/search text;
- stack frames;
- control characters.

Do not use a fixed Unix-prefix allowlist.

### Route fields

Allow only bounded structured route paths required by current diagnostics, including:

- `/mcp`;
- `/health`;
- existing OAuth metadata/authorize/token route paths where applicable.

An arbitrary filesystem-looking path must not become safe merely because it starts with `/`.

### JSON-RPC IDs

- preserve numbers and null;
- preserve safe short strings;
- sanitize strings before persistence and on legacy read;
- cap sanitized strings at 128 characters.

### Endpoint and host fields

- do not persist public tunnel URLs or raw private endpoints;
- return a stable redacted endpoint marker or explicitly safe route-only representation;
- bound and sanitize host, forwarded-host, user-agent, and related request metadata.

Use this module in:

- `src/server/toolCallTrace.ts`;
- `src/server/discoveryTrace.ts` or the immediately preceding persistence boundary;
- `src/transports/httpTransport.ts` error/audit diagnostics.

Remove or delegate:

- `sanitizeTraceString`;
- `safeOAuthErrorDescription` for request/transport diagnostics;
- any separate discovery-ID sanitizer added in this pass.

Do not broaden this Work Card into a full application-output sanitation redesign. `sanitizeToolboxString` may remain if it serves a separate response-sanitization purpose, but it must not be used as the authority for trace/discovery persistence.

## Implementation Task 5 — Prove Cross-Layer Request Identity

Current duplicate tests prove internal consistency only. Replace or extend them with a controlled handler fixture that makes the selected trace correlation observable in each result.

For each request, compare:

1. inbound JSON-RPC request ID;
2. SDK `extra.requestId`;
3. selected trace correlation ID;
4. persisted trace JSON-RPC ID;
5. JSON-RPC response ID.

Required cases:

- two identical calls with distinct string IDs;
- three identical calls with distinct IDs;
- delayed or intentionally varied completion order;
- unknown ID cannot bind an existing context;
- all valid contexts consumed exactly once.

The test must fail if A and B are swapped even when both traces remain internally consistent.

Do not claim order independence unless this cross-layer assertion proves it.

## Implementation Task 6 — Actual HTTP `DISPATCHED_NOT_EXECUTED` Fixture

Create a controlled low-level MCP Server test fixture. Do not add a production delay flag.

Required flow:

1. run the real HTTP transport;
2. send a valid `tools/call`;
3. enter the SDK handler and bind by `extra.requestId`;
4. record `dispatch_started`;
5. block on a deferred promise before result completion;
6. while the HTTP request is still pending, call the trace reader directly from the test;
7. assert stages include `http_received` and `dispatch_started` only;
8. assert classification is `DISPATCHED_NOT_EXECUTED`;
9. assert the exact request ID and correlation;
10. release the deferred handler and clean up.

The test must exercise HTTP receipt and SDK dispatch. A direct trace insertion is not sufficient.

Retain the accepted direct fixture for `RESULT_RETURNED` without HTTP completion if no clean HTTP fixture exists.

## Implementation Task 7 — Discovery and HTTP Diagnostic Persistence

Update discovery persistence so caller-controlled request data cannot bypass the shared redactor.

Required:

- sanitize string `jsonRpc.ids` before writing last/history discovery traces;
- preserve numeric/null IDs;
- sanitize response errors;
- sanitize or redact public base URL, host, forwarded-host, forwarded-proto, user-agent, and other request-derived values;
- maintain bounded discovery history behavior;
- sanitize legacy discovery trace values on read if they can be surfaced publicly.

Update HTTP transport error logging:

- use shared free-text redaction;
- redact arbitrary Windows/UNC/Unix paths;
- redact full endpoints and secrets;
- keep the safe route `METHOD /mcp` representation;
- do not log raw stack traces.

## Required Tests

Implement every deterministic acceptance test listed in the Work Card.

Recommended test organization:

- `tests/toolboxActionPolicy.test.ts`
- `tests/diagnosticRedaction.test.ts`
- focused additions to `tests/toolCallTrace.test.ts`
- focused additions to `tests/httpTransport.test.ts`
- focused discovery-trace tests

At minimum, ensure direct named tests prove:

- installed SDK request-ID contract;
- exhaustive action-policy coverage;
- pre-dispatch files.write denial for repo, Git, and integration toolbox write actions;
- allowed read action with files.read;
- truthful authorized-plus-denied mixed batch;
- call-specific messages for multiple denied calls;
- exact duplicate-call correlation under delayed/reversed completion;
- no context stealing;
- real HTTP `DISPATCHED_NOT_EXECUTED`;
- arbitrary Unix path redaction beyond the prior prefix list;
- denied absolute requestedPath redaction;
- malicious ID redaction in both tool-call and discovery traces;
- shared HTTP error redaction;
- unchanged registry/public exposure and existing behavior;
- absence of claim-order production code;
- absence of WC-V1-0202A/WC-V1-0202B implementation.

Do not treat broad suite success as the only evidence for a semantic boundary.

## Documentation

Correct only trace-related claims in:

- `docs/RELEASE_NOTES.md`
- `docs/SECURITY_MODEL.md`
- `docs/TOOL_REFERENCE.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`

Inspect `docs/CHATGPT_CONNECTION_GUIDE.md`; edit only if current wording becomes inaccurate.

Preserve runtime-drift and promotion-provenance documentation.

Do not mark live CAV cases passed.

Document the actual model:

- 31 internal registered schemas;
- seven public toolboxes plus bounded image writer when permitted;
- SDK request-ID-bound dispatch trace;
- canonical action-policy registry;
- truthful per-call mixed-batch scope evidence;
- shared field-aware diagnostic redaction.

## Required Builder Report

Create:

`planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104A-REPAIR03_request_id_bound_trace_and_scope_policy_consolidation.md`

Do not overwrite earlier Builder Reports.

The report must include:

- repository verification;
- starting/final dirty state;
- exact files changed;
- unrelated-change preservation method;
- exact installed SDK declaration/compiler proof;
- deleted claim-order functions and fallbacks;
- request-ID key/binder design;
- full toolbox action-policy table;
- HTTP/action-level scope enforcement sequence;
- mixed-batch per-call classification rules;
- shared redaction API and every consumer;
- cross-layer identity test method;
- actual HTTP lifecycle fixture;
- exact acceptance-test matrix;
- validation commands, lane, and results;
- validation not performed;
- remaining limitations;
- confirmation that WC-V1-0202A and WC-V1-0202B were untouched;
- confirmation that nothing was staged, committed, pushed, integrated, packaged, promoted, restarted, reconnected, published, or released.

End with:

`No fallback implementation was used.`

Do not mark a stop condition or assumption as PASS.

## Validation Lane

Use the normal Windows validation lane from `docs/dev/VALIDATION_COMMAND_LANES.md`.

Run in this order:

1. repository-defined typecheck;
2. focused SDK identity, policy, redaction, discovery, trace, and HTTP tests;
3. repository-defined build;
4. broader repository unit lane required by shared modules;
5. repository-defined MCP self-test;
6. `npm run check:public` if present;
7. lint;
8. `git diff --check`.

Record exact commands and results.

Do not use Playwright.
Do not package.
Do not promote.
Do not restart or reconnect.
Do not perform live validation.

## Git Restrictions

Leave all changes unstaged for Architect review.

Do not:

- stage;
- commit;
- push;
- merge;
- integrate;
- tag;
- package;
- promote;
- publish;
- release;
- rewrite history.

## Stop Conditions

Stop rather than improvise if:

- the installed SDK lacks `extra.requestId`;
- exact request-ID binding requires a public schema change;
- parsed HTTP IDs cannot be matched to SDK request IDs;
- action-aware HTTP scope evaluation requires changing OAuth semantics;
- field-aware redaction cannot safely distinguish routes from filesystem paths;
- implementation overlaps WC-V1-0202A or WC-V1-0202B;
- a fallback architecture appears necessary.

Do not create or propose REPAIR04.

## Manual Validation After Codex

Report these as not performed:

1. Architect reviews REPAIR03 source, tests, and Builder Report.
2. After approval, a separately authorized pass integrates the change set.
3. Separately approved WC-V1-0202A and WC-V1-0202B proceed in their own sequence.
4. A separately authorized pass packages and promotes the runtime.
5. Operator restarts ChampCity MCP and reconnects ChatGPT.
6. Operator opens a new conversation.
7. Operator performs a safe read call and queries `recent_tool_calls` by `since`, `correlationId`, and `publicToolName`.
8. Operator performs a write action without `files.write` and confirms pre-dispatch `APP_POLICY_DENIED`.
9. Operator checks a blocked or malformed request when available.
10. Operator confirms no raw request-ID content, secret, endpoint, absolute path, prompt/file/patch content, or stack trace appears.

## Remaining Passes for the Current Phase

After REPAIR03 implementation:

- Architect disposition of the REPAIR03 Builder Report;
- authorized Git integration only if approved;
- separate WC-V1-0202A implementation;
- separate WC-V1-0202B implementation;
- separately authorized package-and-promote pass;
- live ChatGPT connector validation;
- final evidence and acceptance-matrix disposition.
