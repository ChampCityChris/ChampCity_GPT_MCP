# Client Setup

## Generic MCP Client Config

Build the server first:

```powershell
npm install
npm run build
```

Then configure your MCP client to start the built server with a local working directory:

```json
{
  "mcpServers": {
    "champcity-gpt": {
      "command": "node",
      "args": ["C:\\Users\\<you>\\Projects\\<project>\\dist\\src\\index.js"],
      "cwd": "C:\\Users\\<you>\\Projects\\<project>",
      "env": {
        "CHAMPCITY_GPT_ALLOWED_ROOTS": "C:\\Users\\<you>\\Projects\\<project>;C:\\Users\\<you>\\Projects\\<another-project>",
        "CHAMPCITY_GPT_REQUIRE_GIT_ROOT": "true"
      }
    }
  }
}
```

## Claude Desktop-Style Example

Many desktop MCP clients use a similar `mcpServers` shape:

```json
{
  "mcpServers": {
    "champcity-gpt": {
      "command": "node",
      "args": ["C:\\Users\\<you>\\Projects\\<project>\\dist\\src\\index.js"],
      "env": {
        "CHAMPCITY_GPT_ALLOWED_ROOTS": "C:\\Users\\<you>\\Projects\\<project>;C:\\Users\\<you>\\Projects\\<another-project>",
        "CHAMPCITY_GPT_AUDIT_LOG": "C:\\Users\\<you>\\Projects\\<project>\\logs\\audit.log"
      }
    }
  }
}
```

Check your client documentation for the exact file location and restart behavior.

## Notes for ChatGPT and MCP

This harness can expose local files through MCP tool calls to an MCP-capable AI client. It does not make hosted ChatGPT magically local-only. If a model or hosted client reads file contents through MCP, those contents may enter that client's tool-call and model context.

Use narrow allowed roots, avoid secrets, and review tool calls before allowing writes.

## Local-Only Recommendation

Run the server over stdio through a trusted local client. Do not bind this server to a public network. Do not place broad paths such as `C:\Users\<you>` or `C:\` in `CHAMPCITY_GPT_ALLOWED_ROOTS`.

## Troubleshooting

- Confirm Node.js 20.10 or newer is installed.
- Run `npm run build` and fix TypeScript errors before connecting a client.
- Confirm every configured allowed root exists.
- Use absolute Windows paths in `CHAMPCITY_GPT_ALLOWED_ROOTS`.
- Check `logs/audit.log` for allow or deny decisions.
- If writes fail, confirm the target is inside a git repository or set `CHAMPCITY_GPT_REQUIRE_GIT_ROOT=false` for local testing.
- If a command is denied, verify it exactly matches `CHAMPCITY_GPT_ALLOWED_COMMANDS`.

