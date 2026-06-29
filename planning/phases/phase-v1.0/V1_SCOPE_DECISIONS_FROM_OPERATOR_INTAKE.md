# ChampCity GPT MCP v1.0 Scope Decisions From Operator Intake

Review date: 2026-06-29

## Source

Primary source reviewed:

- `planning/phases/phase-v1.0/04_operator_intake_interview.md`

The source file contains answered operator intake questions for v1.0 roadmap direction. The unanswered questionnaire alone was not used.

## Summary Of Operator Answers

1. Primary v1.0 users are public users.
2. ChampCity GPT MCP is a local developer/operator tool for the Operator/Architect/Builder workflow, giving ChatGPT.com controlled access to local project repositories.
3. v1.0 succeeds when ChatGPT.com can interact with project repositories without operator intervention for document transfer, GitHub source-control/release workflows, and Builder code review; when it works consistently within ChatGPT.com's safety layer; and when setup is accessible to users unfamiliar with CLI or advanced networking.
4. ChatGPT.com connector reliability is the highest-priority workflow.
5. The assumed user skill level is semi-technical.
6. "Operator never manually manages git" is a hard v1.0 product requirement.
7. Additional modes are acceptable if they improve security and defensive tool calls.
8. Important workflows should become purpose-built tools instead of arbitrary allowlisted command execution.
9. ChatGPT-initiated writes may include high-impact actions, but elevated script execution should be prohibited.
10. Tamper-evident audit logs are required for release, write, and elevated operations.
11. Live ChatGPT connector support is mandatory; the app ceases to have a function without it.
12. Cloudflare tunnel persistence after reboot is a v1.0 requirement.
13. ChatGPT is the only required MCP host for v1.0 validation.
14. OAuth/DCR should be the only supported public connector path unless another method is needed to solve ChatGPT safety-layer issues.
15. Codex-assisted GitHub Release publication is acceptable, but ChatGPT/MCP-managed publication is strongly preferred.
16. Code signing, installer generation, and auto-update should ship with v1.0.
17. Release assets should include an executable and/or installer, checksums, release notes, and validation reports.
18. Release cadence should be milestone-based.
19. UI priority is simple guided setup.
20. The Dashboard should become the operational home base.
21. The app should provide one-click Doctor/Fix actions.
22. Generated Builder/Codex prompts may remain fallback artifacts, but the core feature is MCP access that lets ChatGPT serve as Architect.
23. Figma tools must be revisited because the current implementation is not the correct workflow and does not serve a v1.0 purpose.
24. Work Cards are for another product, not a ChampCity MCP app feature; they remain internal planning artifacts only.
25. v1.0 should stay focused on ChatGPT-to-local-tools; A2A may be a future feature.

## v1.0 Product Positioning

ChampCity GPT MCP v1.0 is a public-user-ready local developer/operator tool. It is not a general MCP launcher, not a release/governance workstation by itself, and not a Work Card product. Its primary job is to let ChatGPT.com act as Architect while safely reading and writing project repository documentation and coordinating local repository workflows through purpose-built MCP tools.

The product should reduce manual operator work for:

- repository documentation transfer;
- Builder/Codex code review intake and evidence;
- source-control operations;
- release preparation and publication;
- connector setup, diagnosis, and repair.

## v1.0 Target User

Primary target users:

- public users;
- semi-technical operators;
- users who should not need routine CLI, manual git, or advanced networking knowledge.

The setup and operating model must assume the user may understand the concept of repositories and releases but should not be expected to manually manage git, Cloudflare tunnel details, OAuth/DCR setup internals, or release asset hygiene.

## v1.0 Success Outcomes

v1.0 must deliver:

- reliable live ChatGPT.com connector operation;
- safe ChatGPT-to-local repository workflows;
- no normal dependency on operator-managed git;
- purpose-built source-control and release workflows;
- ChatGPT safety-layer-compatible tool naming, descriptions, schemas, and behavior;
- simple guided setup for semi-technical public users;
- persistent public connector reachability after reboot;
- release distribution suitable for public users.

## Security And Permission Decisions

Security decisions locked by intake:

- Operator-free git is mandatory for the normal v1.0 path.
- Core workflows must be purpose-built tools rather than arbitrary shell execution.
- Elevated script execution is excluded from normal ChatGPT-facing workflows.
- Tamper-evident audit logs are required for write, release, and elevated operations.
- Repository identity must be enforced before mutation.
- Secret, `.gitignore`, and public-source safety scanning are v1.0 blockers.
- Additional permission modes are acceptable when they reduce risk.

Recommended permission/toolset direction for later Work Cards:

- read-only diagnostics and readiness;
- docs-only writes for planning/report artifacts;
- patch proposal and approved patch application;
- purpose-built source-control actions;
- purpose-built release-publication actions;
- local-only administrative actions that are not exposed as arbitrary ChatGPT command execution.

Excluded from normal public ChatGPT-facing workflows:

- arbitrary shell execution;
- elevated scripts;
- unrestricted filesystem writes;
- unsafe git reset/checkout/force-push patterns;
- broad command allowlisting as a substitute for purpose-built tools.

## Connector And Transport Decisions

Connector and transport decisions:

- Live ChatGPT connector support is mandatory.
- ChatGPT connector reliability is the primary product requirement.
- ChatGPT is the only required MCP host for v1.0 validation.
- OAuth/DCR is the standard public connector path unless another method is required to resolve ChatGPT safety-layer compatibility.
- Cloudflare tunnel persistence after reboot is mandatory.
- Public endpoint and connector Doctor/Fix actions are required.

This keeps the v1.0 validation matrix focused on ChatGPT.com instead of expanding to Claude, Cursor, Copilot, Windsurf, or other hosts.

## Release And Distribution Decisions

Release and distribution decisions:

- GitHub Release publication through ChampCity MCP/ChatGPT is strongly preferred.
- Codex-assisted publication is acceptable only if MCP-managed publication is not ready.
- Code signing is a v1.0 requirement.
- Installer generation is a v1.0 requirement.
- Auto-update is a v1.0 requirement.
- Release assets must include executable and/or installer, checksums, release notes, and validation reports.
- Release cadence should be milestone-based.

The release pipeline must support public-user trust and repeatable release evidence, not only local portable packaging.

## UI And Operator-Experience Decisions

UI and operator-experience decisions:

- Simple guided setup is the UI priority.
- The Dashboard is the operational home base.
- One-click Doctor/Fix actions are required.
- Generated Builder/Codex prompts can remain fallback artifacts, but the core product is MCP access that lets ChatGPT serve as Architect.
- Diagnostics should support semi-technical users and avoid requiring CLI interpretation for normal operation.

## Explicit v1.0 Exclusions And Deferred Items

Deferred or excluded from v1.0 product scope:

- current Figma implementation as a production-core workflow;
- Figma Make handoff until the workflow is revisited and justified;
- Work Cards as a ChampCity MCP app feature;
- GitHub Issues/Projects sync for Work Cards;
- A2A and multi-agent workflows;
- arbitrary allowlisted command execution;
- elevated script execution through public ChatGPT-facing tools;
- validation against MCP hosts other than ChatGPT unless needed for diagnostics.

Work Cards remain internal planning artifacts only.

## v1.0 Blocker List

The following are v1.0 blockers unless explicitly waived by the operator:

1. Live ChatGPT connector reliability.
2. ChatGPT safety-layer-compatible tool calls.
3. Operator-free source-control workflow for normal git operations.
4. Purpose-built, auditable tools for high-impact workflows.
5. Prohibition of elevated script execution through public ChatGPT-facing workflows.
6. Tamper-evident audit logs for write, release, and elevated operations.
7. Repository identity enforcement before mutation.
8. Secret, `.gitignore`, and public-source safety scanning.
9. OAuth/DCR as the normal public connector path.
10. Cloudflare tunnel persistence after reboot.
11. Public endpoint and connector Doctor/Fix actions.
12. Simple guided setup for semi-technical public users.
13. Dashboard-centered operational UX.
14. Code signing.
15. Installer generation.
16. Auto-update.
17. Release assets with checksums, release notes, and validation reports.
18. Current Figma work removed, disabled, or clearly de-scoped from production-core v1.0.
19. Work Cards and GitHub Projects sync excluded from product scope.
20. A2A excluded from v1.0.

## Implications For Work Card Priority

P0 Work Cards should prioritize:

- scope lock and release baseline;
- live ChatGPT connector acceptance and evidence;
- safety-layer false positive remediation;
- MCP protocol self-testing;
- replacement of arbitrary command execution with purpose-built tools;
- permission modes, manifest checks, identity enforcement, and safety scanning;
- MCP-native source-control and release workflows;
- OAuth/DCR and Cloudflare persistence;
- Dashboard, guided setup, and Doctor/Fix;
- signing, installer, auto-update, and release evidence;
- explicit de-scope of Figma, Work Cards-as-product, and A2A;
- documentation, validation suite, release candidate freeze, and final v1.0 release.

P1/P2 work may clarify sequencing or polish but must not convert deferred features into v1.0 commitments.

## Items Needing Later Operator Approval

Later Work Cards should request operator approval for:

- the final permission-mode names and exposed toolsets;
- any non-OAuth/DCR public connector path if needed for ChatGPT safety-layer compatibility;
- code signing certificate/provider choice and trust model;
- installer/update channel strategy;
- whether MCP-managed GitHub Release publication is mandatory before v1.0 or may remain Codex-assisted for v1.0;
- the final Figma de-scope action: remove, disable, hide, or mark experimental.
