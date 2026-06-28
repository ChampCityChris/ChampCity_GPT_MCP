# Codex Figma Make File Handoff

You are Codex implementing a UI change from a deterministic local Figma Make .make export package.

Before editing files, verify the repository path and confirm you are working in the intended ChampCity GPT MCP app checkout.

## Source

- Source type: Figma Make .make export package
- Local Make file: design/figma-handoff/source_make/Review attached code.make
- Handoff directory: `design/figma-handoff/make-file`
- Target UI area: ChampCity GPT launcher UI
- Implementation scope: Create a Figma Make file handoff package and Codex prompt only. Do not implement UI changes.
- Prompt file: `docs/handoffs/CODEX_FIGMA_MAKE_FILE_HANDOFF.md`
- This is not a screenshot-based handoff.

## Required Reading

- Extraction summary: `design/figma-handoff/make-file/reports/extraction-summary.md`
- Resource inventory: `design/figma-handoff/make-file/reports/extracted-resource-inventory.md`
- Reconstruction report: `design/figma-handoff/make-file/reports/reconstruction-report.md`
- Chat history summary: `design/figma-handoff/make-file/reports/chat-history-summary.md`
- Asset inventory: `design/figma-handoff/make-file/reports/asset-inventory.md`
- Raw ai_chat.json: `design/figma-handoff/make-file/raw/ai_chat.json`

## Reconstructed Source Files

- No source files were reconstructed. Inspect the reports and raw package files before deciding whether implementation is possible.

## Asset Paths

- `design/figma-handoff/make-file/assets/thumbnail.png`
- `design/figma-handoff/make-file/assets/images/62a164eba1873c646798df98cb31e456be728345`
- `design/figma-handoff/make-file/assets/images/f5e760432df5ad4139cbff08ac415da8d9049750`
- `design/figma-handoff/make-file/assets/make_binary_files/98e3b4456f0ca1f7c14f5791f4a47a1255d091cd`
- `design/figma-handoff/make-file/assets/make_binary_files/b8a846b6081afeeb91e9be2081ba976d919fd54c`
- `design/figma-handoff/make-file/assets/make_binary_files/7c6ba0cd31db6161ec75d6f1eac7ce0281a8d48e`
- `design/figma-handoff/make-file/assets/make_binary_files/92b9bf17e9cc6455693171b2189a3b80ed44104f`
- `design/figma-handoff/make-file/assets/make_binary_files/01676f564a15446a62da45b89bd8f9b2e4a5a5ff`
- `design/figma-handoff/make-file/assets/blob_store/blob_store_references/AI_CHAT_THREAD/2842e0b6-c1c2-4286-a6ec-7e7ecd3bc6d7/THREAD_AI_CHAT_MESSAGE_CONTENT/5edb4751fa26182caeabe094332bb721555d6620/original`
- `design/figma-handoff/make-file/assets/blob_store/blob_store_references/AI_CHAT_THREAD/2842e0b6-c1c2-4286-a6ec-7e7ecd3bc6d7/THREAD_AI_CHAT_MESSAGE_CONTENT/695ac1625d6d0c9725846f94b4a8fc7ea8582f58/original`
- `design/figma-handoff/make-file/assets/blob_store/blob_store_references/AI_CHAT_THREAD/2842e0b6-c1c2-4286-a6ec-7e7ecd3bc6d7/THREAD_AI_CHAT_MESSAGE_CONTENT/9194ab235a659d47d0bcb5163afff461a6d6c004/original`
- `design/figma-handoff/make-file/assets/blob_store/blob_store_references/AI_CHAT_THREAD/2842e0b6-c1c2-4286-a6ec-7e7ecd3bc6d7/THREAD_AI_CHAT_MESSAGE_CONTENT/416f3de0d2fa78005f594e4c9244ee00de6b534d/original`
- `design/figma-handoff/make-file/assets/blob_store/blob_store_references/AI_CHAT_THREAD/2842e0b6-c1c2-4286-a6ec-7e7ecd3bc6d7/THREAD_AI_CHAT_MESSAGE_CONTENT/77a78b192b72eb83bd58d59df1eaa873fa41f92b/original`
- `design/figma-handoff/make-file/assets/blob_store/blob_store_references/AI_CHAT_THREAD/2842e0b6-c1c2-4286-a6ec-7e7ecd3bc6d7/THREAD_AI_CHAT_MESSAGE_CONTENT/c0a93f5d729b6b9118042aa86e52c1dcc772423e/original`

## Implementation Instructions

- Inspect reconstructed source and reports before coding.
- Preserve existing app functionality.
- Avoid broad refactors.
- Keep changes scoped to ChampCity GPT launcher UI.
- Verify the repo path before changing files.
- Do not modify OAuth, Cloudflare tunnel configuration, MCP authentication, Figma token storage, or server lifecycle unless specifically in scope.
- Do not expose, log, or write tokens, cookies, auth headers, credentials, or local secrets.
- If package evidence is incomplete, report the limitation clearly instead of guessing.

## Validation And Final Report

- Run typecheck, build, tests, and release/public checks relevant to the changed files.
- Report files changed.
- Report validation commands and results.
- Report any remaining extraction gaps or unresolved source reconstruction limits.

## Extraction Warnings

- make_binary_files.json was parsed, but one or more snapshot/blob references remained unresolved.

## User Notes

Use the exported .make package as the source of truth. Preserve raw package contents, assets, ai_chat history, and reconstructed source. Do not use screenshots.
