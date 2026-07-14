# Builder Report - MCP Image Evidence Reader

Title: Add constrained `artifact_toolbox.read_image_artifact` action
Branch: `dev`
Repository: `ChampCity_GPT_MCP`
Starting commit: `b7c5f7daf74f310afa562eee0cd8b3a307bb4e22`

## Implementation Summary

Added the allowlisted `read_image_artifact` action under the existing public `artifact_toolbox`. The action returns a short MCP text content item, an MCP image content item containing the PNG bytes as base64, and structured metadata containing the normalized workspace-relative path, canonical workspace ID, MIME type, byte size, dimensions, SHA-256, and last-modified timestamp.

The existing top-level public tool surface remains the same seven toolboxes. No separate binary-read tool was added. The response wrapper was changed narrowly so an explicitly rich toolbox result can supply MCP content and structured content; existing text-only toolbox responses are unchanged.

PNG is the only supported format in this pass. JPG/JPEG and WebP were optional and were not added.

## Files Changed

- `src/tools/readImageArtifact.ts`
- `src/tools/domainToolboxes.ts`
- `src/server/registerTools.ts`
- `tests/domainToolboxes.test.ts`
- `docs/TOOL_REFERENCE.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `docs/SECURITY_MODEL.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_MCP_IMAGE_EVIDENCE_READER.md`

Pre-existing user changes in `AGENTS.MD`, `package.json`, `docs/dev/`, and `scripts/codex-validate.ps1` were preserved and were not implementation changes made for this pass.

## Security Constraints Added

- Accepts only `workspaceId` plus strict action params `path` and optional `maxBytes`.
- Requires a workspace-relative path and rejects absolute paths, drive paths, UNC paths, null bytes, colons, and any `..` segment through the existing path policy.
- Resolves the selected workspace only from configured workspace routing.
- Resolves the real final file path and verifies it remains inside the selected workspace root.
- Applies the approved artifact-directory policy to both the requested relative path and the normalized final relative path.
- Approved top-level directories are `planning/`, `evidence/`, `artifacts/`, `Builder_Reports/`, `release/`, `reports/`, `validation/`, and `screenshots/`.
- Reuses the central blocked-file policy and adds image-specific denials for secret, credential, dependency-cache, browser-profile, `.git`, `node_modules`, and related sensitive directory segments.
- Supports only `.png` and validates PNG signature plus the required IHDR header before returning content.
- Requires a regular readable file.
- Enforces a hard 5,000,000-byte maximum. `maxBytes` can lower but cannot raise that ceiling.
- Produces controlled toolbox errors for unsafe paths, unsupported types, oversized files, spoofed PNGs, missing files, and non-files.
- Keeps base64 bytes only in the MCP image content item. Text and structured metadata do not contain base64.
- Performs no OCR, image interpretation, or AI analysis.
- Adds no dependency.

## Tests Added

`tests/domainToolboxes.test.ts` now covers:

- Valid PNG evidence returns MCP text plus image content.
- MCP result matches `CallToolResultSchema`.
- Returned MIME type is `image/png`.
- Base64 is absent from text and structured metadata.
- Metadata includes normalized path, workspace ID, size, dimensions, SHA-256, and last-modified timestamp.
- `../` traversal rejection.
- Absolute path rejection.
- Non-evidence directory rejection.
- Secret directory rejection.
- Unsupported extension rejection.
- Default hard-limit rejection using a 5,000,001-byte file.
- Extension spoofing rejection through PNG magic/header validation.
- Final real path outside the workspace rejection through a directory link fixture.
- Missing file controlled-error behavior.

## Validation Commands And Results

Execution lane: documented normal Windows lane via `docs/dev/VALIDATION_COMMAND_LANES.md` and `scripts/codex-validate.ps1`.

- Repository identity checks: PASS.
  - Working directory: `%USERPROFILE%\Projects\ChampCity_GPT`
  - Git toplevel: `%USERPROFILE%\Projects\ChampCity_GPT`
  - Remote: `https://github.com/ChampCityChris/ChampCity_GPT_MCP.git`
  - `package.json`: present
- `npm run typecheck`: initial run found one TypeScript helper-parameter mismatch; the helper type was corrected. Final rerun: PASS.
- `npm run validate:codex`: PASS.
  - Wrapper invoked `npm test`: PASS, 273 tests passed, 0 failed.
  - `npm test` invoked the build before tests: PASS.
  - Wrapper invoked final `npm run build`: PASS.
- `git diff --check`: PASS with existing Windows LF-to-CRLF warnings only.
- No sandbox-only `spawn EPERM` failure occurred. All required results were obtained in the approved lane.

## Validation Not Performed

- Live ChatGPT connector discovery/call validation was not performed; it requires operator validation in a fresh ChatGPT conversation against the running connector.
- Subjective screenshot interpretation was not performed by Codex.
- Packaging, executable launch, runtime promotion, signing, publication, staging, commit, and push were not requested and were not performed.
- JPG/JPEG and WebP validation was not performed because those optional formats were not implemented.

## Manual ChatGPT And Operator Validation

1. Start the development MCP server using the operator's normal runtime workflow and connect it to ChatGPT.
2. In a new ChatGPT conversation, call `artifact_toolbox.builder_report_index` or `builder_report_summary` for a validation report that references a PNG screenshot.
3. Call `artifact_toolbox` with `action: "read_image_artifact"`, the correct `workspaceId`, and the reported repository-relative PNG path in `params.path`.
4. Confirm ChatGPT receives and can describe the visible UI/content in the returned image.
5. Confirm the tool result includes a short text summary and structured metadata, while chat text does not contain the base64 payload.
6. Confirm calls using `../`, an absolute path, a non-image file, an unsupported directory, and a spoofed `.png` are rejected.

Live ChatGPT visibility is required before claiming the connector acceptance criterion is complete.

## Remaining Phase Review

Review whether PDF screenshot evidence, generated browser screenshots, and release-package screenshots should share one artifact path convention. This pass does not expand the action into PDF handling or general file reading.

## Protected Subsystems, Scope, Assumptions, And Fallbacks

- Protected subsystem touched: MCP tool exposure/response handling, explicitly authorized by this task. No OAuth, PKCE, Cloudflare, token storage, write-scope enforcement, lifecycle, runtime-path, preload API, or packaging behavior was changed.
- Scope did not change during implementation.
- Assumption: PNG-only support satisfies the required format; JPG/JPEG and WebP were optional.
- No blockers remain for local implementation and deterministic validation. Live ChatGPT validation remains operator-owned.
- No fallback implementation was used.
