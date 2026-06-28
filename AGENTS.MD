# AGENTS.MD

## 1. Project Identity

- Local project folder: `C:\Users\<you>\Projects\ChampCity_GPT`
- GitHub repository: `ChampCity_GPT_MCP`
- The local folder name and GitHub repo name intentionally differ.
- Do not treat that mismatch as an error.

This repository is the ChampCity GPT MCP desktop app. If the repo/path identity does not match these expectations, stop before making changes.

Before editing, Codex must verify:

- The current working directory is `C:\Users\<you>\Projects\ChampCity_GPT`.
- `git rev-parse --show-toplevel` resolves to `C:\Users\<you>\Projects\ChampCity_GPT`.
- `git remote -v` references the expected `ChampCity_GPT_MCP` repository.
- `package.json` is present.

## 2. Role Boundaries

- Codex is the implementation agent.
- The user/operator and ChatGPT/architect define requirements and architecture.
- Codex is the builder, not the product owner, designer, or architect.
- Codex must not redesign product behavior unless explicitly asked.
- Codex must not reinterpret the goal into a different architecture.
- Codex must not choose fallback architectures without approval.
- Codex must not expand scope to adjacent bugs unless explicitly instructed.

## 3. Scope Discipline

- Implement only the task requested in the prompt.
- Do not fix unrelated issues found during investigation.
- Do not refactor unrelated modules.
- Do not "clean up" nearby code unless required for the requested task.
- Do not alter OAuth, MCP transport, Cloudflare, runtime paths, packaging, or token storage unless the prompt explicitly scopes those areas.
- If the requested change appears to require touching a protected subsystem, stop and report before coding.

Protected subsystems:

- OAuth and Dynamic Client Registration
- OAuth behavior
- PKCE behavior
- MCP HTTP transport
- MCP tool discovery/exposure
- MCP endpoint behavior
- Public MCP endpoint behavior, including the operator-configured production `/mcp` endpoint
- Cloudflare tunnel configuration
- Cloudflare tunnel behavior
- Runtime path/AppData config behavior
- Local config persistence behavior
- Token storage
- Token/session storage
- Admin password handling
- files.write / write-scope enforcement
- Server lifecycle/shutdown behavior
- Server start/stop/restart behavior
- Packaging/release configuration
- Git commit/push automation
- Figma Make extraction architecture
- Existing preload API contracts
- Existing `window.champcity` API shape

## 4. Fallback Policy

Fallbacks are not allowed unless explicitly approved by the architect/operator before implementation.

- Codex must not implement screenshot fallback, browser scraping, network scraping, clipboard automation, Figma Design conversion, metadata-only fallback, or alternate flows unless the prompt explicitly authorizes that fallback.
- If the primary requested approach is blocked, Codex must stop and report the blocker.
- A fallback working is not a valid substitute for the requested architecture.
- Do not treat "partial" as success unless the prompt explicitly defines partial success criteria.

## 5. Validation Policy

- Codex should perform only validation appropriate to the requested change.
- Documentation-only changes do not require build/package/test unless explicitly requested.
- Source-code changes should run the smallest relevant validation first.
- Broad validation such as full test suite, release checks, packaging, or executable launch should only be run when the prompt requests it or when the touched subsystem requires it.
- External workflow validation is primarily performed by the operator when visual/manual confirmation is required.
- Codex must not claim user-visible behavior is fixed unless it was actually validated in the relevant environment.
- Local tests are not a substitute for real ChatGPT connector validation when the task concerns ChatGPT MCP exposure.
- Packaged app validation is not a substitute for dev validation, and dev validation is not a substitute for packaged validation.
- Codex must not attempt subjective visual validation.
- Codex does not have reliable visual judgment and must not spend extended time using Playwright, screenshot comparison loops, browser automation, image matching, or repeated visual retries to decide whether a UI matches a design.
- Playwright must not be installed or used unless explicitly authorized by the operator for a specific task.
- For UI tasks, Codex may run deterministic checks such as build, typecheck, lint, unit tests, and existing repo-defined validation commands.
- Codex may produce deterministic artifacts for operator review only when the repo already has a scripted path for doing so, but Codex must not judge visual fidelity.
- Human/operator approval is required for Electron UI layout, design fidelity, screenshots, and subjective visual quality.
- If a task requires visual approval, Codex must clearly list the operator validation steps and stop.

Packaging validation policy:

- For ChampCity MCP / ChampCity_GPT, a successful Windows packaging run requires the final distributable executable under `release`.
- `release\win-unpacked\*.exe` is an intermediate artifact only and must never be reported as packaging success unless the task explicitly asks for an unpacked build.
- `.nsis.7z` files are intermediate Electron Builder artifacts and must never be reported as final packaging success.
- The final executable must match the current package version.
- Stale final executables from previous runs must not be treated as success.
- Builder must report final executable path, LastWriteTime, size, and SHA-256 hash when practical.
- Builder must report processes left running after packaging.
- Builder must not publish, upload, sign, stage, commit, or push unless explicitly instructed.
- Do not run the active development MCP server from `release*.exe`.
- The `release` folder is packaging output and must remain overwriteable.
- During development, run the copied runtime executable from `C:\Users\<you>\Apps\ChampCity_GPT_MCP_Runtime\ChampCity GPT MCP Launcher-live.exe`.
- If `release*.exe` is running and locking packaging, Builder must report that the operator should close it once and switch to the runtime copy workflow.
- The runtime copy is not a packaging success artifact.
- Packaging success still requires a final versioned portable executable under `release`.
- Only after successful packaging should the runtime copy be refreshed with `npm run app:promote-runtime`.
- Do not run two launcher instances on port 3333 simultaneously.

## 6. Operator Visual Validation

- The operator performs final visual and interactive validation.
- Codex should provide clear validation steps for the operator rather than pretending to complete visual validation it cannot perform.
- For UI changes, Codex must report what changed and what the operator should visually inspect.
- For ChatGPT/MCP changes, Codex must report what the operator should verify in a new ChatGPT conversation.
- For packaged executable changes, Codex must report the exact executable path and LastWriteTime only if packaging was explicitly requested.

## 7. Stop Conditions

Codex must stop and report instead of coding if:

- Requirements are ambiguous.
- The prompt conflicts with `AGENTS.MD`.
- Implementation requires a fallback not explicitly approved.
- Implementation requires touching protected subsystems outside scope.
- The repo/path identity does not match expectations.
- The current app state suggests the task depends on unresolved connection/runtime instability.
- Validation cannot prove the requested acceptance criteria.
- Codex would need to fabricate missing data, source files, screenshots, or extraction results.

## 8. Reporting Requirements

Every Codex final report must include:

- Files changed
- Whether any protected subsystem was touched
- Whether scope changed during implementation
- Validation performed
- Validation not performed
- Remaining operator validation steps
- Blockers or assumptions
- Whether any fallback was used

If no fallback was used, say:

`No fallback implementation was used.`

If a fallback would have been useful but was not authorized, say:

`A fallback may be possible, but was not implemented because architect/operator approval was not provided.`

## 9. Git Policy

- Do not stage, commit, or push unless explicitly instructed.
- Do not run commit/push tools as part of normal implementation.
- Leave changes unstaged unless the prompt explicitly requests staging.
- Report git status at the end only if requested or relevant.

## 10. Minimal Change Policy

- Prefer small, surgical changes.
- Prefer existing project conventions over new patterns.
- Prefer deleting incorrect experimental code over layering new compatibility paths.
- Do not add new dependencies without explicit approval.
- Do not introduce broad abstractions for one-off tasks.
- Do not convert a bug fix into a redesign.

## 11. Figma-Specific Policy

- Figma Make URL extraction primary path is official Figma MCP resource extraction when that route is being worked.
- Figma Make file fallback path is local `.make` package parsing.
- Screenshots are not an approved Figma Make fallback unless explicitly authorized.
- Browser scraping, network scraping, clipboard automation, and manual Make-to-Design conversion are not approved unless explicitly authorized.
- `.make` package parsing must preserve raw contents and report reconstruction uncertainty honestly.
- Do not fabricate missing Make source or design data.

## 12. MCP-Specific Policy

- For MCP tool exposure work, the acceptance standard is real ChatGPT visibility, not only local tests.
- A namespace visible with zero tools is a failure state.
- Internal tool registration is not the same as ChatGPT-facing tool exposure.
- Doctor UI must not claim a tool is available unless it is available in the relevant exposure path.
- Do not conflate local elevated write mode with OAuth-granted write scope.

## 13. Tone and Execution

- Be direct.
- Do not over-explain.
- Do not provide optimistic claims without evidence.
- Do not mark work complete when acceptance criteria are not met.
- Ask for clarification or stop with a blocker report when necessary.
