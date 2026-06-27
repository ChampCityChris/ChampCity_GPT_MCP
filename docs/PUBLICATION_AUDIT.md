# Publication Audit

Audit date: 2026-06-27

## Files Scanned

Scanned repository files returned by `git ls-files --cached --others --exclude-standard`, including source, Electron UI, scripts, tests, docs, examples, package metadata, and root config files. Ignored local/generated paths are excluded from commit candidates.

Primary scan command:

```powershell
rg -n "<private-user-path>|<private-username>|<private-email>|<private-project>|<private-domain>|APPROVE_LOCAL_WRITE|oauth token|auth token|figma token|cloudflare token|tunnel token|client_secret|refresh_token|access_token|figmaAccessToken|cloudflare" .
```

## Private Path Findings

- Removed/sanitized hardcoded private Windows project roots from docs, examples, config, scripts, tests, and launcher defaults.
- Removed/sanitized hardcoded private adjacent project roots from docs, examples, config, scripts, tests, and launcher defaults.
- Replaced public examples with `C:\Users\<you>\Projects\<project>`, `C:\Users\<you>\Projects\<another-project>`, or neutral test paths such as `C:\Projects\example`.
- Updated Electron launcher defaults to derive the repo root from runtime context instead of a private absolute path.
- Updated project-root warning logic to use the repo parent directory instead of a private user profile path.

## Domain-Specific Findings

- Replaced the private public MCP hostname with `https://mcp.example.com` and `mcp.example.com` in public docs, examples, source defaults, and tests.
- Kept Cloudflare/cloudflared references where they describe optional tunnel support, CLI commands, or the Cloudflare dashboard.
- Left `CHAMPCITY_GPT_*` environment variable names and `ChampCity GPT MCP Launcher` product naming intact as intentional project branding.

## Secret, Config, Log, And Build Artifact Findings

- Local config and local generated files exist only locally and are ignored.
- Public repo source is clean.
- Release binaries are not committed.
- Public examples use placeholders.
- Final pre-push check command: `npm run check:public`.
- Confirmed local secret/config files are ignored:
  - `config/allowed-roots.local.json`
  - `config/write-access.local.json`
  - `config/http-auth.local.json`
  - `config/oauth-admin.local.json`
  - `config/oauth-clients.local.json`
  - `config/oauth-tokens.local.json`
  - `config/figma.local.json`
  - `config/setup.local.json`
  - `config/pending-patches.local.json`
- Confirmed generated/build/local artifact directories are ignored:
  - `logs/`
  - `generated/`
  - `release/`
  - `dist/`
  - `node_modules/`
- Added ignores for `package-lock.zip`, `*.pid`, and `*.status.json`.
- No real access tokens, refresh tokens, client secrets, Figma tokens, Cloudflare tokens, or tunnel tokens were found in commit-candidate files.
- Remaining `access_token` and `refresh_token` hits are OAuth protocol field names in source/tests/docs, not committed secret values.

## Actions Taken

- Rewrote `README.md` as a public-facing pre-release README.
- Added `SECURITY.md`.
- Added `CONTRIBUTING.md`.
- Added publication, release, and GitHub publication checklists.
- Added `docs/LICENSE_DECISION_NEEDED.md` instead of assuming a license.
- Added/sanitized example configs:
  - `config/allowed-roots.example.json`
  - `config/write-access.example.json`
  - `config/http-auth.example.json`
  - `config/oauth.example.json`
  - `examples/cloudflared-config.example.yml`
  - `examples/mcp-client-config.example.json`
- Updated `.env.example` to placeholder-only values.
- Updated `.gitignore` for local config, OAuth stores, logs, generated files, release output, package zips, PID files, and status files.
- Updated source and tests to use public placeholders and runtime-derived local paths.
- Added `scripts/check-publication-clean.ps1` and `npm run check:public`.
- Added `scripts/check-release-clean.ps1` and `npm run check:release`.
- Added first-run setup wizard support and runtime config/log/generated path separation.

## Remaining Known Safe Examples

- `https://mcp.example.com/mcp` is an intentional placeholder public MCP endpoint.
- `mcp.example.com` is an intentional placeholder DNS name.
- `C:\Users\<you>\Projects\<project>` is an intentional placeholder local project root.
- `C:\Projects\example` appears only as a neutral test path.
- `cloudflared` and Cloudflare references are intentional optional tunnel documentation and UI labels.
- OAuth field names such as `access_token`, `refresh_token`, and `grant_type=refresh_token` are protocol names, not secret values.

## Manual Steps Before GitHub Publish

- Choose a license and add a root `LICENSE` file.
- Decide the GitHub owner and repository name.
- Replace the placeholder package `repository.url` with the final GitHub URL.
- Review all untracked files and stage only intended source/docs/examples.
- Confirm no local ignored files are force-added.
- Run the full validation checklist.
- Decide whether release binaries will be published as GitHub Release assets.
- Push only after reviewing `git diff --cached`.
