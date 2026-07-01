# Builder Report - WC-V1-FIX02 Stable Domain Toolboxes

## Required Statement

This Work Card creates stable domain toolbox tools to reduce future top-level MCP schema churn. It does not remove existing legacy tools and does not implement arbitrary upstream MCP passthrough.

## Repository Identity

- Repository path inspected: `%USERPROFILE%\Projects\ChampCity_GPT`
- Git top level inspected: `%USERPROFILE%/Projects/ChampCity_GPT`
- Remote inspected: `https://github.com/ChampCityChris/ChampCity_GPT_MCP.git`
- Starting branch: `feature/WC-V1-FIX01-safe-branch-workflow-tool`
- Starting HEAD: `f9210555390a3379c8dc46c321d374415d31b43a`
- Branch used: `feature/WC-V1-FIX02-stable-domain-toolboxes`
- `AGENTS.MD`: present
- `package.json`: present
- Starting working tree status: clean
- `WC-V1-FIX01` prerequisite present: yes
- `prepare_git_work_branch` present: yes

## Source Documents Reviewed

- Attached Codex prompt for `WC-V1-FIX02 - Add stable domain toolbox tools`
- `AGENTS.MD`
- `package.json`
- `docs/TOOL_REFERENCE.md`
- `docs/SECURITY_MODEL.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`
- `planning/phases/phase-v1.0/WORK_CARD_QUEUE_v1.0.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0102_chatgpt_safety_layer_false_positive_remediation.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0102A_builder_report_discovery_facade.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0103_mcp_protocol_self_test.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104_live_chatgpt_connector_evidence_capture.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-FIX01_safe_git_work_branch_tool.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_LOCAL_PACKAGE_after_WC-V1-FIX01.md`
- `src/server/registerTools.ts`
- `src/tools/getWriteAccessStatus.ts`
- `src/tools/publicSafeFacade.ts`
- `src/tools/builderReportFacade.ts`
- `src/tools/gitWorkflow/prepareGitWorkBranch.ts`
- `src/tools/gitWorkflow/safeStageChanges.ts`
- `src/tools/gitWorkflow/commitValidatedChanges.ts`
- `src/tools/gitWorkflow/pushCurrentBranch.ts`
- `src/validation/mcpSelfTest.ts`
- `tests/toolSchema.test.ts`
- `tests/mcpSelfTest.test.ts`

## Files Created

- `src/tools/domainToolboxes.ts`
- `tests/domainToolboxes.test.ts`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-FIX02_stable_domain_toolboxes.md`

## Files Modified

- `src/server/registerTools.ts`
- `src/tools/getWriteAccessStatus.ts`
- `src/validation/mcpSelfTest.ts`
- `tests/toolSchema.test.ts`
- `docs/TOOL_REFERENCE.md`
- `docs/SECURITY_MODEL.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`
- `planning/phases/phase-v1.0/WORK_CARD_QUEUE_v1.0.md`

## Top-Level Toolbox Tools Added

- `repo_toolbox`
- `git_toolbox`
- `artifact_toolbox`
- `diagnostics_toolbox`
- `integration_toolbox`
- `browser_toolbox`
- `knowledge_toolbox`

`figma_toolbox` was not added. Existing Figma-specific tools remain legacy/backward-compatible for now. Figma and Figma Make are represented as allowlisted service IDs under `integration_toolbox`.

## Legacy Tools Retained

Existing narrow tools remain registered, including file tools, patch tools, Figma tools, safe facade tools, Builder Report facade tools, git workflow tools, `get_write_access_status`, and `run_allowed_script`.

## Toolbox Action List

- `repo_toolbox`: `status`, `list_files`, `read_file`, `search_files`, `write_markdown_artifact`
- `git_toolbox`: `status`, `diff`, `prepare_work_branch`, `pre_commit_scan`, `stage_paths`, `commit_staged`, `push_current_branch`, `readiness_summary`
- `artifact_toolbox`: `builder_report_index`, `builder_report_summary`, `release_artifact_summary`, `release_publication_summary`, `local_package_summary`, `create_codex_handoff_prompt`
- `diagnostics_toolbox`: `runtime_status`, `write_access_status`, `tool_exposure_status`, `oauth_scope_status`, `chatgpt_discovery_status`, `public_safety_status`
- `integration_toolbox`: `list_supported_services`, `get_service_status`, `list_service_capabilities`, `validate_service_configuration`, `prepare_external_handoff`
- `browser_toolbox`: `get_browser_capabilities`, `validate_public_endpoint`
- `knowledge_toolbox`: `list_supported_sources`, `get_project_memory_status`, `get_reference_capabilities`

## Access-Control Model

- All seven toolbox tools are classified as `files.read` tools so read-only callers can see and use diagnostics/read-only actions.
- Write-capable toolbox actions check OAuth scope `files.write` internally before delegating to existing write tools.
- Local write mode is still enforced through existing mapped-tool policy.
- Markdown artifact and handoff writes require write mode `docs`, `patch`, or `elevated`.
- Git branch/stage/commit/push actions require write mode `elevated`.
- Unknown actions and unknown services return structured `ok: false` results with supported values.
- Action-specific params are validated with strict Zod schemas.

## Safety Controls Preserved

- No arbitrary shell.
- No arbitrary git command.
- No reset, rebase, merge, stash, branch delete, checkout-path, tag, or force-push controls.
- No raw local filesystem roots accepted from public ChatGPT callers.
- No arbitrary URL browsing or browser automation.
- No arbitrary upstream MCP tool call.
- No arbitrary service API method.
- No raw token, secret, cookie, OAuth store, `.env`, local config, credential store, or private tunnel URL passthrough.
- No `figma_toolbox`.
- No legacy tools removed.
- No public endpoint, OAuth/DCR, PKCE, Cloudflare, runtime path/AppData config, token/session storage, admin password, server lifecycle, packaging/release configuration, Figma Make extraction architecture, preload API, or `window.champcity` API behavior was changed.

## Diagnostics Added To Existing Stable Tool

`get_write_access_status` now accepts an MCP runtime diagnostic block from the tool dispatcher and returns nested redacted diagnostics when that context is available:

- runtime package version
- runtime commit
- runtime branch
- runtime started timestamp
- OAuth `files.read` granted true/false/unknown
- OAuth `files.write` granted true/false/unknown
- registered tool count
- registered tool-name hash
- registered toolbox names
- exposed tool count
- scope-filtered tool count
- write tools hidden by local mode

Direct internal calls without MCP context still preserve the existing top-level fields and report OAuth write status as `unknown`.

## Tests Added Or Updated

- Added `tests/domainToolboxes.test.ts`.
- Updated `tests/toolSchema.test.ts`.
- Updated `src/validation/mcpSelfTest.ts`.

Focused coverage verifies:

- All seven toolbox tools are registered and read-visible.
- Toolbox schemas expose only `action`, `workspaceId`, and `params`, not forbidden fields.
- `diagnostics_toolbox.runtime_status` returns runtime and registered tool-count data.
- `diagnostics_toolbox.oauth_scope_status` and `get_write_access_status` do not expose tokens.
- `get_write_access_status` includes runtime/scope/tool-count diagnostics when MCP context is supplied.
- `repo_toolbox` rejects unknown actions.
- `git_toolbox` rejects unknown actions.
- `git_toolbox.prepare_work_branch` delegates to the safe branch tool in a temporary repository.
- `git_toolbox` write actions fail safely without `files.write`.
- `integration_toolbox` lists supported services.
- `integration_toolbox` rejects unknown services.
- `integration_toolbox` rejects arbitrary upstream MCP tool-name params.
- `browser_toolbox.get_browser_capabilities` returns safe constrained capabilities.
- `browser_toolbox` rejects arbitrary URL browsing params.
- `knowledge_toolbox.list_supported_sources` returns safe constrained capabilities.
- `knowledge_toolbox` rejects arbitrary external fetch params.
- MCP self-test verifies toolbox registration, schema safety, read-only diagnostics, write-denial behavior, unknown action denial, and unknown service denial.
- Existing legacy tool schema and exposure tests still pass in focused validation.

## Documentation Updated

- `docs/TOOL_REFERENCE.md`
- `docs/SECURITY_MODEL.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`
- `planning/phases/phase-v1.0/WORK_CARD_QUEUE_v1.0.md`

Docs now explain:

- stable domain toolbox rationale;
- ChatGPT may require connector rediscovery, app reauthorization, or a new chat when top-level tools change;
- future expansion should prefer internal toolbox actions over top-level tool churn;
- Figma belongs under `integration_toolbox`, not `figma_toolbox`;
- existing Figma tools remain legacy/backward-compatible for now;
- `integration_toolbox` is a governed broker, not arbitrary MCP passthrough;
- `browser_toolbox` is constrained validation, not browser scraping;
- `knowledge_toolbox` is optional reference/context capability, not hidden memory mutation;
- write actions require `files.write` and local write-mode policy;
- read-only callers can still use diagnostics/read-only toolbox actions;
- correct scopes are `files.read files.write`, not `file.read`.

## Validation Commands And Results

Pre-report validation:

- `pwd`: pass.
- `git rev-parse --show-toplevel`: pass.
- `git remote -v`: pass.
- `git branch --show-current`: pass, started on `feature/WC-V1-FIX01-safe-branch-workflow-tool`.
- `git status --short`: pass at implementation start, clean.
- `git rev-parse HEAD`: pass, `f9210555390a3379c8dc46c321d374415d31b43a`.
- `git log --oneline -15`: pass, included `0ec627f feat: add safe git work branch tool` and `f921055 docs: record local package after WC-V1-FIX01`.
- `Test-Path AGENTS.MD`: pass.
- `Test-Path package.json`: pass.
- `rg -n "prepare_git_work_branch|BUILDER_REPORT_WC-V1-FIX01|gitWorkBranch" src tests docs planning package.json`: pass, prerequisite evidence found.
- `npm run typecheck`: pass.
- `npm run build`: sandboxed run reached TypeScript success and then failed on known renderer `esbuild` child-process `spawn EPERM`; final approved build rerun is recorded below.
- `node --test dist/tests/domainToolboxes.test.js dist/tests/toolSchema.test.js dist/tests/mcpSelfTest.test.js`: pass on approved run, 35 tests passed and 0 failed.
- `npm run check:public`: pass, 156 source candidate files checked before this report was created.

Final validation results after this report was created are recorded in the next section before commit.

## Final Validation Commands And Results

- `npm run typecheck`: pass.
- `npm test`: pass on approved run because the test script builds through `esbuild` and runs Node tests with temp git fixtures; 271 tests passed, 0 failed.
- `npm run lint`: pass.
- `npm run build`: pass on approved run because the renderer build invokes `esbuild`.
- `npm run check:public`: pass, `PASS publication cleanliness`, 157 source candidate files checked.
- `npm run mcp:self-test`: pass, 21 checks passed, 0 failed.
- `npm run mcp:self-test -- --json`: pass, `ok: true`, 21 checks passed, 0 failed, 38 registered tools, 7 registered toolbox tools.
- `npm run chatgpt:evidence:validate -- --template`: pass, 7 checks passed, 0 failed.
- `npm run chatgpt:evidence:validate -- --template --json`: pass, `ok: true`, 7 checks passed, 0 failed.
- `git diff --check`: pass; Git printed LF/CRLF working-copy warnings only.
- `git status --short`: inspected before staging.

## Validation Skipped And Reasons

- Packaging: skipped because this Work Card explicitly says do not package.
- Tagging, publishing, release upload, GitHub Release editing, and merge to `main`: skipped because this Work Card forbids them.
- Live ChatGPT connector validation: not performed by Builder; operator validation in a new ChatGPT conversation is still required after runtime update.
- Browser automation, screenshots, Playwright, ChatGPT UI scraping, and visual validation: skipped because this Work Card does not authorize them.
- Cloudflare tunnel validation: skipped because this Work Card does not authorize Cloudflare changes or live tunnel validation.

## Protected Subsystems Touched

Yes.

Touched in the narrow scope authorized by this Work Card:

- MCP tool discovery/exposure: seven top-level toolbox tools were added and classified as read-visible.
- `files.write` / write-scope enforcement: toolbox write actions added internal `files.write` checks because the toolbox tools themselves are read-visible.

Not touched:

- OAuth and Dynamic Client Registration behavior
- PKCE behavior
- MCP HTTP transport behavior
- MCP endpoint behavior
- Public MCP endpoint behavior
- Cloudflare tunnel configuration or behavior
- Runtime path/AppData config behavior
- Local config persistence behavior
- Token/session storage
- Admin password handling
- Server lifecycle/shutdown/start/stop/restart behavior
- Packaging/release configuration
- Git commit/push automation beyond routing existing safe git actions through `git_toolbox`
- Figma Make extraction architecture
- Existing preload API contracts
- Existing `window.champcity` API shape

## Residual Risks

- Local deterministic tests cannot prove live ChatGPT connector visibility or platform safety-layer behavior.
- ChatGPT may require connector rediscovery, app reauthorization, or a new chat to see the added top-level toolbox tools.
- The toolbox implementation intentionally starts with minimal safe actions; broader service integrations remain future Work Card scope.
- Existing legacy tools remain visible for backward compatibility until a future migration/removal card is approved.

## Scope And Fallback

- Scope changed during implementation: no.
- No fallback implementation was used.
- A fallback may be possible, but was not implemented because architect/operator approval was not provided.

## Git, Commit, Push, Main, And Packaging State

- Final branch at report update: `feature/WC-V1-FIX02-stable-domain-toolboxes`
- Final git status before staging:

```text
 M docs/CHATGPT_CONNECTION_GUIDE.md
 M docs/SECURITY_MODEL.md
 M docs/TOOL_REFERENCE.md
 M planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md
 M planning/phases/phase-v1.0/WORK_CARD_QUEUE_v1.0.md
 M src/server/registerTools.ts
 M src/tools/getWriteAccessStatus.ts
 M src/validation/mcpSelfTest.ts
 M tests/toolSchema.test.ts
?? planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-FIX02_stable_domain_toolboxes.md
?? src/tools/domainToolboxes.ts
?? tests/domainToolboxes.test.ts
```

- Anything staged at report update: no.
- Commit hash: reported in the final Codex response because a commit cannot contain its own stable hash.
- Anything pushed at report update: no.
- Push target: `origin/feature/WC-V1-FIX02-stable-domain-toolboxes`
- Anything pushed to `main`: no.
- Anything merged to `main`: no.
- Force push used: no.
- `main` modified by this task: no.
- Packaging run: no.

## Recommended Next Work Card

After this branch is reviewed, merged as appropriate, and available through the runtime, run operator-assisted live ChatGPT connector validation for stable toolbox visibility and read-only diagnostics in a new ChatGPT conversation.
