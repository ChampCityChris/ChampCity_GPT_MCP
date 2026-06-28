# Launcher Setup

The user-facing launcher is now a real Windows desktop app built with Electron and TypeScript. The existing PowerShell scripts remain available as fallback and development tools, but users should not need to open PowerShell for ordinary setup after a packaged executable is built.

## Desktop App

Run in development:

```powershell
cd C:\Users\<you>\Projects\<project>
npm run app:dev
```

Package a portable Windows executable:

```powershell
npm run app:dist
```

Packaged output is written to:

```text
release\
```

The app is named `ChampCity GPT MCP Launcher`.

## Development Runtime Copy

During development, keep `release\` overwriteable by running the copied runtime executable instead of the versioned release executable:

```text
C:\Users\<you>\Apps\ChampCity_GPT_MCP_Runtime\ChampCity GPT MCP Launcher-live.exe
```

After successful packaging, refresh that copy with:

```powershell
npm run app:promote-runtime
```

The runtime copy is not a packaging artifact. Packaging success still requires the final current-version portable executable under `release\`, not `release\win-unpacked\` and not an Electron Builder `.nsis.7z` intermediate. Do not run two launcher instances on port 3333 simultaneously.

## What The App Handles

- Setup checklist and doctor output.
- Allowed roots manager for `config\allowed-roots.local.json`.
- Dependency install and MCP TypeScript build.
- Generated STDIO MCP client config examples.
- Clipboard copy for the generic MCP config.
- Opening generated files, audit logs, logs, and documentation.
- Optional start/stop for the MCP diagnostic STDIO process.

## STDIO Connection Model

This project uses a STDIO MCP server. Many MCP clients launch the server process themselves from a configured command. For those clients, `Generate MCP Client Configs` is the primary connection step.

`Start MCP Diagnostic Server` is optional. Use it for manual diagnostics or a client that explicitly expects a persistent process.

## PowerShell Fallback Scripts

The script layer remains in `scripts\`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\doctor.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\start-mcp.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\start-mcp.ps1 -Background
powershell -ExecutionPolicy Bypass -File .\scripts\stop-mcp.ps1
```

These scripts are useful for debugging, CI-style checks, or environments where Electron cannot be launched.

## Generated Config Files

Use the desktop app action `Generate MCP Client Configs`. The files appear under:

```text
generated\
```

All generated config examples point at:

```text
C:\Users\<you>\Projects\<project>\dist\src\index.js
```

Generated files are ignored by git.

## Safety Warnings

Keep allowed roots narrow. Do not expose this local STDIO server publicly, bind it to a network service, open firewall ports, or configure broad roots such as `C:\` or your full home directory.

Hosted clients may receive file contents they request through MCP. The desktop app does not make hosted ChatGPT fully local-only.

