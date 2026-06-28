# Tool Reference

HTTP clients reach these tools through `/mcp`. In ChatGPT HTTP mode, `/mcp` requires an OAuth bearer access token; unauthenticated localhost testing requires explicit `CHAMPCITY_GPT_ALLOW_UNAUTH_LOCAL_HTTP=true` and must not be tunneled. Keep write mode `off` until the read-only HTTP flow is validated.

In the packaged desktop app, the HTTP server runs in-process from Electron. The developer CLI entrypoint remains available after building from source, but packaged end users do not need Node.js/npm to reach these tools.

OAuth metadata:

```text
/.well-known/oauth-protected-resource
/.well-known/oauth-authorization-server
/oauth/register
/oauth/authorize
/oauth/token
```

Scope mapping:

- `files.read`: `tools/list`, `list_project_files`, `read_project_file`, `search_project_files`, `git_status`, `git_diff`, `get_write_access_status`, `get_figma_status`, `parse_figma_url`, `fetch_figma_file_summary`, `pre_commit_safety_scan`, and `get_commit_readiness`.
- `files.write`: `propose_patch`, `write_markdown_artifact`, `apply_approved_patch`, `fetch_figma_frame_image`, `create_figma_handoff_package`, `create_codex_ui_handoff_prompt`, `run_figma_make_handoff`, `run_figma_make_file_handoff`, `run_allowed_script`, `safe_stage_changes`, `commit_validated_changes`, and `push_current_branch`.

Write access has OAuth plus local write-mode gates. `CHAMPCITY_GPT_WRITE_MODE=off|docs|patch|elevated` is preferred, with `config/write-access.local.json` as the local-file source. Legacy `CHAMPCITY_GPT_ENABLE_WRITE_TOOLS=true` maps to `docs`.

- `off`: no writes.
- `docs`: Markdown artifact writes.
- `patch`: docs plus application of matching pending patch proposals.
- `elevated`: scripts, legacy approval-gated fallback operations, and safe git stage/commit/push tools.

The elevated approval token is configured in `config/write-access.local.json` as a salted hash, or temporarily through `CHAMPCITY_GPT_WRITE_APPROVAL_TOKEN` for dev/manual testing. Static bearer tokens are legacy/manual testing only; ChatGPT.com uses OAuth.

## `list_project_files`

Lists files under an allowed root or subdirectory. Returns relative paths only and excludes blocked directories, sensitive files, symlinks, and file contents.

Input:

```json
{
  "root": "C:\\Users\\<you>\\Projects\\<another-project>",
  "relativePath": ".",
  "glob": "**/*",
  "maxResults": 200
}
```

Output summary: selected root, relative directory, file list, and `truncated`.

## `read_project_file`

Reads one text file from an allowed root after path, file policy, binary, and size checks.

Input:

```json
{
  "root": "C:\\Users\\<you>\\Projects\\<another-project>",
  "relativePath": "src/example.ts",
  "maxBytes": 200000
}
```

Output summary: relative path, size, modified time, SHA-256, and contents.

## `search_project_files`

Searches allowed text files with literal string matching and limited context lines.

Input:

```json
{
  "root": "C:\\Users\\<you>\\Projects\\<another-project>",
  "query": "Narrator Rejection",
  "glob": "**/*.{ts,tsx,js,jsx,json,md}",
  "maxResults": 50,
  "contextLines": 2
}
```

Output summary: matches with relative path, line number, matched line, context, and `truncated`.

## `propose_patch`

Generates a unified diff from safe text replacements without modifying files, then registers a short-lived patch proposal. The returned `proposalId` and `patchHash` can be used by `apply_approved_patch` in patch write mode.

Input:

```json
{
  "root": "C:\\Users\\<you>\\Projects\\<another-project>",
  "changes": [
    {
      "relativePath": "src/example.ts",
      "originalText": "old text",
      "replacementText": "new text"
    }
  ]
}
```

Output summary: `patch`, `proposalId`, `patchHash`, `affectedFiles`, and `expiresAt`.

Safety behavior: target files must be allowed readable text files, and `originalText` must be present. The server stores only proposal metadata and the SHA-256 of the exact patch text in `config/pending-patches.local.json`.

## `apply_approved_patch`

Applies a patch only when local write mode is `patch` or `elevated` and the patch matches a registered proposal from `propose_patch`, or when elevated approval is explicitly configured.

Input:

```json
{
  "root": "C:\\Users\\<you>\\Projects\\<another-project>",
  "patch": "...unified diff...",
  "proposalId": "uuid-from-propose_patch",
  "patchHash": "sha256-from-propose_patch"
}
```

Output summary: changed files and post-apply git diff summary.

Safety behavior: in `patch` mode the patch must exactly match a non-expired unused proposal for the same root. The proposal is marked used after successful apply. All existing patch checks still run: allowed-root, blocked-file, regular-file, symlink/submodule, size, and non-git-target checks when git enforcement is enabled. After applying, changed paths are checked with `lstat`, and symbolic link paths are rejected with a best-effort rollback. In `elevated` mode, a valid elevated approval token can be used as a high-risk fallback without a proposal match.

Review behavior: write operations should still be reviewed with `git diff` before commit.

## `write_markdown_artifact`

Writes a Markdown artifact when OAuth `files.write` is granted and local write mode is `docs`, `patch`, or `elevated`.

Input:

```json
{
  "root": "C:\\Users\\<you>\\Projects\\<project>",
  "relativePath": "docs/EXAMPLE.md",
  "content": "# Example",
  "overwrite": false
}
```

Output summary: relative path, size, and SHA-256.

Safety behavior: allowed roots, `.md`-only writes, blocked-file policy, overwrite rules, atomic write, and audit logging. No `approvalToken` is required for Markdown writes in `docs`, `patch`, or `elevated` mode.

## `get_write_access_status`

Returns the server-side write-mode status without exposing secrets.

Input:

```json
{}
```

Output summary: `writeMode`, `writeModeSource`, docs/patch/elevated booleans, whether the elevated token is configured, pending patch proposal count, and `oauthFilesWriteGranted` as `unknown` when the tool layer cannot see OAuth context.

## `get_figma_status`

Returns whether a Figma token is configured and where it came from. It never returns the token value.

Input:

```json
{}
```

Output summary: `configured` and `source`, where source is `env`, `local-file`, `dev-local-file`, or `none`.

## `parse_figma_url`

Parses common Figma URLs without making a network call.

Input:

```json
{
  "url": "https://www.figma.com/design/<fileKey>/<name>?node-id=1-23"
}
```

Output summary: `fileKey`, normalized `nodeId` such as `1:23`, and `urlType` as `design`, `file`, or `proto`.

## `fetch_figma_file_summary`

Fetches a Figma file using the locally configured token and returns compact metadata only. Requires OAuth `files.read` for HTTP callers.

Input:

```json
{
  "fileKey": "<FIGMA_FILE_KEY>",
  "maxFrames": 100
}
```

Output summary: file name, pages, top-level frames, component counts, component-set counts, and style summary. It does not return raw Figma JSON.

## `fetch_figma_frame_image`

Exports one Figma frame image into an allowed root. Requires a local Figma token, OAuth `files.write` for HTTP callers, and local write mode `docs`, `patch`, or `elevated`.

Input:

```json
{
  "root": "C:\\Users\\<you>\\Projects\\<project>",
  "fileKey": "<FIGMA_FILE_KEY>",
  "nodeId": "1:23",
  "format": "png",
  "scale": 2,
  "relativeOutputPath": "design/figma-handoff/screenshots/frame.png",
  "overwrite": false
}
```

Output summary: relative path, size, and SHA-256. Path traversal, absolute paths, blocked files, and overwrites without `overwrite: true` are rejected before writing.

## `create_figma_handoff_package`

Creates a structured Figma design handoff package under an allowed root. Requires a local Figma token, OAuth `files.write` for HTTP callers, and local write mode `docs`, `patch`, or `elevated`.

Input:

```json
{
  "root": "C:\\Users\\<you>\\Projects\\<project>",
  "figmaUrl": "https://www.figma.com/design/<fileKey>/<name>?node-id=1-23",
  "targetArea": "launcher dashboard",
  "relativeOutputDir": "design/figma-handoff",
  "overwrite": false
}
```

Generated structure:

```text
design/figma-handoff/
  README_DESIGN_HANDOFF.md
  figma-link.txt
  specs/screen-map.md
  specs/component-inventory.md
  specs/interaction-notes.md
  specs/implementation-notes.md
  specs/acceptance-criteria.md
  tokens/design-tokens.json
  screenshots/
  assets/
```

Output summary: handoff directory, files created, screenshots created, and warnings. The original Figma URL is included. The Figma token is never written.

## `create_codex_ui_handoff_prompt`

Creates a Codex-ready UI implementation prompt that points Codex at the Figma handoff package. Requires OAuth `files.write` for HTTP callers and local write mode `docs`, `patch`, or `elevated`.

Input:

```json
{
  "root": "C:\\Users\\<you>\\Projects\\<project>",
  "handoffPath": "design/figma-handoff",
  "targetFile": "docs/handoffs/CODEX_UI_REDESIGN_HANDOFF.md",
  "targetArea": "launcher dashboard",
  "overwrite": false
}
```

Output summary: target file, size, and SHA-256. The prompt tells Codex to use the handoff as design authority, preserve MCP/OAuth/Cloudflare/write-mode/public-safety behavior, keep Electron isolation settings, avoid Playwright, run validation, and report changed files.

## `run_figma_make_handoff`

Runs the one-shot ChatGPT-callable Figma Make handoff workflow. Requires OAuth `files.write` for HTTP callers, local write mode `docs`, `patch`, or `elevated`, and a configured upstream official Figma MCP server. ChatGPT passes the Make URL only; it never passes or receives Figma tokens, auth headers, cookies, or session credentials.

Input:

```json
{
  "makeUrl": "https://www.figma.com/make/<makeProjectId>/<slug>?p=f&t=...",
  "targetUiArea": "ChampCity GPT UI",
  "implementationScope": "Implement the UI shown in the Make handoff.",
  "outputDirectory": "design/figma-handoff/make",
  "codexPromptFile": "docs/handoffs/CODEX_FIGMA_MAKE_UI_HANDOFF.md",
  "notes": "Optional user notes"
}
```

Output summary: `status`, `urlType`, `makeProjectId`, preserved `makeUrl`, handoff directory, Codex prompt file, created files, empty `screenshots`, metadata files, `resourceFiles`, warnings, and errors.

Generated structure:

```text
  design/figma-handoff/make/
    source-url.json
    make-project.json
    figma-mcp-connection.json
    figma-mcp-resource-inventory.json
    extracted-resource-inventory.md
    extraction-summary.md
    CODEX_FIGMA_MAKE_UI_HANDOFF.md
    source/
      retrieved Make files/resources
  docs/handoffs/CODEX_FIGMA_MAKE_UI_HANDOFF.md
  ```

Success requires actual Make resources/files retrieved through official Figma MCP resource content and written under `source/`. Partial requires at least one official MCP resource file plus one or more failed resource reads. If no Make resources/files are retrieved, the status is `failed`; metadata-only and screenshot-only output are not success paths. Screenshots are intentionally not generated for Figma Make MCP resource handoffs, and `screenshots` remains an empty array for backward-compatible output shape.

## `run_figma_make_file_handoff`

Runs the local fallback Figma Make handoff workflow for exported `.make` packages. Requires OAuth `files.write` for HTTP callers and local write mode `docs`, `patch`, or `elevated`. ChatGPT passes a local `.make` file path under configured allowed roots; the tool parses the package directly and does not use screenshots, browser scraping, network scraping, clipboard automation, or Figma Design conversion.

Input:

```json
{
  "makeFilePath": "C:\\Users\\<you>\\Projects\\ChampCity_GPT\\exports\\example.make",
  "targetUiArea": "ChampCity GPT UI",
  "implementationScope": "Implement the UI from the exported Make package.",
  "outputDirectory": "design/figma-handoff/make-file",
  "codexPromptFile": "docs/handoffs/CODEX_FIGMA_MAKE_FILE_HANDOFF.md",
  "notes": "Optional user notes"
}
```

Output summary: `status`, `sourceType: figma_make_file`, safe `.make` path, handoff directory, Codex prompt file, created files, metadata/report files, raw resource files, copied asset files, reconstructed source files, warnings, and errors.

Supported package entries include `meta.json`, `ai_chat.json`, `make_binary_files.json`, `canvas.fig`, `thumbnail.png`, `images/`, `make_binary_files/`, and `blob_store/` when present. The tool writes raw important package files under `raw/`, assets under `assets/`, reconstructed source under `source/`, inventories under `source-package/`, reports under `reports/`, and a Codex prompt both at the requested prompt path and inside the package directory.

Source reconstruction inspects `ai_chat.json` for Make messages, versions, tool calls, file paths, full-file writes, edit operations, code fences, snapshot keys, and blob references. It writes only deterministic recovered source, reports edit-only files as partial, records provenance and confidence, preserves raw `ai_chat.json`, redacts likely secrets, and fails metadata-only packages that do not provide useful implementation evidence.

## `test_figma_mcp_connection`

Tests the configured upstream Figma MCP server connection and lists available resources/templates/tools/prompts when reachable.

Input:

```json
{
  "endpoint": "http://127.0.0.1:3845/mcp",
  "mode": "desktop"
}
```

Both fields are optional overrides. Without overrides, the app uses `figma-mcp.local.json`, `CHAMPCITY_GPT_FIGMA_MCP_ENDPOINT`, or the desktop default `http://127.0.0.1:3845/mcp`.

## `git_status`

Runs fixed git inspection commands for an allowed root.

Input:

```json
{
  "root": "C:\\Users\\<you>\\Projects\\<another-project>"
}
```

Output summary: current branch and `git status --short` output.

## `git_diff`

Returns unstaged or staged git diff with truncation.

Input:

```json
{
  "root": "C:\\Users\\<you>\\Projects\\<another-project>",
  "staged": false,
  "maxBytes": 300000
}
```

Output summary: diff text and `truncated`.

## `pre_commit_safety_scan`

Runs the public-repo safety scanner without changing git state.

Input:

```json
{
  "root": "C:\\Users\\<you>\\Projects\\<project>",
  "mode": "staged"
}
```

Modes: `staged`, `working-tree`, or `paths` with a `paths` array. Output summary: scanned files, skipped files, blocker findings, warnings, and `safe`.

Safety behavior: findings identify the path and rule only. The tool does not return raw matched secret text.

## `get_commit_readiness`

Returns read-only commit and push readiness.

Input:

```json
{
  "root": "C:\\Users\\<you>\\Projects\\<project>",
  "targetBranch": "dev"
}
```

Output summary: `readyToCommit`, `readyToPush`, current branch, staged files, blocker findings, warnings, and recommended next steps.

## `safe_stage_changes`

Stages only files that pass public-repo safety rules. Requires OAuth `files.write` and local write mode `elevated`.

Input:

```json
{
  "root": "C:\\Users\\<you>\\Projects\\<project>",
  "mode": "all-safe"
}
```

For reviewed path staging, use:

```json
{
  "root": "C:\\Users\\<you>\\Projects\\<project>",
  "mode": "paths",
  "paths": ["src/example.ts", "docs/example.md"]
}
```

Output summary: staged files, skipped files, blocker findings, warnings, and `safe`.

Safety behavior: never stages `config/*.local.json`, `.env`, `.env.*` except `.env.example`, `logs`, `generated`, `release`, `dist`, `node_modules`, `package-lock.zip`, `*.pid`, `*.status.json`, `*.log`, `coverage`, ignored files, or files with blocker secret/private-path findings. It computes exact candidate paths and runs `git add -- <validated paths>` only.

## `commit_validated_changes`

Creates a local commit from already staged files only. Requires OAuth `files.write` and local write mode `elevated`.

Input:

```json
{
  "root": "C:\\Users\\<you>\\Projects\\<project>",
  "message": "Add safe workflow tools",
  "targetBranch": "dev"
}
```

Output summary: commit hash, branch, committed files, scan summary, and post-commit short status.

Safety behavior: refuses empty messages, subjects over 200 characters, no staged files, safety scan blockers, target branch mismatches, and `main` commits unless `allowMainCommit` is explicitly `true`. It does not stage files.

## `push_current_branch`

Pushes the current branch to `origin` without force push. Requires OAuth `files.write` and local write mode `elevated`.

Input:

```json
{
  "root": "C:\\Users\\<you>\\Projects\\<project>",
  "remote": "origin",
  "setUpstream": true
}
```

Output summary: branch, remote, pushed boolean, sanitized stdout/stderr, and redacted remote URL.

Safety behavior: only `origin` is accepted, force flags are never used, `main` push is refused unless `allowMainPush` is explicitly `true`, and remote URLs are redacted before returning output.

## `run_allowed_script`

Runs only commands exactly listed in `CHAMPCITY_GPT_ALLOWED_COMMANDS`, without shell interpolation, and only in elevated write mode with required elevated approval. It is never available in `docs` or `patch` mode.

Input:

```json
{
  "root": "C:\\Users\\<you>\\Projects\\<another-project>",
  "command": "npm test",
  "timeoutSeconds": 120,
  "approvalToken": "temporary-token"
}
```

Output summary: stdout, stderr, exit code, timeout flag, and truncation flag.

