# Security Policy

## Supported Posture

ChampCity GPT MCP Launcher is pre-release local tooling. The supported default posture is local-only filesystem access with narrow allowed roots, write mode `off`, and HTTP bound to `127.0.0.1`.

ChatGPT.com-compatible public MCP use requires HTTPS, OAuth, Dynamic Client Registration, PKCE, and scoped access. Do not expose unauthenticated mode through a tunnel or public hostname.

## Configuration Rules

- Never commit `config/*.local.json`, `.env`, OAuth stores, auth tokens, tunnel credentials, logs, generated files, or release binaries.
- Do not include broad roots such as `C:\Users\<you>`, `C:\`, home folders, SSH folders, browser profiles, or credential stores.
- Prefer one narrow project root, for example `C:\Users\<you>\Projects\<project>`.
- Keep `CHAMPCITY_GPT_WRITE_MODE=off` for first connection tests.
- Use `docs` or `patch` only when needed.
- Use `elevated` rarely and only with a local approval token.

## Known Risks

- OAuth development app exposure can grant project file access to a registered client.
- Prompt injection inside files can influence model behavior after file reads.
- Write tools can modify files under allowed roots when local write mode permits it.
- Cloudflare Tunnel or any equivalent tunnel exposes the local service through a public hostname.
- Broad allowed roots increase blast radius.
- Always review `git diff` after write operations.

## Reporting

No public security contact is configured yet. Open a private issue or contact the maintainer through the project’s chosen private channel before disclosing sensitive details publicly.
