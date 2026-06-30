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

Local unauthenticated and authenticated HTTP MCP testing has passed. ChatGPT.com custom MCP apps use OAuth, so the public endpoint must expose the OAuth metadata and browser authorization flow as well as `/mcp`.

## Start Local HTTP Mode

Build first:

```powershell
npm run build
```

Start local HTTP MCP mode:

```powershell
node .\dist\src\index.js --transport http --host 127.0.0.1 --port 3333
```

In the desktop app, use `Configure OAuth Admin Password` before ChatGPT setup. The admin password approves OAuth authorization requests and is stored only as a local hash in `config\oauth-admin.local.json`, which is ignored by git. Do not upload or share local OAuth files.

OAuth endpoints exposed through `https://mcp.example.com`:

```text
/.well-known/oauth-protected-resource
/.well-known/oauth-protected-resource/mcp
/.well-known/oauth-authorization-server
/oauth/register
/oauth/authorize
/oauth/token
```

Static bearer-token auth was useful for manual HTTP testing, but it is not sufficient for ChatGPT's OAuth connector flow. Legacy bearer auth can remain configured with `CHAMPCITY_GPT_HTTP_AUTH_TOKEN` or `config\http-auth.local.json` for manual testing only.

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

When ChatGPT connects, it may dynamically register a public PKCE client at `/oauth/register`. The server stores registered clients in `config\oauth-clients.local.json`, an ignored local file. ChatGPT then opens `/oauth/authorize`; approve only `files.read` first. The authorization page shows the app name, requested scopes, and a warning that approval grants access to configured local project files. It requires the OAuth admin password before redirecting back to ChatGPT with an authorization code. `/oauth/token` validates the code, redirect URI, client ID, and PKCE verifier before issuing a bearer access token and refresh token.

If ChatGPT disconnects after the access token expires, refresh-token support may be broken. Reconnect ChatGPT, optionally set `CHAMPCITY_GPT_ACCESS_TOKEN_TTL_SECONDS` to a low value for testing, and verify ChatGPT can still call MCP tools after the short-lived access token expires. Do not solve expiry by making access tokens permanent.

ChatGPT uses OAuth authorization code with PKCE. `/oauth/authorize` requires `code_challenge_method=S256` and a valid S256 `code_challenge`; plain PKCE is rejected. Use Dynamic Client Registration in ChatGPT rather than User-Defined OAuth Client unless a static client was intentionally registered. If ChatGPT reports `PKCE S256 code_challenge is required`, check the launcher OAuth troubleshooting fields or `config\oauth-authorize-last-error.local.json` to confirm whether `code_challenge` and `code_challenge_method` reached the authorize handler.

Do not attempt ChatGPT.com registration until `npm test` passes, including the end-to-end Streamable HTTP MCP test that initializes, lists tools, and calls `list_project_files`.

Also verify `https://mcp.example.com/mcp` with `scripts\verify-public-endpoint.ps1` before ChatGPT registration.

For local PKCE parsing verification against a running local server:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-oauth-pkce-local.ps1
```

## Safe Status And Release Checks

For normal ChatGPT-facing read-only status and release diagnostics, prefer these WC-V1-0102 facade tools:

- `get_workspace_status_summary`
- `get_change_set_readiness_summary`
- `get_release_artifact_summary`
- `get_release_publication_summary`
- `get_builder_report_index`
- `get_builder_report_summary`

These tools avoid caller-supplied local roots, command-string inputs, and executable file globs. They return structured summaries with repository-relative paths where possible. `run_allowed_script` is not the normal v1.0 ChatGPT-facing status or release workflow.

For Builder Reports, ask ChatGPT to call `get_builder_report_index`, optionally with `phaseFolder` and `workCardId`. For a specific report, ask ChatGPT to call `get_builder_report_summary` with the returned repository-relative `reportPath`, or use a narrow expected-path `read_project_file` call only after the index has identified the path.

Normal ChatGPT workflows should avoid broad `list_project_files` calls that combine an absolute local root, `planning/phases`, `**/BUILDER_REPORT*.md`, and high `maxResults`. The Builder Report facade supports `CAV-033` by avoiding that broad recursive query shape.

These facade tools are part of the remediation for `CAV-011`, `CAV-012`, `CAV-013`, `CAV-021`, `CAV-023`, `CAV-030`, and `CAV-033`. Live ChatGPT validation is still required before claiming the safety-layer false-positive issue is fully remediated.

## Security Notes

Files stay local until a tool call reads them. File contents requested through MCP may enter hosted ChatGPT context. This does not make hosted ChatGPT local-only.

Start read-only first. Set write mode above `off` only after confirming:

- HTTPS tunnel and DNS are configured.
- OAuth admin password is configured.
- Allowed roots are narrow.
- Audit logging is enabled and reviewed.
- Read-only tools work through ChatGPT.

In HTTP mode, `/mcp` requires `Authorization: Bearer <access_token>`. `files.read` covers read/list/search/git status/git diff, the safe status/release/Builder Report facade tools, `get_write_access_status`, Figma status/URL parsing/file summaries, and `tools/list`. `files.write` covers `propose_patch`, `write_markdown_artifact`, `apply_approved_patch`, Figma frame export, Figma handoff package generation, Figma Make URL handoff orchestration, Figma Make `.make` file handoff orchestration, Codex UI handoff prompt generation, and `run_allowed_script`, but write access still has local write-mode gates. Markdown/Figma handoff writes require mode `docs`, `patch`, or `elevated` and do not require `approvalToken`. Patch application requires mode `patch` or `elevated` and a matching pending proposal hash, unless elevated approval is used as a fallback. `run_allowed_script` requires mode `elevated`, an allowlisted maintenance task, and the elevated approval token. Unauthenticated localhost mode requires explicit opt-in with `CHAMPCITY_GPT_ALLOW_UNAUTH_LOCAL_HTTP=true` and must not be used behind a tunnel. A Cloudflare Tunnel can expose a localhost-bound service to the public internet, so localhost binding is not a substitute for OAuth.

## Figma Make Handoff Flow

v1.0 scope note: Figma tools are deferred from v1.0 production-core scope. The current Figma workflow must be revisited before it can be treated as a supported product feature. v1.0 remains focused on ChatGPT-to-local-repository access, connector reliability, source-control/release automation, guided setup, and public-user distribution.

Configure the upstream official Figma MCP server once. Desktop mode defaults to `http://127.0.0.1:3845/mcp`; remote mode requires an explicitly configured HTTPS endpoint. If the upstream server requires Figma-side authentication or user interaction, complete that setup outside ChatGPT first. After that, the intended ChatGPT workflow is one MCP tool call:

```text
My Figma Make URL is <url>. Use it to create a handoff package and generate a Codex prompt.
```

ChatGPT should call `run_figma_make_handoff` with the `/make/` URL. The tool writes `design\figma-handoff\make` and `docs\handoffs\CODEX_FIGMA_MAKE_UI_HANDOFF.md` by default, returns created paths, `resourceFiles`, warnings, and errors, and never receives or returns Figma tokens, cookies, auth headers, or session credentials.

Fallback local route: after exporting a `.make` package from Figma Make and placing it under the repo or another configured allowed root, ChatGPT should call `run_figma_make_file_handoff` with `makeFilePath`. The tool writes `design\figma-handoff\make-file` and `docs\handoffs\CODEX_FIGMA_MAKE_FILE_HANDOFF.md` by default, preserves raw important package files, copies package assets, parses `ai_chat.json` when present, reconstructs source files where deterministic, and reports partial/unresolved reconstruction honestly. This route is direct package parsing, not screenshot capture, browser scraping, network scraping, clipboard automation, or Figma Design conversion.

The Make path must retrieve actual Make resources/files through official Figma MCP resource content. If no resources/files are retrieved, the status is `failed`; metadata-only output, screenshots, browser scraping, network scraping, clipboard automation, and Figma Design conversion are not fallback success paths. `/make/` URLs are not sent through the Design REST parser.

## Figma Design Handoff Flow

Configure a Figma personal access token locally before asking ChatGPT to fetch design metadata. Use the launcher Figma section or create `config\figma.local.json` from `config\figma.example.json`. `CHAMPCITY_GPT_FIGMA_ACCESS_TOKEN` overrides the local file.

Recommended ChatGPT flow:

1. Approve `files.read` first and call `get_figma_status`.
2. Call `parse_figma_url` with the Figma file/frame URL.
3. Call `fetch_figma_file_summary` to inspect pages, top-level frames, components, and styles.
4. Switch local write mode to `docs`, `patch`, or `elevated`, and approve OAuth `files.write`.
5. Call `create_figma_handoff_package` with the project root, Figma URL, target area, and selected frame/node IDs.
6. Call `create_codex_ui_handoff_prompt` to write the Codex implementation prompt.
7. Inspect generated files under `design\figma-handoff` and `docs\handoffs`.

Do not paste the Figma token into ChatGPT. Do not include it in prompts, generated handoffs, docs, or logs. Generated handoff packages may contain private Figma screenshots and metadata; review them before committing or sharing.

Do not remove OAuth, do not expose unauthenticated `/mcp`, and do not enable write mode by default. Use `Revoke All OAuth Sessions` or `Revoke ChatGPT Sessions` in the launcher if a ChatGPT connection should be forced to reauthorize.

Keep `CHAMPCITY_GPT_WRITE_MODE=off` until read-only validation is complete. Use `docs` for Architect Markdown docs, `patch` for proposed code changes, and `elevated` rarely. Configure the elevated approval token in the launcher Write Access panel; it is stored only as a salted hash in `config\write-access.local.json`, which is ignored by git. `CHAMPCITY_GPT_WRITE_MODE` is preferred; legacy `CHAMPCITY_GPT_ENABLE_WRITE_TOOLS=true` maps to `docs`. Do not reuse OAuth access tokens as elevated approval tokens.

Generated setup notes report OAuth status, legacy bearer status, current write mode, pending patch proposal count, and whether an elevated approval token is configured. They never print token values, admin passwords, client secrets, raw OAuth records, or the raw elevated approval token.

Recommended write workflow:

1. Set write mode to `docs` for Markdown planning docs.
2. Set write mode to `patch` for code changes.
3. Ask ChatGPT to propose a patch first and review the returned patch.
4. Apply only the matching pending proposal.
5. Ask ChatGPT to call `get_workspace_status_summary` and inspect any needed diff separately.
6. Use `elevated` only for scripts or legacy fallback, then rotate or clear the elevated token.
7. Return write mode to `off`.

The bearer token is a development/private-connector safeguard, not a complete enterprise auth system.

## Advanced Local STDIO Clients

STDIO remains available for local clients that can launch MCP processes directly:

```powershell
node .\dist\src\index.js
node .\dist\src\index.js --transport stdio
```

Use STDIO for trusted local MCP clients only. ChatGPT.com needs the HTTPS endpoint above.

