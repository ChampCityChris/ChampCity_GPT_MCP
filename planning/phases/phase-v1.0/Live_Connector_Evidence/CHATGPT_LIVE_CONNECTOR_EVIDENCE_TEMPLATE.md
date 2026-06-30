# ChatGPT Live Connector Evidence

Evidence file version: `1`

This template is for operator-assisted live ChatGPT connector validation. Local deterministic checks support release validation, but they do not replace live ChatGPT validation. Do not include screenshots unless separately authorized by the operator/Architect.

## 1. Validation metadata

Evidence file version:
Validation date/time:
Operator:
Architect:
App version:
Commit:
Branch:
Package/build source:
ChatGPT plan/session type:
Connector name:
Public endpoint alias:
Public endpoint redacted: `<REDACTED_PUBLIC_ENDPOINT>`
Cloudflare tunnel state:
OAuth path:
Write mode:
OAuth scopes observed:
Local MCP self-test result:
Evidence redactions confirmed:

Use named OAuth scopes only. Do not include tokens, authorization codes, client secrets, raw OAuth stores, local config contents, private local paths, or raw sensitive public endpoints. Use `%USERPROFILE%`, `%TEMP%`, `<REDACTED_LOCAL_PATH>`, `<REDACTED_PUBLIC_ENDPOINT>`, and `<REDACTED_SECRET>` as needed.

## 2. Local deterministic baseline

Record command outcomes:

| Command | Result | Sanitized observation | Notes |
| --- | --- | --- | --- |
| `npm run mcp:self-test` | NOT_RUN |  |  |
| `npm run mcp:self-test -- --json` | NOT_RUN |  |  |
| `npm run check:public` | NOT_RUN |  |  |

Local deterministic checks do not replace live ChatGPT connector validation.

## 3. Live ChatGPT setup evidence

| Test ID | Status | Evidence class | Sanitized observation | Failure classification | Notes |
| --- | --- | --- | --- | --- | --- |
| CAV-007 | NOT_RUN | CHATGPT_UI_OBSERVATION / APP_LOG / REDACTED_DIAGNOSTIC_EXPORT |  |  | Dynamic Client Registration succeeds. |
| CAV-008 | NOT_RUN | CHATGPT_UI_OBSERVATION / APP_LOG / REDACTED_DIAGNOSTIC_EXPORT |  |  | Authorization flow succeeds with PKCE. |
| CAV-009 | NOT_RUN | CHATGPT_UI_OBSERVATION / APP_LOG / REDACTED_DIAGNOSTIC_EXPORT |  |  | Token exchange succeeds without recording token values. |
| CAV-010 | NOT_RUN | CHATGPT_UI_OBSERVATION / OPERATOR_SCREEN_CONFIRMATION |  |  | Connector appears connected. |
| CAV-027 | NOT_RUN | APP_LOG / REDACTED_DIAGNOSTIC_EXPORT |  |  | Last MCP discovery trace is captured if available. |

## 4. Live tools/list evidence

| Test ID | Status | Tool count observed | Required tools visible | Missing tools | ChatGPT safety-layer behavior | Sanitized evidence excerpt | Failure classification | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CAV-011 | NOT_RUN |  | `get_workspace_status_summary`, `get_change_set_readiness_summary`, `get_release_artifact_summary`, `get_release_publication_summary`, `get_builder_report_index`, `get_builder_report_summary` |  |  |  |  | A namespace visible with zero tools is a failure. |

Also record any other required tools from the acceptance matrix that are visible in the live ChatGPT `tools/list` result.

## 5. Live successful safe tool-call evidence

| Test ID | Tool name | Operator prompt used | Expected behavior | Actual behavior | Status | Sanitized result excerpt | Failure classification | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CAV-012 | `get_workspace_status_summary` |  | Read-only repo status succeeds. |  | NOT_RUN |  |  |  |
| CAV-012 | `get_change_set_readiness_summary` |  | Read-only change-set readiness succeeds. |  | NOT_RUN |  |  |  |
| CAV-013 | `read_project_file` or `search_project_files` with a narrow safe path |  | Safe read/search succeeds without exposing blocked files. |  | NOT_RUN |  |  |  |
| CAV-014 | `write_markdown_artifact` when current mode and scope allow it |  | Safe docs-write artifact creation succeeds only when allowed. |  | NOT_RUN |  |  | Optional if the validation pass includes docs-write success. |
| CAV-021 | `get_workspace_status_summary` / `get_change_set_readiness_summary` |  | Git status/readiness workflow avoids safety-layer false positives. |  | NOT_RUN |  |  |  |
| CAV-023 | `get_release_artifact_summary` / `get_release_publication_summary` |  | Release baseline/status workflow is read-only and safety-layer compatible. |  | NOT_RUN |  |  |  |
| CAV-033 | `get_builder_report_index` / `get_builder_report_summary` |  | Builder Report discovery avoids broad recursive glob false positives. |  | NOT_RUN |  |  |  |

## 6. Live denied unsafe/gated-call evidence

Use safe placeholder attempts only. Do not use real secrets, private files, local config, OAuth stores, or release binaries.

| Test ID | Attempted operation | Expected denial | Actual denial | Status | Sanitized denial excerpt | Failure classification | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CAV-015 | Attempt safe docs-write when mode or OAuth scope does not allow it. | Denied by scope or local write mode. |  | NOT_RUN |  |  |  |
| CAV-018 | Attempt elevated script execution through the public ChatGPT workflow. | Unavailable or denied by app policy. |  | NOT_RUN |  |  |  |
| CAV-019 | Attempt blocked placeholder path read/write such as `<REDACTED_LOCAL_PATH>/.env` or traversal text. | Denied without leaking contents. |  | NOT_RUN |  |  |  |

## 7. Safety-layer regression evidence

Do not retest unsafe or broad legacy calls unless the operator explicitly chooses to do so.

| Legacy pattern | Safe replacement | Live replacement status | Legacy retest performed: yes/no | Notes |
| --- | --- | --- | --- | --- |
| `git_status` blocked | `get_workspace_status_summary` | NOT_RUN | no | CAV-030 |
| `get_commit_readiness` blocked | `get_change_set_readiness_summary` | NOT_RUN | no | CAV-030 |
| `list_project_files` with `release/*.exe` blocked | `get_release_artifact_summary` | NOT_RUN | no | CAV-030 |
| `run_allowed_script` with release lookup blocked | `get_release_publication_summary` | NOT_RUN | no | CAV-030 |
| `list_project_files` with `planning/phases` plus broad Builder Report glob blocked | `get_builder_report_index` / `get_builder_report_summary` | NOT_RUN | no | CAV-030 and CAV-033 |

## 8. Failure classification

Statuses:

- PASS
- FAIL
- BLOCKED
- NOT_RUN
- WAIVED_BY_OPERATOR

Failure classes:

- CHATGPT_SAFETY_LAYER
- TOOLS_LIST_FAIL
- TOOL_NOT_VISIBLE
- TOOL_CALL_APP_ERROR
- TOOL_CALL_DENIED_BY_APP_POLICY
- OAUTH_METADATA_FAIL
- DCR_FAIL
- PKCE_FAIL
- TOKEN_EXCHANGE_FAIL
- PUBLIC_ENDPOINT_UNREACHABLE
- SCOPE_MISSING
- WRITE_MODE_BLOCKED
- REPORT_DISCOVERY_UNAVAILABLE
- SECRET_SAFETY_BLOCKER
- EVIDENCE_INCOMPLETE
- MANUAL_OPERATOR_VALIDATION_REQUIRED

## 9. Redaction checklist

Confirm the evidence contains no:

- [ ] access tokens
- [ ] refresh tokens
- [ ] authorization codes
- [ ] client secrets
- [ ] OAuth stores
- [ ] Cloudflare tokens
- [ ] GitHub tokens
- [ ] Figma tokens
- [ ] `.env` contents
- [ ] local config contents
- [ ] private local user paths
- [ ] raw public tunnel URL if sensitive
- [ ] release binary contents
- [ ] logs with secrets
- [ ] screenshots unless separately authorized
- [ ] PEM/private-key material

CAV-031 diagnostic evidence export safety status:

| Test ID | Status | Sanitized observation | Failure classification | Notes |
| --- | --- | --- | --- | --- |
| CAV-031 | NOT_RUN |  |  | Diagnostic/export evidence is safe and redacted. |

## 10. Final release-gate summary

P0 scenarios run:
P0 passed:
P0 failed:
P0 blocked:
P0 waived:
Release-gate status:
Operator signoff:
Architect signoff:
