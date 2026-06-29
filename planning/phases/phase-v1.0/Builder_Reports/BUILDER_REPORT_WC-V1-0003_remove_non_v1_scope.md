# Builder Report - WC-V1-0003 Remove Non-v1.0 Product Scope

## Repository Identity

- Repository path inspected: `C:\Users\<you>\Projects\ChampCity_GPT` (sanitized; actual local path matched the approved project path)
- Git top level: `C:/Users/<you>/Projects/ChampCity_GPT` (sanitized; actual local path matched the approved project path)
- Remote inspected: `https://github.com/ChampCityChris/ChampCity_GPT_MCP.git`
- Branch inspected: `main`
- Starting git status: clean (`git status --short` returned no output before this task)
- `AGENTS.MD`: present
- `package.json`: present

## Source Documents Reviewed

- `planning/phases/phase-v1.0/04_operator_intake_interview.md`
- `planning/phases/phase-v1.0/V1_SCOPE_DECISIONS_FROM_OPERATOR_INTAKE.md`
- `planning/phases/phase-v1.0/WORK_CARD_QUEUE_v1.0.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0001_v1_scope_decisions.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0002_v0.1.2_release_publication_baseline.md`

## Scope Decisions Confirmed

- Current Figma workflow is not v1.0 production-core and must be revisited.
- Work Cards are internal Operator/Architect/Builder planning artifacts only.
- GitHub Issues/Projects sync for Work Cards is not in v1.0 product scope.
- A2A and multi-agent workflows are deferred.
- v1.0 stays focused on ChatGPT-to-local-tools through the ChampCity MCP connector.

## Files Searched

- `AGENTS.MD`
- `README.md`
- `docs/*.md`
- `planning/**/*.md`

Generated folders, release output, `node_modules`, `dist`, logs, and binaries were not searched or modified.

## Search Terms Used

- `Figma|Figma Make|Make handoff|A2A|Agent2Agent|multi-agent|Work Cards|Work Card|GitHub Projects|GitHub Issues|Projects sync|roadmap|v1\.0|v1.0`
- `required for v1|required for v1\.0|v1\.0 requirement|v1.0 requirement|must ship|production-core|supported feature|core feature|public feature`
- `A2A|Agent2Agent|multi-agent`
- `Work Cards|Work Card|GitHub Projects|GitHub Issues|Projects sync`
- `Figma`
- `check:public|markdown|markdownlint|lint|check`

## Findings By Category

### Category A - Already Correct

- `planning/phases/phase-v1.0/V1_SCOPE_DECISIONS_FROM_OPERATOR_INTAKE.md` already states that Figma, Work Cards as product, GitHub Issues/Projects sync, and A2A are excluded or deferred from v1.0 product scope.
- `planning/phases/phase-v1.0/WORK_CARD_QUEUE_v1.0.md` already marks WC-V1-0003, WC-V1-0701, WC-V1-0702, and WC-V1-0703 as scope cleanup rather than implementation authority.
- A2A and multi-agent references were limited to the v1.0 phase documents and already described deferral.
- Work Card and GitHub Issues/Projects references were limited to the v1.0 phase documents and already described internal planning or explicit exclusion.

### Category B - Ambiguous But Not Harmful

- `docs/GITHUB_PUBLICATION_CHECKLIST.md`, `docs/RELEASE_CHECKLIST.md`, and `docs/PUBLICATION_AUDIT.md` mention generated Figma handoffs only as public-source or secret-safety review items. These do not present Figma as a v1.0 product deliverable and were left unchanged.
- `AGENTS.MD` mentions Figma only as project policy and protected-subsystem guidance. It was intentionally not modified.

### Category C - Conflicts With v1.0 Scope

- `README.md` presented Figma handoff tools in the top-level capability list and Figma section without saying they are deferred from v1.0 production-core scope.
- `docs/CHATGPT_CONNECTION_GUIDE.md` documented Figma Make and Design handoff flows without a v1.0 de-scope note.
- `docs/DESKTOP_APP_SETUP.md` described the launcher Figma controls as normal setup capabilities without a v1.0 de-scope note.
- `docs/TOOL_REFERENCE.md` listed Figma tools without a v1.0 de-scope note.
- `docs/SECURITY_MODEL.md` documented Figma token and handoff policy without clarifying that the workflow is not v1.0 production-core.
- `planning/phases/phase-v1.0/WORK_CARD_QUEUE_v1.0.md` used "Remove current Figma workflow" wording in WC-V1-0701, which could overstate the action authorized by this documentation-only card.

These were corrected with documentation-only wording. No source/app behavior was changed.

### Category D - Requires Future Implementation Cleanup

- The active docs still describe existing Figma tool exposure and launcher controls because the source/UI still contain those capabilities. This card did not remove, disable, or hide them.
- Follow-up should remain under `WC-V1-0701`, where the architect/operator can decide whether current Figma tooling should be removed, disabled, hidden, or marked experimental in product UI and tool exposure.

## Files Created

- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0003_remove_non_v1_scope.md`

## Files Modified

- `README.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `docs/DESKTOP_APP_SETUP.md`
- `docs/SECURITY_MODEL.md`
- `docs/TOOL_REFERENCE.md`
- `planning/phases/phase-v1.0/WORK_CARD_QUEUE_v1.0.md`

## Files Intentionally Not Modified

- `planning/phases/phase-v1.0/V1_SCOPE_DECISIONS_FROM_OPERATOR_INTAKE.md` because the required scope decisions were already present.
- `planning/phases/phase-v1.0/04_operator_intake_interview.md` because it is the answered operator source of truth.
- `src/**`, `electron/**`, `scripts/**`, `package.json`, `package-lock.json`, `tsconfig.json`, `config/**`, `release/**`, and `dist/**`.
- `AGENTS.MD`.
- Existing release/publication checklist references to Figma safety review.

## Follow-up Work Cards Recommended

- Continue to use `WC-V1-0701` for the future Figma implementation cleanup decision: remove, disable, hide, or mark current Figma tooling experimental.
- No new Work Card is recommended for Work Cards/GitHub Projects sync or A2A based on this pass because the active v1.0 planning docs already de-scope them.

## Commands Run And Results

- `pwd`: pass, expected project directory.
- `git rev-parse --show-toplevel`: pass, expected project root.
- `git remote -v`: pass, origin references `ChampCityChris/ChampCity_GPT_MCP`.
- `Test-Path package.json`: pass, `True`.
- `git branch --show-current`: pass, `main`.
- `git status --short`: pass at task start, no output.
- `Test-Path AGENTS.MD`: pass, `True`.
- `Get-Content AGENTS.MD`: pass, project instructions reviewed.
- `Test-Path` for all required v1.0 source documents and prior Builder Reports: pass.
- `Get-Content` for the v1.0 intake, scope decisions, queue, and prior Builder Reports: pass.
- `rg -n "Figma|Figma Make|Make handoff|A2A|Agent2Agent|multi-agent|Work Cards|Work Card|GitHub Projects|GitHub Issues|Projects sync|roadmap|v1\.0|v1.0" planning docs README.md AGENTS.MD`: pass, findings reviewed.
- `rg -n "required for v1|required for v1\.0|v1\.0 requirement|v1.0 requirement|must ship|production-core|supported feature|core feature|public feature" planning docs README.md`: pass, findings reviewed.
- `rg --files planning docs README.md AGENTS.MD`: pass, searched Markdown surface listed.
- `Select-String` reviews for Figma sections in `README.md`, `docs/CHATGPT_CONNECTION_GUIDE.md`, `docs/DESKTOP_APP_SETUP.md`, `docs/TOOL_REFERENCE.md`, and `docs/SECURITY_MODEL.md`: pass.
- Targeted `rg` searches for A2A, Work Cards/GitHub Projects, and Figma safety checklist references: pass.
- `rg -n "check:public|markdown|markdownlint|lint|check" package.json`: pass, `check:public` exists and no Markdown lint/check script was found.
- `git diff --check`: pass before and after report creation; Git emitted LF/CRLF working-copy warnings only.
- `npm run check:public`: pass before report creation, `Checked 131 source candidate files`; pass after report creation, `Checked 132 source candidate files`.
- `git status --short`: pass before report creation, listed only intended modified Markdown files; pass after report creation, listed the same modified files plus this new Builder Report.

## Validation Performed

- Repository identity and remote verification.
- Clean starting worktree verification.
- AGENTS.MD review.
- v1.0 source document existence and content review.
- Roadmap/docs search and classification.
- Documentation-only diff review.
- `git diff --check` passed before and after report creation.
- `npm run check:public` passed before and after report creation.
- `git status --short` inspected before and after report creation.

## Validation Skipped

- Markdown lint/check: skipped because `package.json` does not define a Markdown lint/check script.
- Full app build/typecheck/test: skipped because this is a documentation-only scope-control card and AGENTS.MD does not require broad validation for documentation-only changes.
- Packaging: skipped because this Work Card explicitly forbids packaging.
- Live ChatGPT connector validation: skipped because no connector behavior or MCP exposure behavior was changed.
- UI visual validation: skipped because no UI/source changes were made.

## Security And Secret Safety

- No secrets, tokens, private keys, credentials, OAuth stores, Cloudflare tokens, Figma tokens, GitHub tokens, `.env`, local config, logs, release binaries, generated package output, or private release assets were created or modified.
- Reviewed docs mention token placeholders only, not real credential values.
- `npm run check:public` passed.

## Protected Subsystems Touched

No.

This Work Card modified Markdown documentation only. It did not modify OAuth/DCR, PKCE, MCP transport, MCP tool discovery/exposure, MCP endpoint behavior, Cloudflare, runtime path/AppData config behavior, token storage, admin password handling, write-scope enforcement, server lifecycle, packaging/release configuration, Figma Make extraction architecture, preload APIs, or Electron UI source.

## Scope Changed

No.

The work stayed limited to documentation/scope-control wording and this Builder Report.

## Fallback

No fallback implementation was used.

## Final Git Status

Final `git status --short` after report creation:

```text
 M README.md
 M docs/CHATGPT_CONNECTION_GUIDE.md
 M docs/DESKTOP_APP_SETUP.md
 M docs/SECURITY_MODEL.md
 M docs/TOOL_REFERENCE.md
 M planning/phases/phase-v1.0/WORK_CARD_QUEUE_v1.0.md
?? planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0003_remove_non_v1_scope.md
```

Nothing was staged, committed, tagged, pushed, packaged, or published.

## Blockers Or Assumptions

- Blockers: none.
- Assumption: public documentation may continue to describe existing Figma tools only if it clearly marks them as deferred from v1.0 production-core scope.
