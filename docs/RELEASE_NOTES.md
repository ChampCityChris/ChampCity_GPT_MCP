# Release Notes

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

