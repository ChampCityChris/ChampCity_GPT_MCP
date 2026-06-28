# Codex Prompt — Fix `run_figma_make_file_handoff` Path/Root Resolution

## Role

You are the Builder for the ChampCity GPT MCP desktop app. Treat ChatGPT/operator instructions and repository governance files as architectural direction. Do not redesign the workflow.

## Repository and working directory

Work only in this repository:

```text
C:\Users\<you>\Projects\ChampCity_GPT
```

GitHub repository name:

```text
ChampCity_GPT_MCP
```

The local folder name and GitHub repository name intentionally differ. Do not treat that mismatch as an error.

## Required first steps

1. Verify the working directory is exactly:

   ```text
   C:\Users\<you>\Projects\ChampCity_GPT
   ```

2. Read and follow the root-level `AGENTS.MD` before coding.
3. Inspect the implementation of these tools/path helpers before changing code:
   - `run_figma_make_file_handoff`
   - `list_project_files`
   - `read_project_file`
   - any shared allowed-root/path-resolution utilities used by those tools
4. Confirm why `list_project_files` can see the `.make` file but `run_figma_make_file_handoff` rejects the same file with an allowlist/root mismatch.

## Problem statement

`run_figma_make_file_handoff` fails before writing any handoff artifacts when given a valid `.make` file located inside the configured project root.

Known valid project root:

```text
C:\Users\<you>\Projects\ChampCity_GPT
```

Known valid `.make` file:

```text
C:\Users\<you>\Projects\ChampCity_GPT\design\figma-handoff\source_make\Review attached code.make
```

`list_project_files` successfully sees the same file at:

```text
design/figma-handoff/source_make/Review attached code.make
```

But `run_figma_make_file_handoff` fails with:

```text
Requested root is not in the configured allowlist.
```

This is a tool-side path/root/allowlist resolution bug. It is not a missing file, not a write-mode problem, not an OAuth/DCR problem, and not a ChatGPT MCP discovery problem.

## Scope

Fix only `run_figma_make_file_handoff` path resolution so it uses the same configured allowed-root/path-resolution logic as `list_project_files` and `read_project_file`.

The tool must accept a `.make` file inside the configured project root by:

1. Absolute Windows path:

   ```text
   C:\Users\<you>\Projects\ChampCity_GPT\design\figma-handoff\source_make\Review attached code.make
   ```

2. Root-relative path, preferably:

   ```text
   design/figma-handoff/source_make/Review attached code.make
   ```

Output paths must remain relative to the configured project root:

```text
design/figma-handoff/make-file
docs/handoffs/CODEX_FIGMA_MAKE_FILE_HANDOFF.md
```

## Explicit non-goals

Do not perform feature work.

Do not change Figma extraction architecture.

Do not change OAuth, DCR, MCP discovery, Cloudflare, endpoint routing, server lifecycle, or connector registration.

Do not add screenshot fallback, browser scraping, network scraping, clipboard automation, or Figma Make-to-Design conversion.

Do not implement UI changes.

Do not weaken allowed-root, traversal, extension, file-size, regular-file, symlink, or blocked-file safety checks.

Do not make local tests the only acceptance criterion for MCP exposure work. This task is narrower: it only fixes the local path/root resolution bug for an already exposed tool.

## Expected tool call after fix

The following call should no longer fail with an allowlist/root mismatch:

```json
{
  "makeFilePath": "C:\\Users\\<you>\\Projects\\ChampCity_GPT\\design\\figma-handoff\\source_make\\Review attached code.make",
  "targetUiArea": "ChampCity GPT launcher UI",
  "implementationScope": "Create a Figma Make file handoff package and Codex prompt only. Do not implement UI changes.",
  "outputDirectory": "design/figma-handoff/make-file",
  "codexPromptFile": "docs/handoffs/CODEX_FIGMA_MAKE_FILE_HANDOFF.md",
  "notes": "Use the exported .make package as the source of truth. Preserve raw package contents, assets, ai_chat history, and reconstructed source. Do not use screenshots."
}
```

Root-relative input should also work, unless there is a documented and justified reason it cannot:

```json
{
  "makeFilePath": "design/figma-handoff/source_make/Review attached code.make",
  "targetUiArea": "ChampCity GPT launcher UI",
  "implementationScope": "Create a Figma Make file handoff package and Codex prompt only. Do not implement UI changes.",
  "outputDirectory": "design/figma-handoff/make-file",
  "codexPromptFile": "docs/handoffs/CODEX_FIGMA_MAKE_FILE_HANDOFF.md",
  "notes": "Use the exported .make package as the source of truth. Preserve raw package contents, assets, ai_chat history, and reconstructed source. Do not use screenshots."
}
```

## Required implementation guidance

Use the existing repository path/root safety model. Prefer refactoring `run_figma_make_file_handoff` to call the same helper used by `list_project_files` and/or `read_project_file` rather than creating a second independent resolver.

The resolver should:

1. Resolve configured allowed project roots consistently.
2. Accept absolute paths only when the canonical resolved file is inside an allowed root.
3. Accept root-relative paths when they resolve inside the selected/configured project root.
4. Preserve filenames with spaces.
5. Reject path traversal.
6. Reject files outside the configured root.
7. Reject missing files with a clear missing-file error.
8. Reject non-`.make` files with a clear extension/type error.
9. Keep output directories and prompt files root-relative, not absolute.
10. Reject absolute output paths with the existing safety behavior.

## Required tests

Add or update focused tests for `run_figma_make_file_handoff` path resolution covering:

1. Absolute `.make` path inside configured root is accepted.
2. Root-relative `.make` path inside configured root is accepted.
3. Filename with spaces is accepted.
4. Outside-root absolute path is rejected.
5. Path traversal input is rejected.
6. Missing `.make` file is rejected with a clear missing-file error.
7. Non-`.make` file is rejected.
8. Absolute output directory is rejected.
9. Absolute Codex prompt output path is rejected.
10. Relative output directory is accepted.
11. Relative Codex prompt output path is accepted.

Use targeted tests. Do not add broad unrelated test suites.

## Validation

Run the minimal relevant validation commands defined by the project and `AGENTS.MD` for this path-resolution change.

At minimum, validation evidence should show:

1. The new/updated tests pass.
2. `list_project_files` still lists:

   ```text
   design/figma-handoff/source_make/Review attached code.make
   ```

3. `run_figma_make_file_handoff` no longer fails with:

   ```text
   Requested root is not in the configured allowlist.
   ```

Acceptance does not require the `.make` parser to successfully reconstruct every asset/source file if there is a real package-content/parser issue after path resolution. If parsing fails later, the error must be honest and specific to parser/content handling, not root/allowlist mismatch.

## Acceptance definition

This task is complete when `run_figma_make_file_handoff` can create the handoff package and Codex prompt from the valid `.make` file inside the project root, or when it reaches a genuine parser/content error after correctly resolving the file.

It must not fail with an allowlist/root mismatch for a `.make` file inside:

```text
C:\Users\<you>\Projects\ChampCity_GPT
```

## Deliverables

1. Code changes limited to path/root resolution for `run_figma_make_file_handoff` and any shared helper needed to align it with existing file tools.
2. Focused tests listed above.
3. Validation summary with exact commands run and results.
4. Git diff summary.
5. No commits unless explicitly instructed by the operator.
