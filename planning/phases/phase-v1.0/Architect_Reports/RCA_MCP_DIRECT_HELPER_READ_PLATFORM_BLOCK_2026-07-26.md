# Root Cause Analysis — Direct Helper Read Blocked Before Repository Review

Date: 2026-07-26
Repository: `ChampCityChris/ChampCity_GPT_MCP`
Workspace: `champcity_gpt`
Branch observed: `dev`
Disposition: Corrective action required
Severity: P0 connector diagnostics / evidence gap

## Incident Statement

A ChatGPT session reported:

> The direct helper read was blocked by the platform safety layer. I’m continuing through repository diff and targeted searches rather than treating that read failure as evidence about the code.

The statement correctly avoided treating the blocked read as evidence about repository contents. However, the current MCP telemetry is not sufficient to prove precisely where that attempted call stopped.

## Executive Finding

The available evidence does **not** show that the ChampCity MCP repository read implementation is broken. During this review, repeated calls through the supported public route, `repo_toolbox` with `action: read_file`, successfully read source, test, governance, and planning files.

The most likely explanation is a host-side rejection or cancellation before the requested direct helper reached the supported public toolbox workflow. A second plausible explanation is that the session attempted an obsolete direct helper tool such as `read_project_file`, which is intentionally no longer exposed on the public ChatGPT tool surface after toolbox consolidation.

The exact incident cannot be conclusively classified because ChampCity MCP does not currently record a complete, queryable lifecycle for every public `tools/call` request. Existing logs capture discovery, selected transport errors, scope denials, and helper-level file operations, but they do not join those events with a common correlation identifier.

No evidence reviewed establishes that OpenAI blocked the call as part of a deliberate strategy to move users away from ChatGPT.com. That is a motive claim and is not supportable from this incident. The operational problem is still real: safe local repository reads can be rejected or reported as rejected without enough evidence to identify the responsible boundary.

## Evidence Reviewed

1. `repo_toolbox.status` identified the intended repository and branch. The worktree was already dirty, with eight tracked modifications and six untracked files. No existing work was overwritten during this review.
2. `diagnostics_toolbox.runtime_status` reported runtime package `0.3.0`, workspace package `0.3.0`, and no runtime package-version drift.
3. `diagnostics_toolbox.tool_exposure_status` reported 31 internally registered tools and eight public ChatGPT-facing tools, with no scope-filtered tools.
4. `diagnostics_toolbox.chatgpt_discovery_status` reported a successful HTTP 200 JSON-RPC initialization through a stateful session.
5. The supported public read route, `repo_toolbox.read_file`, successfully read multiple files during this review.
6. `src/server/registerTools.ts` confirms that direct legacy helpers are not part of the public toolbox surface. Public calls are limited to the stable toolbox tools plus the bounded image-writer exception when write scope is available.
7. `tests/httpTransport.test.ts` explicitly verifies that direct legacy public tool calls are rejected after toolbox consolidation.
8. `src/tools/readProjectFile.ts` uses `withAudit` and records helper-level allow or deny events.
9. `src/transports/httpTransport.ts` records discovery traces and selected errors, but `recordMcpDiscovery` intentionally covers discovery methods rather than normal `tools/call` traffic.
10. `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md` already recognizes `TOOL_CALL_BLOCKED_BY_CHATGPT_SAFETY` as a P0 failure classification and requires live evidence to distinguish it from application errors.

## Causal Analysis

### Primary causal condition

The request was apparently blocked or abandoned outside the repository helper execution path. The server has no evidence proving that the helper was invoked for the reported incident.

### Contributing factor 1 — Obsolete direct-helper workflow

The phrase “direct helper read” strongly suggests an attempt to use a direct helper rather than the current public `repo_toolbox.read_file` action. Direct legacy helpers remain registered internally for implementation reuse and testing but are intentionally excluded from the public ChatGPT-facing surface.

A model or stale conversation that remembers the former tool surface can attempt the wrong route. Depending on the host behavior, that attempt may be rejected before the server receives it or may be returned as an application-level “not exposed” error.

### Contributing factor 2 — Missing public tool-call lifecycle trace

The current server does not record a complete lifecycle for each public `tools/call` request. Specifically, it lacks a joined sequence such as:

1. HTTP `tools/call` received.
2. MCP SDK dispatch started.
3. Public toolbox handler entered.
4. Toolbox action selected.
5. Internal helper entered.
6. Helper allowed or denied.
7. Tool result returned.
8. HTTP response completed.

Without these stages, an absent helper audit entry cannot distinguish a host-side block from an MCP transport or SDK dispatch failure.

### Contributing factor 3 — Correlation identifier is not consistently propagated

`AuditLogEntry` supports `correlationId`, but normal repository reads do not assign or propagate one. Helper-level logs therefore cannot be reliably joined to transport, dispatcher, or response events.

### Contributing factor 4 — Diagnostics expose discovery, not recent calls

`diagnostics_toolbox.chatgpt_discovery_status` is useful for connection and tool-list evidence, but there is no bounded `recent_tool_calls` diagnostic action. An operator cannot currently ask the MCP server whether a particular attempted call was received and where it ended.

### Contributing factor 5 — Host-side classifications are not observable from the MCP server

A safety decision made before the HTTP request is sent leaves no server event. The MCP can only report that it has no receipt evidence during a specified time window. It must not claim to know the host’s internal reason or motive.

## Root Cause

The root cause of the inability to classify this incident is an observability design gap across the public MCP tool-call boundary. ChampCity MCP logs helper execution and discovery, but it does not maintain a correlated end-to-end trace for normal public tool calls.

The probable trigger for the specific blocked read was use of an obsolete direct helper or a host-side false positive before the supported toolbox call reached the server. That probable trigger is not conclusively proven by current telemetry.

## What Was Ruled Out

- **Broken repository read implementation:** ruled out for the current runtime; supported toolbox reads succeeded repeatedly.
- **Runtime package drift:** ruled out; runtime and workspace package versions matched at `0.3.0`.
- **Missing public tool exposure:** ruled out for the current session; eight public tools were exposed and none were scope-filtered.
- **General OAuth read-scope failure:** not supported by the evidence; read-only toolbox actions succeeded.
- **Repository content as the cause:** not established. A blocked read is not evidence about the file’s content or code correctness.

## Corrective Action

Implement a bounded, redacted public tool-call trace using the existing audit infrastructure.

Required stages:

- `http_received`
- `dispatch_started`
- `toolbox_entered`
- `helper_started` where applicable
- `helper_allowed` or `helper_denied`
- `tool_result_returned`
- `http_response_completed`
- `transport_error` when applicable

Each attempt must receive a correlation identifier generated server-side. The trace may include only safe metadata: timestamp, correlation ID, JSON-RPC request ID when available, public tool name, toolbox action, workspace ID, repository-relative path hint when allowed, stage, result, structured error code, duration, HTTP status, and transport route. It must never record raw file contents, patches, prompts, OAuth values, tokens, credentials, absolute roots, or unrestricted argument payloads.

Add a read-only `diagnostics_toolbox.recent_tool_calls` action returning a bounded redacted view, default 20 and maximum 50. The output must include a classification field based on the deepest recorded stage:

- `NO_SERVER_RECEIPT_EVIDENCE`
- `RECEIVED_NOT_DISPATCHED`
- `DISPATCHED_NOT_EXECUTED`
- `APP_POLICY_DENIED`
- `APP_EXECUTION_ERROR`
- `RESULT_RETURNED`
- `RESPONSE_COMPLETED`

`NO_SERVER_RECEIPT_EVIDENCE` may be reported only as an absence of server evidence for an operator-supplied time window. It must not be phrased as proof of an OpenAI safety decision.

## Acceptance Standard

A live validation run must demonstrate all of the following:

1. A safe `repo_toolbox.read_file` call produces correlated receipt, dispatch, helper, result, and HTTP completion events.
2. A deliberately invalid toolbox action produces correlated application-denial evidence.
3. A direct legacy helper attempt, when the host sends it, produces receipt and public-surface denial evidence.
4. When ChatGPT reports a block and no server receipt exists in the matching time window, diagnostics report `NO_SERVER_RECEIPT_EVIDENCE` rather than inventing an application failure.
5. Local tests prove redaction, bounds, correlation, and classification.
6. Live ChatGPT validation remains mandatory; local tests cannot prove host-side safety behavior.

## Immediate Operating Guidance

Until the corrective action is implemented:

- Use `repo_toolbox` with `action: read_file` for repository text reads.
- Do not use or request direct legacy helpers such as `read_project_file` from ChatGPT.
- Treat any platform-block message without a corresponding MCP audit event as unclassified, not as evidence about repository contents.
- Continue with targeted search, repository diff, and supported toolbox reads when a single read attempt is blocked, while clearly recording the evidentiary limitation.

## Disposition

A new scoped Work Card is required because implementation touches protected MCP HTTP transport, public tool dispatch, diagnostics exposure, and audit behavior.

Document.Status=RevisionRequested
