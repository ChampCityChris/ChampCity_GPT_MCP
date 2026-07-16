# Release Notes

## v0.2.0 - Purpose-built architect diagnostics

- Added fixed project validation operations for typecheck, build, tests, and release checks.
- Added MCP startup, registration, and public inventory diagnostics.
- Added fixed development and packaged Electron startup diagnostics with typed milestones and automatic shutdown.
- Added TypeScript compiler API analysis for symbols, references, imports, callers/callees, and MCP registrations.
- Added bounded read-only Git log, commit, diff, file-history, blame, merge-base, and ancestry inspection.
- Kept the stable public toolbox surface at seven toolbox tools and added one bounded top-level exception, `workspace_write_attached_image`, for ChatGPT-authorized raster image attachments. No generic command runner, shell, browser automation, arbitrary IPC, executable, argument, environment input, arbitrary URL downloader, or general file writer was added.
- `workspace_write_attached_image` requires `files.write` plus local write mode `docs`, `patch`, or `elevated`; accepts one top-level ChatGPT file parameter; validates PNG, JPEG, and WebP bytes; writes create-only to a configured workspace-relative destination; refuses overwrites; rejects path traversal, Windows unsafe paths, and symlink/junction escapes; and returns SHA-256 evidence for the exact bytes written.
- Canonical artifact verification, canonical hashing, registry validation, and workflow-state tracing remain explicitly excluded pending a separate architecture specification.

Packaged source analysis returns `source_unavailable` when repository TypeScript source is not present. Preload completion is not directly observable through the preserved preload contract; Electron diagnostics report that limitation explicitly.

## 2026-06-26 - Windows desktop app rebuild

Summary:
- Rebuilt the Windows desktop release after fixing false npm detection in the desktop app.
- Windows npm path handling now prefers `C:\Program Files\nodejs\npm.cmd`.
- `Install Dependencies` and `Build MCP Server` use the detected npm path instead of bare `npm`.

Validation passed:
- `npm run build`
- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm audit --audit-level=low` (`found 0 vulnerabilities`)

Packaging:
- Old `release/` output was deleted before packaging.
- Packaging command: `npm run app:dist`

Release artifacts:
- `C:\Users\<you>\Projects\<project>\release\ChampCity GPT MCP Launcher-0.1.0-x64.exe`
- `C:\Users\<you>\Projects\<project>\release\win-unpacked\ChampCity GPT MCP Launcher.exe`

Smoke test:
- Launched `release\win-unpacked\ChampCity GPT MCP Launcher.exe` with `CHAMPCITY_GPT_REPO_ROOT` set to this repo.
- Confirmed it stayed alive for 8 seconds and then stopped it.

