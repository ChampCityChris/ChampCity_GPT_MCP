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
- `files.write`: required for `workspace_write_attached_image` and inside write-capable toolbox actions such as `artifact_toolbox.create_markdown_artifact`, `repo_toolbox.write_markdown_artifact`, `repo_toolbox.write_json_artifact`, `repo_toolbox.propose_patch`, `repo_toolbox.apply_approved_patch`, `integration_toolbox.prepare_external_handoff`, and git mutating actions under `git_toolbox`.

Write access has OAuth plus local write-mode gates. `CHAMPCITY_GPT_WRITE_MODE=off|docs|patch|elevated` is preferred, with `config/write-access.local.json` as the local-file source. Legacy `CHAMPCITY_GPT_ENABLE_WRITE_TOOLS=true` maps to `docs`.

- `off`: no writes.
- `docs`: Markdown artifact writes.
- `patch`: docs plus application of matching pending patch proposals.
- `elevated`: internal/elevated exception tasks, legacy approval-gated fallback operations, and safe git branch/stage/commit/push tools.

ChatGPT-facing status and release checks should use the stable toolbox actions. `workspace_write_attached_image` is the only current top-level public exception because ChatGPT attachment file parameters must be top-level tool inputs. The internal MCP registry remains at the restored 31-schema baseline; legacy top-level implementation functions remain registered internally where toolbox routers and local maintenance checks need them, but they are not exposed in public ChatGPT `tools/list`.

These facade tools are part of the WC-V1-0102 remediation path for `CAV-011`, `CAV-012`, `CAV-013`, `CAV-021`, `CAV-023`, and `CAV-030`. Live ChatGPT validation is still required before claiming full remediation.

Builder Report discovery should use `artifact_toolbox.builder_report_index`. Specific report review should use `artifact_toolbox.builder_report_summary`, or `repo_toolbox.read_file` only with a narrow expected report path already returned by the index. Normal ChatGPT workflows should avoid broad file-listing calls. The Builder Report facade supports `CAV-033`; live ChatGPT validation is still required before claiming platform safety-layer remediation.

## Stable Domain Toolbox Tools

The public ChatGPT-facing surface is the stable toolbox tools plus `workspace_write_attached_image`. Future capability expansion should still prefer internal allowlisted actions over new top-level MCP tool names when file-parameter constraints do not require a top-level tool. ChatGPT may bind tool schemas for the connector or chat lifecycle, so adding new top-level tools can require connector rediscovery, app reauthorization, or a new chat.

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

Other top-level legacy helper schemas remain registered internally for compatibility and local maintenance. Legacy helper names such as `read_project_file`, `git_diff`, `write_markdown_artifact`, and `safe_stage_changes` are exposure-filtered from public ChatGPT `tools/list`, and direct non-public calls receive the existing safe public-surface rejection.

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

Workspace authority is server-configured and never caller supplied. A ChampCity workspace is an allowed project directory, not necessarily a Git repository; workspace IDs identify served projects and do not need to match the MCP service repository. Legacy `writePolicy` values remain accepted as compatibility inputs: `git_required` no longer requires Git for reads, searches, artifact persistence, or general diagnostics, while `artifact_only` preserves configured artifact-root limits and disables Git mutation. Future configs may use `workspaceCapabilities` with `artifactPersistence`, `patchWorkflow`, `gitOperations`, and `releaseOperations`. Git capabilities are optional and isolated.

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
- `inspect_text_file`
- `read_text_chunk`
- `read_text_lines`
- `read_markdown_section`
- `search_files`
- `write_markdown_artifact`
- `write_json_artifact`
- `propose_patch`
- `apply_approved_patch`

Read actions route through the selected workspace and existing file safety policy without requiring Git. `write_markdown_artifact` and `write_json_artifact` require `files.write` plus write mode `docs`, `patch`, or `elevated`; artifact persistence depends on allowed roots, write mode, OAuth scope, file policy, artifact-root policy, overwrite rules, and evidence controls, not Git. In `artifact_only` workspaces artifact writes are limited to configured artifact roots. JSON writes only accept workspace-relative `.json` paths, parse and normalize JSON, block local/generated/risky paths, and audit writes. Patch actions wrap the existing proposal/apply implementations without accepting public caller-supplied roots; they require the explicit patch capability and Git-backed source-code safeguards.

Bounded text projection:

- Public text content items default to 8,192 UTF-8 bytes and are hard-capped at 16,384 UTF-8 bytes.
- `read_file` returns complete inline content only at or below 16,384 bytes. Larger files return metadata plus the first bounded chunk as MCP text content, `contentComplete: false`, and a continuation cursor for `read_text_chunk`.
- `inspect_text_file` returns metadata, SHA-256, line count, line-ending classification, maximum line byte length, and a bounded Markdown heading index. It intentionally omits body text.
- `read_text_chunk` continues by opaque server-issued cursor or starts with `relativePath`.
- `read_text_lines` returns exact one-based line ranges without hidden ellipses.
- `read_markdown_section` reads a `sectionId` returned by `inspect_text_file`, includes nested headings, and stops before the next equal-or-higher heading.
- Cursors are integrity-protected and bound to workspace, normalized path, source SHA-256, offset, and optional section. Stale source changes require re-inspection.
- Bounded delivery is exact source delivery, not summarization, encoding, redaction, or obfuscation. It reduces the blast radius of host-side safety false positives but cannot guarantee OpenAI host acceptance.

Example inspect/chunk sequence:

```json
{ "action": "inspect_text_file", "workspaceId": "champcity_gpt", "params": { "relativePath": "planning/report.md" } }
{ "action": "read_text_chunk", "workspaceId": "champcity_gpt", "params": { "cursor": "<recommendedFirstCursor>" } }
{ "action": "read_text_chunk", "workspaceId": "champcity_gpt", "params": { "cursor": "<nextCursor>", "maximumBytes": 4096 } }
```

Example line and section reads:

```json
{ "action": "read_text_lines", "params": { "relativePath": "src/file.ts", "startLine": 42, "maximumLines": 20 } }
{ "action": "read_markdown_section", "params": { "relativePath": "docs/plan.md", "sectionId": "sec-..." } }
```

`list_files` accepts a repository-relative `relativePath`, normalizes Windows and POSIX separators, keeps the final path inside the selected workspace, and returns repository-relative file paths plus diagnostics. Diagnostics distinguish missing paths, non-directory paths, readable empty directories, filter misses, and traversal/read failures; failures are not reported as unexplained empty results. Globs are evaluated against the repository path, the path relative to the requested directory, and the basename so nested directory listings work with simple patterns such as `*.md`.

`search_files` accepts `query`, optional repository-relative `scopePath`, `glob`, `maxResults`, and `contextLines`. Search uses the same workspace path containment and traversal behavior as `list_files`. Exact repository-relative path, scoped path, and filename matches are returned as path/filename matches even when the query text does not appear inside the file. Content matches remain line-based. Current results report `searchSources`; a miss means only that the bounded search returned no match, not that the file cannot exist.

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

The toolbox does not accept arbitrary git commands, reset, rebase, stash, branch delete, force push, checkout path, or raw branch-name controls. Git absence is localized to Git actions as `not_git_repository`/`GIT_CAPABILITY_UNAVAILABLE` and does not affect repository reads or artifact persistence. Mutating actions require `files.write`, write mode `elevated`, and a Git-backed workspace regardless of legacy `requireGitRoot`. `artifact_only` workspaces receive structured policy denial for mutation. `prepare_work_branch` delegates to the safe `prepare_git_work_branch` behavior. `integrate_to_dev` is a guarded internal action under `git_toolbox`, not a top-level public MCP tool.

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
- `create_markdown_artifact`
- `read_image_artifact`
- `list_artifacts`
- `read_artifact_by_id`
- `inspect_artifact_text`
- `read_artifact_text_chunk`
- `latest_artifact`
- `artifact_pair_status`
- `current_action_context`
- `export_planning_corpus`
- `review_queue`

Read actions return bounded project-artifact summaries. The obsolete Figma-specific Codex handoff prompt action was removed. All artifact discovery and context actions resolve `workspaceId` through the configured workspace registry, return repository-relative paths only, reject unknown action parameters, reject unsafe metadata paths, and never mutate files, hashes, registry entries, review state, or workflow state.

`create_markdown_artifact` is a generic single-file Markdown persistence action. It accepts exactly `relativePath`, `content`, and optional `overwrite`, requires OAuth `files.write` plus write mode `docs`, `patch`, or `elevated`, writes exact UTF-8 content to a safe repository-relative `.md` path, returns `saved` or `already_saved`, and does not return hashes, revision tokens, artifact types, workflow fields, or interpreted document metadata. Existing identical content is not rewritten. Existing different content fails unless `overwrite` is `true`; overwrite replacement uses internal raw-byte comparison and exact-byte reread verification.

The retired action names `save_architect_interview_output`, `save_project_planning_outputs`, and `submit_handoff_outputs` are unsupported.

`list_artifacts` discovers artifacts from structured registry records when present, then JSON sidecars, structured Markdown front matter, documented repository path conventions, and file metadata. It accepts `phaseId`, `artifactType`, `artifactTypes`, `workCardId`, `status`, `statuses`, `pathPrefix`, `recordKind`, `includeDerived`, `includeSidecars`, `sourceOnly`, `limit`, and `cursor`. Filters use AND semantics. Each result includes a non-authoritative `recordKind` of `source`, `sidecar`, or `derived`; this is classification for review ergonomics, not an authority ranking. The prior complete inventory view remains the default. Results sort by `modifiedAt` descending, then `artifactId` ascending for stable ties. `limit` defaults to `50`, is capped at `200`, and page metadata plus `nextCursor` are returned when more records remain.

`read_artifact_by_id` reads one artifact by stable `artifactId`, registry ID, or pair ID. It accepts `component: "preferred" | "markdown" | "json" | "both"`, defaulting to `preferred`. Markdown at or below the inline threshold may return full content. Larger Markdown returns bounded projection metadata, a `textHandle`, and the first bounded chunk as MCP content; full text is not duplicated into structured metadata. JSON is parsed only when the full bounded JSON file can be read; oversized JSON returns metadata and hash without malformed partial JSON.

`inspect_artifact_text` and `read_artifact_text_chunk` resolve an artifact ID to its preferred Markdown component and delegate to the same bounded text projection protocol used by `repo_toolbox`. If a returned artifact `textHandle.relativePath` is available, callers may continue through `repo_toolbox.read_text_chunk` with the returned cursor.

`latest_artifact` accepts the same structured filters as `list_artifacts` plus `includeContent`. It uses the exact same ordering as `list_artifacts` and returns the first match; it never relies on filename or directory enumeration order. With `includeContent: true`, large Markdown uses the same bounded first-chunk projection as `read_artifact_by_id`.

`artifact_pair_status` reports Markdown, JSON, registry, identity, and payload-hash status separately. It computes raw SHA-256 over the exact bytes on disk, compares stored component hashes when present, reports invalid JSON, missing pair components, registry path or identity mismatches, and leaves all repair or hash rewriting to future explicit write actions. Canonical payload hashing reports `not_configured` unless an authoritative canonicalizer is present; raw JSON stringification is not substituted.

`current_action_context` reads only a structured current-action authority from well-known workspace files such as `.champcity/current-action.json`, `planning/current-action.json`, `planning/workflow/current-action.json`, or phase-scoped equivalents. If no structured authority exists, it returns `status: "not_configured"`. It does not infer current action from prose, branch names, newest files, or builder reports, and it does not advance workflow state.

`export_planning_corpus` is a read-only planning-corpus review action restricted to `planning/` and descendants. It accepts `pathPrefix`, `includeFullText`, `includeDerived`, `includeSidecars`, `artifactTypes`, `statuses`, `limit`, `cursor`, and `maxBundleBytes`. It returns a deterministic manifest page with repository-relative paths, artifact metadata when available, record kind, file size, SHA-256 hashes calculated from actual file bytes, read status, exclusion/failure reasons, counts, and cursor metadata. In full-text mode it returns multiple files per page where limits permit, includes explicit file boundaries, reports unsupported/binary or oversized files, and does not silently truncate text. Inventory-only manifest review is not equivalent to full-text review; use the full-text coverage counts to confirm which eligible files were actually read.

`review_queue` returns only artifacts with explicit structured review states that mean Architect review is pending, normalized to `awaiting_architect_review` while preserving the source status. Draft, operator-review, approved, rejected, and work-in-progress artifacts are excluded unless their structured state explicitly indicates Architect review is pending. Sorting uses submitted time descending when available, then artifact modified time descending, then artifact ID ascending. If no structured review-state authority exists, it returns `review_authority_not_configured`.

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
- `recent_tool_calls`
- `acknowledge_tool_result`
- `result_delivery_status`
- `list_workspaces`
- `workspace_safety_status`
- `public_safety_status`
- `project_validation`
- `mcp_server_startup`
- `mcp_tool_registration`
- `mcp_tool_inventory`
- `electron_development_startup`
- `electron_packaged_startup`

Diagnostics are redacted and separate ChampCity GPT service-runtime provenance from target-workspace metadata. `runtime_status` may report runtime package version, runtime source commit, packaged/development mode, and service-repository alignment only when the selected workspace is the ChampCity GPT service repository; unrelated target workspaces report alignment as `not_applicable`. `list_workspaces` returns safe catalog metadata only: workspace IDs, labels, optional repository metadata, default marker, expected-remote match status, legacy write policy, capability summaries, Git detected yes/no as informational metadata, relative `artifactWriteRoots`, and safe warnings. `workspace_safety_status` checks registration, allowed-root containment, path/file policy readiness, write mode, OAuth scope state, artifact roots, audit/trace storage, filesystem read capability, artifact persistence, patch capability, and optional Git capabilities without requiring Git. `public_safety_status` is a deprecated alias for `workspace_safety_status`; use `git_toolbox.readiness_summary` for source-control readiness. No OAuth tokens, refresh tokens, authorization codes, client secrets, code verifiers, local config dumps, private tunnel tokens, cookies, raw credential stores, or absolute roots are returned.

`recent_tool_calls` accepts optional `params.limit` (default 20, minimum 1, maximum 50), `params.since` as a strict ISO-8601 timestamp, `params.correlationId`, and `params.publicToolName`. It reads only the redacted MCP tool-call trace and returns deterministic classifications: `NO_SERVER_RECEIPT_EVIDENCE`, `RECEIVED_NOT_DISPATCHED`, `DISPATCHED_NOT_EXECUTED`, `APP_CONTRACT_REJECTED`, `APP_POLICY_DENIED`, `APP_AUTHORIZATION_DENIED`, `APP_EXECUTION_ERROR`, `RESULT_MATERIALIZED`, `RESULT_SERIALIZED`, `RESPONSE_FINISHED_UNACKNOWLEDGED`, `CLIENT_ACKNOWLEDGED`, `CONNECTION_CLOSED_BEFORE_FINISH`, or `TRANSPORT_ERROR`. Valid dispatch correlation is bound by the MCP SDK JSON-RPC request ID supplied as handler metadata. Malformed or unsupported actions are contract errors, not safety-policy denials. OAuth scope denials classify as authorization denials. HTTP `finish` means Node handed response bytes to the transport stack; it is not client acknowledgement and does not prove ChatGPT accepted, exposed, or consumed the result.

`acknowledge_tool_result` accepts `params.correlationId`, `params.resultAttemptId`, `params.payloadSha256`, and optional `params.acknowledgementContext: "content_consumed" | "metadata_consumed" | "retry_requested"`. It records a diagnostic receipt only; it is telemetry, not an approval control, and it does not retrieve, unlock, or reveal hidden payload content or imply OpenAI approved the content under every internal policy. `result_delivery_status` looks up safe result-delivery metadata by exact `correlationId` or `resultAttemptId`. Result telemetry never retains document text, prompt text, patch text, artifact bodies, credentials, raw URLs, or absolute paths. Result hashes identify serialized bytes without revealing content. Live OpenAI/ChatGPT host safety decisions remain outside the MCP server's direct observability.

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

Semantic Markdown/JSON equivalence checks, artifact repair, automatic registry repair, canonical payload hashing without a repository canonicalizer, workflow advancement, approval/rejection transitions, historical workflow tracing, and review assignment are not implemented. These capabilities require separate operator-approved architecture specifications; no placeholder transition model or simulated review decisions were added.

## Local MCP Protocol Self-Test

Release validation can run the deterministic local MCP protocol self-test after building:

```powershell
npm run mcp:self-test
npm run mcp:self-test -- --json
```

This self-test checks the local tool registry, MCP `tools/list` schema validity, the public surface of seven stable toolboxes plus `workspace_write_attached_image` when write-scoped, required internal gated operations, stable toolbox registration, exposure-filtered legacy facade schemas, narrow toolbox schemas, tool description safety phrases, safe read-only facade calls through toolbox actions, toolbox read-only diagnostics, explicit multi-workspace routing, toolbox write denial without `files.write`, unknown toolbox action denial, unknown integration service denial, Builder Report discovery and summary, docs-write denial when write mode is off, blocked-path denial, hidden `run_allowed_script` public exposure, and gated branch workflow tool coverage. JSON mode emits machine-readable pass/fail results for Builder Reports and release validation.

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

The following entries describe internal implementation functions retained for toolbox routers and local maintenance context. They are not exposed as top-level public ChatGPT tools. Direct calls to names outside the public toolbox surface continue to receive the existing safe public-surface rejection.

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

Applies a patch only when local write mode is `patch` or `elevated` and the patch exactly matches a live registered proposal from `propose_patch`. This action does not accept a UI or local approval token.

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

Safety behavior: in both `patch` and `elevated` mode, the patch must exactly match a non-expired unused proposal for the same root. The proposal is marked used after successful apply. Patch proposal and application always require a confirmed Git-backed workspace, regardless of legacy `requireGitRoot`. All existing patch checks still run: allowed-root, blocked-file, regular-file, symlink/submodule, size, and non-Git-target checks. After applying, changed paths are checked with `lstat`, and symbolic link paths are rejected with a best-effort rollback. Proposal failures remain patch errors and are never replaced with an approval-token challenge.

After source corrections to this behavior, run the package-and-promote path before treating the fix as active in ChatGPT. Runtime drift diagnostics identify stale packaged deployments where source and active runtime versions differ.

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

Output summary: relative path, size, SHA-256, workspace ID, and write policy.

Safety behavior: allowed roots, workspace write policy, artifact-root boundaries for `artifact_only`, `.md`-only writes, blocked-file policy, overwrite rules, regular-file target checks, atomic write, and audit logging. No `approvalToken` is required for Markdown writes in `docs`, `patch`, or `elevated` mode.

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

