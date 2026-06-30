# Builder Report - WC-V1-0104 Live ChatGPT Connector Evidence Capture

## Repository Identity

- Repository path inspected: `C:\Users\<you>\Projects\ChampCity_GPT`
- Git top level inspected: `C:/Users/<you>/Projects/ChampCity_GPT`
- Remote inspected: `https://github.com/ChampCityChris/ChampCity_GPT_MCP.git`
- Branch inspected: `main`
- Starting git status: clean (`git status --short` returned no output before this task)
- Baseline commit present: yes, `0ed8253 test: add MCP protocol self-test`
- `AGENTS.MD`: present
- `package.json`: present

## Source Documents Reviewed

- Attached Codex prompt for `WC-V1-0104 - Add live ChatGPT connector evidence capture`
- `AGENTS.MD`
- `package.json`
- `docs/TOOL_REFERENCE.md`
- `docs/SECURITY_MODEL.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`
- `planning/phases/phase-v1.0/WORK_CARD_QUEUE_v1.0.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0101_chatgpt_connector_acceptance_matrix.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0102_chatgpt_safety_layer_false_positive_remediation.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0102A_builder_report_discovery_facade.md`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0103_mcp_protocol_self_test.md`
- `src/validation/mcpSelfTest.ts`
- `tests/mcpSelfTest.test.ts`
- `scripts/mcp-self-test.mjs`
- `scripts/check-publication-clean.ps1`

## Summary

This Work Card adds evidence capture and validation structure. It does not itself perform live ChatGPT connector validation.

Implemented a redacted Markdown evidence template, a local TypeScript validator, a CLI wrapper, focused tests, and documentation updates for operator-assisted live ChatGPT connector validation.

## Files Created

- `planning/phases/phase-v1.0/Live_Connector_Evidence/README.md`
- `planning/phases/phase-v1.0/Live_Connector_Evidence/CHATGPT_LIVE_CONNECTOR_EVIDENCE_TEMPLATE.md`
- `scripts/validate-chatgpt-evidence.mjs`
- `src/validation/chatgptEvidence.ts`
- `tests/chatgptEvidence.test.ts`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104_live_chatgpt_connector_evidence_capture.md`

## Files Modified

- `package.json`
- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `docs/SECURITY_MODEL.md`
- `docs/TOOL_REFERENCE.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`
- `planning/phases/phase-v1.0/WORK_CARD_QUEUE_v1.0.md`

## Evidence Format Created

- Markdown template path: `planning/phases/phase-v1.0/Live_Connector_Evidence/CHATGPT_LIVE_CONNECTOR_EVIDENCE_TEMPLATE.md`
- Evidence folder README path: `planning/phases/phase-v1.0/Live_Connector_Evidence/README.md`
- The template separates local deterministic baseline evidence from live ChatGPT connector evidence.
- The template captures CAV-007 through CAV-011 setup/discovery evidence, safe tool-call evidence, denied unsafe/gated-call evidence, safety-layer regression evidence, redaction review, CAV-031 diagnostic safety, and release-gate summary.
- The template instructs operators to use redacted placeholders such as `%USERPROFILE%`, `%TEMP%`, `<REDACTED_LOCAL_PATH>`, `<REDACTED_PUBLIC_ENDPOINT>`, and `<REDACTED_SECRET>`.

## Validator Command Added

```powershell
npm run chatgpt:evidence:validate -- --template
npm run chatgpt:evidence:validate -- --template --json
npm run chatgpt:evidence:validate -- --file planning/phases/phase-v1.0/Live_Connector_Evidence/<evidence-file>.md
npm run chatgpt:evidence:validate -- --dir planning/phases/phase-v1.0/Live_Connector_Evidence
```

The CLI imports the built validator from `dist/src/validation/chatgptEvidence.js`, matching the existing compiled-validator pattern used by `npm run mcp:self-test`.

## Required Sections Implemented

- Validation metadata
- Local deterministic baseline
- Live ChatGPT setup evidence
- Live tools/list evidence
- Live successful safe tool-call evidence
- Live denied unsafe/gated-call evidence
- Safety-layer regression evidence
- Failure classification
- Redaction checklist
- Final release-gate summary

## Redaction Checks Implemented

The validator fails evidence containing obvious:

- OpenAI-style token-looking content
- GitHub token-looking content
- Figma token-looking content
- Cloudflare token-looking content where detectable
- raw access-token, refresh-token, authorization-code, client-secret, or password assignment text
- private Windows, macOS, or Linux user paths
- `.env`-style secret assignment lines
- private-key material

The validator reports rule IDs and failure classes, not matched secret text.

## Tests Added Or Updated

- Added `tests/chatgptEvidence.test.ts`.

Focused coverage verifies:

- Template contains all required sections.
- Template mentions all required CAV IDs.
- Template mentions all required safe replacement tools.
- Validator passes the template in template mode.
- Validator fails token-looking evidence.
- Validator fails private local user path evidence.
- Validator fails evidence missing a required section.
- Validator fails evidence missing a required CAV reference.
- Validator permits safe placeholders.
- JSON CLI output includes `ok`, `summary`, and `checks`.

## Documentation Updated

- `docs/CHATGPT_CONNECTION_GUIDE.md`
- `docs/SECURITY_MODEL.md`
- `docs/TOOL_REFERENCE.md`
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`
- `planning/phases/phase-v1.0/WORK_CARD_QUEUE_v1.0.md`

Docs now state:

- live ChatGPT validation evidence must be captured manually or from explicit ChatGPT tool results;
- no screenshots, browser scraping, or ChatGPT UI scraping are required or supported by this Work Card;
- the evidence template lives under `planning/phases/phase-v1.0/Live_Connector_Evidence/`;
- the validator command is `npm run chatgpt:evidence:validate`;
- local MCP self-test evidence does not replace live evidence;
- WC-V1-0104 supports CAV-007 through CAV-011 and CAV-027 through CAV-031, and also helps CAV-033.

## Validation Commands And Results

- `pwd`: pass, current directory matched the approved project path.
- `git rev-parse --show-toplevel`: pass, git root matched the approved project root.
- `git remote -v`: pass, origin references `ChampCityChris/ChampCity_GPT_MCP`.
- `git branch --show-current`: pass, returned `main`.
- `git status --short`: pass at task start, no output.
- `git log --oneline -8`: pass, latest history included `0ed8253`.
- `Test-Path AGENTS.MD`: pass, returned `True`.
- `Test-Path package.json`: pass, returned `True`.
- `node --check scripts/validate-chatgpt-evidence.mjs`: pass.
- `npm run typecheck`: pass.
- `npm run build`: initial sandboxed run failed on esbuild `spawn EPERM`; approved rerun passed.
- `npm run chatgpt:evidence:validate -- --template`: pass, 7 checks passed, 0 failed.
- `npm run chatgpt:evidence:validate -- --template --json`: pass, emitted valid JSON with `ok: true`.
- `npm run lint`: pass.
- `npm run check:public`: pass, 148 source candidate files checked before this report was created.
- `npm test`: pass on approved run because the test script builds through esbuild; 247 tests passed, 0 failed.
- `npm run mcp:self-test`: pass, 14 checks passed, 0 failed.
- `npm run mcp:self-test -- --json`: pass, emitted valid JSON with `ok: true`, 14 passed, 0 failed.
- `git diff --check`: pass; Git printed LF/CRLF working-copy warnings only.
- `git status --short`: inspected before this report was created.
- Final `npm run typecheck` after this report was created: pass.
- Final `npm run lint` after this report was created: pass.
- Final `npm run check:public` after this report was created: pass, 149 source candidate files checked.
- Final `npm run chatgpt:evidence:validate -- --template` after this report was created: pass, 7 checks passed, 0 failed.
- Final `npm run chatgpt:evidence:validate -- --template --json` after this report was created: pass, emitted valid JSON with `ok: true`.
- Final `npm run build` after this report was created: pass on approved run because the renderer build invokes esbuild.
- Final `npm test` after this report was created: pass on approved run; 247 tests passed, 0 failed.
- Final `npm run mcp:self-test` after this report was created: pass, 14 checks passed, 0 failed.
- Final `npm run mcp:self-test -- --json` after this report was created: pass, emitted valid JSON with `ok: true`, 14 passed, 0 failed.
- Final `git diff --check` after this report was created: pass; Git printed LF/CRLF working-copy warnings only.
- Final `git status --short` after this report was created: inspected.

## Validation Skipped And Reasons

- Live ChatGPT validation was not performed in this Builder pass. This Work Card adds the evidence capture template and validator used by a later operator-assisted live validation pass.
- Packaging was skipped because this Work Card explicitly forbids packaging.
- Browser automation, ChatGPT UI scraping, and screenshots were skipped because this Work Card explicitly forbids them.
- OAuth/DCR, Cloudflare, release publication, tag, push, upload, signing, and packaging validation were skipped because this Work Card does not authorize mutation or implementation in those areas.

## Live ChatGPT Validation Status

Live ChatGPT validation was not performed in this Builder pass. This Work Card adds the evidence capture template and validator used by a later operator-assisted live validation pass.

## Protected Subsystems Touched

No.

This Work Card did not modify OAuth/DCR behavior, OAuth behavior, PKCE behavior, MCP HTTP transport, MCP tool discovery/exposure, MCP endpoint behavior, public MCP endpoint behavior, Cloudflare tunnel configuration or behavior, runtime path/AppData config behavior, local config persistence behavior, token/session storage, admin password handling, files.write/write-scope enforcement, server lifecycle/shutdown/start/stop/restart behavior, packaging/release configuration, Figma Make extraction architecture, preload API contracts, or the `window.champcity` API shape.

## Security Controls Preserved

- No live evidence file with secrets was created.
- No screenshots, browser automation, UI scraping, network scraping, clipboard automation, or fallback capture path was added.
- No OAuth material, Cloudflare token, GitHub token, Figma token, local config, `.env` contents, release binary contents, or credential store contents were collected.
- Existing public safety scanning, blocked-path policy, OAuth scope checks, local write mode, and approval gates were not changed.
- The validator avoids echoing matched secret text in reports.

## Residual Risks

- The validator is a conservative text scanner and cannot prove every possible secret is absent.
- Template validation proves only structure and obvious redaction safety, not that a live operator pass occurred.
- Live ChatGPT safety-layer behavior remains unproven until the operator runs a real ChatGPT connector validation pass and records redacted evidence.

## Recommended Next Work Card

`WC-V1-0401 - Harden OAuth/DCR as the sole public connector path`, or an operator-assisted live validation pass using the WC-V1-0104 evidence template if the current runtime is ready.

## Scope And Fallback

- Scope changed during implementation: no.
- No fallback implementation was used.

## Staging, Commit, Tag, Release, And Packaging State

- Nothing was staged.
- Nothing was committed.
- Nothing was tagged.
- Nothing was pushed.
- Nothing was packaged.
- Nothing was published or uploaded.

## Final Git Status

```text
 M docs/CHATGPT_CONNECTION_GUIDE.md
 M docs/SECURITY_MODEL.md
 M docs/TOOL_REFERENCE.md
 M package.json
 M planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md
 M planning/phases/phase-v1.0/WORK_CARD_QUEUE_v1.0.md
?? planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0104_live_chatgpt_connector_evidence_capture.md
?? planning/phases/phase-v1.0/Live_Connector_Evidence/
?? scripts/validate-chatgpt-evidence.mjs
?? src/validation/chatgptEvidence.ts
?? tests/chatgptEvidence.test.ts
```
