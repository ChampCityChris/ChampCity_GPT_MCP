# ChampCity GPT MCP Launcher

ChampCity GPT MCP Launcher is a pre-release ChatGPT-compatible MCP server and Electron launcher for controlled local project-file access. It can expose read-only and approval-gated write tools over local STDIO or local HTTP, with optional OAuth and HTTPS tunneling for ChatGPT.com-compatible MCP connectors.

Current maturity: `v0.1.2`, pre-release/private-tooling quality. Review the code and security model before using it with sensitive repositories.

License: not yet selected. See [docs/LICENSE_DECISION_NEEDED.md](docs/LICENSE_DECISION_NEEDED.md).

## What It Does

- Lists, reads, and searches files inside configured allowed roots.
- Reports git status and git diffs for allowed git worktrees.
- Provides safe git workflow tools for readiness checks, safety scans, filtered staging, validated local commits, and optional non-force pushes.
- Provides Figma-to-Codex design handoff tools using the official Figma REST API for Design URLs and official Figma MCP resources for Make URLs.
- Supports write modes: `off`, `docs`, `patch`, and `elevated`.
- Provides an Electron launcher for local setup, status checks, OAuth administration, and client config generation.
- Supports local STDIO MCP for trusted local clients.
- Runs the local Streamable HTTP MCP server inside the packaged Electron app on `127.0.0.1`.
- Supports OAuth metadata, Dynamic Client Registration, PKCE, access tokens, refresh token rotation, and scopes for ChatGPT.com-compatible public HTTPS endpoints.
- Includes optional Cloudflare Tunnel docs and examples.

## What It Does Not Do

- It does not make hosted ChatGPT local-only; file contents returned by tools can enter the model/tool context.
- It does not safely expose arbitrary folders. You must configure narrow allowed roots.
- It does not require Cloudflare or any specific domain. `https://mcp.example.com/mcp` is only a placeholder.
- It does not enable writes by default.
- It does not commit or expose Figma tokens, auth headers, cookies, or session credentials. Generated Design handoffs may still contain private screenshots or metadata; generated Make handoffs may contain private source/resources.
- It does not replace human review. Review generated patches and git diffs before committing.

## Security Model

Filesystem access is limited to configured allowed roots. Use project-level roots such as:

```powershell
C:\Users\<you>\Projects\<project>
```

Avoid broad roots such as `C:\`, `C:\Users\<you>`, home directories, cloud sync roots, browser profile folders, SSH folders, and credential stores.

HTTP mode should bind to `127.0.0.1` by default. ChatGPT.com compatibility requires an HTTPS-reachable endpoint with OAuth and Dynamic Client Registration. For public use, set:

```powershell
CHAMPCITY_GPT_PUBLIC_BASE_URL=https://mcp.example.com
```

OAuth scopes:

- `files.read`: list/read/search files, git status/diff, write-access status, Figma status/URL parsing/file summaries, commit readiness, safety scans, and tool discovery.
- `files.write`: propose patches, write Markdown artifacts, apply approved patches, export Figma frame images, create Figma handoff packages, run Figma Make handoff orchestration, create Codex UI handoff prompts, run allowlisted scripts, safely stage files, create validated commits, and optionally push, still gated by local write mode.

Never expose unauthenticated HTTP mode through a tunnel.

## Write Modes

- `off`: default. Blocks write tools.
- `docs`: allows Markdown artifact writes for planning or notes.
- `patch`: allows proposed patch workflows and approved patch application.
- `elevated`: allows rare allowlisted script/elevated operations and safe git stage/commit/push workflows.

Set the mode with:

```powershell
$env:CHAMPCITY_GPT_WRITE_MODE='off'
```

## Local Configuration

On first launch, the Electron app opens a setup wizard where each user chooses allowed roots, local-only or public endpoint mode, OAuth admin password, optional Cloudflare guidance, and write mode. Write mode defaults to `off`, and the OAuth admin password is stored only as a local hash.

## Packaged App Runtime

End users do not need Node.js, npm, PowerShell server startup, a source checkout, or `npm install` to run the packaged app. The installed or portable executable starts the HTTP MCP server in-process from bundled Electron modules when the user clicks `Start Local HTTP MCP Server`.

Node.js and npm are developer prerequisites only for building from source, running tests, or using the advanced CLI server entrypoint.

The developer CLI remains available after a source build:

```powershell
node dist\src\index.js --transport stdio
node dist\src\index.js --transport http --host 127.0.0.1 --port 3333
```

For source development, you can still copy example config files and create repo-local versions as needed:

```powershell
Copy-Item config\allowed-roots.example.json config\allowed-roots.local.json
Copy-Item config\write-access.example.json config\write-access.local.json
```

Local files matching `config/*.local.json` are ignored by git. Do not commit OAuth stores, auth tokens, local paths, tunnel credentials, logs, generated configs, release outputs, or `.env` files.

## Figma Design Handoff

ChampCity GPT can fetch Figma file/frame metadata through the official Figma REST API and generate a Codex-ready UI implementation handoff. Configure a Figma personal access token locally:

```powershell
Copy-Item config\figma.example.json config\figma.local.json
```

Then edit `config\figma.local.json`:

```json
{
  "figmaAccessToken": "<FIGMA_ACCESS_TOKEN>"
}
```

`CHAMPCITY_GPT_FIGMA_ACCESS_TOKEN` overrides the local file. Installed mode stores the local file under the app userData config directory; portable mode stores it under `data\config`; development mode can use repo-local `config\figma.local.json`. The launcher can save or clear the local token, but never displays it after save. If the token comes from the environment, clear it outside the app.

Figma tools:

- `get_figma_status`: reports configured yes/no and source without the token.
- `parse_figma_url`: parses `/design`, `/file`, and `/proto` URLs.
- `fetch_figma_file_summary`: returns compact file/frame/component/style metadata.
- `fetch_figma_frame_image`: writes one PNG/SVG export inside an allowed root.
- `create_figma_handoff_package`: writes `design/figma-handoff` by default.
- `create_codex_ui_handoff_prompt`: writes `docs/handoffs/CODEX_UI_REDESIGN_HANDOFF.md` by default.
- `test_figma_mcp_connection`: probes the configured upstream Figma MCP server without exposing credentials.
- `run_figma_make_handoff`: accepts a `/make/` URL, retrieves Make resources through the configured official Figma MCP server, writes `design/figma-handoff/make` and `docs/handoffs/CODEX_FIGMA_MAKE_UI_HANDOFF.md` by default, and returns paths plus warnings without exposing credentials.

Default handoff package:

```text
design/figma-handoff/
  README_DESIGN_HANDOFF.md
  figma-link.txt
  specs/
    screen-map.md
    component-inventory.md
    interaction-notes.md
    implementation-notes.md
    acceptance-criteria.md
  tokens/
    design-tokens.json
  screenshots/
  assets/
```

Figma image export and Design handoff generation require OAuth `files.write` for HTTP callers and local write mode `docs`, `patch`, or `elevated`. Figma Make URLs use the dedicated `run_figma_make_handoff` path, are not sent through the Design REST parser, and require an upstream official Figma MCP server such as the desktop endpoint `http://127.0.0.1:3845/mcp` or a configured remote HTTPS endpoint. Make handoff success requires actual MCP resources/files under `design/figma-handoff/make/source`; screenshots are intentionally not generated for Make MCP resource handoffs.

## Recommended Git Workflow

Use `dev` or a feature branch for normal work. `main` commits and pushes are refused by default unless the caller explicitly opts in.

1. Validate locally with `npm run build`, `npm test`, `npm run typecheck`, `npm run lint`, and `npm run check:public`.
2. Ask ChatGPT to run `get_commit_readiness`.
3. Ask ChatGPT to run `safe_stage_changes` for all safe files or reviewed paths.
4. Ask ChatGPT to run `pre_commit_safety_scan`.
5. Ask ChatGPT to run `commit_validated_changes` with a reviewed commit message.
6. Ask ChatGPT to run `push_current_branch` only after reviewing the commit result.

The staging tool never stages local config, logs, generated output, release artifacts, `dist`, `node_modules`, `.env`, ignored files, or files with blocker secret/private-path findings. Push is optional and never uses force flags. Releases are separate from commits; release binaries belong in GitHub Releases, not in the repository.

Useful examples:

- [config/allowed-roots.example.json](config/allowed-roots.example.json)
- [config/write-access.example.json](config/write-access.example.json)
- [config/http-auth.example.json](config/http-auth.example.json)
- [config/figma.example.json](config/figma.example.json)
- [config/figma-mcp.example.json](config/figma-mcp.example.json)
- [config/oauth.example.json](config/oauth.example.json)
- [examples/cloudflared-config.example.yml](examples/cloudflared-config.example.yml)
- [examples/mcp-client-config.example.json](examples/mcp-client-config.example.json)

## Development

Build-from-source requirements:

- Node.js `>=20.10.0`
- npm

Install, build, and test:

```powershell
npm install
npm run build
npm test
npm run typecheck
npm run lint
```

Public clone/build flow:

```powershell
git clone https://github.com/<owner>/<repo>.git
cd <repo>
npm install
npm run build
npm test
npm run app:dist
```

Run the local MCP server after building:

```powershell
node dist\src\index.js
```

Run the Electron app:

```powershell
npm run app:dev
```

Package the Electron app:

```powershell
npm run app:dist
```

Release binaries belong in GitHub Releases, not in the repository.

## Runtime Paths

Development mode uses the source checkout and can use repo-local `config/*.local.json` for development.

Installed mode stores runtime-local files under Electron `userData`:

- `config`
- `logs`
- `generated`

Portable mode activates when a `data` folder exists next to the executable:

- `<exeDir>\data\config`
- `<exeDir>\data\logs`
- `<exeDir>\data\generated`

The app status panel shows runtime mode, server runtime, config directory, logs directory, generated directory, public base URL, write mode, OAuth status, and developer CLI paths when relevant.

## ChatGPT-Compatible HTTPS Endpoint

For ChatGPT.com-compatible MCP registration, use an HTTPS endpoint like:

```text
https://mcp.example.com/mcp
```

The server exposes OAuth metadata under:

```text
https://mcp.example.com/.well-known/oauth-protected-resource
https://mcp.example.com/.well-known/oauth-authorization-server
https://mcp.example.com/oauth/register
https://mcp.example.com/oauth/authorize
https://mcp.example.com/oauth/token
```

Cloudflare Tunnel is optional. Any equivalent HTTPS reverse tunnel can work if OAuth remains enabled and the local service is still bound narrowly.

## Publication Safety

Before publishing, run the release and publication checklists:

- [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)
- [docs/GITHUB_PUBLICATION_CHECKLIST.md](docs/GITHUB_PUBLICATION_CHECKLIST.md)
- [docs/PUBLICATION_AUDIT.md](docs/PUBLICATION_AUDIT.md)

Do not publish until the license, GitHub owner/repo, and release-binary policy are decided.

Final local checks:

```powershell
npm run check:public
npm run app:dist
npm run check:release
```
