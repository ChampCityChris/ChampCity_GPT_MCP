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

## Security Notes

Files stay local until a tool call reads them. File contents requested through MCP may enter hosted ChatGPT context. This does not make hosted ChatGPT local-only.

Start read-only first. Set write mode above `off` only after confirming:

- HTTPS tunnel and DNS are configured.
- OAuth admin password is configured.
- Allowed roots are narrow.
- Audit logging is enabled and reviewed.
- Read-only tools work through ChatGPT.

In HTTP mode, `/mcp` requires `Authorization: Bearer <access_token>`. `files.read` covers read/list/search/git status/git diff, `get_write_access_status`, and `tools/list`. `files.write` covers `propose_patch`, `write_markdown_artifact`, `apply_approved_patch`, and `run_allowed_script`, but write access still has local write-mode gates. Markdown writes require mode `docs`, `patch`, or `elevated` and do not require `approvalToken`. Patch application requires mode `patch` or `elevated` and a matching pending proposal hash, unless elevated approval is used as a fallback. Scripts require mode `elevated`, an allowlisted command, and the elevated approval token. Unauthenticated localhost mode requires explicit opt-in with `CHAMPCITY_GPT_ALLOW_UNAUTH_LOCAL_HTTP=true` and must not be used behind a tunnel. A Cloudflare Tunnel can expose a localhost-bound service to the public internet, so localhost binding is not a substitute for OAuth.

Do not remove OAuth, do not expose unauthenticated `/mcp`, and do not enable write mode by default. Use `Revoke All OAuth Sessions` or `Revoke ChatGPT Sessions` in the launcher if a ChatGPT connection should be forced to reauthorize.

Keep `CHAMPCITY_GPT_WRITE_MODE=off` until read-only validation is complete. Use `docs` for Architect Markdown docs, `patch` for proposed code changes, and `elevated` rarely. Configure the elevated approval token in the launcher Write Access panel; it is stored only as a salted hash in `config\write-access.local.json`, which is ignored by git. `CHAMPCITY_GPT_WRITE_MODE` is preferred; legacy `CHAMPCITY_GPT_ENABLE_WRITE_TOOLS=true` maps to `docs`. Do not reuse OAuth access tokens as elevated approval tokens.

Generated setup notes report OAuth status, legacy bearer status, current write mode, pending patch proposal count, and whether an elevated approval token is configured. They never print token values, admin passwords, client secrets, raw OAuth records, or the raw elevated approval token.

Recommended write workflow:

1. Set write mode to `docs` for Markdown planning docs.
2. Set write mode to `patch` for code changes.
3. Ask ChatGPT to propose a patch first and review the returned patch.
4. Apply only the matching pending proposal.
5. Inspect `git status` and `git diff`.
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

