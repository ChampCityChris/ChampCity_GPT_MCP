# Contributing

ChampCity GPT MCP Launcher is pre-release local MCP tooling. Keep changes small, security-conscious, and easy to review.

## Setup

```powershell
npm install
npm run build
```

Create local config from examples only when needed:

```powershell
Copy-Item config\allowed-roots.example.json config\allowed-roots.local.json
Copy-Item config\write-access.example.json config\write-access.local.json
```

## Validation

Run before opening a PR:

```powershell
npm run build
npm test
npm run typecheck
npm run lint
```

Use `npm audit --audit-level=low` before releases.

## Guardrails

- Do not commit secrets, tokens, OAuth stores, local config, logs, generated output, or release binaries.
- Do not add broad filesystem access.
- Do not weaken MCP, OAuth, PKCE, scope, or write-mode checks.
- Prefer narrow allowed roots and local-only defaults.
- Keep examples generic with placeholders such as `C:\Users\<you>\Projects\<project>` and `https://mcp.example.com/mcp`.
