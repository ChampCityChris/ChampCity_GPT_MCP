# ChatGPT Connector Acceptance Matrix

Work Card: `WC-V1-0101`
Created: 2026-06-29

## 1. Purpose

This matrix defines the required v1.0 ChatGPT connector acceptance checks for ChampCity GPT MCP.

ChatGPT.com is the only required MCP host for v1.0. Local deterministic checks are useful for development and release confidence, but they do not replace live ChatGPT connector validation. This matrix defines the tests that must pass; it does not claim any test was run unless supporting evidence is recorded.

Initial status for all scenarios in this document is `NOT_RUN` because `WC-V1-0101` is a documentation and test-design Work Card, not a live connector validation pass.

## 2. Scope

In scope for this matrix:

- public endpoint reachability;
- OAuth/DCR metadata;
- protected resource metadata;
- ChatGPT connector creation and recreation;
- tool discovery;
- read-only tool calls;
- docs-write tool calls, if permitted by current mode and OAuth scope;
- write-scope denial behavior;
- unsafe and elevated tool denial behavior;
- last discovery trace and evidence capture;
- Cloudflare tunnel current reachability;
- Cloudflare tunnel persistence after reboot;
- safety-layer false-positive tracking;
- user-facing diagnosis and remediation evidence.

Out of scope for v1.0 acceptance:

- Claude, Cursor, Copilot, Windsurf, or other MCP host validation;
- A2A or multi-agent validation;
- Figma Make workflow validation;
- Work Cards as an app feature;
- arbitrary shell or elevated script execution as a normal ChatGPT-facing workflow.

## 3. Acceptance Status Definitions

Statuses:

- `PASS`: the scenario was executed and met the expected result with required evidence.
- `FAIL`: the scenario was executed and did not meet the expected result.
- `BLOCKED`: the scenario could not be executed because a prerequisite, environment, operator action, or upstream dependency was unavailable.
- `NOT_RUN`: the scenario has not been executed in the current validation pass.
- `DEFERRED`: the scenario is intentionally not part of the current validation pass; this does not satisfy a P0 release gate unless separately waived.
- `WAIVED_BY_OPERATOR`: the operator explicitly waived the scenario with documented rationale and accepted release risk.

Severity:

- `P0_BLOCKER`: blocks v1.0 release unless `PASS` or explicitly `WAIVED_BY_OPERATOR`.
- `P1_RC_REQUIRED`: required before release-candidate approval unless explicitly waived.
- `P2_OPTIONAL`: useful evidence or hardening, but not a release blocker by itself.

Evidence classes:

- `APP_LOG`
- `DOCTOR_OUTPUT`
- `CHATGPT_TOOL_RESULT`
- `CHATGPT_UI_OBSERVATION`
- `GITHUB_OR_RELEASE_EVIDENCE`
- `OPERATOR_SCREEN_CONFIRMATION`
- `REDACTED_DIAGNOSTIC_EXPORT`

## 4. Required Matrix Columns

The acceptance matrix uses these required columns:

```text
ID
Area
Scenario
Preconditions
Steps
Expected result
Evidence required
Failure classification
Severity
Automation level
Owner
Related Work Card
Status
Notes
```

Automation level values:

- `Automated`
- `Manual`
- `Hybrid`
- `Future`

Owner values:

- `Architect`
- `Builder`
- `Operator`
- `App`

## 5. Acceptance Matrix

| ID | Area | Scenario | Preconditions | Steps | Expected result | Evidence required | Failure classification | Severity | Automation level | Owner | Related Work Card | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CAV-001 | local runtime | Local app launches and reports health | Packaged or dev launcher available; configured allowed root; no conflicting server on the MCP port | Start the launcher; start local HTTP MCP server; inspect local health and Dashboard readiness state | App launches, local server health passes, and Dashboard does not claim public readiness unless public checks pass | APP_LOG, DOCTOR_OUTPUT, OPERATOR_SCREEN_CONFIRMATION | APP_NOT_RUNNING, LOCAL_HEALTH_FAIL, EVIDENCE_INCOMPLETE | P0_BLOCKER | Hybrid | Operator | WC-V1-0502, WC-V1-0802 | NOT_RUN | Local health supports but does not replace live ChatGPT validation. |
| CAV-002 | repo identity | Repository identity is visible and correct | Configured root points at the intended repository | Inspect app or Doctor identity output for configured root, git root, remote, branch, and write mode | App can identify configured root, git root, remote, branch, and write mode without exposing private paths unnecessarily | DOCTOR_OUTPUT, REDACTED_DIAGNOSTIC_EXPORT | REPO_IDENTITY_MISMATCH, EVIDENCE_INCOMPLETE | P0_BLOCKER | Hybrid | App | WC-V1-0204, WC-V1-0502 | NOT_RUN | Private paths should be minimized or redacted in exported evidence. |
| CAV-003 | public endpoint | Public base URL is configured | Operator has configured public endpoint mode | Inspect public base URL in app/Doctor output and tunnel route configuration | Public base URL is not the example hostname and maps to the intended Cloudflare tunnel route | DOCTOR_OUTPUT, OPERATOR_SCREEN_CONFIRMATION | PUBLIC_ENDPOINT_UNREACHABLE, EVIDENCE_INCOMPLETE | P0_BLOCKER | Hybrid | Operator | WC-V1-0402, WC-V1-0403 | NOT_RUN | Do not record tokens or private tunnel credentials. |
| CAV-004 | public endpoint | Public health endpoint is reachable | Local server running; tunnel route active; OAuth remains enabled for `/mcp` | Request public health or equivalent readiness endpoint; verify unauthenticated `/mcp` write access is not exposed | Public health or equivalent endpoint responds as expected without exposing unauthenticated write access | DOCTOR_OUTPUT, APP_LOG, REDACTED_DIAGNOSTIC_EXPORT | PUBLIC_ENDPOINT_UNREACHABLE, TOOL_CALL_DENIED_BY_APP_POLICY, EVIDENCE_INCOMPLETE | P0_BLOCKER | Hybrid | App | WC-V1-0403, WC-V1-0802 | NOT_RUN | Health reachability must not become an unauthenticated MCP bypass. |
| CAV-005 | OAuth metadata | Public OAuth authorization metadata is reachable | Public base URL configured; local server and tunnel active | From ChatGPT setup or Doctor, fetch `/.well-known/oauth-authorization-server` | ChatGPT can retrieve OAuth metadata | CHATGPT_UI_OBSERVATION, DOCTOR_OUTPUT, APP_LOG | OAUTH_METADATA_FAIL, PUBLIC_ENDPOINT_UNREACHABLE | P0_BLOCKER | Hybrid | Operator | WC-V1-0401, WC-V1-0802 | NOT_RUN | Evidence must not include secrets. |
| CAV-006 | protected resource metadata | Public protected-resource metadata is reachable | Public base URL configured; OAuth metadata route active | From ChatGPT setup or Doctor, fetch protected resource metadata for the public MCP endpoint | ChatGPT can retrieve protected resource metadata and it references the correct issuer/resource | CHATGPT_UI_OBSERVATION, DOCTOR_OUTPUT, APP_LOG | PROTECTED_RESOURCE_METADATA_FAIL, PUBLIC_ENDPOINT_UNREACHABLE | P0_BLOCKER | Hybrid | Operator | WC-V1-0401, WC-V1-0802 | NOT_RUN | Include both base and `/mcp` metadata route if both are supported. |
| CAV-007 | OAuth/DCR | Dynamic Client Registration succeeds | Metadata reachable; OAuth admin password configured; ChatGPT connector setup available | Create or recreate the ChatGPT connector using Dynamic Client Registration | ChatGPT can register a client through DCR | CHATGPT_UI_OBSERVATION, APP_LOG, REDACTED_DIAGNOSTIC_EXPORT | DCR_FAIL, OAUTH_METADATA_FAIL, EVIDENCE_INCOMPLETE | P0_BLOCKER | Manual | Operator | WC-V1-0401, WC-V1-0104 | NOT_RUN | Client IDs and redirect details in evidence must be redacted as needed. |
| CAV-008 | OAuth/PKCE | Authorization flow succeeds with PKCE | DCR succeeded; operator can approve the authorization request | Complete ChatGPT authorization; approve requested scopes through the browser flow | ChatGPT OAuth authorization flow completes and PKCE S256 requirements are satisfied | CHATGPT_UI_OBSERVATION, APP_LOG, REDACTED_DIAGNOSTIC_EXPORT | PKCE_FAIL, DCR_FAIL, MANUAL_OPERATOR_VALIDATION_REQUIRED | P0_BLOCKER | Manual | Operator | WC-V1-0401, WC-V1-0104 | NOT_RUN | Plain PKCE must remain rejected. |
| CAV-009 | OAuth tokens | Token exchange succeeds | Authorization code flow completed | Allow ChatGPT to complete token exchange and verify the connector proceeds to MCP use | Access token is issued; secrets are not logged or exposed | CHATGPT_UI_OBSERVATION, APP_LOG, REDACTED_DIAGNOSTIC_EXPORT | TOKEN_EXCHANGE_FAIL, PKCE_FAIL, EVIDENCE_INCOMPLETE | P0_BLOCKER | Manual | Operator | WC-V1-0401, WC-V1-0104 | NOT_RUN | Raw access tokens, refresh tokens, and authorization codes must not appear in evidence. |
| CAV-010 | ChatGPT UI | ChatGPT connector appears connected | OAuth token exchange succeeded | Inspect ChatGPT connectors UI after setup; disconnect/reconnect once if testing recreation | Connector is visible and usable in ChatGPT after setup | CHATGPT_UI_OBSERVATION, OPERATOR_SCREEN_CONFIRMATION | PUBLIC_ENDPOINT_UNREACHABLE, TOKEN_EXCHANGE_FAIL, MANUAL_OPERATOR_VALIDATION_REQUIRED | P0_BLOCKER | Manual | Operator | WC-V1-0104, WC-V1-0802 | NOT_RUN | Record connector name and date without exposing private workspace data. |
| CAV-011 | MCP discovery | ChatGPT `tools/list` succeeds | Connector connected; `files.read` granted | In a new ChatGPT conversation, trigger tool discovery or ask for available ChampCity tools | ChatGPT can list exposed tools; required read-only tools are visible, including `get_workspace_status_summary`, `get_change_set_readiness_summary`, `get_release_artifact_summary`, `get_release_publication_summary`, and the seven stable domain toolbox tools | CHATGPT_TOOL_RESULT, CHATGPT_UI_OBSERVATION, APP_LOG | TOOLS_LIST_FAIL, TOOL_NOT_VISIBLE, TOOL_CALL_BLOCKED_BY_CHATGPT_SAFETY | P0_BLOCKER | Manual | Operator | WC-V1-0102, WC-V1-0103, WC-V1-0104, WC-V1-FIX02 | NOT_RUN | A namespace visible with zero tools is failure, not partial success. Stable toolbox visibility still requires live ChatGPT validation. |
| CAV-012 | MCP read tool | Read-only repo status tool succeeds | Connector connected; configured root points at intended repo; `files.read` granted | Ask ChatGPT to call `get_workspace_status_summary` and `get_change_set_readiness_summary` | Safe read-only status/readiness tools return structured output and are not blocked by ChatGPT safety layer | CHATGPT_TOOL_RESULT, APP_LOG | TOOL_CALL_BLOCKED_BY_CHATGPT_SAFETY, TOOL_CALL_APP_ERROR, REPO_IDENTITY_MISMATCH | P0_BLOCKER | Manual | Operator | WC-V1-0102, WC-V1-0204, WC-V1-0802 | NOT_RUN | These tools avoid caller-supplied absolute roots and raw git output. |
| CAV-013 | MCP read tool | Read project file/search succeeds | Connector connected; allowed root configured; `files.read` granted | Ask ChatGPT to read or search an allowed non-secret Markdown file after a safe facade status check | Safe file read/search operation works for allowed roots without exposing blocked files or secrets | CHATGPT_TOOL_RESULT, APP_LOG, REDACTED_DIAGNOSTIC_EXPORT | TOOL_CALL_BLOCKED_BY_CHATGPT_SAFETY, TOOL_CALL_APP_ERROR, SECRET_SAFETY_BLOCKER | P0_BLOCKER | Manual | Operator | WC-V1-0102, WC-V1-0205 | NOT_RUN | WC-V1-0102 facade tools reduce adjacent safety-layer false positives; include one denied blocked-file probe separately under CAV-019. |
| CAV-014 | MCP docs write | Docs-write artifact creation succeeds when mode/scope allows | Connector connected; OAuth `files.write` granted; local write mode permits docs writes; target path is approved planning/report path | Ask ChatGPT to create a safe Markdown planning or report artifact | ChatGPT can create a safe Markdown planning/report artifact in an approved planning path when granted the correct mode/scope | CHATGPT_TOOL_RESULT, APP_LOG, REDACTED_DIAGNOSTIC_EXPORT | SCOPE_MISSING, WRITE_MODE_BLOCKED, TOOL_CALL_BLOCKED_BY_CHATGPT_SAFETY, TOOL_CALL_APP_ERROR | P0_BLOCKER | Manual | Operator | WC-V1-0202, WC-V1-0802 | NOT_RUN | The artifact must be safe to commit and free of private credentials. |
| CAV-015 | write enforcement | Docs-write is denied when mode/scope does not allow it | Connector connected; repeat target from CAV-014; remove `files.write` or set local write mode to `off` | Ask ChatGPT to attempt the same write without sufficient scope or mode | The same write attempt fails cleanly when write mode or OAuth scope is insufficient | CHATGPT_TOOL_RESULT, APP_LOG | SCOPE_MISSING, WRITE_MODE_BLOCKED, TOOL_CALL_DENIED_BY_APP_POLICY | P0_BLOCKER | Manual | Operator | WC-V1-0202, WC-V1-0802 | NOT_RUN | Denial should be clear and should not suggest unsafe workarounds. |
| CAV-016 | patch workflow | Patch proposal flow succeeds | Connector connected; `files.write` granted if the current tool contract requires it; allowed root configured | Ask ChatGPT to propose a small patch for an allowed text file without applying it | ChatGPT can propose a patch without direct mutation | CHATGPT_TOOL_RESULT, APP_LOG | TOOL_CALL_BLOCKED_BY_CHATGPT_SAFETY, TOOL_CALL_APP_ERROR, SCOPE_MISSING | P0_BLOCKER | Manual | Operator | WC-V1-0202, WC-V1-0203 | NOT_RUN | Verify no file is changed by proposal creation. |
| CAV-017 | patch workflow | Approved patch application is gated | Patch proposal from CAV-016 exists; local mode and approval state varied intentionally | Attempt patch application without matching proposal or mode, then with valid gate in a controlled test path | Patch application requires a matching proposal and the appropriate mode/approval state | CHATGPT_TOOL_RESULT, APP_LOG | TOOL_CALL_DENIED_BY_APP_POLICY, WRITE_MODE_BLOCKED, TOOL_CALL_APP_ERROR | P0_BLOCKER | Manual | Operator | WC-V1-0202, WC-V1-0203 | NOT_RUN | The denied case is as important as the allowed case. |
| CAV-018 | prohibited behavior | Elevated script execution is unavailable to public ChatGPT workflow | Connector connected; v1.0 public toolset selected | Inspect exposed tools and attempt normal ChatGPT workflow for elevated arbitrary script execution | Elevated arbitrary script execution is not exposed as a normal ChatGPT-facing workflow | CHATGPT_TOOL_RESULT, CHATGPT_UI_OBSERVATION, DOCTOR_OUTPUT | TOOL_NOT_VISIBLE, TOOL_CALL_DENIED_BY_APP_POLICY, TOOL_CALL_BLOCKED_BY_CHATGPT_SAFETY | P0_BLOCKER | Hybrid | App | WC-V1-0201, WC-V1-0202, WC-V1-0203 | NOT_RUN | Current docs describe legacy elevated behavior; v1.0 final must prohibit it for public ChatGPT workflow. |
| CAV-019 | filesystem safety | Unsafe paths are blocked | Connector connected; allowed root configured; blocked path fixtures or known blocked examples available | Attempt read/write of blocked paths, local config, `.env`, OAuth stores, release binaries, logs, generated output, and path traversal | Attempts to read/write blocked paths are denied without leaking sensitive contents | CHATGPT_TOOL_RESULT, APP_LOG, REDACTED_DIAGNOSTIC_EXPORT | SECRET_SAFETY_BLOCKER, TOOL_CALL_DENIED_BY_APP_POLICY, TOOL_CALL_APP_ERROR | P0_BLOCKER | Hybrid | App | WC-V1-0205, WC-V1-0802 | NOT_RUN | Use safe placeholder fixtures; do not create or expose real secrets. |
| CAV-020 | public safety | Public-repo safety scan blocks unsafe content | Repo has safe test fixture or controlled staged sample; no real secrets | Run public safety scan through the app/tooling before source-control or release workflow | Secret, private-path, and release-artifact findings block staging, commit, and release workflows | CHATGPT_TOOL_RESULT, DOCTOR_OUTPUT, APP_LOG | SECRET_SAFETY_BLOCKER, TOOL_CALL_APP_ERROR, EVIDENCE_INCOMPLETE | P0_BLOCKER | Hybrid | App | WC-V1-0205, WC-V1-0301, WC-V1-0302 | NOT_RUN | Findings should identify rule/path, not raw secret values. |
| CAV-021 | source control | Git status/readiness workflow is safety-layer compatible | Connector connected; repo identity verified; `files.read` granted | Ask ChatGPT for safe repo status/readiness using `get_workspace_status_summary` and `get_change_set_readiness_summary` | ChatGPT can request safe repo status/readiness without platform safety false positives | CHATGPT_TOOL_RESULT, APP_LOG | TOOL_CALL_BLOCKED_BY_CHATGPT_SAFETY, REPO_IDENTITY_MISMATCH, TOOL_CALL_APP_ERROR | P0_BLOCKER | Manual | Operator | WC-V1-0102, WC-V1-0301 | NOT_RUN | This validates tool naming/schema safety, not arbitrary shell. |
| CAV-022 | source control | Operator-free git workflow is defined | Source-control workflow design exists or is being validated | Validate required later checks for branch preparation, pull, stage, commit, push, tag, and release workflows | Matrix identifies required later checks for preparing `dev` or a Work Card feature branch, then validating, staging, committing, pushing, and deferring `main` merges to stable checkpoints | DOCTOR_OUTPUT, GITHUB_OR_RELEASE_EVIDENCE, REDACTED_DIAGNOSTIC_EXPORT | GITHUB_AUTH_BLOCKED, SECRET_SAFETY_BLOCKER, EVIDENCE_INCOMPLETE | P0_BLOCKER | Future | Architect | WC-V1-FIX01, WC-V1-0301, WC-V1-0302 | NOT_RUN | `prepare_git_work_branch` covers safe branch preparation only; the broader source-control workflow remains later Work Card scope. |
| CAV-023 | release automation | Release baseline/status workflow is safety-layer compatible | Connector connected; release/tag inspection workflow available; no release mutation authorized | Ask ChatGPT to inspect local artifact status with `get_release_artifact_summary` and publication status with `get_release_publication_summary` | ChatGPT can safely inspect tag/release/artifact status without arbitrary shell | CHATGPT_TOOL_RESULT, GITHUB_OR_RELEASE_EVIDENCE, APP_LOG | TOOL_CALL_BLOCKED_BY_CHATGPT_SAFETY, RELEASE_ARTIFACT_MISSING, TOOL_CALL_APP_ERROR | P0_BLOCKER | Manual | Operator | WC-V1-0102, WC-V1-0302, WC-V1-0303 | NOT_RUN | Must not publish, edit, delete, tag, or upload during this check. |
| CAV-024 | release automation | GitHub Release publication workflow is defined | Release-publication workflow design exists or is being validated | Review defined checks for tag, asset hash, release notes, validation report, and asset upload | Matrix defines checks for tag, asset hash, release notes, validation report, and asset upload | GITHUB_OR_RELEASE_EVIDENCE, REDACTED_DIAGNOSTIC_EXPORT | GITHUB_AUTH_BLOCKED, RELEASE_ARTIFACT_MISSING, EVIDENCE_INCOMPLETE | P0_BLOCKER | Future | Architect | WC-V1-0302, WC-V1-0802, WC-V1-0804 | NOT_RUN | P0 for v1.0 final; no release mutation is authorized by this matrix. |
| CAV-025 | tunnel | Cloudflare tunnel is currently reachable | Local server running; tunnel configured; public base URL set | Check current public endpoint and `/mcp` route through Doctor or verifier | Current public endpoint evidence proves the tunnel path is serving the launcher | DOCTOR_OUTPUT, APP_LOG, OPERATOR_SCREEN_CONFIRMATION | PUBLIC_ENDPOINT_UNREACHABLE, TUNNEL_NOT_PERSISTENT, EVIDENCE_INCOMPLETE | P0_BLOCKER | Hybrid | Operator | WC-V1-0402, WC-V1-0403 | NOT_RUN | Public reachability must preserve OAuth enforcement. |
| CAV-026 | tunnel persistence | Cloudflare tunnel persistence after reboot is validated | Tunnel persistence configured; operator can reboot machine | Record pre-reboot state; reboot; verify app/tunnel/public endpoint state after restart | Operator performs reboot/persistence validation and evidence is recorded | OPERATOR_SCREEN_CONFIRMATION, DOCTOR_OUTPUT, APP_LOG | TUNNEL_NOT_PERSISTENT, PUBLIC_ENDPOINT_UNREACHABLE, MANUAL_OPERATOR_VALIDATION_REQUIRED | P0_BLOCKER | Manual | Operator | WC-V1-0402, WC-V1-0802 | NOT_RUN | Cannot be completed by Builder without operator reboot validation. |
| CAV-027 | evidence | Last MCP discovery trace is captured | Connector discovery attempted from ChatGPT | Inspect app/log/diagnostic export for last discovery attempt | App or logs provide a redacted record of the last ChatGPT MCP discovery attempt | APP_LOG, REDACTED_DIAGNOSTIC_EXPORT | EVIDENCE_INCOMPLETE, TOOLS_LIST_FAIL, TOOL_NOT_VISIBLE | P0_BLOCKER | Hybrid | App | WC-V1-0104, WC-V1-0403 | NOT_RUN | Trace must be useful without exposing tokens or private local config. |
| CAV-028 | diagnostics | Doctor output classifies connector failures | Doctor or equivalent diagnostic surface available | Exercise or simulate representative failures and inspect classification | Doctor distinguishes app down, tunnel down, OAuth metadata failure, DCR failure, scope issue, safety-layer rejection, and ChatGPT host issue | DOCTOR_OUTPUT, REDACTED_DIAGNOSTIC_EXPORT | APP_NOT_RUNNING, PUBLIC_ENDPOINT_UNREACHABLE, OAUTH_METADATA_FAIL, DCR_FAIL, SCOPE_MISSING, TOOL_CALL_BLOCKED_BY_CHATGPT_SAFETY | P0_BLOCKER | Hybrid | App | WC-V1-0403, WC-V1-0503 | NOT_RUN | Classification should drive clear next steps for semi-technical users. |
| CAV-029 | remediation | One-click Doctor/Fix actions are identified for later implementation | Failure taxonomy and guided setup goals are accepted | Review defined Doctor/Fix acceptance checks for safe one-click remediation | Matrix identifies needed Doctor/Fix acceptance checks | DOCTOR_OUTPUT, REDACTED_DIAGNOSTIC_EXPORT | EVIDENCE_INCOMPLETE, MANUAL_OPERATOR_VALIDATION_REQUIRED | P0_BLOCKER | Future | Architect | WC-V1-0403, WC-V1-0503 | NOT_RUN | P0 for v1.0 final; implementation belongs to later Work Cards. |
| CAV-030 | ChatGPT safety layer | Safety-layer false positive regression is tracked | Known safe calls and prior ChatGPT safety failures are listed | Re-run known safe calls in a new ChatGPT conversation using the WC-V1-0102 facade tools and compare outcomes | Known previously blocked safe calls are listed with expected future pass behavior | CHATGPT_TOOL_RESULT, CHATGPT_UI_OBSERVATION, REDACTED_DIAGNOSTIC_EXPORT | TOOL_CALL_BLOCKED_BY_CHATGPT_SAFETY, EVIDENCE_INCOMPLETE | P0_BLOCKER | Manual | Operator | WC-V1-0102, WC-V1-0104 | NOT_RUN | Use live ChatGPT evidence; local tests cannot prove this. |
| CAV-031 | evidence/export | Diagnostic evidence export is safe | Diagnostic export feature or manual evidence bundle exists | Generate or assemble diagnostic evidence and inspect redaction | Diagnostic/export artifact redacts tokens, secrets, private local config, OAuth stores, and unnecessary private paths | REDACTED_DIAGNOSTIC_EXPORT, APP_LOG | SECRET_SAFETY_BLOCKER, EVIDENCE_INCOMPLETE | P1_RC_REQUIRED | Hybrid | Builder | WC-V1-0104, WC-V1-0205 | NOT_RUN | A P1 issue may still block RC approval if evidence cannot be trusted. |
| CAV-032 | guided setup | User-facing setup path is semi-technical friendly | Clean profile or scripted reset available; operator can perform guided setup | Follow guided setup without routine CLI; record blockers and required manual steps | Matrix defines how to validate that a semi-technical user can complete setup without routine CLI | OPERATOR_SCREEN_CONFIRMATION, DOCTOR_OUTPUT, REDACTED_DIAGNOSTIC_EXPORT | MANUAL_OPERATOR_VALIDATION_REQUIRED, PUBLIC_ENDPOINT_UNREACHABLE, EVIDENCE_INCOMPLETE | P0_BLOCKER | Manual | Operator | WC-V1-0501, WC-V1-0502, WC-V1-0802 | NOT_RUN | Builder does not judge visual quality; operator validates usability. |
| CAV-033 | planning artifact discovery | Builder Report discovery facade avoids broad recursive glob false positives | Connector connected; `files.read` granted; target repository has phase-local `Builder_Reports` Markdown files | Ask ChatGPT to find Builder Reports through `get_builder_report_index`, including a known report such as `WC07` in `ChampCity_AI`, then use `get_builder_report_summary` for one specific report without passing an absolute local root or broad recursive glob | ChatGPT can discover relevant Builder Reports through a safe facade without platform safety false positives, and the facade returns repository-relative paths with bounded metadata | CHATGPT_TOOL_RESULT, CHATGPT_UI_OBSERVATION, APP_LOG, REDACTED_DIAGNOSTIC_EXPORT | TOOL_CALL_BLOCKED_BY_CHATGPT_SAFETY, TOOL_NOT_VISIBLE, REPORT_DISCOVERY_UNAVAILABLE, TOOL_CALL_APP_ERROR | P0_BLOCKER | Manual | Operator | WC-V1-0102A, WC-V1-0104 | NOT_RUN | WC-V1-0102A adds deterministic local coverage for the 2026-06-29 false positive where broad `list_project_files` with `planning/phases`, `**/BUILDER_REPORT*.md`, high `maxResults`, and an absolute local root was blocked. Live ChatGPT validation is still required. |
| CAV-034 | workspace routing | Explicit multi-workspace toolbox routing selects the intended project | Connector connected; multiple allowed workspaces configured; `files.read` granted; expected projects have distinguishable package/repo status data | Ask ChatGPT to call `diagnostics_toolbox` with `action: list_workspaces`, then call `repo_toolbox.status`, `repo_toolbox.read_file`, `git_toolbox.status`, and `artifact_toolbox.builder_report_summary` with explicit workspace IDs for at least two configured projects | ChatGPT sees safe workspace IDs, project-specific calls route to the requested workspace, no absolute roots are required in toolbox params, and ambiguous `workspaceId: default` fails safely when no explicit default is configured | CHATGPT_TOOL_RESULT, APP_LOG, REDACTED_DIAGNOSTIC_EXPORT | TOOL_CALL_BLOCKED_BY_CHATGPT_SAFETY, TOOL_CALL_APP_ERROR, REPO_IDENTITY_MISMATCH, EVIDENCE_INCOMPLETE | P0_BLOCKER | Manual | Operator | WC-V1-FIX04, WC-V1-0104 | NOT_RUN | Local self-test covers fixture routing, but live ChatGPT validation is still required after package promotion. |

## 6. Failure Classification Taxonomy

- `APP_NOT_RUNNING`
- `LOCAL_HEALTH_FAIL`
- `PUBLIC_ENDPOINT_UNREACHABLE`
- `TUNNEL_NOT_PERSISTENT`
- `OAUTH_METADATA_FAIL`
- `PROTECTED_RESOURCE_METADATA_FAIL`
- `DCR_FAIL`
- `PKCE_FAIL`
- `TOKEN_EXCHANGE_FAIL`
- `SCOPE_MISSING`
- `TOOLS_LIST_FAIL`
- `TOOL_NOT_VISIBLE`
- `REPORT_DISCOVERY_UNAVAILABLE`
- `TOOL_CALL_BLOCKED_BY_CHATGPT_SAFETY`
- `TOOL_CALL_DENIED_BY_APP_POLICY`
- `TOOL_CALL_APP_ERROR`
- `SECRET_SAFETY_BLOCKER`
- `REPO_IDENTITY_MISMATCH`
- `WRITE_MODE_BLOCKED`
- `GITHUB_AUTH_BLOCKED`
- `RELEASE_ARTIFACT_MISSING`
- `EVIDENCE_INCOMPLETE`
- `MANUAL_OPERATOR_VALIDATION_REQUIRED`

## 7. Known Current Gaps / Follow-up Cards

| Gap | Follow-up Work Card | Acceptance dependency |
| --- | --- | --- |
| Safety-layer false positives | `WC-V1-0102` | Adds safe read-only facade tools for CAV-011, CAV-012, CAV-013, CAV-021, CAV-023, and CAV-030; live ChatGPT validation is still required. |
| Builder Report discovery false positive | `WC-V1-0102A` | Required for CAV-033; adds a safe read-only Builder Report discovery facade so ChatGPT does not need broad recursive globs or absolute local roots for normal Architect review workflows. |
| MCP protocol self-test | `WC-V1-0103` | Adds `npm run mcp:self-test` and `npm run mcp:self-test -- --json` for deterministic local coverage around CAV-011, CAV-014, CAV-015, CAV-018, CAV-019, CAV-021, CAV-023, CAV-030, and CAV-033. This local self-test complements but does not replace live ChatGPT connector validation. |
| Live evidence capture | `WC-V1-0104` | Adds a redacted evidence template and validator under `planning/phases/phase-v1.0/Live_Connector_Evidence/`. Required for CAV-007 through CAV-011 and CAV-027 through CAV-031, and also helps CAV-033. |
| Safe git work-branch preparation | `WC-V1-FIX01` | Adds `prepare_git_work_branch` so ChatGPT can prepare `dev` or `feature/WC-V1-xxxx-*` / `feature/WC-V1-FIXxx-*` without arbitrary branch names, dirty-tree switches, `main` as the active work target, push, merge, rebase, reset, stash, delete, force, or arbitrary command behavior. |
| Stable domain toolbox surface | `WC-V1-FIX02` | Adds `repo_toolbox`, `git_toolbox`, `artifact_toolbox`, `diagnostics_toolbox`, `integration_toolbox`, `browser_toolbox`, and `knowledge_toolbox` as stable read-visible tools so future expansion can prefer internal allowlisted actions over new top-level MCP tools. Write actions still require `files.write` and local write-mode policy. No `figma_toolbox` is added; Figma belongs under `integration_toolbox`. |
| Explicit multi-workspace routing | `WC-V1-FIX04` | Adds server-defined workspace IDs, safe workspace discovery, and stateless explicit toolbox routing for concurrent multi-project ChatGPT chats. Required for CAV-034; live ChatGPT validation remains required. |
| Purpose-built tools | `WC-V1-0201` | Required to keep CAV-018, CAV-021, CAV-022, and CAV-023 off arbitrary shell workflows. |
| Permission modes/toolsets | `WC-V1-0202` | Required for CAV-014, CAV-015, CAV-017, and CAV-018. |
| Tool manifest | `WC-V1-0203` | Required for CAV-011, CAV-016, CAV-017, and release validation. |
| Repo identity enforcement | `WC-V1-0204` | Required for CAV-002, CAV-012, and mutation-capable workflows. |
| Safety scan expansion | `WC-V1-0205` | Required for CAV-019, CAV-020, and CAV-031. |
| MCP-native source control | `WC-V1-0301` | Required for CAV-021 and CAV-022. |
| MCP-native release publication | `WC-V1-0302` | Required for CAV-023 and CAV-024. |
| OAuth/DCR hardening | `WC-V1-0401` | Required for CAV-005 through CAV-009. |
| Cloudflare persistence | `WC-V1-0402` | Required for CAV-003, CAV-025, and CAV-026. |
| Public endpoint Doctor/Fix | `WC-V1-0403` | Required for CAV-004, CAV-025, CAV-027, and CAV-028. |
| Guided setup | `WC-V1-0501` | Required for CAV-032. |
| Dashboard home base | `WC-V1-0502` | Required for CAV-001, CAV-002, and CAV-032. |
| One-click Doctor/Fix | `WC-V1-0503` | Required for CAV-028 and CAV-029. |
| v1.0 validation suite | `WC-V1-0802` | Must consume this matrix as the ChatGPT connector release gate. |

## 8. Evidence Collection Template

The WC-V1-0104 evidence template lives at:

```text
planning/phases/phase-v1.0/Live_Connector_Evidence/CHATGPT_LIVE_CONNECTOR_EVIDENCE_TEMPLATE.md
```

Validate template or evidence files with:

```powershell
npm run chatgpt:evidence:validate -- --template
npm run chatgpt:evidence:validate -- --file planning/phases/phase-v1.0/Live_Connector_Evidence/<evidence-file>.md
```

Live ChatGPT validation evidence must be captured manually or from explicit ChatGPT tool results. No screenshots, browser scraping, or ChatGPT UI scraping are required or supported by WC-V1-0104. Local MCP self-test evidence supports release validation but does not replace live ChatGPT connector evidence.

```text
Validation date:
Operator:
App version:
Commit:
Public endpoint:
ChatGPT connector name:
Write mode:
OAuth scope observed:
Cloudflare tunnel state:
Test IDs run:
Passed:
Failed:
Blocked:
Evidence paths:
Redactions confirmed:
Notes:
```

## 9. Source-Control Branch Workflow Note

Active Work Cards should use `dev` or a generated `feature/WC-V1-xxxx-*` / `feature/WC-V1-FIXxx-*` branch. `main` is reserved for stable release or baseline checkpoints. The safe MCP branch-preparation path is `prepare_git_work_branch`, followed by validation, `safe_stage_changes`, `pre_commit_safety_scan`, `commit_validated_changes`, and `push_current_branch` for the current `dev` or feature branch. Merge to `main` only at a stable checkpoint.

## 10. Release Gate Rule

```text
v1.0 cannot be released unless all P0_BLOCKER ChatGPT connector acceptance scenarios are PASS or explicitly WAIVED_BY_OPERATOR with documented rationale.
```
