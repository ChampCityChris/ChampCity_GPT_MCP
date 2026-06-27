# ChampCity GPT MCP Launcher

ChampCity GPT MCP Launcher is a pre-release ChatGPT-compatible MCP server and Electron launcher for controlled local project-file access. It can expose read-only and approval-gated write tools over local STDIO or local HTTP, with optional OAuth and HTTPS tunneling for ChatGPT.com-compatible MCP connectors.

Current maturity: `v0.1.0`, pre-release/private-tooling quality. Review the code and security model before using it with sensitive repositories.

License: not yet selected. See [docs/LICENSE_DECISION_NEEDED.md](docs/LICENSE_DECISION_NEEDED.md).

## What It Does

- Lists, reads, and searches files inside configured allowed roots.
- Reports git status and git diffs for allowed git worktrees.
- Supports write modes: `off`, `docs`, `patch`, and `elevated`.
- Provides an Electron launcher for local setup, status checks, OAuth administration, and client config generation.
- Supports local STDIO MCP for trusted local clients.
- Supports local Streamable HTTP MCP on `127.0.0.1`.
- Supports OAuth metadata, Dynamic Client Registration, PKCE, access tokens, refresh token rotation, and scopes for ChatGPT.com-compatible public HTTPS endpoints.
- Includes optional Cloudflare Tunnel docs and examples.

## What It Does Not Do

- It does not make hosted ChatGPT local-only; file contents returned by tools can enter the model/tool context.
- It does not safely expose arbitrary folders. You must configure narrow allowed roots.
- It does not require Cloudflare or any specific domain. `https://mcp.example.com/mcp` is only a placeholder.
- It does not enable writes by default.
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

- `files.read`: list/read/search files, git status/diff, write-access status, and tool discovery.
- `files.write`: propose patches, write Markdown artifacts, apply approved patches, and run allowlisted scripts, still gated by local write mode.

Never expose unauthenticated HTTP mode through a tunnel.

## Write Modes

- `off`: default. Blocks write tools.
- `docs`: allows Markdown artifact writes for planning or notes.
- `patch`: allows proposed patch workflows and approved patch application.
- `elevated`: allows rare allowlisted script/elevated operations with a local approval token.

Set the mode with:

```powershell
$env:CHAMPCITY_GPT_WRITE_MODE='off'
```

## Local Configuration

On first launch, the Electron app opens a setup wizard where each user chooses allowed roots, local-only or public endpoint mode, OAuth admin password, optional Cloudflare guidance, and write mode. Write mode defaults to `off`, and the OAuth admin password is stored only as a local hash.

For source development, you can still copy example config files and create repo-local versions as needed:

```powershell
Copy-Item config\allowed-roots.example.json config\allowed-roots.local.json
Copy-Item config\write-access.example.json config\write-access.local.json
```

Local files matching `config/*.local.json` are ignored by git. Do not commit OAuth stores, auth tokens, local paths, tunnel credentials, logs, generated configs, release outputs, or `.env` files.

Useful examples:

- [config/allowed-roots.example.json](config/allowed-roots.example.json)
- [config/write-access.example.json](config/write-access.example.json)
- [config/http-auth.example.json](config/http-auth.example.json)
- [config/oauth.example.json](config/oauth.example.json)
- [examples/cloudflared-config.example.yml](examples/cloudflared-config.example.yml)
- [examples/mcp-client-config.example.json](examples/mcp-client-config.example.json)

## Development

Requirements:

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

The app status panel shows runtime mode, config directory, logs directory, generated directory, and bundled server resource path.

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
