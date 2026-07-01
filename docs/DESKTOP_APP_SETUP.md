# Desktop App Setup

ChampCity GPT MCP Launcher is a self-contained Windows desktop app for the ChampCity GPT MCP filesystem harness. It gives end users a double-clickable app for setup, allowed-root configuration, OAuth administration, generated MCP client examples, logs, and local HTTP MCP server start/stop.

The packaged launcher runs the HTTP MCP server in-process from Electron. End users do not need Node.js, npm, command-line startup, or a source checkout after installing or unpacking the app. The launcher does not create a public network server, open firewall ports, add telemetry, or weaken the MCP server's existing filesystem and command restrictions.

## What The App Does

- Shows runtime mode, server runtime, config state, HTTP server state, endpoint URLs, and last doctor result.
- Runs a setup checklist for runtime config, allowed roots, logs, public/OAuth readiness, and developer diagnostics.
- Lets you view, add, remove, reset, and save `config/allowed-roots.local.json`.
- Warns before saving roots outside `C:\Users\<you>\Projects`.
- Generates MCP client config examples under `generated\`.
- Copies the generic STDIO MCP config to the clipboard.
- Opens the generated config folder, audit log, logs folder, and documentation.
- Starts and stops the local HTTP MCP server in-process from Electron.
- Configures ChatGPT OAuth setup: admin password, client reset, token revocation, metadata links, MCP URL copy, and OAuth setup notes.
- Configures the HTTP auth token through a desktop modal instead of the browser prompt API.
- Shows the current experimental/deferred Figma handoff controls.
- Shows runtime mode and runtime-local config/log/generated directories.
- Runs a first-run setup wizard when required runtime config is missing.

## First-Run Wizard

On a clean profile, the app opens a setup wizard before normal use. The wizard covers:

1. Welcome and security model.
2. Runtime mode and config/log/generated directories.
3. Allowed roots with folder picker and broad-root confirmation.
4. OAuth admin password, stored only as a hash.
5. Local-only or public HTTPS endpoint mode.
6. Optional Cloudflare Tunnel guidance.
7. Write mode, default `off`.
8. Summary and save.

Setup completion is stored in runtime-local:

```text
setup.local.json
```

The Settings/Advanced panel includes `Reset Setup Wizard`. Resetting the wizard does not delete tokens or config unless the user separately clears those values.

## Runtime Paths

Development mode uses the source repo for development config, logs, generated files, and build output.

Installed mode uses Electron `app.getPath("userData")`:

```text
<userData>\config
<userData>\logs
<userData>\generated
```

Portable mode activates when a `data` folder exists next to the executable:

```text
<exeDir>\data\config
<exeDir>\data\logs
<exeDir>\data\generated
```

The Electron main process passes these paths directly into the server lifecycle and mirrors them into process environment variables for shared config helpers:

```text
CHAMPCITY_GPT_CONFIG_DIR
CHAMPCITY_GPT_LOG_DIR
CHAMPCITY_GPT_GENERATED_DIR
```

Installed and portable mode must not depend on `C:\Users\<you>\Projects\ChampCity_GPT` or any other source repo path.

## Packaged Runtime

The packaged app uses:

- Runtime mode: `installed` or `portable`.
- Server runtime: `in-process`.
- Config path: Electron `userData\config` for installed mode or `data\config` beside the executable for portable mode.
- Logs path: Electron `userData\logs` or `data\logs`.
- Generated path: Electron `userData\generated` or `data\generated`.

`Start Local HTTP MCP Server` imports the bundled server lifecycle module and calls `startHttpMcpServer(...)` directly. It does not spawn `node.exe`, does not spawn `dist/src/index.js`, and never treats the launcher executable as the server process.

Node.js and npm checks are developer diagnostics only. In packaged mode, `Install Dependencies` and `Build MCP Server` are hidden or marked developer-only.

## Development Mode

From the repo root:

```powershell
cd C:\Users\<you>\Projects\<project>
npm install
npm run app:dev
```

`app:dev` compiles TypeScript and launches Electron from the repo. The renderer uses a preload bridge; it does not have unrestricted Node.js or shell access.

The CLI server remains available for developer and advanced local-client use after building:

```powershell
node .\dist\src\index.js --transport stdio
node .\dist\src\index.js --transport http --host 127.0.0.1 --port 3333
```

## Build And Package

Build the TypeScript app and MCP server:

```powershell
npm run app:build
```

Package a Windows portable executable:

```powershell
npm run app:dist
```

Electron Builder writes packaged output to:

```text
release\
```

The configured product name is `ChampCity GPT MCP Launcher`, and the app id is `com.champcity.gpt.mcp.launcher`.

## Development Runtime Copy

During development, do not run the active MCP launcher from the versioned executable under `release\`. Electron Builder must be able to overwrite that final portable executable during packaging.

After a successful package run, refresh the development runtime copy:

```powershell
npm run app:promote-runtime
```

The runtime copy is written to:

```text
C:\Users\<you>\Apps\ChampCity_GPT_MCP_Runtime\ChampCity GPT MCP Launcher-live.exe
```

Run that copied executable during development instead of `release\ChampCity GPT MCP Launcher-<version>-x64.exe`. The runtime copy is not a packaging artifact and must not be treated as packaging success; packaging success still requires the final versioned portable executable under `release\`.

If the versioned `release\*.exe` is already running and locks packaging, close it once, run `npm run app:promote-runtime` after a successful package build, and switch to the runtime copy. Do not run two launcher instances on port 3333 at the same time.

## Configure Allowed Roots

Open the Allowed Roots Manager in the app. The suggested defaults are:

```text
C:\Users\<you>\Projects\<project>
C:\Users\<you>\Projects\<another-project>
```

In development mode, the app saves:

```text
config\allowed-roots.local.json
```

In installed or portable mode, the same file name is saved under the runtime config directory, not the source repo.

The local config shape is:

```json
{
  "allowedRoots": [
    "C:\\Users\\<you>\\Projects\\<project>",
    "C:\\Users\\<you>\\Projects\\<another-project>"
  ],
  "requireGitRoot": true,
  "auditLog": "C:\\Users\\<you>\\Projects\\<project>\\logs\\audit.log",
  "allowedCommands": [
    "npm test",
    "npm run lint",
    "npm run typecheck",
    "npm run build",
    "git status",
    "git diff"
  ]
}
```

For concurrent project work, the same file may define server-named workspaces:

```json
{
  "workspaces": [
    {
      "workspaceId": "champcity_gpt",
      "label": "ChampCity GPT MCP",
      "root": "C:\\Users\\<you>\\Projects\\ChampCity_GPT",
      "remote": "https://github.com/ChampCityChris/ChampCity_GPT_MCP.git"
    }
  ],
  "defaultWorkspaceId": "champcity_gpt",
  "requireGitRoot": true
}
```

`allowedRoots` remains supported. If only `allowedRoots` is configured, the server derives safe workspace IDs from folder names. ChatGPT-facing toolbox calls should use `diagnostics_toolbox.list_workspaces` and pass explicit workspace IDs instead of local paths.

Environment variables still override the local config. The local config overrides safe defaults.

## Configure ChatGPT OAuth

Use the `ChatGPT OAuth Setup` section before registering `https://mcp.example.com/mcp` in ChatGPT.com.

The section shows:

- OAuth admin password configured: yes/no
- Registered ChatGPT clients count
- Active tokens count
- Active write tokens count
- Active OAuth clients count
- Active refresh sessions count
- Expired sessions count
- Revoked sessions count
- Access token TTL, default 2 hours
- Refresh token TTL, default 30 days
- Public issuer: `https://mcp.example.com`
- MCP endpoint: `https://mcp.example.com/mcp`
- Write mode: off/docs/patch/elevated
- OAuth files.write granted: yes/no/unknown
- Tunnel readiness

Actions:

- `Configure OAuth Admin Password`
- `Reset OAuth Clients`
- `Revoke All OAuth Sessions`
- `Revoke ChatGPT Sessions`
- `Clear Expired Sessions`
- `Open OAuth Metadata`
- `Open OAuth Session Docs`
- `Open Protected Resource Metadata`
- `Copy MCP Server URL`
- `Generate ChatGPT OAuth Setup Notes`

The admin password is stored only as a hash in:

```text
oauth-admin.local.json
```

Registered clients, hashed access tokens, and hashed refresh-session metadata are stored in ignored local files:

```text
oauth-clients.local.json
oauth-tokens.local.json
```

The launcher never displays passwords, access tokens, refresh tokens, client secrets, or bearer tokens in status, generated notes, logs, or docs. Access tokens default to 2 hours, 7200 seconds. Refresh tokens default to 30 days, 2592000 seconds, and keep ChatGPT connected across access-token expiry. Do not make tokens permanent, remove OAuth, expose unauthenticated `/mcp`, or enable write mode by default.

## Write Access

Use the `Write Access` section only after read-only ChatGPT access is working.

The section shows:

- Current write mode and source
- Docs writes: allowed/blocked
- Patch writes: allowed/blocked
- Elevated operations: allowed/blocked
- Pending patch proposal count
- Elevated approval token configured: yes/no
- Elevated approval token source: local-file/env/none
- OAuth files.write granted: yes/no/unknown
- Public write readiness: READY or NOT READY with the blocking reason

Actions:

- `Set Write Mode: Off`
- `Set Write Mode: Architect Docs`
- `Set Write Mode: Controlled Patch`
- `Set Write Mode: Elevated`
- `Clear Pending Patch Proposals`
- `Configure Elevated Approval Token`
- `Rotate Elevated Approval Token`
- `Clear Elevated Approval Token`
- `Generate Strong Elevated Token`
- `Copy Temporary Elevated Token`

The local write settings are stored in:

```text
write-access.local.json
```

The file stores `writeMode`, `elevatedApprovalRequired`, and a salted hash of the elevated approval token. Existing `httpWriteToolsEnabled: true` migrates to `writeMode: "docs"` unless the file already has `writeMode`; `false` migrates to `off`. The raw elevated token is shown only when generated or entered and is not displayed again after saving. If `CHAMPCITY_GPT_WRITE_APPROVAL_TOKEN` is set, the token source is `env`; clear or rotate that value outside the app. Do not reuse OAuth access tokens as elevated approval tokens.

Write access gates:

1. The OAuth access token must include `files.write`.
2. Local `writeMode` must allow the operation.
3. `run_allowed_script` and elevated fallback operations must include the elevated token in `approvalToken`.

Recommended workflow:

1. Set `Architect Docs` for Markdown planning docs.
2. Set `Controlled Patch` for code changes, then require `propose_patch` before `apply_approved_patch`.
3. Inspect `git status` and `git diff`.
4. Use `Elevated` rarely for scripts or legacy fallback, with the elevated token.
5. Set write mode back to `Off`.

## Figma Handoff

v1.0 scope note: Figma tools are deferred from v1.0 production-core scope. The current Figma workflow must be revisited before it can be treated as a supported product feature. v1.0 remains focused on ChatGPT-to-local-repository access, connector reliability, source-control/release automation, guided setup, and public-user distribution.

Use the `Figma Handoff` section to save the Figma token once and monitor Figma handoff status. For Figma Make, the primary online workflow is ChatGPT calling `run_figma_make_handoff`; the local exported-package fallback is ChatGPT calling `run_figma_make_file_handoff` with a `.make` path under an allowed root. The URL fields and buttons can remain useful for manual Design-file debugging.

Status fields:

- Figma token configured: yes/no
- Figma token source: env/local-file/dev-local-file/none
- Figma config path
- MCP Make handoff tool: available/unavailable
- Last parsed node

Actions:

- `Save`: saves the masked Figma token to runtime-local `figma.local.json`.
- `Clear Figma Token`: removes only the local token file. If the token source is `env`, change `CHAMPCITY_GPT_FIGMA_ACCESS_TOKEN` outside the app.
- `Test Figma Connection`: fetches a compact file summary only after a Figma file key or URL is entered.
- `Parse Figma URL`: extracts file key, normalized node ID, and URL type without a network call.
- `Create Figma Handoff Package`: writes `design\figma-handoff` by default.
- `Create Codex UI Handoff Prompt`: writes `docs\handoffs\CODEX_UI_REDESIGN_HANDOFF.md` by default.

The local token file shape is:

```json
{
  "figmaAccessToken": "<FIGMA_ACCESS_TOKEN>"
}
```

The launcher never displays the token after saving and does not include it in generated setup notes. Figma handoff/package writes still require the configured MCP write mode to allow docs-style writes. Generated handoffs may include screenshots and metadata from private Figma files, so review them before committing or sharing.

After the token is saved, ChatGPT can pass a Figma `/make/` URL to `run_figma_make_handoff`. The tool writes `design\figma-handoff\make` and `docs\handoffs\CODEX_FIGMA_MAKE_UI_HANDOFF.md` by default, returns artifact paths and warnings, and does not require the user to fill the launcher URL field or click `Create Figma Handoff Package`.

If the user exports a `.make` package from Figma Make, places it under the repo or another configured allowed root, and gives ChatGPT that path, ChatGPT can call `run_figma_make_file_handoff`. The tool writes `design\figma-handoff\make-file` and `docs\handoffs\CODEX_FIGMA_MAKE_FILE_HANDOFF.md` by default. This fallback parses the local package directly, copies assets, preserves important raw package files, parses Make chat history, reconstructs source where deterministic, and is not a screenshot or browser-scraping workflow.

## Legacy HTTP Auth Token

Use `Configure HTTP Auth Token` only for legacy/manual HTTP testing. The app opens a real Electron modal titled `Configure HTTP Auth Token` with a masked password/token field, Show/Hide, `Generate Strong Token`, `Save Token`, `Clear Token`, and `Cancel`.

`Generate Strong Token` creates a random token from at least 32 random bytes. `Save Token` requires a non-empty value and writes only:

```text
http-auth.local.json
```

The file shape is:

```json
{
  "httpAuthToken": "<secret token>"
}
```

`http-auth.local.json` is ignored by git in source development and stored under the runtime config directory in installed/portable mode. Do not upload it, share it, paste it into generated notes, or include it in release files. If `CHAMPCITY_GPT_HTTP_AUTH_TOKEN` is set, it overrides the local file and the app reports that the token is configured via environment variable. `Clear Token` only removes the local file; environment variables must be changed outside the app.

Static bearer-token auth was useful for manual testing but is not enough for ChatGPT's OAuth connector flow.

## Generate MCP Client Configs

Use `Generate MCP Client Configs` in the app. Files are written to:

```text
generated\
```

Generated files are written under the runtime generated directory. In development, that is `generated\`.

Generated files:

- `generic-stdio-mcp-config.example.json`
- `codex-mcp-config.example.json`
- `claude-desktop-mcp-config.example.json`
- `chatgpt-connection-notes.md`

Development STDIO JSON configs launch:

```text
C:\Users\<you>\Projects\<project>\dist\src\index.js
```

Packaged app HTTP server launch is internal to Electron and does not use these STDIO config snippets.

Copy the generated snippet into the MCP client location documented by that client, then restart or reload the client as required.

## Codex And Local STDIO Clients

Many local MCP clients launch STDIO servers themselves. For those clients, generating and installing the client config is the primary connection step. The client starts `node` with the MCP entrypoint when it needs the server.

That means you usually do not need a persistent background process for Codex-style or Claude Desktop-style STDIO MCP.

## Local HTTP MCP Server

`Start Local HTTP MCP Server` starts the HTTP server in-process from Electron and keeps the handle in Electron main memory. The same server code is still available to developers through the CLI:

```powershell
node .\dist\src\index.js --transport http --host 127.0.0.1 --port 3333
```

For ChatGPT OAuth mode, configure the OAuth admin password first. The server can then start without a legacy bearer token because `/mcp` is protected by OAuth access tokens. A legacy auth token from `CHAMPCITY_GPT_HTTP_AUTH_TOKEN` or `config\http-auth.local.json` can still start manual bearer-auth testing. If neither OAuth admin password nor legacy token is configured, startup is refused unless you explicitly enable local unauthenticated test mode.

Unauthenticated local mode remains clearly labeled `LOCAL TEST ONLY - DO NOT TUNNEL.` Do not tunnel it.

Launcher status metadata is written under the runtime logs directory:

```text
champcity-gpt-mcp-http.status.json
```

`Stop Local HTTP MCP Server` calls `handle.stop()` for the in-process server. If a legacy child-process PID file from an older development run is present, the launcher still refuses to stop unknown processes and only cleans up matching stale metadata.

## Troubleshooting

- Node or npm missing: packaged runtime does not need them. Install Node.js 20.10 or newer only when building from source.
- Dependencies missing: use `Developer: Install Dependencies` in development mode.
- Build output missing: use `Developer: Build MCP Server` in development mode.
- Local config missing: use `Reset Defaults`, review roots, then `Save Config`.
- A root warning appears: keep roots under `C:\Users\<you>\Projects` unless you intentionally confirm a narrower external path.
- Generated config does not connect: verify your MCP client config location and restart behavior.
- Local HTTP server appears stale: click `Stop Local HTTP MCP Server` to clean up stale launcher status files.

## Safety Notes

Keep allowed roots narrow. Do not configure `C:\`, your whole home folder, browser profiles, cloud credential stores, or secret directories.

This app does not make hosted ChatGPT local-only. If a hosted client or model asks the MCP server for file contents, those contents may enter that hosted client or model context.

OAuth scopes map to tool access: `files.read` for read/list/search/git inspection/status, and `files.write` for proposal, Markdown, patch, and script tools. Local write mode is still required. Markdown artifact writes work without `approvalToken` in Architect Docs, Controlled Patch, or Elevated mode; scripts still require Elevated mode and the elevated approval token.

