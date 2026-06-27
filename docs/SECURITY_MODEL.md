# Security Model

ChampCity_GPT is a local MCP filesystem harness. It exposes a small set of audited file and git tools to an MCP-capable client, scoped to configured project roots.

## Threat Model

The server assumes an MCP client can request file reads, searches, patch proposals, approved writes, safe git inspection, and exact allowlisted commands. The main risks are accidental overexposure of local files, path traversal, symlink escapes, secret reads, unsafe writes, and command injection.

The harness is defensive, but it is not a sandbox for hostile code execution. Do not expose it to a public network, and do not add broad allowed roots such as `C:\`, a home directory, or an application profile directory.

## HTTP MCP OAuth Policy

In HTTP mode, `/mcp` requires `Authorization: Bearer <access_token>`. ChatGPT.com custom MCP apps use OAuth, so the server exposes a minimal private OAuth 2.1-compatible authorization layer instead of relying on static bearer-token setup.

Local unauthenticated and authenticated HTTP MCP testing has passed for `http://127.0.0.1:3333/mcp`. The Cloudflare Tunnel path for `https://mcp.example.com/mcp` must keep OAuth enforcement enabled.

Discovery endpoints:

```text
/.well-known/oauth-protected-resource
/.well-known/oauth-protected-resource/mcp
/.well-known/oauth-authorization-server
```

OAuth endpoints:

```text
/oauth/register
/oauth/authorize
/oauth/token
```

Dynamic client registration accepts ChatGPT's public PKCE client metadata and stores redirect URIs exactly in `config\oauth-clients.local.json`, which is ignored by git. The authorization page validates client ID, decoded redirect URI, `response_type=code`, requested scopes, and PKCE with `code_challenge_method=S256`. Plain PKCE is not allowed. Approval requires the local OAuth admin password, stored only as a hash in `config\oauth-admin.local.json`. Authorization codes are short-lived, one-time use, and bound to the client ID, redirect URI, S256 code challenge, and scopes. The token endpoint recomputes `base64url(sha256(code_verifier))` before issuing a bearer access token and refresh token. Access and refresh tokens are stored hashed in `config\oauth-tokens.local.json`; raw refresh tokens are not stored.

Access tokens are intentionally short-lived. The default access token TTL is 2 hours, 7200 seconds, configured with `CHAMPCITY_GPT_ACCESS_TOKEN_TTL_SECONDS`. Refresh tokens keep ChatGPT connected for up to 30 days, 2592000 seconds by default, configured with `CHAMPCITY_GPT_REFRESH_TOKEN_TTL_SECONDS`. Refresh-token use rotates the refresh token, revokes the previous record, and rejects reuse of the old refresh token. Do not make access tokens permanent.

If ChatGPT reports `PKCE S256 code_challenge is required`, inspect the launcher OAuth troubleshooting fields or `config\oauth-authorize-last-error.local.json`. The diagnostic records only field presence, safe redirect origin/path, method value, and a client ID prefix; it must not contain raw code challenges, verifiers, tokens, authorization codes, client secrets, or admin passwords.

Scope mapping:

- `files.read`: `tools/list`, `list_project_files`, `read_project_file`, `search_project_files`, `git_status`, `git_diff`, and `get_write_access_status`.
- `files.write`: `propose_patch`, `write_markdown_artifact`, `apply_approved_patch`, and `run_allowed_script`.

Write access uses local write modes instead of a per-write token for every write. OAuth `files.write` is still required, but it is not enough by itself. The local write mode must also permit the operation:

- `off`: no write tools are allowed.
- `docs`: Markdown artifact writes are allowed without `approvalToken`.
- `patch`: docs mode plus controlled application of patches that match a stored `propose_patch` proposal hash.
- `elevated`: reserved for scripts and legacy approval-gated fallback operations.

Write mode defaults to `off`. The preferred override is `CHAMPCITY_GPT_WRITE_MODE=off|docs|patch|elevated`; otherwise the server reads `config/write-access.local.json`. Legacy `CHAMPCITY_GPT_ENABLE_WRITE_TOOLS=true` maps to `docs`, and `false` maps to `off`. Existing `httpWriteToolsEnabled: true` local config migrates to `writeMode: "docs"` unless `writeMode` is already present.

The local elevated approval token is stored only as a salted `scrypt` hash in `config/write-access.local.json`; `CHAMPCITY_GPT_WRITE_APPROVAL_TOKEN` may be used temporarily for dev/manual testing and takes precedence over the local hash. Do not reuse OAuth access tokens as elevated approval tokens.

Static HTTP bearer tokens can remain for legacy/manual testing. Loading order is `CHAMPCITY_GPT_HTTP_AUTH_TOKEN`, then `config\http-auth.local.json`, then no legacy token. Static bearer tokens were useful for manual HTTP tests but are not sufficient for ChatGPT's OAuth connector flow.

Unauthenticated localhost testing requires the explicit opt-in `CHAMPCITY_GPT_ALLOW_UNAUTH_LOCAL_HTTP=true`. Treat that mode as `LOCAL TEST ONLY - DO NOT TUNNEL.`

Nonlocal binding still requires `CHAMPCITY_GPT_ALLOW_NONLOCAL_HTTP=true`. A Cloudflare Tunnel can expose a localhost-bound service to the public internet, so binding to `127.0.0.1` does not replace OAuth.

For the example.com path, keep the local server bound to `127.0.0.1`, route Cloudflare Tunnel to `http://127.0.0.1:3333`, and register `https://mcp.example.com/mcp` only after tests and metadata checks pass. Do not tunnel unauthenticated local mode. Keep write mode `off` during first ChatGPT registration and testing.

OAuth sessions can be revoked from the launcher. Use all-session revocation for a full reset, ChatGPT-session revocation for ChatGPT registered clients, and clear expired sessions for local cleanup. These actions do not display raw tokens.

ChatGPT.com registration should not be attempted until `npm test` passes, including the end-to-end HTTP MCP test.

## Allowed Root Boundary

All file tools require a `root` value that matches one configured allowed root. Paths are resolved to canonical absolute paths before use. Relative paths that contain traversal segments, drive specifiers, UNC-style escapes, absolute paths, null bytes, or colon characters are rejected.

Configured roots can come from `config/allowed-roots.local.json` or `CHAMPCITY_GPT_ALLOWED_ROOTS`, separated by semicolons. Environment variables override local config. If neither is set, the server defaults to the current working directory only.

## Blocked File Policy

The file policy blocks sensitive names and directories by default:

- `.env` and `.env.*`, except `.env.example` as a documented template file
- `id_rsa` and `id_ed25519`
- `*.pem`, `*.key`, `*.pfx`, `*.sqlite`, `*.sqlite3`, and `*.db`
- `node_modules`
- `.git` internals
- `AppData`
- common browser profile paths

Read and search tools also reject binary-looking files and enforce byte limits.

## Symlink Policy

Paths are resolved with `realpath` where possible. For new files, the nearest existing parent is resolved. If a symlink causes the final canonical path to escape the selected allowed root, the request is denied.

On Windows, creating test symlinks can require Developer Mode or elevated permissions. The runtime policy still uses canonical path resolution to block escapes.

## Audit Log Policy

Every tool handler writes a JSONL audit entry with:

- timestamp
- tool name
- requested path or command
- resolved path when applicable
- allow or deny result
- reason
- byte count when applicable

The audit log never records full file contents. The default path is `logs/audit.log` under the repo root. `config/allowed-roots.local.json` can set `auditLog`, and `CHAMPCITY_GPT_AUDIT_LOG` overrides both.

## Command Allowlist Policy

`run_allowed_script` only runs commands that exactly match the configured command allowlist. `CHAMPCITY_GPT_ALLOWED_COMMANDS` overrides the local config file. The command is parsed into executable plus arguments and spawned without shell interpolation.

The default allowlist is:

- `npm test`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `git status`
- `git diff`

The dedicated git tools run fixed git commands only.

## Write Mode Model

The old universal per-write `approvalToken` model was replaced because ChatGPT already authenticates with OAuth, allowed roots are narrow, blocked paths remain enforced, git provides rollback/review, and audit logging records MCP operations. The lower-friction model lets ChatGPT create Markdown planning artifacts in `docs` mode without pasting a token on every call.

`write_markdown_artifact` requires OAuth `files.write` and write mode `docs`, `patch`, or `elevated`. It only writes `.md` files and refuses overwrites unless `overwrite` is `true`.

`propose_patch` requires OAuth `files.write`, generates a unified diff, computes a SHA-256 hash of the exact patch text, and stores short-lived metadata in `config/pending-patches.local.json`. The store contains proposal ID, root, hash, affected files, timestamps, expiry, and used status; it does not store the patch body.

`apply_approved_patch` requires OAuth `files.write` and write mode `patch` or `elevated`. In `patch` mode it applies only when the supplied patch exactly matches a non-expired unused proposal for the same root. The proposal is marked used after successful application. In `elevated` mode, an elevated approval token can be used as a high-risk fallback when no proposal matches.

`apply_approved_patch` rejects git patches that declare symlink, submodule, or other non-regular file modes. Only regular text file modes are allowed; symlink mode `120000` and submodule/gitlink mode `160000` are denied before `git apply` runs. After a patch applies, the tool also checks changed paths with `lstat` and rejects the operation if any changed path is a symbolic link.

When `CHAMPCITY_GPT_REQUIRE_GIT_ROOT=true`, write tools verify that targets belong to a git repository.

`run_allowed_script` requires OAuth `files.write`, write mode `elevated`, an exact allowlisted command, and a valid elevated approval token. Scripts are not available in `docs` or `patch` mode.

The elevated approval token is a local confirmation guard layered on top of OAuth, not a replacement for OAuth authentication. Treat every write as reviewable work: inspect `git diff` before committing or sharing changes.

Recommended workflow:

1. Use `docs` mode for Markdown planning docs.
2. Use `patch` mode for code changes and require `propose_patch` before `apply_approved_patch`.
3. Inspect `git diff` after writes and before commits.
4. Use `elevated` mode only for rare approval-gated scripts or fallback patch application.
5. Return write mode to `off` after the session.

## Known Limitations

- MCP client/model behavior is outside this server's control once file contents are returned.
- The server does not provide OS-level sandboxing.
- Patch application uses `git apply` after validating targets and rejecting symlink/submodule modes. Post-apply rollback is best-effort if a symlink path is detected after apply.
- Search is literal string matching, not a full ripgrep replacement.

## Recommended Future Hardening

- Add per-request confirmation or signed approvals.
- Add token revocation by individual client.
- Add configurable file extension allowlists per root.
- Add structured patch previews with checksums.
- Add rate limits and per-client audit identity.
- Add integration tests against a real MCP client.

