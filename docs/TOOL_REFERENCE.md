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

- `files.read`: `tools/list`, `repo_toolbox`, `git_toolbox`, `artifact_toolbox`, `diagnostics_toolbox`, `integration_toolbox`, `browser_toolbox`, `knowledge_toolbox`, `list_project_files`, `read_project_file`, `search_project_files`, `git_status`, `git_diff`, `get_workspace_status_summary`, `get_change_set_readiness_summary`, `get_release_artifact_summary`, `get_release_publication_summary`, `get_builder_report_index`, `get_builder_report_summary`, `get_write_access_status`, `get_figma_status`, `parse_figma_url`, `fetch_figma_file_summary`, `pre_commit_safety_scan`, and `get_commit_readiness`.
- `files.write`: `propose_patch`, `write_markdown_artifact`, `apply_approved_patch`, `fetch_figma_frame_image`, `create_figma_handoff_package`, `create_codex_ui_handoff_prompt`, `run_figma_make_handoff`, `run_figma_make_file_handoff`, `run_allowed_script`, `prepare_git_work_branch`, `safe_stage_changes`, `commit_validated_changes`, and `push_current_branch`.

Write access has OAuth plus local write-mode gates. `CHAMPCITY_GPT_WRITE_MODE=off|docs|patch|elevated` is preferred, with `config/write-access.local.json` as the local-file source. Legacy `CHAMPCITY_GPT_ENABLE_WRITE_TOOLS=true` maps to `docs`.

- `off`: no writes.
- `docs`: Markdown artifact writes.
- `patch`: docs plus application of matching pending patch proposals.
- `elevated`: internal/elevated exception tasks, legacy approval-gated fallback operations, and safe git branch/stage/commit/push tools.

ChatGPT-facing status and release checks should prefer the read-only safe facade tools: `get_workspace_status_summary`, `get_change_set_readiness_summary`, `get_release_artifact_summary`, and `get_release_publication_summary`. These tools avoid caller-supplied local roots, executable file globs, and command-string inputs. Legacy `git_status`, `get_commit_readiness`, `list_project_files`, and `run_allowed_script` remain documented for compatibility, but `run_allowed_script` is not the normal v1.0 ChatGPT-facing status or release workflow.

These facade tools are part of the WC-V1-0102 remediation path for `CAV-011`, `CAV-012`, `CAV-013`, `CAV-021`, `CAV-023`, and `CAV-030`. Live ChatGPT validation is still required before claiming full remediation.

Builder Report discovery should use `get_builder_report_index`. Specific report review should use `get_builder_report_summary`, or `read_project_file` only with a narrow expected report path already returned by the index. Normal ChatGPT workflows should avoid broad `list_project_files` calls that combine `planning/phases`, `**/BUILDER_REPORT*.md`, high `maxResults`, and absolute local roots. The Builder Report facade supports `CAV-033`; live ChatGPT validation is still required before claiming platform safety-layer remediation.

## Stable Domain Toolbox Tools

WC-V1-FIX02 adds stable top-level toolbox tools so future capability expansion can prefer internal allowlisted actions over new top-level MCP tool names. ChatGPT may bind tool schemas for the connector or chat lifecycle, so adding new top-level tools can require connector rediscovery, app reauthorization, or a new chat. Existing narrow tools remain registered for backward compatibility.

The stable domain toolbox tools are:

- `repo_toolbox`
- `git_toolbox`
- `artifact_toolbox`
- `diagnostics_toolbox`
- `integration_toolbox`
- `browser_toolbox`
- `knowledge_toolbox`

Each toolbox accepts:

```json
{
  "action": "status",
  "workspaceId": "champcity_gpt",
  "params": {}
}
```

The public schema stays stable, but action-specific server-side validation is strict. Unknown actions, unknown services, missing required params, and unsafe params return structured `ok: false` results with supported values where applicable. The toolbox schema does not expose raw roots, absolute paths, shell commands, arbitrary git commands, approval tokens, force/reset/merge/rebase/stash/delete controls, raw tokens, or service secrets.

Workspace routing is stateless per call. Use `diagnostics_toolbox` with `action: "list_workspaces"` to discover safe server-defined workspace IDs such as `champcity_gpt`, then pass the chosen ID on project-specific toolbox calls. `workspaceId: "default"` is accepted only when deterministic: a single workspace is configured, or `defaultWorkspaceId` is explicitly configured. With multiple workspaces and no explicit default, project-specific calls fail with `WORKSPACE_REQUIRED` and safe available workspace IDs.

Toolbox calls return:

```ts
{
  toolbox: string;
  action: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string; details?: unknown };
  warnings?: string[];
  recommendedNextSteps?: string[];
}
```

Toolbox visibility uses `files.read`. Write-capable toolbox actions still fail unless the caller has OAuth `files.write` and the local write mode permits the mapped operation. The correct ChatGPT app scopes are `files.read files.write`; `file.read` is a typo and does not grant the required read scope.

### `repo_toolbox`

Initial actions:

- `status`
- `list_files`
- `read_file`
- `search_files`
- `write_markdown_artifact`

Read actions route through the selected workspace and existing file safety policy. `write_markdown_artifact` uses the existing Markdown artifact writer and requires `files.write` plus write mode `docs`, `patch`, or `elevated`.

### `git_toolbox`

Initial actions:

- `status`
- `diff`
- `prepare_work_branch`
- `pre_commit_scan`
- `stage_paths`
- `commit_staged`
- `push_current_branch`
- `readiness_summary`

The toolbox does not accept arbitrary git commands, reset, rebase, merge, stash, branch delete, force push, checkout path, or raw branch-name controls. Mutating actions require `files.write` and write mode `elevated`. `prepare_work_branch` delegates to the safe `prepare_git_work_branch` behavior.

### `artifact_toolbox`

Initial actions:

- `builder_report_index`
- `builder_report_summary`
- `release_artifact_summary`
- `release_publication_summary`
- `local_package_summary`
- `create_codex_handoff_prompt`

Read actions return bounded project-artifact summaries. Handoff prompt creation writes only a local Markdown artifact through existing docs-write policy.

### `diagnostics_toolbox`

Initial actions:

- `runtime_status`
- `write_access_status`
- `tool_exposure_status`
- `oauth_scope_status`
- `chatgpt_discovery_status`
- `list_workspaces`
- `public_safety_status`

Diagnostics are redacted and include runtime package version, commit, branch, runtime start time where available, registered tool count, registered tool-name hash, registered toolbox names, workspace-routing summary, observed OAuth scope booleans, local write mode, local write-mode booleans, and latest discovery counts when a discovery trace is available. `list_workspaces` returns safe catalog metadata only: workspace IDs, labels, repository name when available, branch when safely readable, default marker, and expected-remote match status. No OAuth tokens, refresh tokens, authorization codes, client secrets, code verifiers, local config dumps, private tunnel tokens, cookies, raw credential stores, or unnecessary absolute roots are returned.

`get_write_access_status` also includes a nested diagnostics block when called through MCP so older visible tool surfaces can report runtime, scope, and tool-count state.

### `integration_toolbox`

Initial actions:

- `list_supported_services`
- `get_service_status`
- `list_service_capabilities`
- `validate_service_configuration`
- `prepare_external_handoff`

Initial service IDs:

```text
figma
figma_make
github
cloudflare
playwright
docker_mcp
sentry
linear
jira
slack
notion
custom
```

`integration_toolbox` is a governed allowlisted broker, not arbitrary MCP passthrough. It does not accept raw tokens, arbitrary upstream server URLs, arbitrary HTTP methods, arbitrary upstream MCP tool names, or arbitrary service API methods. Figma belongs under `integration_toolbox` as service IDs `figma` and `figma_make`; no permanent `figma_toolbox` is added. Existing Figma-specific tools remain legacy/backward-compatible for now.

### `browser_toolbox`

Initial actions:

- `get_browser_capabilities`
- `validate_public_endpoint`

This toolbox is constrained validation, not browser scraping. WC-V1-FIX02 does not add live browser automation, Playwright MCP invocation, credential entry, cookies, screenshots by default, raw network headers, or ChatGPT UI scraping.

### `knowledge_toolbox`

Initial actions:

- `list_supported_sources`
- `get_project_memory_status`
- `get_reference_capabilities`

This toolbox is an optional reference/context facade. It does not add arbitrary web fetch, private document connector scraping, hidden persistent memory mutation, or memory writes.

## Local MCP Protocol Self-Test

Release validation can run the deterministic local MCP protocol self-test after building:

```powershell
npm run mcp:self-test
npm run mcp:self-test -- --json
```

This self-test checks the local tool registry, MCP `tools/list` schema validity, required read and gated tool registration, stable toolbox registration, narrow safe-facade and toolbox schemas, tool description safety phrases, safe read-only facade calls, toolbox read-only diagnostics, explicit multi-workspace routing, toolbox write denial without `files.write`, unknown toolbox action denial, unknown integration service denial, Builder Report discovery and summary, docs-write denial when write mode is off, blocked-path denial, elevated-script gating, and gated branch workflow tool coverage. JSON mode emits machine-readable pass/fail results for Builder Reports and release validation.

This self-test complements but does not replace live ChatGPT connector validation.

## Live ChatGPT Connector Evidence

Operator-assisted live ChatGPT validation evidence should be captured with the template under `planning/phases/phase-v1.0/Live_Connector_Evidence/`. The validator checks evidence completeness and redaction safety without using browser automation, ChatGPT UI scraping, screenshots, OAuth/DCR mutation, Cloudflare mutation, packaging, release publication, or token capture.

```powershell
npm run chatgpt:evidence:validate -- --template
npm run chatgpt:evidence:validate -- --template --json
npm run chatgpt:evidence:validate -- --file planning/phases/phase-v1.0/Live_Connector_Evidence/<evidence-file>.md
```

Use the local MCP self-test output as deterministic baseline evidence only. Live ChatGPT connector evidence must come from manual operator observations or explicit ChatGPT tool results, and must keep public endpoints, local paths, OAuth material, local config contents, and secrets redacted.

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

Output summary: `writeMode`, `writeModeSource`, docs/patch/elevated booleans, whether the elevated token is configured, pending patch proposal count, `oauthFilesWriteGranted`, and a nested redacted diagnostics block when MCP call context is available.

## `get_figma_status`

v1.0 scope note: Figma tools are deferred from v1.0 production-core scope. The current Figma workflow must be revisited before it can be treated as a supported product feature. v1.0 remains focused on ChatGPT-to-local-repository access, connector reliability, source-control/release automation, guided setup, and public-user distribution.

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

## `get_workspace_status_summary`

Read-only ChatGPT-safe facade for configured workspace status. It does not require the caller to provide an absolute local root and returns structured counts plus repository-relative changed paths.

Input:

```json
{
  "workspaceId": "default"
}
```

Output summary: workspace ID/label, repository name when available, branch, clean/dirty booleans, staged/tracked/untracked/deleted counts, repository-relative changed paths, and safety notes. It does not return raw git status text.

## `get_change_set_readiness_summary`

Read-only ChatGPT-safe facade for change set readiness. It reports staged, unstaged, and untracked files, public-safety blockers, warnings, and recommended next steps without staging, committing, pushing, tagging, or changing release state.

Input:

```json
{
  "workspaceId": "default",
  "targetBranch": "feature"
}
```

Output summary: workspace ID, branch, target branch, clean/dirty state, staged files, unstaged files, untracked files, blocker findings by relative path/rule/message, warnings, and recommended next steps.

## `get_release_artifact_summary`

Read-only ChatGPT-safe facade for local release artifact inspection. It accepts a release version and maps that version internally to the expected final portable executable name under `release`.

Input:

```json
{
  "workspaceId": "default",
  "releaseVersion": "v0.1.2"
}
```

Output summary: normalized release version, expected artifact names, local final-artifact presence, repository-relative artifact path, size, timestamp, SHA-256 when present, release output policy, and warnings. Intermediate builder output such as `win-unpacked` executables or `.nsis.7z` files is not accepted as final release evidence.

## `get_release_publication_summary`

Read-only ChatGPT-safe facade for GitHub Release publication state. It accepts a tag name and optional asset inclusion flag, then checks release metadata through a fixed GitHub release lookup derived from the configured repository remote.

Input:

```json
{
  "workspaceId": "default",
  "tagName": "v0.1.2",
  "includeAssets": true
}
```

Output summary: tag name, release existence, publication state, release URL, target commitish, draft/prerelease booleans, publish timestamp, optional asset metadata, expected asset match, expected asset match method, warnings, and blockers. When the expected local final artifact exists, expected asset matching first compares the local SHA-256 to GitHub asset digests such as `sha256:<hex>`, then falls back to exact asset name and conservative separator-normalized name comparison. Size-only evidence is reported as weak and is not treated as a strong match. It does not create, edit, upload, publish, or alter releases.

## `get_builder_report_index`

Read-only ChatGPT-safe facade for Builder Report discovery under configured allowed roots. It does not accept caller-supplied absolute roots or arbitrary glob patterns. The scanner only inspects:

```text
planning/phases/<phaseFolder>/Builder_Reports/BUILDER_REPORT*.md
```

Input:

```json
{
  "workspaceId": "default",
  "phaseFolder": "phase-v1.0",
  "workCardId": "WC-V1-0102A",
  "maxResults": 25
}
```

`workspaceId` may be an explicit configured workspace ID, a safe ID derived from a legacy configured allowed root folder name, `default` when deterministic, or `all_allowed` for index scans. It is never interpreted as a filesystem path. `maxResults` defaults to `25` and is capped at `50`.

Output summary: workspace ID/label, optional repository name, query metadata, report metadata, result count, truncation flag, warnings, and safety notes. Report paths are repository-relative. The index returns metadata only, not report contents.

## `get_builder_report_summary`

Read-only ChatGPT-safe facade for bounded review of one Builder Report. It accepts either a safe repository-relative `reportPath` returned by `get_builder_report_index`, or a `phaseFolder` plus `workCardId` lookup.

Input:

```json
{
  "workspaceId": "default",
  "reportPath": "planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0102A_builder_report_discovery_facade.md",
  "maxChars": 6000
}
```

Alternate lookup:

```json
{
  "workspaceId": "default",
  "phaseFolder": "phase-v1.0",
  "workCardId": "WC-V1-0102A"
}
```

Output summary: workspace ID/label, optional repository name, report metadata, match/ambiguity status, candidate paths for ambiguous lookups, bounded `contentPreview`, truncation flag, warnings, and safety notes. Private local path-like and token-like content is redacted from previews. `maxChars` defaults to `6000` and is capped at `12000`. `all_allowed` is intentionally rejected for summaries so a specific configured workspace must be selected.

## `git_status`

Legacy read-only git inspection tool for an allowed root. ChatGPT-facing status workflows should prefer `get_workspace_status_summary`.

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

Legacy read-only commit and push readiness tool for an allowed root. ChatGPT-facing change set workflows should prefer `get_change_set_readiness_summary`.

Input:

```json
{
  "root": "C:\\Users\\<you>\\Projects\\<project>",
  "targetBranch": "dev"
}
```

Output summary: `readyToCommit`, `readyToPush`, current branch, staged files, blocker findings, warnings, and recommended next steps.

## `prepare_git_work_branch`

Prepares `dev` or a generated `feature/WC-V1-xxxx-*` / `feature/WC-V1-FIXxx-*` branch. Requires OAuth `files.write` and local write mode `elevated`.

Input:

```json
{
  "workspaceId": "default",
  "branchKind": "feature",
  "workCardId": "WC-V1-FIX01",
  "slug": "safe-branch-workflow-tool",
  "baseBranch": "dev",
  "createIfMissing": true
}
```

Output summary: branch before/after, whether the branch was created or switched, selected base branch, target branch, clean status before/after, warnings, and recommended next steps.

Safety behavior: the tool does not accept a raw branch name, root path, command, script, shell, args, `approvalToken`, force, reset, merge, rebase, stash, delete, or clobber field. It refuses dirty working trees, staged changes, untracked files, detached HEAD, `main` as the active work target, invalid Work Card IDs, unsafe slugs, missing base branches, and existing target branches that are not based on the selected base branch. It validates the generated branch with `git check-ref-format --branch`. It does not push, merge, rebase, reset, stash, delete branches, tag, or run arbitrary commands.

Active Work Cards should use `dev` or a Work Card feature branch. `main` is reserved for stable release or baseline checkpoints. After branch preparation, the normal sequence is validate, stage reviewed files with `safe_stage_changes`, run `pre_commit_safety_scan`, commit with `commit_validated_changes`, push the current `dev` or feature branch with `push_current_branch`, and merge to `main` only at a stable checkpoint.

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

Internal/elevated exception tool for exact allowlisted maintenance tasks, without shell interpolation, and only in elevated write mode with required elevated approval. It is never available in `docs` or `patch` mode and is not the normal v1.0 ChatGPT-facing status or release workflow.

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

