# Tool Reference

HTTP clients reach these tools through `/mcp`. In ChatGPT HTTP mode, OAuth with Dynamic Client Registration is the standard public connector path and `/mcp` requires an OAuth bearer access token; unauthenticated localhost testing requires explicit `CHAMPCITY_GPT_ALLOW_UNAUTH_LOCAL_HTTP=true` and must not be tunneled. Keep write mode `off` until the read-only HTTP flow is validated.

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

- `files.read`: `tools/list` and the seven public toolbox tools: `repo_toolbox`, `git_toolbox`, `artifact_toolbox`, `diagnostics_toolbox`, `integration_toolbox`, `browser_toolbox`, and `knowledge_toolbox`.
- `files.write`: required for `workspace_write_attached_image` and inside write-capable toolbox actions such as `repo_toolbox.write_markdown_artifact`, `repo_toolbox.write_json_artifact`, `repo_toolbox.propose_patch`, `repo_toolbox.apply_approved_patch`, `integration_toolbox.prepare_external_handoff`, and git mutating actions under `git_toolbox`.

Write access has OAuth plus local write-mode gates. `CHAMPCITY_GPT_WRITE_MODE=off|docs|patch|elevated` is preferred, with `config/write-access.local.json` as the local-file source. Legacy `CHAMPCITY_GPT_ENABLE_WRITE_TOOLS=true` maps to `docs`.

- `off`: no writes.
- `docs`: Markdown artifact writes.
- `patch`: docs plus application of matching pending patch proposals.
- `elevated`: internal/elevated exception tasks, legacy approval-gated fallback operations, and safe git branch/stage/commit/push tools.

ChatGPT-facing status and release checks should use the stable toolbox actions. `workspace_write_attached_image` is the only current top-level public exception because ChatGPT attachment file parameters must be top-level tool inputs. The legacy top-level tools remain internal implementation functions where toolbox routers need them, but they are not exposed through public ChatGPT `tools/list` and direct public calls are denied.

These facade tools are part of the WC-V1-0102 remediation path for `CAV-011`, `CAV-012`, `CAV-013`, `CAV-021`, `CAV-023`, and `CAV-030`. Live ChatGPT validation is still required before claiming full remediation.

Builder Report discovery should use `artifact_toolbox.builder_report_index`. Specific report review should use `artifact_toolbox.builder_report_summary`, or `repo_toolbox.read_file` only with a narrow expected report path already returned by the index. Normal ChatGPT workflows should avoid broad file-listing calls. The Builder Report facade supports `CAV-033`; live ChatGPT validation is still required before claiming platform safety-layer remediation.

## Stable Domain Toolbox Tools

WC-V1-FIX05 reduced the public ChatGPT-facing surface to the stable toolbox tools. `workspace_write_attached_image` is a later bounded top-level exception for ChatGPT attachment import because nested file parameters are not supported. Future capability expansion should still prefer internal allowlisted actions over new top-level MCP tool names when file-parameter constraints do not require a top-level tool. ChatGPT may bind tool schemas for the connector or chat lifecycle, so adding new top-level tools can require connector rediscovery, app reauthorization, or a new chat.

The stable domain toolbox tools are:

- `repo_toolbox`
- `git_toolbox`
- `artifact_toolbox`
- `diagnostics_toolbox`
- `integration_toolbox`
- `browser_toolbox`
- `knowledge_toolbox`

The current additional public write tool is:

- `workspace_write_attached_image`

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

Toolbox visibility uses `files.read`. `workspace_write_attached_image` visibility and calls require OAuth `files.write` plus local write mode `docs`, `patch`, or `elevated`. Write-capable toolbox actions still fail unless the caller has OAuth `files.write` and the local write mode permits the mapped operation. The correct ChatGPT app scopes are `files.read files.write`; `file.read` is a typo and does not grant the required read scope.

## Top-Level Attachment Writer

### `workspace_write_attached_image`

This tool is not a general file writer.

It accepts one ChatGPT-authorized raster image and creates one new file inside an already configured workspace.

It cannot overwrite files or write outside the selected workspace.

Use it only when the user explicitly asks to save an attached ChatGPT image into an existing ChampCity workspace at an exact repository-relative destination. Image editing, resizing, cropping, recompression, metadata stripping, or format conversion must happen before this tool is invoked.

Input:

```json
{
  "workspaceId": "champcity_gpt",
  "relativePath": "src/assets/logo.png",
  "image": {
    "download_url": "https://...",
    "file_id": "file_...",
    "mime_type": "image/png",
    "file_name": "logo.png"
  }
}
```

`image` is a top-level ChatGPT file parameter declared with `_meta["openai/fileParams"]`. Only `download_url` and `file_id` are required; `mime_type` and `file_name` are optional. The server does not accept base64 image content, inline byte arrays, local source paths, arbitrary image URLs, caller-provided headers, caller-provided cookies, or multiple files.

Supported formats:

- PNG: `.png`, `image/png`
- JPEG: `.jpg` or `.jpeg`, `image/jpeg`
- WebP: `.webp`, `image/webp`

Limits:

- Maximum encoded file size: 25 MiB
- Maximum width: 16,384 pixels
- Maximum height: 16,384 pixels
- Maximum total pixels: 100,000,000
- HTTPS-only download URL
- Connection timeout: 10,000 ms
- Total download timeout: 30,000 ms
- Redirect limit: 3

Destination rules:

- `workspaceId` must resolve through the configured workspace registry.
- `relativePath` must be repository-relative and include the destination filename.
- The destination extension must match the detected image bytes.
- Missing parent directories may be created inside the selected workspace.
- Existing destination files return `destination_exists` and are not modified.

Valid destinations:

```text
src/imports/company-logo.png
assets/reference/dashboard-layout.webp
planning/evidence/ui/current-screen.jpg
```

Invalid destinations:

```text
C:\image.png
C:/image.png
\\server\share\image.png
/file.png
../image.png
src/../../image.png
file:///image.png
%USERPROFILE%\image.png
~\image.png
CON.png
image.png:ads
```

Security behavior:

- Resolves workspace roots only from trusted application configuration.
- Rejects absolute paths, drive-relative paths, UNC paths, file URIs, traversal, NUL bytes, alternate data streams, Windows device names, trailing-dot segments, trailing-space segments, empty filenames, and unsupported extensions.
- Resolves the real workspace root and deepest existing destination ancestor before writing.
- Rejects symlink, junction, or reparse-point escapes.
- Uses exclusive create-only file creation and removes partial final files on write or verification failure.
- Computes SHA-256 over the exact bytes written and verifies the final file size and hash before reporting success.
- Does not return or log the temporary download URL.

Output summary includes `status`, `workspaceId`, `workspaceName`, `relativePath`, detected format and MIME type, original file name when supplied, byte count, dimensions, SHA-256, created directories, Git file status when safely available, warnings, and structured errors. It never returns raw image bytes, base64 content, temporary download URLs, authentication data, or filesystem paths outside the selected workspace.

### `repo_toolbox`

Initial actions:

- `status`
- `list_files`
- `read_file`
- `search_files`
- `write_markdown_artifact`
- `write_json_artifact`
- `propose_patch`
- `apply_approved_patch`

Read actions route through the selected workspace and existing file safety policy. `write_markdown_artifact` and `write_json_artifact` require `files.write` plus write mode `docs`, `patch`, or `elevated`. JSON writes only accept repository-relative `.json` paths, parse and normalize JSON, block local/generated/risky paths, and audit writes. Patch actions wrap the existing proposal/apply implementations without accepting public caller-supplied roots.

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
- `integrate_to_dev`
- `inspect_history`

The toolbox does not accept arbitrary git commands, reset, rebase, stash, branch delete, force push, checkout path, or raw branch-name controls. Mutating actions require `files.write` and write mode `elevated`. `prepare_work_branch` delegates to the safe `prepare_git_work_branch` behavior. `integrate_to_dev` is a guarded internal action under `git_toolbox`, not a top-level public MCP tool.

`inspect_history` is read-only and accepts a strict `operation` enum: `log`, `show_commit`, `diff_refs`, `file_history`, `blame`, `merge_base`, or `check_ancestry`. Each operation constructs one fixed Git subcommand and validates bounded counts, refs, line ranges, and repository-relative paths. It disables pagers, external diff helpers, color, interactive prompts, and credential prompts. It never accepts arbitrary Git options or subcommands.

Normal reviewed Work Card lifecycle:

1. Feature branch implementation.
2. Architect review.
3. Commit staged changes.
4. Push feature branch.
5. Run `git_toolbox.integrate_to_dev` dry run.
6. Run `git_toolbox.integrate_to_dev` execute with `push: true` after review approval.
7. Package/promote from `dev` when needed.
8. Live validation.

### `artifact_toolbox`

Initial actions:

- `builder_report_index`
- `builder_report_summary`
- `release_artifact_summary`
- `release_publication_summary`
- `local_package_summary`
- `read_image_artifact`

Read actions return bounded project-artifact summaries. The obsolete Figma-specific Codex handoff prompt action was removed.

`read_image_artifact` is a constrained screenshot/image-evidence reader, not a general binary file read capability. It accepts a workspace-relative PNG path under an approved artifact directory (`planning/`, `evidence/`, `artifacts/`, `Builder_Reports/`, `release/`, `reports/`, `validation/`, or `screenshots/`) and an optional `maxBytes` value that can only lower the hard 5,000,000-byte limit. Absolute paths, traversal, paths outside the selected workspace, blocked/cache/secret directories, unsupported extensions, non-files, oversized files, missing files, and PNG extension spoofing are rejected. Successful calls return a short text item, an MCP `image` content item, and structured metadata; base64 image bytes are never included in the text summary.

```json
{
  "action": "read_image_artifact",
  "workspaceId": "champcity_gpt",
  "params": {
    "path": "planning/phases/phase-v1.0/evidence/screenshots/example.png"
  }
}
```

When a validation report references a PNG and visual inspection is needed, ChatGPT should call this action with the reported repository-relative path, then inspect the returned image content. The server performs no OCR, interpretation, or AI analysis.

### `diagnostics_toolbox`

Initial actions:

- `runtime_status`
- `write_access_status`
- `tool_exposure_status`
- `oauth_scope_status`
- `chatgpt_discovery_status`
- `list_workspaces`
- `public_safety_status`
- `project_validation`
- `mcp_server_startup`
- `mcp_tool_registration`
- `mcp_tool_inventory`
- `electron_development_startup`
- `electron_packaged_startup`

Diagnostics are redacted and include runtime package version, commit, branch, runtime start time where available, registered tool count, registered tool-name hash, registered toolbox names, workspace-routing summary, observed OAuth scope booleans, local write mode, local write-mode booleans, and latest discovery counts when a discovery trace is available. `list_workspaces` returns safe catalog metadata only: workspace IDs, labels, repository name when available, branch when safely readable, default marker, and expected-remote match status. No OAuth tokens, refresh tokens, authorization codes, client secrets, code verifiers, local config dumps, private tunnel tokens, cookies, raw credential stores, or unnecessary absolute roots are returned.

`get_write_access_status` also includes a nested diagnostics block when called through MCP so older visible tool surfaces can report runtime, scope, and tool-count state.

`project_validation` accepts only `params.operation: "typecheck" | "build" | "test" | "release_checks"`. Operations map in source to fixed package scripts and the documented normal-Windows validation lane. The action accepts no command, script name, arguments, path, working directory, environment, or timeout. Results include fixed command metadata, execution lane, timestamps, exit/timeout details, bounded redacted output, Git HEAD before/after, and structured changed files. Maintainers update the fixed mapping in `src/tools/architect/projectValidation.ts` when repository scripts change; they must not add a generic command registry.

`mcp_server_startup` starts the repository-owned HTTP server on a fixed ephemeral localhost port, checks its health endpoint, and shuts it down. `mcp_tool_registration` checks public tool uniqueness, schemas, descriptions, and absence of generic command exposure. `mcp_tool_inventory` lists the public tools, including the seven toolboxes and the bounded attachment image writer, without exposing internal executables or secrets.

`electron_development_startup` and `electron_packaged_startup` use one application-owned fixed diagnostic flag. They accept empty params only, capture bounded typed startup milestones, and auto-shut down. The packaged action derives the current-version executable from `package.json` and `electron-builder.json`; it returns `not_packaged` when that file is absent. Renderer load is observable. The current preload contract does not directly expose preload completion, so the diagnostic reports that limitation rather than claiming validation.

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

`integration_toolbox` is a governed allowlisted broker, not arbitrary MCP passthrough. It does not accept raw tokens, arbitrary upstream server URLs, arbitrary HTTP methods, arbitrary upstream MCP tool names, or arbitrary service API methods. Figma belongs under `integration_toolbox` as service IDs `figma` and `figma_make`; no `figma_toolbox` is added. Figma status/capability/configuration actions return broker-not-implemented placeholders and do not call old direct Figma API, token, or MCP code.

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
- `source_analysis`

This toolbox is an optional reference/context facade. It does not add arbitrary web fetch, private document connector scraping, hidden persistent memory mutation, or memory writes.

`source_analysis` uses the TypeScript compiler API and accepts these strict operations:

- `find_symbol` and `find_references` with a bounded symbol name.
- `import_graph` with a repository-relative TypeScript/JavaScript file and depth from 1 through 5.
- `get_callers` and `get_callees` for statically visible calls.
- `mcp_registrations` and `duplicate_mcp_tool_names` for the repository tool-registration AST.

Source analysis is read-only, bounded by file/match/node/edge/time limits, rejects absolute paths and traversal, and returns `source_unavailable` in packaged runtimes without repository TypeScript source. Static analysis does not claim complete resolution of dependency injection, computed calls, runtime IPC dispatch, or non-literal dynamic imports.

## Architect Diagnostic Security Boundary

ChampCity MCP does not expose arbitrary shell or command execution. Validation actions are fixed purpose-built operations.

The architect actions use fixed executables, fixed argument construction, fixed repository working directories, `shell: false`, sanitized process environments, bounded output, redaction, fixed timeouts, and Windows-compatible process-tree termination. No action accepts executable names, package-script names, process arguments, environment variables, arbitrary Electron flags, IPC names, URLs, JavaScript, or browser selectors.

Canonical artifact verification, canonical serialization/hashing, artifact-registry validation, workflow-state validation, and workflow tracing are not implemented. This repository does not yet define canonical artifact pairs, a canonical serializer/hash, an artifact registry, a workflow-state store, or transition authority. Those capabilities require a separate operator-approved architecture specification; no placeholder production models or simulated results were added.

## Local MCP Protocol Self-Test

Release validation can run the deterministic local MCP protocol self-test after building:

```powershell
npm run mcp:self-test
npm run mcp:self-test -- --json
```

This self-test checks the local tool registry, MCP `tools/list` schema validity, the public surface of seven stable toolboxes plus `workspace_write_attached_image` when write-scoped, required internal gated tool registration, stable toolbox registration, narrow safe-facade and toolbox schemas, tool description safety phrases, safe read-only facade calls, toolbox read-only diagnostics, explicit multi-workspace routing, toolbox write denial without `files.write`, unknown toolbox action denial, unknown integration service denial, Builder Report discovery and summary, docs-write denial when write mode is off, blocked-path denial, hidden `run_allowed_script` public exposure, and gated branch workflow tool coverage. JSON mode emits machine-readable pass/fail results for Builder Reports and release validation.

This self-test complements but does not replace live ChatGPT connector validation.

## Live ChatGPT Connector Evidence

Operator-assisted live ChatGPT validation evidence should be captured with the template under `planning/phases/phase-v1.0/Live_Connector_Evidence/`. The validator checks evidence completeness and redaction safety without using browser automation, ChatGPT UI scraping, screenshots, OAuth/DCR mutation, Cloudflare mutation, packaging, release publication, or token capture.

```powershell
npm run chatgpt:evidence:validate -- --template
npm run chatgpt:evidence:validate -- --template --json
npm run chatgpt:evidence:validate -- --file planning/phases/phase-v1.0/Live_Connector_Evidence/<evidence-file>.md
```

Use the local MCP self-test output as deterministic baseline evidence only. Live ChatGPT connector evidence must come from manual operator observations or explicit ChatGPT tool results, and must keep public endpoints, local paths, OAuth material, local config contents, and secrets redacted.

The elevated approval token is configured in `config/write-access.local.json` as a salted hash, or temporarily through `CHAMPCITY_GPT_WRITE_APPROVAL_TOKEN` for dev/manual testing. Static bearer tokens are temporary legacy/manual testing fallback only; ChatGPT.com public connector setup uses OAuth/DCR.

## Internal Legacy Implementations

The following entries describe internal implementation functions retained for toolbox routers and local maintenance context. They are not exposed as top-level public ChatGPT tools after WC-V1-FIX05.

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

## Figma Broker Placeholder

The obsolete direct Figma and Figma Make tools were removed from public MCP exposure and from the direct implementation tree. There is no `figma_toolbox`.

Future Figma support belongs under `integration_toolbox` as governed broker behavior. For now, `integration_toolbox.get_service_status`, `integration_toolbox.list_service_capabilities`, and `integration_toolbox.validate_service_configuration` for `figma` or `figma_make` return static broker-not-implemented placeholders with `governedBrokerOnly: true`, `arbitraryUpstreamMcpPassthrough: false`, and `legacyDirectFigmaToolsRemoved: true`.

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

## `git_toolbox.integrate_to_dev`

Integrates a reviewed feature branch into `dev` through the public `git_toolbox` dispatcher. It is not registered as a top-level MCP tool.

Input:

```json
{
  "action": "integrate_to_dev",
  "workspaceId": "champcity_gpt",
  "params": {
    "sourceBranch": "feature/WC-V1-0401-harden-oauth-dcr-public-connector",
    "targetBranch": "dev",
    "push": false,
    "requireCleanWorkingTree": true,
    "requireSourceBranchPushed": true,
    "requireValidationReport": true,
    "validationReportPath": "planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0401_harden_oauth_dcr_public_connector.md",
    "mergeMode": "no-ff",
    "dryRun": true
  }
}
```

Defaults: `sourceBranch` is the current branch, `targetBranch` is `dev`, `push` is `false`, `requireCleanWorkingTree` is `true`, `requireSourceBranchPushed` is `true`, `requireValidationReport` is `true`, `mergeMode` is `no-ff`, and `dryRun` is `true`.

Dry run does not mutate git state. It reports the resolved workspace, repository identity, source/target branch existence, upstream/pushed status, source and target commits, commits that would be integrated, validation report status, blockers, warnings, and planned operations.

Execute mode only proceeds when guardrails pass. It resolves the workspace by `workspaceId`, requires a clean working tree, rejects `main` and `dev` as source branches, requires local source branch existence, requires local `dev` or an existing `origin/dev` tracking branch, requires the source branch to be pushed, requires a Builder Report unless explicitly disabled, uses `git merge --no-ff` by default, aborts on conflicts, runs `git diff --check`, `npm run check:public`, and `npm run mcp:self-test -- --json` after merge, and pushes only with `git push origin dev` when `push: true` and checks pass.

Safety behavior: the action does not accept a root path, shell command, approval token, arbitrary git command, force option, rebase option, reset option, stash option, branch deletion option, tag option, package option, release option, or `main` target. It does not package or publish releases. If `push: false`, a successful local `dev` merge is left unpushed and reported.

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

