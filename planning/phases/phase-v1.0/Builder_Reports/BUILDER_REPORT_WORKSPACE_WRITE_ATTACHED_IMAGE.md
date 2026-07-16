# Builder Report - Workspace Write Attached Image

## Objective

Add one constrained ChatGPT image-to-workspace write tool, `workspace_write_attached_image`, that accepts one ChatGPT-authorized raster image attachment and creates one new file at an exact repository-relative destination inside an existing configured ChampCity workspace.

This tool is not a general file writer. It does not accept arbitrary roots, arbitrary URLs, local source paths, base64 content, multiple files, overwrites, conversion, resizing, or image editing.

## Repository Verification

- Working directory: `C:\Users\<you>\Projects\ChampCity_GPT`
- Git top level: `C:\Users\<you>\Projects\ChampCity_GPT`
- Remote: `https://github.com/ChampCityChris/ChampCity_GPT_MCP.git`
- `package.json`: present
- Starting branch: `dev`
- Starting HEAD: `41ca79cf1e52d32a24a735fce2a33f119ec80168`
- Starting working tree: clean
- Existing release state: `v0.2.0` already exists; this is the next implementation pass.

## Files Reviewed

- `AGENTS.MD`
- `docs/dev/VALIDATION_COMMAND_LANES.md`
- `package.json`
- `package-lock.json`
- `src/server/registerTools.ts`
- `src/workspaces.ts`
- `src/config.ts`
- `src/security/pathPolicy.ts`
- `src/security/auditLog.ts`
- `src/tools/domainToolboxes.ts`
- `src/tools/writeMarkdownArtifact.ts`
- `src/tools/writeJsonArtifact.ts`
- `src/tools/readImageArtifact.ts`
- `src/utils/git.ts`
- Existing tool schema, workspace, path policy, HTTP transport, MCP self-test, and write-access tests
- `planning/phases/phase-v1.0/V1_SCOPE_DECISIONS_FROM_OPERATOR_INTAKE.md`

## Workspace Authority Reused

The implementation reuses the existing configured workspace registry in `src/workspaces.ts`.

The caller supplies only `workspaceId`. The caller cannot supply a workspace root, absolute path, URL, drive letter, UNC path, home path, environment-variable path, or file URI as workspace authority.

## Tool Name

- `workspace_write_attached_image`

## Tool Description

Use this when the user explicitly asks to save one image attached in ChatGPT into an existing ChampCity workspace at a specified repository-relative path. Creates a new image file only and refuses to overwrite existing files.

## Input Schema

Top-level fields:

- `workspaceId: string`
- `relativePath: string`
- `image: { download_url: string; file_id: string; mime_type?: string; file_name?: string }`

The image field is a top-level input because ChatGPT file parameters are not nested.

## Output Schema

The tool returns structured JSON with:

- `status`
- `workspaceId`
- `workspaceName`
- `relativePath`
- `detectedMimeType`
- `detectedFormat`
- `originalFileName`
- `bytesWritten`
- `width`
- `height`
- `sha256`
- `createdDirectories`
- `gitFileStatus`
- `warnings`
- `errors`

It does not return raw bytes, base64, temporary download URLs, authentication data, or filesystem paths outside the selected workspace.

## File-Parameter Metadata

The public MCP tool includes:

```json
{
  "_meta": {
    "openai/fileParams": ["image"]
  }
}
```

The file-reference schema declares `download_url`, `file_id`, `mime_type`, and `file_name`. Only `download_url` and `file_id` are required.

## Tool Annotations

```ts
annotations: {
  readOnlyHint: false,
  openWorldHint: false,
  destructiveHint: false
}
```

`destructiveHint` remains false because the tool is create-only and refuses to overwrite or delete files.

## Supported Image Formats

- PNG: `.png`, `image/png`
- JPEG: `.jpg`, `.jpeg`, `image/jpeg`
- WebP: `.webp`, `image/webp`

SVG, SVGZ, HTML, PDF, ICO, BMP, TIFF, PSD, AVIF, HEIC, GIF, and arbitrary binary files are not supported.

## File-Size and Dimension Limits

- Maximum encoded file size: 25 MiB
- Maximum width: 16,384 px
- Maximum height: 16,384 px
- Maximum total pixels: 100,000,000
- HTTPS-only download URL
- Connection timeout: 10,000 ms
- Total download timeout: 30,000 ms
- Redirect limit: 3

## Path-Containment Design

- Resolve the selected workspace through `resolveWorkspace`.
- Resolve the real workspace root with `fs.realpathSync.native`.
- Parse and normalize the requested repository-relative destination.
- Resolve the final absolute path under the real workspace root.
- Confirm lexical containment with Windows case-insensitive behavior through existing path-policy comparison.
- Inspect and realpath the deepest existing destination ancestor.
- Recheck containment immediately before exclusive final creation.

## Windows Path Protections

The tool rejects:

- absolute Windows paths
- absolute POSIX paths
- drive-relative paths
- UNC paths
- file URIs
- traversal
- NUL characters
- alternate data stream syntax
- reserved Windows device names, including device names with extensions
- trailing-dot segments
- trailing-space segments
- empty destination filenames
- unsupported extensions
- destinations that resolve to the workspace root

## Symlink and Junction Protections

The tool rejects symlink, junction, or reparse-point escapes by resolving the real workspace root and deepest existing destination ancestor before creating anything. Existing destination symlinks are rejected. Containment is rechecked before final creation.

## Download Controls

- Accepts only the ChatGPT-authorized `download_url` supplied through the declared file parameter.
- Requires HTTPS.
- Uses fixed connection and total timeouts.
- Enforces the 25 MiB encoded byte limit while streaming.
- Limits redirects to 3.
- Does not accept caller headers, cookies, tokens, or credentials.
- Does not persist, return, or log the temporary download URL.
- Does not write partial downloaded content to the destination.

## Create-Only and No-Overwrite Behavior

The final destination is opened with exclusive create semantics. If it already exists, the tool returns `destination_exists` and leaves existing bytes unchanged. There is no `overwrite`, `force`, `replace`, or alternate filename option.

## Atomic-Write Implementation

The tool validates path and image bytes before creating the destination. It creates only missing parent directories inside the workspace, opens the final destination with `wx`, writes the complete approved byte buffer, flushes, closes, reads the file back, verifies size and SHA-256, and removes partial final files on write or verification failure.

## Hash Implementation

SHA-256 is computed from the downloaded approved bytes and verified against the final workspace file after creation. The returned hash describes the final file.

## Tests Added

- `tests/workspaceWriteAttachedImage.test.ts`

Coverage includes:

- top-level file-parameter registration
- `_meta["openai/fileParams"]`
- write annotations
- PNG, JPEG, and WebP create success
- exact-byte preservation
- SHA-256 and byte count
- parent directory creation reporting
- extension mismatch
- MIME mismatch
- non-image/SVG-like content rejection
- oversized byte rejection
- excessive dimension rejection
- traversal, absolute, UNC, file URI, alternate stream, NUL, reserved-name, and trailing-space rejection
- existing-file create-only protection
- concurrent create conflict safety
- symlink escape rejection where fixtures are supported
- HTTP URL rejection
- temporary URL absence from output and audit logs
- local write-mode denial

Existing schema, HTTP transport, self-test, and git integration tests were updated for the intentional public-surface exception.

## Validation Commands

- `npm run validate:codex:unit` - sandbox lane - failed with known `spawn EPERM` from esbuild; not used as application-failure evidence.
- `npm run validate:codex:unit` - normal Windows lane outside sandbox - PASS, 295 tests.
- `npm run validate:codex` - normal Windows lane outside sandbox - PASS; ran `npm run test` then `npm run build`, 295 tests.
- `npm run check:public` - sandbox lane - PASS, 176 source candidate files.
- `npm run check:release` - sandbox lane - PASS, 2,783 release files.
- `npm run mcp:self-test -- --json` - sandbox lane - failed with sandbox-only `spawn EPERM`/child-process failures; not used as application-failure evidence.
- `npm run mcp:self-test -- --json` - normal Windows lane outside sandbox - PASS, 22 checks, write-scoped exposed tool count 8.
- `git diff --check` - PASS; only CRLF conversion warnings were reported.

## Validation Lanes

Validation used the repository wrapper documented in `docs/dev/VALIDATION_COMMAND_LANES.md`. The sandbox-only `spawn EPERM` failure was rerun in the approved normal Windows lane.

## Packaging Results

- Command: `npm run app:package` in the normal Windows lane outside sandbox.
- Result: PASS; Electron Builder produced the final current-version portable executable.
- Final executable: `C:\Users\<you>\Projects\ChampCity_GPT\release\ChampCity GPT MCP Launcher-0.2.1-x64.exe`
- LastWriteTime: `2026-07-16T01:06:43.252Z`
- Size: `96,032,933` bytes
- SHA-256: `8e578839deb997ec08aefc5409bec1777535dcd32af915b2c0d5d2b71585b434`
- Runtime promotion: PASS to `C:\Users\<you>\Apps\ChampCity_GPT_MCP_Runtime\ChampCity GPT MCP Launcher-live.exe`; size and SHA-256 match the final artifact.
- Processes left running after packaging and packaged startup validation: no new `0.2.1` launcher process. Pre-existing `0.2.0` release/temp launcher processes remained running and should be closed by the operator before future packaging if they lock release output.

## Packaged MCP Registration

- Packaged startup diagnostic: PASS for app `0.2.1`, Electron `42.5.0`, Node `24.17.0`, clean shutdown.
- Startup diagnostic runs with local write mode forced off and therefore reported the read-visible public tool count of 7.
- Separate packaged write-scoped registry check against `release/win-unpacked/resources/app.asar.unpacked/dist/src/server/registerTools.js`: PASS.
- Packaged write-scoped exposed tools: `repo_toolbox`, `git_toolbox`, `artifact_toolbox`, `diagnostics_toolbox`, `integration_toolbox`, `browser_toolbox`, `knowledge_toolbox`, `workspace_write_attached_image`.
- Packaged `workspace_write_attached_image` schema preserved `_meta["openai/fileParams"]: ["image"]`.
- Packaged `workspace_write_attached_image` annotations preserved `readOnlyHint: false`, `destructiveHint: false`, and `openWorldHint: false`.
- Packaged image file-reference schema preserved `download_url`, `file_id`, `mime_type`, and `file_name`, with only `download_url` and `file_id` required.

## Manual Validation Required

- Refresh or reconnect the packaged ChampCity MCP connector in ChatGPT.
- Confirm read-only discovery shows the seven toolbox tools.
- Confirm write-scoped discovery with local write mode enabled shows `workspace_write_attached_image`.
- Attach a PNG, JPEG, or WebP in ChatGPT.
- Ask ChatGPT to save it to a configured workspace at a new repository-relative path.
- Approve the write action.
- Confirm the destination exists, SHA-256 matches, and image bytes were not modified.
- Confirm traversal, absolute path, overwrite, SVG, and non-image attempts are rejected.
- Confirm no temporary download URL appears in returned output or logs.

## Known Limitations

- Live ChatGPT connector validation is still operator/manual.
- Junction creation may require Windows privileges not available in every test environment; symlink escape coverage is best-effort where fixture creation is supported.
- The tool copies only PNG, JPEG, and WebP. It does not convert, resize, crop, edit, preview, stage, commit, or overwrite.

## Version

`0.2.1`

## Commit

Committed locally with message `Add attached image workspace writer`. The final immutable commit SHA is reported in the operator handoff after this report is amended.

## Tag

To be created as `v0.2.1` after the final report amendment.

## Push Status

To be pushed after the final report amendment and `v0.2.1` tag creation.

## Release Status

Pending GitHub release publication.

## Final Git Status

Clean after implementation commit before final report amendment/tag/push.

No fallback implementation was used.
