# Figma Make MCP Resource Extraction Notes

## Decision

`run_figma_make_handoff` now treats Figma Make as an upstream MCP-resource workflow. It connects as an MCP client to a configured official Figma MCP server, lists resources/templates/tools/prompts when available, retrieves Make resources through MCP `resources/read` or embedded MCP resource contents, and writes only those retrieved files under `design/figma-handoff/make/source/`.

Desktop mode defaults to `http://127.0.0.1:3845/mcp`. Remote mode is supported by explicit configuration with an HTTPS endpoint, but this app does not invent or store Figma MCP OAuth/session credentials. If the upstream server requires user interaction or authentication, the tool reports that blocker.

## Configuration

Use environment variables:

- `CHAMPCITY_GPT_FIGMA_MCP_ENDPOINT`
- `CHAMPCITY_GPT_FIGMA_MCP_MODE` as `desktop` or `remote`

Or copy `config/figma-mcp.example.json` to the runtime config directory as `figma-mcp.local.json`.

The existing Figma personal access token remains for `/design`, `/file`, and `/proto` REST workflows. It is not assumed to authenticate Figma MCP Make extraction.

## Success Rules

- `success`: actual Make resources/files were retrieved through official Figma MCP resource content and written locally.
- `partial`: at least one official Figma MCP resource was written, but other resource reads or upstream calls failed.
- `failed`: no official Figma MCP Make resources/files were retrieved.

Metadata-only output, screenshot-only output, browser scraping, network scraping, clipboard-derived output, and Figma Design conversion are not valid Make handoff success paths.

## Removed Direction

The rejected hidden-browser screenshot/capture fallback was removed from `run_figma_make_handoff`. The Make workflow intentionally leaves `screenshots` as an empty array for backward-compatible output shape.
