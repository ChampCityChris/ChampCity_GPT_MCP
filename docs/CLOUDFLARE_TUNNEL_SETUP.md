# Cloudflare Tunnel Setup

This guide prepares the validated local OAuth-protected ChampCity_GPT HTTP MCP server for a user-chosen public endpoint such as:

```text
https://mcp.example.com/mcp
```

Keep the MCP server local:

```text
http://127.0.0.1:3333/mcp
http://127.0.0.1:3333/health
```

## Prerequisites

- The user's chosen domain, such as `example.com`, is managed by Cloudflare, or the user can add the required DNS records.
- `cloudflared` is installed on the workstation that runs ChampCity_GPT.
- The local MCP HTTP server has been validated at `http://127.0.0.1:3333`.
- An OAuth admin password is configured in the launcher.
- Write mode is off with `CHAMPCITY_GPT_WRITE_MODE=off` during first registration and testing.

## Recommended Architecture

```text
ChatGPT.com
  -> https://mcp.example.com/mcp
  -> Cloudflare Tunnel
  -> http://127.0.0.1:3333/mcp
  -> local ChampCity_GPT MCP server
```

Do not expose the Node.js MCP server directly to the public internet. Do not bind it to `0.0.0.0`. Do not open firewall ports for MCP.

## Dashboard-Managed Tunnel

In the Cloudflare dashboard:

1. Open `Zero Trust`.
2. Go to `Networks` -> `Tunnels`.
3. Create or select a Cloudflare Tunnel for this workstation.
4. Add a public hostname:
   - Subdomain: `mcp`
   - Domain: `example.com`
   - Service type: `HTTP`
   - Service URL: `127.0.0.1:3333`
5. Confirm Cloudflare creates or updates the DNS route for `mcp.example.com`.

The public hostname should route:

```text
mcp.example.com -> Cloudflare Tunnel hostname
```

Cloudflare may represent that DNS route as a CNAME target under `cfargotunnel.com` or manage it internally for the tunnel.

## CLI-Managed Tunnel

Use Cloudflare's `cloudflared` CLI if you prefer local configuration. Replace `mcp.example.com` with the user's chosen hostname:

```powershell
cloudflared tunnel login
cloudflared tunnel create champcity-gpt-mcp
cloudflared tunnel route dns champcity-gpt-mcp mcp.example.com
```

Use the template at `examples\cloudflared-config.example.yml` as the starting point. Copy it to your local `cloudflared` config location and add your own tunnel identifier and credentials path there. Do not commit real tunnel UUIDs, credentials paths, account IDs, or tokens.

Run the tunnel with your local config:

```powershell
cloudflared tunnel --config <your-local-cloudflared-config.yml> run
```

## Required Local Server State

Before starting the tunnel, the local server should be running with:

```text
Host: 127.0.0.1
Port: 3333
OAuth admin: configured
Write tools: disabled
Unauthenticated local mode: disabled
```

Run:

```powershell
.\scripts\tunnel-readiness.ps1
```

Warnings:

- Do not tunnel unauthenticated local mode.
- Keep write mode off during first ChatGPT registration and testing.
- Do not print or paste OAuth tokens, refresh tokens, client IDs/secrets, Cloudflare tokens, or tunnel credentials into docs, logs, issues, screenshots, or setup notes.

## Verify Public Endpoint

After the tunnel and DNS are active, verify the public endpoint before ChatGPT registration:

```powershell
.\scripts\verify-public-endpoint.ps1 -BaseUrl "https://mcp.example.com"
```

The script checks `/health` and confirms unauthenticated `/mcp` is rejected. OAuth registration and approval happens through ChatGPT's connector flow.

## ChatGPT Registration

Use this MCP endpoint in ChatGPT when connector registration is available:

```text
https://mcp.example.com/mcp
```

Start with read-only tools. Set write mode to `docs` or `patch` only after the tunnel, auth, allowed roots, audit logging, and read-only ChatGPT flow are all verified. Use `elevated` rarely.

