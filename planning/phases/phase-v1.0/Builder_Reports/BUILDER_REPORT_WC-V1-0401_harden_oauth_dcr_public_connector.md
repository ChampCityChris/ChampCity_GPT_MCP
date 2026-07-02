# Builder Report - WC-V1-0401 Harden OAuth/DCR Public Connector Path

Work Card: `WC-V1-0401 - Harden OAuth/DCR as the sole public connector path`
Branch: `feature/WC-V1-0401-harden-oauth-dcr-public-connector`
Date: 2026-07-02

## Repository Identity Checks

- Working directory verified: `%USERPROFILE%\Projects\ChampCity_GPT`
- Git top level verified: `%USERPROFILE%/Projects/ChampCity_GPT`
- Remote verified: `https://github.com/ChampCityChris/ChampCity_GPT_MCP.git`
- Starting branch: `feature/WC-V1-FIX05-clean-public-tool-surface`
- Implementation branch: `feature/WC-V1-0401-harden-oauth-dcr-public-connector`
- `package.json` present: yes
- Starting dirty state: only the prior FIX05 live probe was untracked: `planning/phases/phase-v1.0/Validation_Evidence/WC-V1-FIX05/live_toolbox_validation_probe.json`

## FIX05 Readiness Confirmation

Reviewed the WC-V1-FIX05 queue and reports before implementation:

- `planning/phases/phase-v1.0/WORK_CARD_QUEUE_v1.0.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-FIX05_clean_public_tool_surface.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_LOCAL_PACKAGE_after_WC-V1-FIX05.md`

Confirmed that FIX05 completed the seven-toolbox public surface, removed obsolete direct Figma/Figma Make public tools, kept legacy implementation paths hidden where needed by toolbox routers, and did not start WC-V1-0401.

## Implementation Summary

- Hardened Dynamic Client Registration metadata validation for ChatGPT-compatible public PKCE clients.
- Hardened public OAuth base URL normalization so invalid or unsafe public base values fall back to the default public issuer.
- Added safe, bounded OAuth error descriptions for DCR, authorization, and token request parsing failures.
- Removed local OAuth store paths, audit-log paths, and allowed-root paths from generated ChatGPT setup notes.
- Updated public setup documentation so OAuth/DCR is the standard v1.0 public connector path.
- Relabeled bearer/PAT/manual auth guidance as temporary local/manual fallback only, not the normal public ChatGPT path.
- Updated ChatGPT live connector evidence template and validator expectations for the exact seven public toolbox tools.
- Added focused deterministic tests for DCR rejection, redacted metadata/error behavior, generated note redaction, and evidence template coverage.

## Files Changed

- `README.md`
- `docs/CHAMPCITY_NET_ENDPOINT.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `docs/DESKTOP_APP_SETUP.md`
- `docs/SECURITY_MODEL.md`
- `docs/TOOL_REFERENCE.md`
- `electron/launcherCore.ts`
- `planning/phases/phase-v1.0/Live_Connector_Evidence/CHATGPT_LIVE_CONNECTOR_EVIDENCE_TEMPLATE.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0401_harden_oauth_dcr_public_connector.md`
- `src/oauth.ts`
- `src/transports/httpTransport.ts`
- `src/validation/chatgptEvidence.ts`
- `tests/chatgptEvidence.test.ts`
- `tests/docs.test.ts`
- `tests/httpTransport.test.ts`
- `tests/launcherCore.test.ts`

Pre-existing untracked file left untouched:

- `planning/phases/phase-v1.0/Validation_Evidence/WC-V1-FIX05/live_toolbox_validation_probe.json`

## OAuth/DCR Behavior Before And After

Before:

- DCR already existed for public PKCE clients and required `token_endpoint_auth_method: none`.
- Client metadata accepted broader `grant_types`, `response_types`, `client_uri`, and redirect URI values.
- OAuth request parse and registration errors could return raw exception messages.
- Generated ChatGPT setup notes included local paths for OAuth client storage, audit logs, and allowed roots.
- Documentation still gave too much normal-path weight to manual bearer/PAT-style setup language.

After:

- DCR accepts only `authorization_code` and `refresh_token` grant types, requires `authorization_code`, accepts only `code` response type, and keeps `token_endpoint_auth_method: none`.
- Redirect URIs and `client_uri` must be absolute HTTPS URLs, with localhost HTTP allowed only for local testing.
- OAuth URLs cannot include credentials or fragments, redirect URIs are de-duplicated, and client metadata strings are bounded and single-line.
- Invalid public base URL values fall back to the default public issuer; credentials, query strings, fragments, and trailing slashes are stripped from accepted base URLs.
- DCR, authorization, and token parsing errors return bounded redacted descriptions instead of raw path/token-bearing messages.
- Generated ChatGPT setup notes expose counts/status instead of local OAuth store, audit-log, or allowed-root paths.

## Public Connector Path Decisions

- OAuth/DCR is documented as the standard public ChatGPT connector path for v1.0.
- Public setup no longer presents bearer tokens, PATs, manual auth headers, or manually copied secrets as the normal path.
- Existing bearer-token support was not removed or code-gated in this card because that would change launcher compatibility behavior beyond the requested hardening scope.
- Bearer/manual auth is documented only as a temporary local/manual fallback that requires operator approval and is not the normal public connector path.

## Scope Enforcement Summary

- Existing `files.read` and `files.write` enforcement paths were preserved.
- Existing toolbox write denials without `files.write` remain covered by MCP self-test.
- Existing local write-mode denial behavior remains covered by tests and MCP self-test.
- Diagnostics continue to expose only redacted scope/status data.
- No public toolbox schema was changed to accept raw bearer tokens, client secrets, arbitrary authorization headers, caller-supplied OAuth internals, arbitrary endpoint URLs, raw shell commands, or caller-supplied repository roots.

## Public Tool Surface Confirmation

The public ChatGPT-facing MCP surface remains exactly these seven top-level toolbox tools:

- `repo_toolbox`
- `git_toolbox`
- `artifact_toolbox`
- `diagnostics_toolbox`
- `integration_toolbox`
- `browser_toolbox`
- `knowledge_toolbox`

The following were not reintroduced:

- legacy top-level repo tools
- legacy top-level git tools
- legacy top-level Figma tools
- `figma_toolbox`
- `run_allowed_script`
- direct `write_json_artifact`
- direct `propose_patch`
- direct `apply_approved_patch`

`write_json_artifact`, `propose_patch`, and `apply_approved_patch` remain available only as `repo_toolbox` actions.

## Validation Command Results

- `npm run typecheck`: PASS.
- `npm test`: initial sandbox execution failed with `spawn EPERM` from the esbuild subprocess; rerun in the normal Windows environment PASS, 249 tests passing.
- `npm run lint`: PASS.
- `npm run build`: PASS in the normal Windows environment because esbuild subprocesses are sandbox-blocked.
- `npm run check:public`: PASS before this Builder Report was added; final rerun after this report update PASS, 157 source candidate files checked.
- `npm run mcp:self-test`: initial sandbox execution failed with child-process/git `EPERM`; rerun in the normal Windows environment PASS, 22 checks passing.
- `npm run mcp:self-test -- --json`: initial sandbox execution failed with child-process/git `EPERM`; rerun in the normal Windows environment PASS, JSON output `ok: true`, 22 checks passing, 30 registered internal tools, and exactly 7 exposed public tools.
- `npm run chatgpt:evidence:validate -- --template`: PASS, 8 checks passing.
- `npm run chatgpt:evidence:validate -- --template --json`: PASS, JSON output `ok: true`, 8 checks passing.
- `git diff --check`: PASS after this report update; Git emitted LF-to-CRLF working-copy warnings only.
- `git status --short`: final capture completed after this report update; only intended WC-V1-0401 files plus the pre-existing FIX05 live validation probe are present.

## Known Limitations

- Live ChatGPT connector validation was not performed by Builder.
- The promoted runtime was not packaged, refreshed, or manually validated in ChatGPT as part of this card.
- Browser-based or visual validation was not performed.
- Existing legacy/manual bearer runtime support remains present as a compatibility path, but it is no longer documented as the normal public connector path.

## Live ChatGPT Connector Validation

Live ChatGPT connector validation is still required after runtime promotion. The operator should validate in a fresh ChatGPT conversation that OAuth/DCR registration and authorization succeed, `tools/list` shows exactly the seven public toolboxes, read-only calls work with `files.read`, and write actions remain denied without `files.write` plus local write-mode approval.

## Explicitly Not Performed

- WC-V1-0402 Cloudflare tunnel persistence was not performed.
- WC-V1-0403 Doctor/Fix actions were not performed.
- Packaging was not performed.
- Runtime promotion was not performed.
- Release publication was not performed.
- Tag creation was not performed.
- Merge to `main` was not performed.
- Staging, commit, push, and PR creation were not performed.

## Protected Subsystem Scope

Protected subsystems were touched only where this Work Card explicitly scoped them:

- OAuth and Dynamic Client Registration
- OAuth behavior
- token/scope documentation and tests
- MCP HTTP transport error handling
- generated ChatGPT setup notes
- public MCP evidence validation

No Cloudflare tunnel persistence, Doctor/Fix actions, packaging/release configuration, runtime path persistence, token storage format, write-scope enforcement architecture, server lifecycle behavior, or `window.champcity` preload API contract was changed.

## Scope And Fallback Status

- Scope did not change during implementation.
- No fallback implementation was used.
