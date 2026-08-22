# Security Model

ChampCity_GPT is a local MCP filesystem harness. It exposes a small set of audited file and git tools to an MCP-capable client, scoped to configured project roots.

Packaged Electron builds run the local HTTP MCP server in-process from bundled app modules. End users do not need external Node.js, npm, a source checkout, or command-line server startup. The `node dist/src/index.js` CLI remains available only for development and advanced local-client workflows.

## Threat Model

The server assumes an MCP client can request file reads, searches, patch proposals, approved writes, safe git inspection, and exact allowlisted commands. The main risks are accidental overexposure of local files, path traversal, symlink escapes, secret reads, unsafe writes, and command injection.

The harness is defensive, but it is not a sandbox for hostile code execution. Do not expose it to a public network, and do not add broad allowed roots such as `C:\`, a home directory, or an application profile directory.

## HTTP MCP OAuth Policy

In HTTP mode, `/mcp` requires `Authorization: Bearer <access_token>`. ChatGPT.com custom MCP apps use OAuth, so the server exposes a minimal private OAuth 2.1-compatible authorization layer instead of relying on static bearer-token setup. OAuth with Dynamic Client Registration is the normal public v1.0 connector path.

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

Dynamic client registration accepts ChatGPT's public PKCE client metadata and stores redirect URIs exactly in a runtime-local ignored OAuth client registry. The authorization page validates client ID, decoded redirect URI, `response_type=code`, requested scopes, and PKCE with `code_challenge_method=S256`. Plain PKCE is not allowed. Approval requires the local OAuth admin password, stored only as a runtime-local hash. Authorization codes are short-lived, one-time use, and bound to the client ID, redirect URI, S256 code challenge, and scopes. The token endpoint recomputes `base64url(sha256(code_verifier))` before issuing a bearer access token and refresh token. Access and refresh tokens are stored hashed in runtime-local ignored OAuth token state; raw refresh tokens are not stored.

Access tokens are intentionally short-lived. The default access token TTL is 2 hours, 7200 seconds, configured with `CHAMPCITY_GPT_ACCESS_TOKEN_TTL_SECONDS`. Refresh tokens keep ChatGPT connected for up to 30 days, 2592000 seconds by default, configured with `CHAMPCITY_GPT_REFRESH_TOKEN_TTL_SECONDS`. Refresh-token use rotates the refresh token, revokes the previous record, and rejects reuse of the old refresh token. Do not make access tokens permanent.

If ChatGPT reports `PKCE S256 code_challenge is required`, inspect the launcher OAuth troubleshooting fields. The diagnostic records only field presence, safe redirect origin/path, method value, and a client ID prefix; it must not contain raw code challenges, verifiers, tokens, authorization codes, client secrets, or admin passwords.

Scope mapping:

- `files.read`: `tools/list` and the seven public toolbox tools: `repo_toolbox`, `git_toolbox`, `artifact_toolbox`, `diagnostics_toolbox`, `integration_toolbox`, `browser_toolbox`, and `knowledge_toolbox`.
- `files.write`: required for `workspace_write_attached_image` and inside write-capable toolbox actions, including `artifact_toolbox.create_markdown_artifact`, `repo_toolbox.write_markdown_artifact`, `repo_toolbox.write_json_artifact`, `repo_toolbox.propose_patch`, `repo_toolbox.apply_approved_patch`, `integration_toolbox.prepare_external_handoff`, and mutating actions under `git_toolbox`.

Write access uses local write modes instead of a per-write token for every write. OAuth `files.write` is still required, but it is not enough by itself. The local write mode must also permit the operation:

- `off`: no write tools are allowed.
- `docs`: Markdown and JSON artifact writes and constrained attached-image imports are allowed without `approvalToken`.
- `patch`: docs mode plus controlled application of patches that match a stored `propose_patch` proposal hash.
- `elevated`: reserved for scripts, legacy approval-gated fallback operations, and safe git branch/stage/commit/push/integrate tools.

Write mode defaults to `off`. The preferred override is `CHAMPCITY_GPT_WRITE_MODE=off|docs|patch|elevated`; otherwise the server reads `config/write-access.local.json`. Legacy `CHAMPCITY_GPT_ENABLE_WRITE_TOOLS=true` maps to `docs`, and `false` maps to `off`. Existing `httpWriteToolsEnabled: true` local config migrates to `writeMode: "docs"` unless `writeMode` is already present.

The local elevated approval token is stored only as a salted `scrypt` hash in `config/write-access.local.json`; `CHAMPCITY_GPT_WRITE_APPROVAL_TOKEN` may be used temporarily for dev/manual testing and takes precedence over the local hash. Do not reuse OAuth access tokens as elevated approval tokens.

Static HTTP bearer tokens can remain for legacy/manual testing as a temporary operator-approved fallback. They are not the normal public ChatGPT connector path and are not sufficient for ChatGPT's OAuth connector flow.

## ChatGPT-Safe Read-Only Facade Tools

WC-V1-0102 added read-only facade implementations now routed through public toolbox actions for normal ChatGPT-facing status and release diagnostics:

- `get_workspace_status_summary`
- `get_change_set_readiness_summary`
- `get_release_artifact_summary`
- `get_release_publication_summary`
- `get_builder_report_index`
- `get_builder_report_summary`

These tools do not require absolute local Windows paths, do not accept command strings, do not accept executable file globs, and return bounded structured summaries with repository-relative paths where possible. They are the preferred ChatGPT-facing path for workspace status, change set readiness, release artifact inspection, and GitHub Release publication inspection.

Legacy `git_status`, `get_commit_readiness`, `list_project_files`, and `run_allowed_script` are not top-level public ChatGPT tools after WC-V1-FIX05. Internal implementations remain where toolbox routers need them. No write-scope, allowed-root, blocked-file, git safety, OAuth, or local write-mode checks are weakened by the facade tools.

The Builder Report facade implementations are limited to `planning/phases/<phaseFolder>/Builder_Reports/BUILDER_REPORT*.md` and are public through `artifact_toolbox` actions. `builder_report_index` returns repository-relative metadata only; `builder_report_summary` returns one bounded preview by safe report lookup and redacts private local path-like and token-like content. They do not accept arbitrary roots, arbitrary globs, command strings, shell arguments, write controls, or mutation inputs. Normal ChatGPT workflows should avoid broad file-listing calls that combine `planning/phases`, `**/BUILDER_REPORT*.md`, high `maxResults`, and absolute local roots.

`artifact_toolbox.read_image_artifact` is a PNG-only evidence reader, not a general binary file reader. It accepts only workspace-relative paths under approved artifact/evidence directories, verifies the real final path remains inside the selected configured workspace, applies blocked-file and image-specific cache/secret directory policy, enforces a hard 5,000,000-byte maximum, and checks PNG signature/IHDR bytes before returning MCP image content. Base64 bytes are confined to the MCP image content item and are omitted from text and structured metadata. The server performs no OCR or image analysis.

`artifact_toolbox.create_markdown_artifact` is a generic Markdown writer, not a document workflow tool. It accepts exactly `relativePath`, `content`, and optional `overwrite`, resolves the configured `workspaceId`, requires OAuth `files.write` plus write mode `docs`, `patch`, or `elevated`, applies repository-relative path containment, `.md` extension, blocked-path, artifact-root, size, and symlink/junction/reparse safeguards, and verifies exact bytes after writing. The content is opaque; the server does not parse headings, front matter, fenced blocks, review state, hashes, revisions, artifact types, or workflow metadata for this action.

Bounded text projection is the shared public read protocol for repository text and Markdown artifact text. `repo_toolbox.inspect_text_file` returns metadata, UTF-8 status, SHA-256, line counts, line-ending classification, and bounded Markdown heading indexes without body excerpts. `repo_toolbox.read_text_chunk`, `repo_toolbox.read_text_lines`, `repo_toolbox.read_markdown_section`, and `artifact_toolbox.read_artifact_text_chunk` return exact source text through bounded MCP text content items. Default text chunks target 8,192 UTF-8 bytes and public content items are hard-capped at 16,384 UTF-8 bytes. Larger `repo_toolbox.read_file`, `artifact_toolbox.read_artifact_by_id`, `latest_artifact(includeContent=true)`, and planning-corpus full-text export use the same projection metadata and cursors instead of embedding large bodies in structured JSON.

Projection cursors are opaque, integrity-protected, short-lived, and bound to workspace ID, normalized repository-relative path, source SHA-256, byte offset, and section identity where applicable. Source modification invalidates continuation and requires re-inspection. The protocol preserves exact bytes and line ordering with hashes; it must not base64, hex, URL encode, compress, encrypt, paraphrase, redact, or otherwise transform source text to avoid host classification. Bounded delivery limits a single failed host-side safety decision to one chunk, but it cannot guarantee OpenAI host acceptance.

`workspace_write_attached_image` is the only current top-level public exception to the toolbox surface because ChatGPT attachment file parameters must be top-level inputs. It is not a general file writer. It accepts one ChatGPT-authorized PNG, JPEG, or WebP attachment, validates the downloaded bytes, requires a configured `workspaceId`, requires a repository-relative `.png`, `.jpg`, `.jpeg`, or `.webp` destination, refuses overwrites, rejects traversal/absolute/Windows device/alternate-stream paths, rejects symlink or junction escapes, writes the exact approved bytes create-only, verifies SHA-256 after creation, and omits temporary download URLs from output and audit logs.

These tools are part of the remediation for `CAV-011`, `CAV-012`, `CAV-013`, `CAV-021`, `CAV-023`, `CAV-030`, and `CAV-033`. Local tests can verify registration and schema safety, but live ChatGPT validation is still required before claiming full platform safety-layer remediation.

## Stable Domain Toolbox Security Model

WC-V1-FIX05 leaves exactly seven stable read-visible public domain toolbox tools:

- `repo_toolbox`
- `git_toolbox`
- `artifact_toolbox`
- `diagnostics_toolbox`
- `integration_toolbox`
- `browser_toolbox`
- `knowledge_toolbox`

These tools reduce top-level MCP schema churn. `workspace_write_attached_image` is a bounded write-scoped top-level addition for ChatGPT attachment import only, so the ChatGPT-visible public MCP surface contains the seven toolbox tools plus the image writer when `files.write` and local write mode permit it. ChatGPT may bind tool schemas for a connector or chat lifecycle, so future expansion should prefer new internal allowlisted toolbox actions over new top-level MCP tools when file-parameter constraints do not require a top-level tool. Legacy top-level implementation functions remain registered internally where toolbox routers and local maintenance checks need them, but they are not exposed in public ChatGPT `tools/list`.

The toolbox input shape is stable: `action`, optional `workspaceId`, and optional `params`. The schema is not a security boundary. Each action has strict server-side validation and rejects unknown actions, unknown services, unsafe params, and missing required params with structured errors.

Workspace routing is stateless and per-call. Runtime config can define a workspace registry in `allowed-roots.local.json` with `workspaces` entries containing server-defined `workspaceId`, `label`, `root`, and optional expected `remote`, plus optional `defaultWorkspaceId`. Legacy `allowedRoots`-only configs still work; safe workspace IDs are derived from folder names. With multiple workspaces and no explicit default, project-specific toolbox calls using `workspaceId: "default"` fail with `WORKSPACE_REQUIRED` and safe available workspace IDs. There is no mutable global active workspace.

`diagnostics_toolbox.runtime_status` reports the running server package version and the selected workspace package version without returning absolute local paths. If those versions differ, the diagnostic warns that the active packaged runtime may be stale and should be packaged, promoted, restarted, and reconnected before relying on current source behavior. This drift warning is diagnostic only; it does not disable MCP access by itself.

Every parsed JSON-RPC object with `method: "tools/call"` gets a server-side correlation ID and HTTP receipt evidence before parameter validation, including malformed calls that are later rejected by the MCP SDK. For valid public calls, dispatch binding uses the installed MCP SDK handler metadata `extra.requestId`, not tool/action/path matching or handler-order claiming. The correlation ID is propagated through MCP dispatch, toolbox entry, helper audit events, result materialization, result serialization, HTTP response finish/close evidence, and transport-error logging. HTTP `finish` is transport evidence only; it is not client acknowledgement and does not prove ChatGPT accepted, exposed, or consumed the result. The trace records only bounded redacted metadata: tool name, toolbox action, safe workspace ID, repository-relative path hints where already allowed, sanitized JSON-RPC ID, result-attempt ID, result dimensions, result classification, sanitized error code/message, route, status, and duration. It never records file contents, search result contents, patch/artifact contents, full arguments, OAuth tokens, authorization codes, PKCE material, cookies, private tunnel URLs, absolute roots, stack traces, prompts, or attachment bytes.

`diagnostics_toolbox.recent_tool_calls` reads only the redacted MCP tool-call trace. It supports `limit`, `since`, `correlationId`, and `publicToolName` filters and classifies calls as `NO_SERVER_RECEIPT_EVIDENCE`, `RECEIVED_NOT_DISPATCHED`, `DISPATCHED_NOT_EXECUTED`, `APP_CONTRACT_REJECTED`, `APP_POLICY_DENIED`, `APP_AUTHORIZATION_DENIED`, `APP_EXECUTION_ERROR`, `RESULT_MATERIALIZED`, `RESULT_SERIALIZED`, `RESPONSE_FINISHED_UNACKNOWLEDGED`, `CLIENT_ACKNOWLEDGED`, `CONNECTION_CLOSED_BEFORE_FINISH`, or `TRANSPORT_ERROR`. OAuth scope requirements for toolbox actions come from one canonical action-policy registry used by both the HTTP gate and toolbox router. OAuth scope denials are evaluated per contained call and classified as `APP_AUTHORIZATION_DENIED` on actual receipt/completion evidence without fabricated dispatch or result stages; in a rejected mixed batch, an authorized sibling is recorded as received but not dispatched rather than inheriting another call's denial. Unsupported toolbox actions, duplicate JSON-RPC IDs, and schema validation failures are `APP_CONTRACT_REJECTED`, not application policy denials. String JSON-RPC IDs are sanitized, control-normalized, redacted for secrets, URLs, content keys, and arbitrary absolute paths, and capped at 128 characters. Tool-call, discovery, and HTTP transport diagnostics share field-aware redaction for free text, JSON-RPC IDs, routes, endpoints, host metadata, and request-derived errors. `NO_SERVER_RECEIPT_EVIDENCE` means only that no matching server receipt evidence was found.

`diagnostics_toolbox.acknowledge_tool_result` records a diagnostic receipt for an exact `correlationId`, `resultAttemptId`, and `payloadSha256`; it is telemetry only, not an approval control, and it does not retrieve, unlock, or reveal hidden payload content or imply OpenAI approved the content under every internal policy. `diagnostics_toolbox.result_delivery_status` returns only bounded safe metadata and result dimensions. Result hashes identify serialized bytes without revealing content, and result telemetry never retains document text, prompt text, patch text, artifact bodies, credentials, raw URLs, or absolute paths. Live OpenAI/ChatGPT host safety decisions remain outside the MCP server's direct observability.

Toolbox visibility requires `files.read`. Mixed read/write toolboxes are safe because write-capable actions enforce OAuth `files.write` and the same local write-mode policy as the mapped legacy operation. A caller with only `files.read` can see and call read-only diagnostics, but write actions fail with a clear missing `files.write` or write-mode error. This avoids hiding diagnostics from read-only sessions.

The toolbox surface must not expose or accept raw local filesystem roots from public ChatGPT callers, arbitrary shell, arbitrary git commands, arbitrary URL fetch, arbitrary upstream MCP tool calls, arbitrary service API methods, arbitrary browser actions, raw JSON passthrough as execution authority, raw tokens, OAuth stores, `.env`, local config, credential stores, private tunnel URLs, cookies, or browser profile credentials.

Figma belongs under `integration_toolbox` as the `figma` and `figma_make` service IDs. No `figma_toolbox` is added. The obsolete direct Figma tools and handoff implementation were removed; Figma integration actions now return governed broker-not-implemented placeholders without calling old token/API/MCP code.

`integration_toolbox` is a governed allowlisted service broker, not arbitrary MCP passthrough. `browser_toolbox` is constrained validation, not browser scraping. `knowledge_toolbox` is optional project-reference capability, not hidden memory mutation.

The correct ChatGPT OAuth scopes are:

```text
files.read files.write
```

`file.read` is a typo and does not grant the required `files.read` scope.

## Local MCP Protocol Self-Test

Release validation can run:

```powershell
npm run mcp:self-test
npm run mcp:self-test -- --json
```

The self-test is deterministic and local. It validates the restored internal MCP registry baseline of 31 registered schemas, `tools/list` schema, the public surface of seven stable toolboxes plus `workspace_write_attached_image` when write-scoped, required internal gated operations, stable toolbox registration, exposure-filtering of legacy helper schemas, narrow toolbox schemas, safety-compatible descriptions, safe read-only facade calls through toolbox actions, toolbox read-only diagnostics, explicit multi-workspace routing, toolbox write denial without `files.write`, unknown toolbox action denial, unknown integration service denial, Builder Report discovery, denied docs-write behavior, blocked-path denial, and hidden public exposure for `run_allowed_script`. It uses temporary fixtures for denied write, blocked-path, and multi-workspace probes, does not contact ChatGPT.com, does not launch Cloudflare, does not mutate OAuth/DCR state, and does not run elevated scripts.

The JSON output is intended for release validation and Builder Reports. It must remain redacted and must not expose secrets, tokens, OAuth stores, local config contents, full private user paths, release binary contents, logs, or generated output contents.

This self-test complements but does not replace live ChatGPT connector validation.

## Live ChatGPT Evidence Capture

Live ChatGPT connector validation evidence is recorded with the template and validator under `planning/phases/phase-v1.0/Live_Connector_Evidence/`:

```powershell
npm run chatgpt:evidence:validate -- --template
npm run chatgpt:evidence:validate -- --file planning/phases/phase-v1.0/Live_Connector_Evidence/<evidence-file>.md
```

This evidence workflow is manual/operator-assisted or based on explicit ChatGPT tool results. It does not require or support browser automation, ChatGPT UI scraping, screenshots, OAuth/DCR implementation changes, Cloudflare implementation changes, packaging, release publication, or token capture.

The validator fails evidence with obvious token-looking content, credential assignment text, private local user paths, `.env`-style secret lines, or private-key material. Evidence should use `%USERPROFILE%`, `%TEMP%`, `<REDACTED_LOCAL_PATH>`, `<REDACTED_PUBLIC_ENDPOINT>`, and `<REDACTED_SECRET>` placeholders. Local MCP self-test evidence supports release validation but does not prove live ChatGPT connector behavior.

## Figma Broker Placeholder Policy

The obsolete direct Figma and Figma Make implementation path was removed in WC-V1-FIX05. Public ChatGPT no longer sees `get_figma_status`, `parse_figma_url`, `fetch_figma_file_summary`, `fetch_figma_frame_image`, `create_figma_handoff_package`, `create_codex_ui_handoff_prompt`, `run_figma_make_handoff`, `run_figma_make_file_handoff`, or `test_figma_mcp_connection`.

Figma remains represented only as `figma` and `figma_make` service IDs under `integration_toolbox`. Current Figma service responses are governed broker placeholders: `status: "broker_not_implemented"`, `governedBrokerOnly: true`, `arbitraryUpstreamMcpPassthrough: false`, and `legacyDirectFigmaToolsRemoved: true`.

Do not add arbitrary upstream MCP passthrough, unofficial browser scraping, screenshot fallback, clipboard automation, raw Figma tokens, or local package parsing under a new public top-level tool. A future scoped Work Card may add audited broker behavior under `integration_toolbox`.

Public safety scans still block `config/*.local.json`, real-looking `figmaAccessToken` values, and common Figma token-looking strings where practical.

Unauthenticated localhost testing requires the explicit opt-in `CHAMPCITY_GPT_ALLOW_UNAUTH_LOCAL_HTTP=true`. Treat that mode as `LOCAL TEST ONLY - DO NOT TUNNEL.`

Nonlocal binding still requires `CHAMPCITY_GPT_ALLOW_NONLOCAL_HTTP=true`. A Cloudflare Tunnel can expose a localhost-bound service to the public internet, so binding to `127.0.0.1` does not replace OAuth.

For the example.com path, keep the local server bound to `127.0.0.1`, route Cloudflare Tunnel to `http://127.0.0.1:3333`, and register `https://mcp.example.com/mcp` only after tests and metadata checks pass. Do not tunnel unauthenticated local mode. Keep write mode `off` during first ChatGPT registration and testing.

OAuth sessions can be revoked from the launcher. Use all-session revocation for a full reset, ChatGPT-session revocation for ChatGPT registered clients, and clear expired sessions for local cleanup. These actions do not display raw tokens.

ChatGPT.com registration should not be attempted until `npm test` passes, including the end-to-end HTTP MCP test.

## Allowed Root Boundary

All file tools require a `root` value that matches one configured allowed root. Paths are resolved to canonical absolute paths before use. Relative paths that contain traversal segments, drive specifiers, UNC-style escapes, absolute paths, null bytes, or colon characters are rejected.

Configured roots can come from `config/allowed-roots.local.json` or `CHAMPCITY_GPT_ALLOWED_ROOTS`, separated by semicolons. Environment variables override local config. If neither is set, the server defaults to the current working directory only.

Named workspaces are also configured in `allowed-roots.local.json`. A workspace root must be inside the configured allowed roots; when only `workspaces` are configured, their roots become the allowed roots. ChatGPT-facing toolbox calls receive only workspace IDs, not arbitrary root paths. The legacy absolute-root helpers are retained as internal implementations for toolbox routers, but they are not registered as public MCP tools.

Workspace authority is per workspace and per operation. A ChampCity workspace is an allowed project directory and does not need to be a Git repository. Legacy `writePolicy: "git_required"` remains accepted as the default compatibility profile, but it does not require Git for filesystem reads, searches, Markdown/JSON artifact persistence, or general safety diagnostics. `writePolicy: "artifact_only"` remains an explicit planning profile that preserves configured `artifactWriteRoots` and denies Git mutation. New configs may express the same separation with `workspaceCapabilities.artifactPersistence`, `patchWorkflow`, `gitOperations`, and `releaseOperations`.

Git is an optional, isolated capability. Patch workflow, Git inspection/mutation, and release operations may require Git according to their explicit capability checks; absence of Git is reported locally to those operations and is not a workspace-wide security-policy denial. General workspace safety does not imply source-control readiness. Service runtime provenance describes ChampCity GPT itself, while selected target project metadata such as package version or Git HEAD is reported separately and is not compared to the runtime unless the selected workspace is the ChampCity GPT service repository.

`artifactWriteRoots` are server-configured workspace-relative directory prefixes. They reject absolute paths, drive/UNC paths, traversal, URLs, wildcards, shell metacharacters, empty values, blocked directory segments, and normalized paths that escape the workspace. `artifact_only` defaults to `["planning"]` when no roots are configured. The root `.` is allowed only when explicitly configured and is reported with a warning because it grants Markdown/JSON artifact-extension writes throughout that workspace.

Legacy `requireGitRoot` remains readable for compatibility, but it is deprecated as an operational gate. `requireGitRoot:false` does not disable Git requirements for `propose_patch`, `apply_approved_patch`, branch preparation, stage, pre-commit scan, commit, push, integration, tag, release, or future Git mutation paths. No existing Git repository silently becomes `artifact_only`.

Installed mode reads local config from Electron `userData\config`; portable mode reads from `data\config` beside the executable. Packaged runtime must not depend on repo-local `config/*.local.json` files or a hardcoded source checkout path.

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
- root, branch, action, and file count for git workflow tools when applicable
- requested path or command
- resolved path when applicable
- allow or deny result
- reason
- byte count when applicable

The audit log never records full file contents. The default path is `logs/audit.log` under the repo root. `config/allowed-roots.local.json` can set `auditLog`, and `CHAMPCITY_GPT_AUDIT_LOG` overrides both.

## Command Allowlist Policy

`run_allowed_script` is an internal/elevated exception for exact allowlisted maintenance tasks. `CHAMPCITY_GPT_ALLOWED_COMMANDS` overrides the local config file. The configured entry is parsed into executable plus arguments and spawned without shell interpolation.

The default allowlist is:

- `npm test`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `git status`
- `git diff`

The dedicated git tools run fixed git commands only. There is no MCP tool that accepts arbitrary git command strings.

The public architect diagnostics do not route through `run_allowed_script` or the legacy maintenance allowlist. `diagnostics_toolbox.project_validation` accepts only a fixed operation enum and launches the corresponding repository-owned npm script through a fixed Node.js/npm CLI resolution with `shell: false`. `git_toolbox.inspect_history` accepts only fixed read-only operations and constructed argument arrays. Electron diagnostics accept empty params and use only the application-owned startup diagnostic flag. Source analysis uses the TypeScript parser and never executes analyzed code.

All architect subprocess output is bounded and redacted. The inherited environment is reduced to an internal safe key set; callers cannot supply environment variables. Timeout cleanup terminates process descendants on Windows. Git inspection disables pagers, external diff helpers, interactive/credential prompts, system Git configuration, and color output.

## Write Mode Model

The old universal per-write `approvalToken` model was replaced because ChatGPT already authenticates with OAuth, allowed roots are narrow, blocked paths remain enforced, git provides rollback/review, and audit logging records MCP operations. The lower-friction model lets ChatGPT create Markdown planning artifacts in `docs` mode without pasting a token on every call.

`artifact_toolbox.create_markdown_artifact` and `repo_toolbox.write_markdown_artifact` require OAuth `files.write` and write mode `docs`, `patch`, or `elevated`. They only write `.md` files. `create_markdown_artifact` returns `already_saved` for identical existing bytes and otherwise refuses overwrites unless `overwrite` is `true`; it does not return hashes or interpreted document fields.

`write_json_artifact` is available through `repo_toolbox`, requires OAuth `files.write` and write mode `docs`, `patch`, or `elevated`, accepts only repository-relative `.json` paths, rejects caller-supplied roots, parses and normalizes JSON before writing, blocks local/generated/risky paths, refuses overwrites unless `overwrite` is `true`, and audits the write.

`propose_patch` requires OAuth `files.write`, generates a unified diff, computes a SHA-256 hash of the exact patch text, and stores short-lived metadata in `config/pending-patches.local.json`. The store contains proposal ID, root, hash, affected files, timestamps, expiry, and used status; it does not store the patch body.

`apply_approved_patch` requires OAuth `files.write` and write mode `patch` or `elevated`. In either mode it applies only when the supplied patch exactly matches a non-expired unused proposal for the same root. The proposal is marked used after successful application. Proposal mismatch, reuse, expiry, or hash failure is returned directly as a patch error; patch application never converts those failures into an approval-token request.

Source corrections to patch approval are not active for ChatGPT until the current version is packaged, promoted to the development runtime copy, restarted, and reconnected. After promotion, compare the package versions in `diagnostics_toolbox.runtime_status`; stale packaged deployments are flagged by the runtime drift diagnostics.

`apply_approved_patch` rejects git patches that declare symlink, submodule, or other non-regular file modes. Only regular text file modes are allowed; symlink mode `120000` and submodule/gitlink mode `160000` are denied before `git apply` runs. After a patch applies, the tool also checks changed paths with `lstat` and rejects the operation if any changed path is a symbolic link.

Git-backed patch and mutation workflows always require a confirmed Git repository regardless of workspace policy or legacy `CHAMPCITY_GPT_REQUIRE_GIT_ROOT`.

`run_allowed_script` requires OAuth `files.write`, write mode `elevated`, an exact allowlisted command, and a valid elevated approval token. Scripts are not available in `docs` or `patch` mode.

`pre_commit_safety_scan` and `get_commit_readiness` are read-only tools available with OAuth `files.read`. They report blocker findings by rule and path, but do not return raw matched secret values.

`prepare_git_work_branch`, `safe_stage_changes`, `commit_validated_changes`, `push_current_branch`, and `git_toolbox.integrate_to_dev` require OAuth `files.write` and write mode `elevated`. They do not accept shell commands or arbitrary git commands. `prepare_git_work_branch` accepts only `branchKind: dev` or `branchKind: feature` plus a validated Work Card ID and lowercase kebab-case slug. It generates only `dev`, `feature/WC-V1-xxxx-*`, or `feature/WC-V1-FIXxx-*`, refuses dirty working trees, refuses detached HEAD, refuses `main` as the active work target, and cannot push, merge, rebase, reset, stash, delete branches, tag, or run arbitrary commands. `safe_stage_changes` stages exact validated paths only after excluding local config, `.env` files except `.env.example`, logs, generated output, release artifacts, `dist`, `node_modules`, `package-lock.zip`, PID/status/log files, coverage output, ignored files, and files with blocker secret/private-path findings. It never runs `git add .` or `git add -f`.

`commit_validated_changes` commits already staged files only. It runs `pre_commit_safety_scan` in staged mode immediately before `git commit -m <message>`, refuses empty staged sets and blocker findings, and refuses `main` by default unless `allowMainCommit` is explicitly `true`.

`push_current_branch` pushes only to `origin`, refuses `main` by default unless `allowMainPush` is explicitly `true`, and never uses force push flags. It returns sanitized stdout/stderr and redacts credentials from remote URLs.

`git_toolbox.integrate_to_dev` is an internal allowlisted action under the existing public `git_toolbox`; it is not a new top-level MCP tool. It resolves the workspace by server-defined `workspaceId`, rejects caller-supplied roots, requires `targetBranch: "dev"`, rejects `main` and `dev` as source branches, requires a clean working tree, requires the source branch to be local and pushed, requires a Builder Report unless explicitly disabled, uses `no-ff` merge mode by default, aborts on merge conflict, runs fixed post-merge checks, and pushes only `dev` to `origin/dev` after those checks pass. It never force-pushes, rebases, resets, stashes, deletes branches, tags, packages, publishes releases, or touches `main`.

The elevated approval token is a local confirmation guard layered on top of OAuth, not a replacement for OAuth authentication. Treat every write as reviewable work: inspect `git diff` before committing or sharing changes.

Recommended workflow:

1. Use `docs` mode for Markdown planning docs.
2. Use `patch` mode for code changes and require `propose_patch` before `apply_approved_patch`.
3. Work on `dev` or a Work Card feature branch, not `main`; `main` is for stable release or baseline checkpoints.
4. Ask ChatGPT to run `git_toolbox.prepare_work_branch` when `dev` or `feature/WC-V1-xxxx-*` / `feature/WC-V1-FIXxx-*` needs to be prepared.
5. Validate the change on the prepared branch.
6. Ask ChatGPT to call `git_toolbox.readiness_summary` for the public-safe change set check.
7. Ask ChatGPT to run `git_toolbox.stage_paths`.
8. Ask ChatGPT to run `git_toolbox.pre_commit_scan`.
9. Ask ChatGPT to run `git_toolbox.commit_staged` with a reviewed commit message.
10. Ask ChatGPT to run `git_toolbox.push_current_branch` only after reviewing the commit result.
11. After Architect review, run `git_toolbox.integrate_to_dev` in dry-run mode.
12. After dry-run approval, run `git_toolbox.integrate_to_dev` with `dryRun: false` and `push: true`.
13. Package/promote from `dev` only when a later scoped prompt asks for it.
14. Merge to `main` only at a stable release or baseline checkpoint.
15. Return write mode to `off` after the session.

Releases are separate from commits. Release binaries are uploaded as GitHub Release assets, not committed.

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

