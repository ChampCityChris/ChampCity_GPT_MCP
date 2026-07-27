# Code Review and RCA — WC-V1-0104A Tool-Call Trace Repair Churn

Date: 2026-07-26
Repository: `ChampCityChris/ChampCity_GPT_MCP`
Workspace: `%USERPROFILE%\Projects\ChampCity_GPT`
Branch reviewed: `dev`
Reviewed lineage:

- `WC-V1-0104A`
- `WC-V1-0104A-REPAIR01`
- `WC-V1-0104A-REPAIR02`
- all corresponding Builder Reports and Architect Reviews

## Executive Conclusion

The repeated repair cycle was avoidable.

The remaining defects do not require another incremental patch to the current heuristics. They require one bounded consolidation pass that replaces three duplicated or assumption-based mechanisms:

1. replace metadata-and-order trace-context claiming with exact SDK request-ID binding;
2. replace scattered read/write knowledge with one toolbox-action policy registry;
3. replace multiple partial sanitizers with one field-aware diagnostic redaction module.

The most important code-review discovery is that the installed MCP SDK contract exposes the JSON-RPC request ID to the low-level request handler through the second handler argument, `extra.requestId`. The current implementation does not use it. Instead, REPAIR01 and REPAIR02 built and tested a `claimed`-flag selector based on tool name, action, workspace, path, and assumed SDK invocation order.

That incorrect SDK assumption is the primary reason duplicate-call correlation remained unresolved through two repairs.

REPAIR03 should delete the selector and bind dispatch directly by `extra.requestId`. It should not attempt a fourth variation of metadata matching.

## Repository Code Reviewed

The review inspected the current implementations and tests for:

- `src/server/registerTools.ts`
- `src/server/toolCallTrace.ts`
- `src/transports/httpTransport.ts`
- `src/tools/domainToolboxes.ts`
- `src/tools/common.ts`
- `src/utils/errorClassification.ts`
- `src/server/discoveryTrace.ts`
- `src/security/auditLog.ts`
- `src/server/createMcpServer.ts`
- `tests/httpTransport.test.ts`
- `tests/toolCallTrace.test.ts`
- current trace-related documentation and acceptance evidence
- `package-lock.json`
- the MCP TypeScript SDK v1 request-handler contract used by the installed `@modelcontextprotocol/sdk` package

The lockfile resolves `@modelcontextprotocol/sdk` to version `1.29.0`.

## Root-Cause Analysis

### Root Cause 1 — The implementation failed to inspect the SDK request-handler contract

The current production handler is registered as:

```ts
server.setRequestHandler(CallToolRequestSchema, async (request) => {
```

The low-level SDK handler accepts a second argument containing request metadata. The v1 SDK `RequestHandlerExtra` includes:

```ts
requestId: RequestId
```

The SDK constructs that value from the inbound JSON-RPC request ID and passes it to the handler.

The current trace design ignored that API and invented `runWithSelectedToolCallTraceContext`, which:

- matches by public tool name;
- then action;
- then workspace ID;
- then requested path;
- then falls back to first unclaimed same-tool context;
- then first unclaimed context;
- mutates a shared `claimed` flag.

That mechanism is inherently weaker than the available SDK identity. Tests proving that two correlations and two IDs exist cannot prove that the SDK response ID was attached to the correct correlation when the production selector never receives the response ID.

This was not a subtle runtime limitation. It was a missed API capability.

### Root Cause 2 — OAuth scope authority is duplicated and incomplete

Write authority currently exists in several disconnected forms:

- top-level `READ_TOOL_NAMES` and `WRITE_TOOL_NAMES` in `registerTools.ts`;
- individual `assertFilesWrite(...)` calls inside toolbox switch cases;
- `mcpScopeDenial(...)` in `httpTransport.ts`;
- public tool exposure filtering;
- local write-mode mapping through internal legacy tool names.

The HTTP gate knows only the top-level MCP name. It does not know that:

- `repo_toolbox.write_markdown_artifact` is write-scoped;
- `repo_toolbox.apply_approved_patch` is write-scoped;
- `git_toolbox.stage_paths` is write-scoped;
- `integration_toolbox.prepare_external_handoff` is write-scoped.

The toolbox router knows those facts, but only inside switch-case branches. There is no canonical action-policy registry the transport can query.

That duplication caused the scope-boundary defect and made the mixed-batch evidence inaccurate.

### Root Cause 3 — Redaction is implemented as unrelated regex copies

The repository currently has separate sanitization behavior in at least:

- `sanitizeTraceString` in `toolCallTrace.ts`;
- `safeOAuthErrorDescription` in `httpTransport.ts`;
- `sanitizeToolboxString` in `domainToolboxes.ts`;
- no equivalent sanitizer before `writeMcpDiscoveryTrace` persists JSON-RPC IDs and endpoint metadata.

Each repair expanded one sanitizer while adjacent persistence routes remained unchanged.

This is why REPAIR02 could truthfully sanitize the tool-call trace while still allowing caller-controlled IDs into the discovery trace and weaker path handling into HTTP error diagnostics.

### Root Cause 4 — Tests proved internal self-consistency rather than cross-layer identity

Several tests asserted that:

- each trace contains one ID;
- all events inside that trace use the same ID;
- all expected IDs appear somewhere.

Those assertions are necessary but insufficient. They do not prove that the SDK response with ID `B` used correlation context `B` rather than context `A` whose stored ID was internally consistent.

The correct test must compare the SDK handler's `extra.requestId` to the selected trace context and the emitted response ID.

### Root Cause 5 — The acceptance matrix encouraged symptom patching

The original capability sounds simple: record where an MCP call reached.

In code, it crosses:

- raw HTTP receipt;
- JSON-RPC batch parsing;
- OAuth scope checks;
- SDK validation;
- low-level request dispatch;
- toolbox routing;
- helper execution;
- response generation;
- trace persistence;
- redaction;
- diagnostics querying.

The repair cards enumerated many edge tests but did not initially mandate a single identity model, policy registry, or redaction authority. Implementers satisfied individual rows by adding local behavior rather than simplifying the architecture.

### Root Cause 6 — Builder Reports treated acknowledged assumptions as passed criteria

REPAIR02 correctly disclosed the alleged SDK limitation, but then marked the duplicate-call criterion `PASS with limitation` even though the Work Card defined inability to prove identity as a stop condition.

A limitation can support approval only when the Work Card explicitly permits it. It cannot convert a stop condition into a pass.

## Specific Code Findings

### Finding A — Exact request identity is already available

`registerTools.ts` must accept the handler's second argument and use `extra.requestId`.

The following should be removed:

- `runWithSelectedToolCallTraceContext`;
- metadata-priority context selection;
- `claimed` mutation;
- same-tool and first-unclaimed fallbacks.

The trace group should index contexts by a canonical internal request-ID key and consume the exact matching context.

For caller-controlled string IDs, the internal key should use a one-way digest or another bounded canonical representation. The public diagnostic value remains separately sanitized and capped.

### Finding B — The repository needs one action-policy table

A toolbox action policy must define, for every supported toolbox action:

- required OAuth scope: `files.read` or `files.write`;
- mapped internal write operation, when local write-mode enforcement is required;
- whether the action is known and supported.

The supported-action lists should be derived from, or validated against, that policy table.

Both the HTTP transport and `runToolboxAction` must use the same policy.

### Finding C — Scope evaluation must be per call, not per body

The transport currently returns one denial string for a batch and stamps that denial onto every tool-call context.

The replacement must evaluate each parsed call independently.

If one denied call causes the existing transport behavior to reject the entire batch:

- the independently denied call is `APP_POLICY_DENIED` with its own denial code/message;
- an independently authorized sibling is `RECEIVED_NOT_DISPATCHED` because the batch was rejected before dispatch;
- the authorized sibling must not receive the denied call's policy code or denial message;
- response-route metadata may state `batch-scope-denied`.

This preserves current batch rejection behavior without falsifying per-call evidence.

### Finding D — Field-aware redaction is required

Free-form diagnostic text must redact any absolute local path, not selected Unix prefixes.

Structured route fields should be handled separately and may preserve approved route values such as `/mcp` and `/health`.

A single module should provide:

- bounded free-text diagnostic sanitization;
- string JSON-RPC ID sanitization;
- route sanitization;
- host/endpoint sanitization where persisted;
- recursive or field-specific discovery-trace sanitization.

### Finding E — Discovery trace persistence is part of the same diagnostic boundary

`writeMcpDiscoveryTrace` currently persists data supplied by `recordMcpDiscovery` without a final sanitization boundary.

At minimum, the shared redactor must cover:

- string JSON-RPC IDs;
- response errors;
- public endpoint values;
- host/forwarded-host values;
- caller-controlled user-agent and header text with deterministic bounds.

### Finding F — `DISPATCHED_NOT_EXECUTED` can be tested without a production test hook

A controlled low-level Server fixture can:

1. receive an actual HTTP tool call;
2. bind the trace by `extra.requestId`;
3. record `dispatch_started`;
4. wait on a deferred promise before returning a result;
5. allow the test to query the persisted trace while the HTTP request is in flight;
6. confirm `DISPATCHED_NOT_EXECUTED`;
7. release the promise and complete cleanup.

No production-only delay hook is required.

## Required Final Architecture

REPAIR03 should implement the following bounded architecture.

### 1. Toolbox action policy registry

Create a small shared module, expected as:

`src/tools/toolboxActionPolicy.ts`

It should export:

- the stable toolbox names;
- a complete policy record for every supported action;
- supported action names derived from the policy;
- `getToolboxActionPolicy(toolbox, action)`;
- `requiredScopeForPublicToolCall(publicToolName, action)`;
- mapped internal write-tool names where needed.

`domainToolboxes.ts`, `httpTransport.ts`, and tool-exposure diagnostics must consume that authority.

### 2. Exact request-ID trace binder

Refactor `toolCallTrace.ts` so a trace group contains an exact request-ID lookup.

Expected API:

```ts
runWithToolCallTraceRequestId(requestId, handler)
```

The implementation must:

- select by the SDK request ID;
- support string and numeric IDs;
- use a bounded internal key;
- support a queue for duplicate wire IDs without using metadata fallback;
- expose no raw internal key;
- remove `claimed` and metadata-based selection.

`registerTools.ts` must use:

```ts
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  return runWithToolCallTraceRequestId(extra.requestId, async () => {
    // existing dispatch
  });
});
```

### 3. Per-call scope evaluation

Replace `mcpScopeDenial` with a structured evaluation result.

Expected shape:

```ts
interface ToolCallScopeEvaluation {
  context: ToolCallTraceContext;
  requiredScope?: "files.read" | "files.write";
  allowed: boolean;
  denialCode?: "OAUTH_SCOPE_DENIED";
  denialMessage?: string;
}
```

A separate batch result may indicate that the HTTP body is rejected because one or more entries failed scope validation.

### 4. Shared diagnostic redaction

Create a small shared module, expected as:

`src/security/diagnosticRedaction.ts`

It must be the only authority for trace/discovery/HTTP diagnostic sanitization.

The module must distinguish:

- free text;
- JSON-RPC IDs;
- route values;
- endpoint/host values.

## Scope Control

REPAIR03 is not authorization to redesign:

- the 31-schema internal registry;
- public tool exposure;
- OAuth semantics;
- write modes;
- patch approval;
- Git workflow;
- workspace routing;
- trace retention count;
- runtime drift or promotion provenance;
- packaging;
- Electron UI;
- WC-V1-0202A or WC-V1-0202B.

## Recommended Disposition

Create one final bounded Work Card:

`WC-V1-0104A-REPAIR03 — Request-ID-Bound Trace and Scope-Policy Consolidation`

The card should require deletion of obsolete heuristics, not merely additional tests around them.

No REPAIR04 should be planned. If the installed SDK does not expose `extra.requestId` despite the package contract, the Implementer must stop before editing and return exact declaration/compiler evidence.

Document.Status=Completed
