# Builder Report - WC-V1-0104A MCP Tool-Call Dispatch Trace

Date: 2026-07-26
Repository: `ChampCityChris/ChampCity_GPT_MCP`
Workspace: `%USERPROFILE%\Projects\ChampCity_GPT`
Branch: `dev`
HEAD: `780217aa1046ad8d271d13887ba1121bba419362`

## Repository Verification

- `pwd`: `%USERPROFILE%\Projects\ChampCity_GPT`
- `git rev-parse --show-toplevel`: `%USERPROFILE%/Projects/ChampCity_GPT`
- `git remote -v`: `https://github.com/ChampCityChris/ChampCity_GPT_MCP.git`
- `package.json`: present
- `AGENTS.MD`: read
- `docs/dev/VALIDATION_COMMAND_LANES.md`: read before validation

## Starting Dirty Worktree

Starting branch was `dev` at `780217aa1046ad8d271d13887ba1121bba419362`.

Starting dirty state included pre-existing modified files:

- `docs/RELEASE_NOTES.md`
- `docs/SECURITY_MODEL.md`
- `docs/TOOL_REFERENCE.md`
- `planning/phases/phase-v1.0/04_operator_intake_interview.md`
- `planning/phases/phase-v1.0/Live_Connector_Evidence/README.md`
- `scripts/promote-runtime-exe.mjs`
- `src/tools/domainToolboxes.ts`
- `tests/domainToolboxes.test.ts`

Starting dirty state also included pre-existing untracked planning/report/test artifacts under `Architect_Reports`, `Builder_Reports`, `Implementer_Prompts`, `Work_Cards`, `planning/project`, and `tests/promoteRuntimeProvenance.test.ts`.

Pre-existing runtime-drift, promotion-provenance, planning, and documentation changes were preserved. No reset, restore, clean, stash, checkout, rebase, merge, or discard operation was performed.

## Files Changed By This Pass

- `src/server/registerTools.ts`
- `src/server/toolCallTrace.ts`
- `src/transports/httpTransport.ts`
- `src/tools/common.ts`
- `src/tools/domainToolboxes.ts`
- `src/utils/errors.ts`
- `src/validation/mcpSelfTest.ts`
- `tests/httpTransport.test.ts`
- `tests/toolSchema.test.ts`
- `docs/RELEASE_NOTES.md`
- `docs/SECURITY_MODEL.md`
- `docs/TOOL_REFERENCE.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`
- `planning/phases/phase-v1.0/Implementer_Prompts/IMPLEMENTER_PROMPT_WC-V1-0104A_mcp_tool_call_dispatch_trace.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104A_mcp_tool_call_dispatch_trace.md`

## Implementation Summary

Removed obsolete top-level MCP tool schemas from the public registration catalog. The only registered public MCP tools are now:

- `repo_toolbox`
- `git_toolbox`
- `artifact_toolbox`
- `diagnostics_toolbox`
- `integration_toolbox`
- `browser_toolbox`
- `knowledge_toolbox`
- `workspace_write_attached_image`

Legacy top-level names now return `LEGACY_TOOL_REMOVED` when directly submitted through `tools/call`, with migration routes such as `repo_toolbox.read_file` and `git_toolbox.diff`. `run_allowed_script` reports removal without recommending arbitrary execution.

Internal helpers retained include `readProjectFile`, `listProjectFiles`, `searchProjectFiles`, `gitDiff`, `proposePatch`, `applyApprovedPatch`, `writeMarkdownArtifact`, `writeJsonArtifact`, and existing guarded git workflow functions. Public tool names and internal guarded operation names are separated; `assertWriteToolEnabled` continues to enforce internal operation policy without requiring those operations to be registered as public tools.

Added `src/server/toolCallTrace.ts` using Node `AsyncLocalStorage` and JSONL trace storage beside the audit log. The trace is bounded and redacted, and write failures do not fail the underlying tool call.

Implemented trace stages:

- `http_received`
- `dispatch_started`
- `legacy_tool_rejected`
- `toolbox_entered`
- `helper_started`
- `helper_allowed`
- `helper_denied`
- `tool_result_returned`
- `http_response_completed`
- `transport_error`

Implemented diagnostic classifications:

- `NO_SERVER_RECEIPT_EVIDENCE`
- `RECEIVED_NOT_DISPATCHED`
- `DISPATCHED_NOT_EXECUTED`
- `APP_POLICY_DENIED`
- `APP_EXECUTION_ERROR`
- `LEGACY_TOOL_REMOVED`
- `RESULT_RETURNED`
- `RESPONSE_COMPLETED`
- `TRANSPORT_ERROR`

Added `diagnostics_toolbox.recent_tool_calls` with `limit`, `correlationId`, `publicTool`, and `action` filters. It reads only redacted tool-call trace events and does not return absolute audit-log paths.

Updated `withAudit` so helper audit records inherit the current request correlation ID when one exists and emit helper trace stages around existing allow/deny audit semantics.

## Tests Added Or Changed

- Public registration tests now assert exactly the eight approved public MCP tools and absence of removed legacy names from registered schemas.
- Legacy-call tests now assert `LEGACY_TOOL_REMOVED` migration errors for `read_project_file` and `git_diff`, no arbitrary replacement for `run_allowed_script`, and normal unknown-tool behavior for unrelated names.
- Correlated trace tests cover successful `repo_toolbox.read_file`, helper audit correlation, validation-denial classification, legacy-removal classification, diagnostic filtering, missing correlation `NO_SERVER_RECEIPT_EVIDENCE`, transport-error classification/redaction, and trace-write failure tolerance.
- MCP self-test now treats gated legacy operations as internal policy names rather than registered tools, and fails if removed safe facade schemas reappear as public top-level tools.

## Validation

Execution lane: documented normal Windows validation lane for child-process-capable commands; `git diff --check` was run as a non-spawning local git check.

- `npm run typecheck`: PASS
- `npm run build`: PASS
- `node --test dist/tests/httpTransport.test.js dist/tests/gitIntegrateToDev.test.js`: PASS
- `npm run validate:codex:unit`: first run FAIL, then PASS after fixes
  - Initial failures: trace JSONL appeared in an existing list-files assertion; one git integration fixture failed in that run but passed on targeted rerun and full rerun.
  - Corrected by filtering diagnostic `logs/` output in the affected transport test.
- `npm run lint`: PASS
- `npm run check:public`: first run FAIL, then PASS
  - Initial failure: pre-existing untracked Implementer Prompt contained an unredacted local user path.
  - Corrected by redacting the prompt path to `%USERPROFILE%\Projects\ChampCity_GPT`.
- `npm run mcp:self-test -- --json`: PASS
- `npm run chatgpt:evidence:validate -- --template`: PASS
- `git diff --check`: PASS

Validation not performed:

- Live ChatGPT connector validation was not performed.
- Packaging was not performed.
- Runtime promotion was not performed.
- Playwright/browser visual validation was not performed.

## Protected Subsystem Confirmation

Touched authorized protected areas:

- MCP HTTP transport request tracing
- MCP public tool registration
- MCP public tool dispatch
- Toolbox dispatch diagnostics
- Existing audit-log metadata/correlation integration
- Read-only diagnostics

Not changed:

- OAuth behavior
- Dynamic Client Registration behavior
- PKCE behavior
- Access-token or refresh-token behavior
- Cloudflare configuration or tunnel behavior
- Workspace routing semantics
- Write-mode semantics
- Patch approval semantics
- Git workflow semantics
- Figma behavior
- Packaging/release configuration
- Runtime promotion
- Electron UI

## Source-Control And Release Confirmation

Nothing was staged, committed, pushed, tagged, packaged, promoted, published, or released.

No unrelated changes were reverted.

## Remaining Operator Validation

Operator should:

1. Review the complete Git diff and confirm unrelated dirty-worktree changes remain intact.
2. Commit and integrate only after Architect approval.
3. Package the approved current version.
4. Promote the runtime executable.
5. Restart ChampCity MCP.
6. Disconnect and reconnect the ChatGPT connector.
7. Start a new ChatGPT conversation.
8. Verify the connector exposes only the seven toolbox tools, plus `workspace_write_attached_image` when write scope and local write mode permit.
9. Perform a supported `repo_toolbox.read_file` call.
10. Query `diagnostics_toolbox.recent_tool_calls` and confirm the successful call has correlated receipt, dispatch, toolbox, helper, result, and response evidence.
11. Attempt a legacy direct `read_project_file` call from a controlled MCP client and confirm `LEGACY_TOOL_REMOVED`.
12. Reproduce a ChatGPT-side blocked-call condition if available and confirm whether the server has receipt evidence.
13. Record results in the live connector evidence artifact.

## Blockers And Assumptions

No implementation blocker remains for local deterministic validation.

Assumption: live ChatGPT behavior still requires operator validation after package and runtime promotion; local tests do not prove ChatGPT.com host-side safety-layer behavior.

No fallback implementation was used.
