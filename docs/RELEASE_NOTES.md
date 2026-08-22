# Release Notes

## v0.3.0 - Planning-corpus reliability and deterministic patch approval

- Unified repository listing and search on one safe traversal implementation with nested-directory, Windows/POSIX path, filename, path, and content matching diagnostics.
- Added source, sidecar, and derived artifact classification with backward-compatible filters and stable pagination.
- Added the read-only `artifact_toolbox.export_planning_corpus` action with deterministic manifests, SHA-256 file hashes, full-text coverage accounting, and explicit unsupported or excluded-file reporting.
- Expanded `current_action_context` diagnostics without inferring workflow authority when no structured current-action record exists.
- Removed the elevated approval-token fallback from `apply_approved_patch`; all patch applications now require an exact, live, unused proposal match in both patch and elevated modes.
- Added runtime/workspace package-version drift diagnostics and runtime promotion provenance manifest output so stale packaged deployments are visible after package-and-promote.
- Added correlated, redacted MCP tool-call tracing with `diagnostics_toolbox.recent_tool_calls`, including SDK request-ID-bound dispatch correlation, malformed receipt evidence, per-call mixed-batch scope evidence, a canonical toolbox action-policy registry, shared field-aware diagnostic redaction, sanitized/capped string JSON-RPC IDs, arbitrary absolute-path redaction, and the restored 31-schema internal registry with unchanged public toolbox exposure behavior.
- Added privacy-safe result-delivery telemetry with result-attempt IDs, serialized result dimensions, HTTP finish/close evidence, explicit diagnostic acknowledgement, delivery-status lookup, and separated contract, policy, authorization, execution, and transport failure attribution. HTTP finish is not client acknowledgement; acknowledgement is diagnostic receipt only and does not prove OpenAI host approval.
- Added bounded exact text projection for repository and Markdown artifact reads with inspect/chunk/line/section actions, 8 KiB default chunks, a 16 KiB public content-item cap, SHA-backed Markdown section IDs, integrity-protected cursors, stale-source detection, bounded planning-corpus text export, and diagnostics action-contract discovery.
- Added an independent workspace capability model so allowed non-Git project directories remain valid for reads, searches, safety diagnostics, and Markdown/JSON artifact persistence. Git status, diff, history, mutation, and release checks now report Git capability locally instead of making Git a general workspace prerequisite; runtime provenance is separated from target project metadata.
- Added focused regression coverage for traversal, artifact filtering, planning-corpus export, current-action diagnostics, and proposal-mismatch behavior.

## v0.2.0 - Purpose-built architect diagnostics

- Added fixed project validation operations for typecheck, build, tests, and release checks.
- Added MCP startup, registration, and public inventory diagnostics.
- Added fixed development and packaged Electron startup diagnostics with typed milestones and automatic shutdown.
- Added TypeScript compiler API analysis for symbols, references, imports, callers/callees, and MCP registrations.
- Added bounded read-only Git log, commit, diff, file-history, blame, merge-base, and ancestry inspection.
- Kept the stable public toolbox surface at seven toolbox tools and added one bounded top-level exception, `workspace_write_attached_image`, for ChatGPT-authorized raster image attachments. No generic command runner, shell, browser automation, arbitrary IPC, executable, argument, environment input, arbitrary URL downloader, or general file writer was added.
- `workspace_write_attached_image` requires `files.write` plus local write mode `docs`, `patch`, or `elevated`; accepts one top-level ChatGPT file parameter; validates PNG, JPEG, and WebP bytes; writes create-only to a configured workspace-relative destination; refuses overwrites; rejects path traversal, Windows unsafe paths, and symlink/junction escapes; and returns SHA-256 evidence for the exact bytes written.
- Canonical artifact verification, canonical hashing, registry validation, and workflow-state tracing remain explicitly excluded pending a separate architecture specification.

Packaged source analysis returns `source_unavailable` when repository TypeScript source is not present. Preload completion is not directly observable through the preserved preload contract; Electron diagnostics report that limitation explicitly.

## 2026-06-26 - Windows desktop app rebuild

Summary:
- Rebuilt the Windows desktop release after fixing false npm detection in the desktop app.
- Windows npm path handling now prefers `C:\Program Files\nodejs\npm.cmd`.
- `Install Dependencies` and `Build MCP Server` use the detected npm path instead of bare `npm`.

Validation passed:
- `npm run build`
- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm audit --audit-level=low` (`found 0 vulnerabilities`)

Packaging:
- Old `release/` output was deleted before packaging.
- Packaging command: `npm run app:dist`

Release artifacts:
- `C:\Users\<you>\Projects\<project>\release\ChampCity GPT MCP Launcher-0.1.0-x64.exe`
- `C:\Users\<you>\Projects\<project>\release\win-unpacked\ChampCity GPT MCP Launcher.exe`

Smoke test:
- Launched `release\win-unpacked\ChampCity GPT MCP Launcher.exe` with `CHAMPCITY_GPT_REPO_ROOT` set to this repo.
- Confirmed it stayed alive for 8 seconds and then stopped it.

