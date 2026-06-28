# AGENTS.MD

## 1. Project Identity

- Local project folder: `C:\Users\<you>\Projects\ChampCity_GPT`
- GitHub repository: `ChampCity_GPT_MCP`
- The local folder name and GitHub repo name intentionally differ.
- Do not treat that mismatch as an error.

This repository is the ChampCity GPT MCP desktop app. If the repo/path identity does not match these expectations, stop before making changes.

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
- MCP HTTP transport
- MCP tool discovery/exposure
- Cloudflare tunnel configuration
- Runtime path/AppData config behavior
- Token storage
- Server lifecycle/shutdown behavior
- Packaging/release configuration
- Git commit/push automation
- Figma Make extraction architecture

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
