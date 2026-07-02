# ChatGPT Connection Guide

ChatGPT.com requires an HTTPS-reachable MCP endpoint. A local STDIO MCP server is not directly usable by ChatGPT.com.

For ChampCity_GPT, the intended endpoint is:

```text
https://mcp.example.com/mcp
```

Local development uses:

```text
http://127.0.0.1:3333/mcp
```

OAuth with Dynamic Client Registration is the supported public ChatGPT connector path. The public endpoint must expose OAuth metadata, DCR, the browser authorization flow, token exchange, and `/mcp`. Static bearer-token setup is not the normal v1.0 ChatGPT path.

## Start Local HTTP Mode

Build first:

```powershell
npm run build
```

Start local HTTP MCP mode:

```powershell
node .\dist\src\index.js --transport http --host 127.0.0.1 --port 3333
```

In the desktop app, use `Configure OAuth Admin Password` before ChatGPT setup. The admin password approves OAuth authorization requests and is stored only as a runtime-local hash. Do not upload, paste, or share local OAuth files.

OAuth endpoints exposed through `https://mcp.example.com`:

```text
/.well-known/oauth-protected-resource
/.well-known/oauth-protected-resource/mcp
/.well-known/oauth-authorization-server
/oauth/register
/oauth/authorize
/oauth/token
```

Static bearer-token auth was useful for manual HTTP testing, but it is not sufficient for ChatGPT's OAuth connector flow and is not the standard public connector path. Treat legacy bearer auth as a temporary operator-approved local/manual fallback only; do not present it to ChatGPT as the normal setup path.

Access tokens are intentionally short-lived. The default access token TTL is 2 hours, 7200 seconds. The token endpoint also returns a refresh token with a default TTL of 30 days, 2592000 seconds, so ChatGPT can renew access without forcing a fresh browser authorization during normal work sessions. Refresh tokens are stored only as local hashes, rotated on use, and can be revoked from the launcher's OAuth Sessions panel.

For local-only testing without a token:

```powershell
$env:CHAMPCITY_GPT_ALLOW_UNAUTH_LOCAL_HTTP='true'
node .\dist\src\index.js --transport http --host 127.0.0.1 --port 3333
```

Unauthenticated local mode is `LOCAL TEST ONLY - DO NOT TUNNEL.` It is not safe for `mcp.example.com`.

Check health:

```powershell
curl http://127.0.0.1:3333/health
```

## Cloudflare Tunnel Validation

Use the Cloudflare setup package in this repo:

- Guide: `docs/CLOUDFLARE_TUNNEL_SETUP.md`
- Template: `examples/cloudflared-config.example.yml`
- Local readiness check: `.\scripts\tunnel-readiness.ps1`
- Public endpoint verifier: `.\scripts\verify-public-endpoint.ps1`

Recommended path:

```text
ChatGPT.com
  -> https://mcp.example.com/mcp
  -> Cloudflare Tunnel
  -> http://127.0.0.1:3333/mcp
  -> local ChampCity_GPT MCP server
```

Do not tunnel unauthenticated local mode. Keep write mode `off` during first ChatGPT registration and testing.

After Cloudflare DNS and tunnel routing are active:

Open `https://mcp.example.com/.well-known/oauth-protected-resource` and `https://mcp.example.com/.well-known/oauth-authorization-server` and confirm they return JSON with issuer `https://mcp.example.com`.

The verifier and generated notes must not print tokens, admin passwords, client secrets, or local OAuth files.

## ChatGPT Setup

ChatGPT setup is product, plan, and workspace dependent. In ChatGPT, use Settings -> Connectors -> Create if that surface is available.

Register the HTTPS MCP endpoint:

```text
https://mcp.example.com/mcp
```

Do not register the local STDIO command as the ChatGPT.com connection path.

When ChatGPT connects, it may dynamically register a public PKCE client at `/oauth/register`. The server stores registered client metadata in a runtime-local ignored OAuth registry. ChatGPT then opens `/oauth/authorize`; approve only `files.read` first. The authorization page shows the app name, requested scopes, and a warning that approval grants access to configured local project files. It requires the OAuth admin password before redirecting back to ChatGPT with an authorization code. `/oauth/token` validates the code, redirect URI, client ID, and PKCE verifier before issuing a bearer access token and refresh token.

If ChatGPT disconnects after the access token expires, refresh-token support may be broken. Reconnect ChatGPT, optionally set `CHAMPCITY_GPT_ACCESS_TOKEN_TTL_SECONDS` to a low value for testing, and verify ChatGPT can still call MCP tools after the short-lived access token expires. Do not solve expiry by making access tokens permanent.

ChatGPT uses OAuth authorization code with PKCE. `/oauth/authorize` requires `code_challenge_method=S256` and a valid S256 `code_challenge`; plain PKCE is rejected. Use Dynamic Client Registration in ChatGPT rather than User-Defined OAuth Client unless a static client was intentionally registered. If ChatGPT reports `PKCE S256 code_challenge is required`, check the launcher OAuth troubleshooting fields to confirm whether `code_challenge` and `code_challenge_method` reached the authorize handler.

Do not attempt ChatGPT.com registration until `npm test` passes, including the end-to-end Streamable HTTP MCP test that initializes, lists tools, and calls `repo_toolbox.list_files`.

Also verify `https://mcp.example.com/mcp` with `scripts\verify-public-endpoint.ps1` before ChatGPT registration.

For local PKCE parsing verification against a running local server:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-oauth-pkce-local.ps1
```

## Safe Status And Release Checks

For normal ChatGPT-facing read-only status and release diagnostics, use the toolbox actions that route to the WC-V1-0102 facade implementations:

- `repo_toolbox.status`
- `git_toolbox.readiness_summary`
- `artifact_toolbox.release_artifact_summary`
- `artifact_toolbox.release_publication_summary`
- `artifact_toolbox.builder_report_index`
- `artifact_toolbox.builder_report_summary`
- `diagnostics_toolbox.public_safety_status`

These actions avoid caller-supplied local roots, command-string inputs, and executable file globs. They return structured summaries with repository-relative paths where possible. `run_allowed_script` is not exposed publicly.

For Builder Reports, ask ChatGPT to call `artifact_toolbox` with `action: "builder_report_index"`, optionally with `phaseFolder` and `workCardId`. For a specific report, ask ChatGPT to call `artifact_toolbox` with `action: "builder_report_summary"` and the returned repository-relative `reportPath`, or use a narrow expected-path `repo_toolbox.read_file` call only after the index has identified the path.

Normal ChatGPT workflows should avoid broad file-listing calls that combine `planning/phases`, `**/BUILDER_REPORT*.md`, and high `maxResults`. The Builder Report facade supports `CAV-033` by avoiding that broad recursive query shape.

These facade tools are part of the remediation for `CAV-011`, `CAV-012`, `CAV-013`, `CAV-021`, `CAV-023`, `CAV-030`, and `CAV-033`. Live ChatGPT validation is still required before claiming the safety-layer false-positive issue is fully remediated.

## Safe Source-Control Branch Preparation

Active Work Cards should use `dev` or a generated `feature/WC-V1-xxxx-*` / `feature/WC-V1-FIXxx-*` branch. `main` is reserved for stable release or baseline checkpoints.

Use `prepare_git_work_branch` as the safe MCP path to prepare `dev` or a Work Card feature branch. The tool requires OAuth `files.write` and local write mode `elevated`, refuses dirty working trees, refuses detached HEAD, refuses `main` as the active work target, and does not push, merge, rebase, reset, stash, delete branches, tag, or run arbitrary commands.

After branch preparation, the normal reviewed Work Card lifecycle is:

1. Feature branch implementation.
2. Architect review.
3. Commit staged changes with `commit_validated_changes`.
4. Push the feature branch with `push_current_branch`.
5. Run `git_toolbox.integrate_to_dev` in dry-run mode.
6. Run `git_toolbox.integrate_to_dev` with `dryRun: false` and `push: true` after review approval.
7. Package/promote from `dev` when needed.
8. Live validation.
9. Merge to `main` only at a stable release or baseline checkpoint.

## Stable Domain Toolbox Tools

WC-V1-FIX02 adds stable top-level toolbox tools for ChatGPT:

- `repo_toolbox`
- `git_toolbox`
- `artifact_toolbox`
- `diagnostics_toolbox`
- `integration_toolbox`
- `browser_toolbox`
- `knowledge_toolbox`

ChatGPT may bind tool schemas for the connector or chat lifecycle. Adding new top-level MCP tools can require connector rediscovery, app reauthorization, or a new chat. Future capability expansion should prefer adding allowlisted internal toolbox actions over adding new top-level tools when that fits the domain.

Existing narrow tools remain available for backward compatibility. The new toolbox tools are visible with `files.read`; write-capable actions inside them still require OAuth `files.write` plus the same local write-mode policy as the mapped legacy tool. A read-only caller can still use diagnostics/read-only toolbox actions, while write actions fail with a clear missing-scope or write-mode denial.

Use explicit workspace IDs when more than one project is configured. Ask ChatGPT to call `diagnostics_toolbox` with `action: "list_workspaces"` to see safe IDs, then pass the chosen ID on project-specific calls:

```json
{
  "action": "status",
  "workspaceId": "champcity_gpt",
  "params": {}
}
```

`workspaceId: "default"` is safe only for a single workspace or when `defaultWorkspaceId` is explicitly configured. With multiple workspaces and no explicit default, project-specific toolbox calls fail with `WORKSPACE_REQUIRED` instead of using a mutable active workspace.

Current public action groups:

- `repo_toolbox`: `status`, `list_files`, `read_file`, `search_files`, `write_markdown_artifact`, `write_json_artifact`, `propose_patch`, `apply_approved_patch`
- `git_toolbox`: `status`, `diff`, `prepare_work_branch`, `pre_commit_scan`, `stage_paths`, `commit_staged`, `push_current_branch`, `readiness_summary`, `integrate_to_dev`
- `artifact_toolbox`: `builder_report_index`, `builder_report_summary`, `release_artifact_summary`, `release_publication_summary`, `local_package_summary`
- `diagnostics_toolbox`: `runtime_status`, `write_access_status`, `tool_exposure_status`, `oauth_scope_status`, `chatgpt_discovery_status`, `list_workspaces`, `public_safety_status`
- `integration_toolbox`: `list_supported_services`, `get_service_status`, `list_service_capabilities`, `validate_service_configuration`, `prepare_external_handoff`
- `browser_toolbox`: `get_browser_capabilities`, `validate_public_endpoint`
- `knowledge_toolbox`: `list_supported_sources`, `get_project_memory_status`, `get_reference_capabilities`

Do not expect a `figma_toolbox`. Figma is represented under `integration_toolbox` as `figma` and `figma_make`, but current Figma responses are broker-not-implemented placeholders and do not call old direct Figma API/token/MCP code. `integration_toolbox` is a governed broker, not arbitrary upstream MCP passthrough. `browser_toolbox` is constrained validation, not browser scraping. `knowledge_toolbox` is optional project reference capability, not hidden memory mutation.

When approving ChatGPT app scopes, use:

```text
files.read files.write
```

`file.read` is wrong; the required read scope is `files.read`.

## Local MCP Protocol Self-Test

For deterministic local release validation after a build, run:

```powershell
npm run mcp:self-test
npm run mcp:self-test -- --json
```

The self-test validates the local MCP tool registry, `tools/list` schema, required read and gated tools, stable toolbox registration, safe facade and toolbox schema narrowness, safe read-only facade calls, toolbox read-only diagnostics, explicit multi-workspace routing, toolbox write denial without `files.write`, unknown toolbox action denial, unknown integration service denial, Builder Report discovery and summary, docs-write denial with write mode off, blocked-path denial, elevated-script gating, and gated branch workflow tool coverage. JSON mode is suitable for Builder Reports and release validation evidence.

This self-test complements but does not replace live ChatGPT connector validation. It does not contact ChatGPT.com, use browser automation or UI scraping, launch Cloudflare, mutate OAuth/DCR state, package, tag, push, publish, or run elevated scripts.

## Live Connector Evidence Capture

Use the evidence template when the operator runs live ChatGPT connector validation:

```text
planning/phases/phase-v1.0/Live_Connector_Evidence/CHATGPT_LIVE_CONNECTOR_EVIDENCE_TEMPLATE.md
```

Validate the template or a completed redacted evidence file with:

```powershell
npm run chatgpt:evidence:validate -- --template
npm run chatgpt:evidence:validate -- --template --json
npm run chatgpt:evidence:validate -- --file planning/phases/phase-v1.0/Live_Connector_Evidence/<evidence-file>.md
```

Live evidence must be captured manually by the operator or from explicit ChatGPT tool results. This workflow does not use screenshots, browser scraping, ChatGPT UI scraping, OAuth/DCR mutation, Cloudflare mutation, packaging, release publication, or token capture.

WC-V1-0104 supports evidence capture for CAV-007 through CAV-011 and CAV-027 through CAV-031, and also helps CAV-033. Local deterministic evidence from `npm run mcp:self-test` is useful baseline evidence, but it does not replace a live ChatGPT connector pass.

## Security Notes

Files stay local until a tool call reads them. File contents requested through MCP may enter hosted ChatGPT context. This does not make hosted ChatGPT local-only.

Start read-only first. Set write mode above `off` only after confirming:

- HTTPS tunnel and DNS are configured.
- OAuth admin password is configured.
- Allowed roots are narrow.
- Audit logging is enabled and reviewed.
- Read-only tools work through ChatGPT.

In HTTP mode, `/mcp` requires `Authorization: Bearer <access_token>`. Public `tools/list` exposes only `repo_toolbox`, `git_toolbox`, `artifact_toolbox`, `diagnostics_toolbox`, `integration_toolbox`, `browser_toolbox`, and `knowledge_toolbox`. `files.read` covers `tools/list` and those toolbox tools. `files.write` is enforced inside write-capable toolbox actions, including Markdown/JSON artifact writes, patch proposal/application, integration handoff writing, and git mutating actions. Markdown and JSON artifact writes require mode `docs`, `patch`, or `elevated` and do not require `approvalToken`. Patch application requires mode `patch` or `elevated` and a matching pending proposal hash, unless elevated approval is used as a fallback. `run_allowed_script` is not exposed publicly. Unauthenticated localhost mode requires explicit opt-in with `CHAMPCITY_GPT_ALLOW_UNAUTH_LOCAL_HTTP=true` and must not be used behind a tunnel. A Cloudflare Tunnel can expose a localhost-bound service to the public internet, so localhost binding is not a substitute for OAuth.

## Figma Broker Placeholder

The old direct Figma/Figma Make handoff workflow was removed. Do not call `get_figma_status`, `parse_figma_url`, `fetch_figma_file_summary`, `fetch_figma_frame_image`, `create_figma_handoff_package`, `create_codex_ui_handoff_prompt`, `run_figma_make_handoff`, `run_figma_make_file_handoff`, or `test_figma_mcp_connection`; they are not public tools.

For now, use `integration_toolbox` service IDs `figma` and `figma_make` only to confirm the broker placeholder status. Future Figma support must be implemented as governed broker behavior under `integration_toolbox`, without arbitrary upstream MCP passthrough.

Do not remove OAuth, do not expose unauthenticated `/mcp`, and do not enable write mode by default. Use `Revoke All OAuth Sessions` or `Revoke ChatGPT Sessions` in the launcher if a ChatGPT connection should be forced to reauthorize.

Keep `CHAMPCITY_GPT_WRITE_MODE=off` until read-only validation is complete. Use `docs` for Architect Markdown docs, `patch` for proposed code changes, and `elevated` rarely. Configure the elevated approval token in the launcher Write Access panel; it is stored only as a salted hash in `config\write-access.local.json`, which is ignored by git. `CHAMPCITY_GPT_WRITE_MODE` is preferred; legacy `CHAMPCITY_GPT_ENABLE_WRITE_TOOLS=true` maps to `docs`. Do not reuse OAuth access tokens as elevated approval tokens.

Generated setup notes report OAuth status, legacy bearer status, current write mode, pending patch proposal count, and whether an elevated approval token is configured. They never print token values, admin passwords, client secrets, raw OAuth records, local OAuth store paths, local allowed-root paths, audit-log paths, or the raw elevated approval token.

Recommended write workflow:

1. Set write mode to `docs` for Markdown planning docs.
2. Set write mode to `patch` for code changes.
3. Ask ChatGPT to prepare `dev` or a Work Card feature branch with `prepare_git_work_branch` before source changes are staged or committed.
4. Ask ChatGPT to propose a patch first and review the returned patch.
5. Apply only the matching pending proposal.
6. Ask ChatGPT to call `get_workspace_status_summary` and inspect any needed diff separately.
7. Validate, then stage reviewed files, commit, and push only the current `dev` or feature branch.
8. Use `elevated` only for source-control tools, scripts, or legacy fallback, then rotate or clear the elevated token.
9. Return write mode to `off`.

The bearer token is a development/private-connector safeguard and temporary local/manual fallback, not a public ChatGPT connector path or a complete enterprise auth system.

## Advanced Local STDIO Clients

STDIO remains available for local clients that can launch MCP processes directly:

```powershell
node .\dist\src\index.js
node .\dist\src\index.js --transport stdio
```

Use STDIO for trusted local MCP clients only. ChatGPT.com needs the HTTPS endpoint above.

