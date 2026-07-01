# Public MCP Endpoint

## Target Endpoint

Use a user-owned HTTPS base URL such as:

```text
https://mcp.example.com
```

The ChatGPT MCP endpoint is:

```text
https://mcp.example.com/mcp
```

The public health endpoint is:

```text
https://mcp.example.com/health
```

Local development stays on:

```text
http://127.0.0.1:3333/mcp
http://127.0.0.1:3333/health
```

Local unauthenticated testing is only for localhost and must not be tunneled.

## OAuth Metadata And Flow

ChatGPT custom MCP apps use OAuth. Discovery endpoints for a placeholder public base URL are:

```text
https://mcp.example.com/.well-known/oauth-protected-resource
https://mcp.example.com/.well-known/oauth-protected-resource/mcp
https://mcp.example.com/.well-known/oauth-authorization-server
```

OAuth flow endpoints:

```text
https://mcp.example.com/oauth/register
https://mcp.example.com/oauth/authorize
https://mcp.example.com/oauth/token
```

Dynamic client registration stores ChatGPT clients in runtime-local `oauth-clients.local.json`, which is ignored by git. The approval page requires the local OAuth admin password configured in the desktop launcher and never displays tokens or passwords.

## DNS Concept

Create a DNS record that points the chosen subdomain at the selected tunnel or provider hostname:

```text
CNAME mcp.example.com -> <tunnel-or-provider-hostname>
```

Do not expose the local Node.js server directly to the public internet. Keep the local MCP server bound to `127.0.0.1` and tunnel to it only after OAuth admin approval is configured.

## Tunnel Options

- Cloudflare Tunnel using the user's chosen domain.
- Secure MCP Tunnel, if available in the user's ChatGPT/OpenAI developer setup.
- ngrok for temporary testing.

For Cloudflare, see:

- `docs/CLOUDFLARE_TUNNEL_SETUP.md`
- `examples/cloudflared-config.example.yml`
- `scripts\tunnel-readiness.ps1`
- `scripts\verify-public-endpoint.ps1`

The Cloudflare service target should be:

```text
http://127.0.0.1:3333
```

The public MCP path remains:

```text
https://mcp.example.com/mcp
```

## Safeguards

- Keep allowed roots narrow.
- Keep write mode off with `CHAMPCITY_GPT_WRITE_MODE=off` until read-only tools work through ChatGPT.
- Keep write mode off during first tunnel and ChatGPT registration testing.
- `/mcp` requires OAuth bearer access tokens in HTTP mode.
- `files.read` allows `tools/list` and the seven public toolbox tools.
- `files.write` allows write-capable toolbox actions only when local `writeMode` also permits the requested operation.
- Use `CHAMPCITY_GPT_ALLOW_UNAUTH_LOCAL_HTTP=true` only for local unauthenticated testing.
- Local unauthenticated mode is `LOCAL TEST ONLY - DO NOT TUNNEL.`
- Treat the legacy bearer token as a development/private-connector safeguard, not the ChatGPT connector auth path.
- Do not open firewall ports for the local MCP server.
- Do not bind to `0.0.0.0` unless `CHAMPCITY_GPT_ALLOW_NONLOCAL_HTTP=true` is set after a security review.
- Keep audit logging enabled and review the runtime-local audit log.
- Verify the external OAuth metadata first in a browser before ChatGPT registration.
