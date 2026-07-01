# ChampCity GPT MCP v1.0 Work Card Queue

Review date: 2026-06-29

## Source

This queue is derived from the answered operator intake file:

- `planning/phases/phase-v1.0/04_operator_intake_interview.md`

## Queue Rules

- Work Cards are internal planning artifacts only.
- P0 means a v1.0 blocker unless explicitly waived by the operator.
- P1/P2 items may clarify sequencing but must not convert deferred features into v1.0 commitments.
- No Work Card in this queue authorizes fallback architecture, release publication, tag movement, package generation, source implementation, or protected-subsystem changes outside its own future approved scope.
- Active implementation Work Cards should use `dev` or a generated `feature/WC-V1-xxxx-*` / `feature/WC-V1-FIXxx-*` branch. `main` is reserved for stable release or baseline checkpoints.
- `prepare_git_work_branch` is the safe MCP branch-preparation path. It refuses dirty working trees and `main` as the active work target, and it does not push, merge, rebase, reset, stash, delete, force, or run arbitrary commands.
- Stable domain toolbox expansion should prefer internal allowlisted actions under `repo_toolbox`, `git_toolbox`, `artifact_toolbox`, `diagnostics_toolbox`, `integration_toolbox`, `browser_toolbox`, and `knowledge_toolbox` instead of adding new top-level MCP tools when possible. Figma belongs under `integration_toolbox`; do not add `figma_toolbox`.
- Normal source-control flow after branch preparation is validate, stage reviewed files, run pre-commit safety scan, commit, push the current `dev` or feature branch, and merge to `main` only at a stable checkpoint.

## Phase 0 — Scope Lock And Baseline

### WC-V1-0001 — Commit v1.0 scope decisions from operator intake

- ID: `WC-V1-0001`
- Title: Commit v1.0 scope decisions from operator intake
- Priority: P0
- Owner mode: Architect prepares; Codex/Builder implements
- Type: Planning / governance
- Objective: Convert the answered intake into durable v1.0 planning artifacts.
- Scope: Create/update the phase v1.0 scope decisions document, Work Card queue, and Builder report. Do not implement app features.
- Acceptance criteria: Scope decisions summarize all 25 answers, required conclusions are explicit, the queue includes all required P0 cards, and the Builder report records the pass.
- Validation: `git status --short`, `git diff --check`, `npm run check:public` if available, Markdown lint if repo-defined.
- Dependencies or notes: Uses `planning/phases/phase-v1.0/04_operator_intake_interview.md` as the primary source.

### WC-V1-0002 — Verify v0.1.2 release publication baseline

- ID: `WC-V1-0002`
- Title: Verify v0.1.2 release publication baseline
- Priority: P0
- Owner mode: ChampCity MCP first; Codex fallback only if MCP is blocked
- Type: Release hygiene
- Objective: Establish the v0.1.2 release baseline before v1.0 work proceeds.
- Scope: Verify branch, status, tag, release, attached assets, and validation evidence without moving tags or publishing new artifacts.
- Acceptance criteria: v0.1.2 release state is unambiguous and any missing release evidence is captured as a follow-up Work Card.
- Validation: Git tag checks, release metadata check, asset/hash check if available, and public safety scan.
- Dependencies or notes: Must not create, move, push, or publish release assets unless a later prompt explicitly authorizes that action.

### WC-V1-0003 — Remove non-v1.0 product scope from active roadmap

- ID: `WC-V1-0003`
- Title: Remove non-v1.0 product scope from active roadmap
- Priority: P0
- Owner mode: Architect with Codex/Builder documentation support
- Type: Scope control
- Objective: Keep v1.0 focused on ChatGPT-to-local-tools.
- Scope: Mark current Figma workflow, A2A/multi-agent work, and Work Cards/GitHub Projects sync as out of v1.0 product scope.
- Acceptance criteria: Active roadmap no longer treats these as v1.0 deliverables and planning language matches the intake decisions.
- Validation: Roadmap review and operator approval.
- Dependencies or notes: Does not remove code by itself; implementation cleanup requires separate scoped Work Cards.

## Phase 1 — ChatGPT Connector And Safety-Layer Reliability

### WC-V1-0101 — Build ChatGPT-only connector acceptance matrix

- ID: `WC-V1-0101`
- Title: Build ChatGPT-only connector acceptance matrix
- Priority: P0
- Owner mode: Architect defines; Codex/Builder documents
- Type: Connector validation
- Objective: Define the exact ChatGPT.com behaviors that must pass before v1.0.
- Scope: Cover connector creation, OAuth/DCR registration, public `/mcp` reachability, tools/list visibility, safe tool calls, denied unsafe calls, and evidence capture.
- Acceptance criteria: Matrix is ChatGPT-only, each test has expected result and evidence requirements, and failures distinguish ChatGPT safety-layer rejection from app/server failure.
- Validation: Manual ChatGPT connector run and Builder/Architect report.
- Dependencies or notes: Must not broaden v1.0 validation to other MCP hosts unless required for diagnostics.

### WC-V1-0102 — Remediate ChatGPT safety-layer false positives

- ID: `WC-V1-0102`
- Title: Remediate ChatGPT safety-layer false positives
- Priority: P0
- Owner mode: Codex/Builder
- Type: MCP reliability
- Objective: Make normal ChampCity MCP tool calls consistently usable from ChatGPT.com.
- Scope: Adjust tool names, descriptions, schemas, responses, and exposed workflows as needed to avoid false unsafe classifications.
- Acceptance criteria: Required safe tool calls work in a new ChatGPT conversation and blocked unsafe calls remain blocked.
- Validation: Live ChatGPT connector validation, protocol self-test, and regression checks.
- Dependencies or notes: Touches protected MCP exposure behavior and must be handled under a separately approved implementation card. Builder pass WC-V1-0102 adds read-only facade tools for status, change set readiness, release artifact inspection, and release publication inspection; full remediation still requires live ChatGPT validation for CAV-011, CAV-012, CAV-013, CAV-021, CAV-023, and CAV-030.

### WC-V1-0102A — Add Builder Report discovery facade

- ID: `WC-V1-0102A`
- Title: Add Builder Report discovery facade
- Priority: P0
- Owner mode: Architect specifies; Codex/Builder implements
- Type: MCP reliability / planning artifact discovery
- Objective: Replace broad recursive Builder Report listing with a purpose-built ChatGPT-safe read-only facade.
- Scope: Add a bounded read-only tool such as `get_builder_report_index` and, if needed, a narrow `get_builder_report_summary`/specific-report lookup that discovers phase-local Builder Reports without caller-supplied absolute roots, arbitrary globs, or broad recursive file queries. The tool should support configured allowed workspaces by safe `workspaceId`/project key, phase folder, Work Card ID, and bounded result count. It must return repository-relative paths and safe metadata only.
- Acceptance criteria: ChatGPT can find known Builder Reports, including the WC07 report under `ChampCity_AI`, without using `list_project_files` with `planning/phases` plus `**/BUILDER_REPORT*.md`; blocked unsafe path attempts remain blocked; live ChatGPT validation records whether the prior broad-glob false positive is avoided by the facade.
- Validation: Unit tests for schema bounds, allowed-root enforcement, blocked-path behavior, and relative output paths; MCP tool-list/self-test once available; live ChatGPT validation for CAV-033.
- Dependencies or notes: This is a narrow follow-up to WC-V1-0102. Builder implementation adds `get_builder_report_index` and `get_builder_report_summary` as read-only facade tools with deterministic local tests; live ChatGPT validation for CAV-033 remains required. It does not authorize a broad workspace registry, product Work Card UI, GitHub Projects sync, arbitrary file search expansion, or mutation tools.

### WC-V1-0103 — Add MCP protocol self-test for release validation

- ID: `WC-V1-0103`
- Title: Add MCP protocol self-test for release validation
- Priority: P0
- Owner mode: Codex/Builder
- Type: Test infrastructure
- Objective: Add deterministic MCP protocol checks to release validation.
- Scope: Verify metadata, initialize, tools/list, required tool presence, safe read call, write-scope denied behavior, and diagnostic output.
- Acceptance criteria: Self-test produces pass/fail results suitable for release reports and catches empty namespace/tool exposure failures.
- Validation: Local self-test run and release validation integration.
- Dependencies or notes: Builder implementation adds `npm run mcp:self-test` and `npm run mcp:self-test -- --json` for deterministic local release validation. Complements but does not replace live ChatGPT connector validation.

### WC-V1-0104 — Add live ChatGPT connector evidence capture

- ID: `WC-V1-0104`
- Title: Add live ChatGPT connector evidence capture
- Priority: P0
- Owner mode: Codex/Builder plus operator validation
- Type: Connector diagnostics
- Objective: Capture auditable evidence for live ChatGPT connector success/failure.
- Scope: Define safe evidence artifacts for connector visibility, tool count, successful calls, rejected calls, and error classification.
- Acceptance criteria: Release validation can include evidence without exposing secrets, tokens, private URLs, or sensitive local paths.
- Validation: Operator-run ChatGPT connector evidence capture and redaction review.
- Dependencies or notes: Evidence capture must not rely on browser scraping or screenshots unless separately authorized. Builder implementation adds the redacted evidence template, `npm run chatgpt:evidence:validate`, and local redaction/completeness checks; it does not itself perform live ChatGPT connector validation. Supports CAV-007 through CAV-011 and CAV-027 through CAV-031, and also helps CAV-033.

## Phase 2 — Safe Purpose-Built MCP Tool Architecture

### WC-V1-FIX02 — Add stable domain toolbox tools

- ID: `WC-V1-FIX02`
- Title: Add stable domain toolbox tools
- Priority: P0
- Owner mode: Codex/Builder
- Type: MCP reliability / tool governance
- Objective: Add a durable small set of top-level MCP toolbox tools so future capability expansion can prefer internal allowlisted actions over new top-level MCP tools.
- Scope: Add `repo_toolbox`, `git_toolbox`, `artifact_toolbox`, `diagnostics_toolbox`, `integration_toolbox`, `browser_toolbox`, and `knowledge_toolbox` with minimal safe initial actions. Preserve existing legacy tools. Do not add `figma_toolbox`; Figma and other external services belong under `integration_toolbox`.
- Acceptance criteria: The seven toolbox tools are registered and visible with `files.read`; write-capable actions fail safely without OAuth `files.write` and local write-mode permission; unknown actions and unknown services fail with structured errors; toolbox schemas avoid forbidden root, command, token, force/reset/merge/rebase/stash/delete, and secret fields; MCP self-test covers the toolbox surface.
- Validation: Typecheck, unit tests, lint, build, public safety scan, MCP self-test, ChatGPT evidence template validation, diff check, and live ChatGPT connector validation by the operator after runtime update.
- Dependencies or notes: Depends on `WC-V1-FIX01` and `prepare_git_work_branch`. This card reduces top-level MCP schema churn but does not migrate or remove existing narrow tools.

### WC-V1-FIX04 — Add explicit multi-workspace routing for toolbox actions

- ID: `WC-V1-FIX04`
- Title: Add explicit multi-workspace routing for toolbox actions
- Priority: P0
- Owner mode: Codex/Builder
- Type: MCP reliability / workspace routing
- Objective: Route project-specific toolbox actions through server-defined workspace IDs instead of a single global default workspace.
- Scope: Add a workspace registry to runtime config, preserve legacy `allowedRoots`, add safe workspace discovery, and route repo/git/artifact/diagnostics/integration/browser/knowledge toolbox actions through explicit `workspaceId` resolution. Preserve legacy tools and do not add `figma_toolbox`.
- Acceptance criteria: Multiple allowed workspaces produce stable safe workspace IDs; `diagnostics_toolbox.list_workspaces` returns safe metadata without unnecessary absolute roots; explicit workspace IDs route repo/git/artifact actions to the selected fixture repo; ambiguous `workspaceId: default` fails safely when multiple workspaces exist and no explicit default is configured; public toolbox schemas remain `action`, `workspaceId`, and `params`.
- Validation: Typecheck, unit tests, lint, build, public safety scan, MCP self-test including multi-workspace fixtures, ChatGPT evidence template validation, diff check, and live ChatGPT connector validation by the operator after package promotion.
- Dependencies or notes: Depends on `WC-V1-FIX02`. Do not implement mutable active workspace state, fallback routing, public root params, OAuth changes, Cloudflare changes, packaging, release publication, or `WC-V1-0401`.

### WC-V1-0201 — Replace arbitrary command execution with purpose-built tools

- ID: `WC-V1-0201`
- Title: Replace arbitrary command execution with purpose-built tools
- Priority: P0
- Owner mode: Codex/Builder
- Type: MCP safety architecture
- Objective: Remove broad command execution from core v1.0 workflows.
- Scope: Inventory command-backed workflows and design purpose-built tools for repo status, docs, patches, source control, release, and diagnostics.
- Acceptance criteria: Core workflows do not depend on arbitrary allowlisted command execution and each high-impact action has explicit schema, guardrails, and audit events.
- Validation: Tool manifest review, safety gate, tests, and live ChatGPT validation.
- Dependencies or notes: Protected MCP tool exposure; implementation requires a separate scoped card.

### WC-V1-0202 — Implement v1.0 permission modes and toolsets

- ID: `WC-V1-0202`
- Title: Implement v1.0 permission modes and toolsets
- Priority: P0
- Owner mode: Codex/Builder
- Type: Security architecture
- Objective: Define and enforce permission modes that match v1.0 risk levels.
- Scope: Separate read-only, docs-write, patch proposal, approved patch, source-control, release-publisher, and local admin capabilities as appropriate.
- Acceptance criteria: ChatGPT-facing tools expose only the permitted capability set for the granted mode and denied calls fail clearly.
- Validation: Unit tests, MCP self-test, permission matrix review, and live ChatGPT denied-scope checks.
- Dependencies or notes: Operator approval needed for final mode names and exposed toolsets.

### WC-V1-0203 — Create tool manifest and safety/quality gate

- ID: `WC-V1-0203`
- Title: Create tool manifest and safety/quality gate
- Priority: P0
- Owner mode: Codex/Builder
- Type: Tool governance
- Objective: Ensure every exposed MCP tool is intentional, documented, tested, and safe for its mode.
- Scope: Add a manifest/check covering tool names, descriptions, schemas, modes, risk level, audit behavior, tests, and ChatGPT acceptance evidence.
- Acceptance criteria: Release validation fails if a required tool is missing, unsafe, undocumented, or exposed in the wrong mode.
- Validation: Manifest check, typecheck, tests, public safety scan, and MCP self-test.
- Dependencies or notes: Should be sequenced before broad release validation.

### WC-V1-0204 — Enforce repository identity before every mutation

- ID: `WC-V1-0204`
- Title: Enforce repository identity before every mutation
- Priority: P0
- Owner mode: Codex/Builder
- Type: Repository safety
- Objective: Prevent writes against the wrong repository or remote.
- Scope: Require path, git root, remote, package/project identity, and clean safety preconditions before every mutation-capable workflow.
- Acceptance criteria: Mutation fails safely when repo identity is missing or mismatched and all mutation paths share the same enforcement logic.
- Validation: Unit tests, mutation-denied tests, and MCP self-test.
- Dependencies or notes: Must not weaken existing write-scope enforcement.

### WC-V1-0205 — Expand secret, .gitignore, and public-source safety scanning

- ID: `WC-V1-0205`
- Title: Expand secret, .gitignore, and public-source safety scanning
- Priority: P0
- Owner mode: Codex/Builder
- Type: Public repo safety
- Objective: Prevent secret, credential, generated artifact, and private-path exposure in public releases.
- Scope: Extend scans for tokens, OAuth stores, Cloudflare/Figma/GitHub credentials, `.env`, logs, release binaries, generated output, and ignored/private-risk paths.
- Acceptance criteria: Source-control and release workflows block unsafe content before commit, tag, or release publication.
- Validation: `npm run check:public`, release-clean checks, fixture tests, and manual review for new patterns.
- Dependencies or notes: Must preserve safe Markdown planning artifacts while blocking sensitive content.

## Phase 3 — Source Control And Release Automation

### WC-V1-0301 — Build MCP-native source-control workflow

- ID: `WC-V1-0301`
- Title: Build MCP-native source-control workflow
- Priority: P0
- Owner mode: Codex/Builder
- Type: Source control automation
- Objective: Remove operator-managed git from normal v1.0 workflows.
- Scope: Provide purpose-built status, diff, scan, stage, commit, pull, push, tag-preflight, and evidence tools with guardrails.
- Acceptance criteria: ChatGPT can coordinate normal source-control flow without asking the operator to run git commands manually.
- Validation: Unit tests, sandbox/repo identity tests, public safety scan, and live ChatGPT workflow validation.
- Dependencies or notes: Must not allow unsafe git reset, checkout, force-push, or tag movement without explicit future approval. `WC-V1-FIX01` adds the narrow `prepare_git_work_branch` prerequisite for safe `dev` or Work Card feature branch preparation; broader source-control workflow remains in this card.

### WC-V1-0302 — Build MCP-native release publication workflow

- ID: `WC-V1-0302`
- Title: Build MCP-native release publication workflow
- Priority: P0
- Owner mode: Codex/Builder
- Type: Release automation
- Objective: Let ChatGPT/MCP coordinate GitHub Release publication when safe.
- Scope: Purpose-built release creation/update, asset attachment, tag validation, hash verification, notes attachment, and publication evidence.
- Acceptance criteria: Release publication can be completed through audited MCP tools or produces a clear blocker report when unsafe.
- Validation: Dry run or test release path, public safety scan, release evidence review, and operator approval.
- Dependencies or notes: Codex-assisted publication remains acceptable only if MCP-managed publication is not ready.

### WC-V1-0303 — Generate release assets: checksums, notes, validation reports

- ID: `WC-V1-0303`
- Title: Generate release assets: checksums, notes, validation reports
- Priority: P0
- Owner mode: Codex/Builder
- Type: Release evidence
- Objective: Standardize required release assets for public v1.0.
- Scope: Generate checksums, release notes, validation reports, and asset manifests for executable/installer releases.
- Acceptance criteria: Every release candidate produces complete, current, non-stale release evidence and no release binaries are committed.
- Validation: Hash verification, release-clean scan, report review, and artifact timestamp/version checks.
- Dependencies or notes: Final release publication is a separate Work Card.

## Phase 4 — OAuth/DCR And Cloudflare Tunnel Production Readiness

### WC-V1-0401 — Harden OAuth/DCR as the sole public connector path

- ID: `WC-V1-0401`
- Title: Harden OAuth/DCR as the sole public connector path
- Priority: P0
- Owner mode: Codex/Builder
- Type: Connector security
- Objective: Make OAuth/DCR the standard public connector path for v1.0.
- Scope: Verify dynamic client registration, protected resource metadata, token flow, scope enforcement, and public connector documentation.
- Acceptance criteria: Public setup does not require bearer/PAT/manual auth except when separately approved for safety-layer compatibility.
- Validation: OAuth/DCR tests, live ChatGPT connector validation, and operator setup review.
- Dependencies or notes: Protected OAuth/DCR subsystem; implementation requires a separate approved card. `WC-V1-0401` remains paused until `WC-V1-FIX01` is reviewed, committed, pushed, and available through MCP.

### WC-V1-0402 — Implement Cloudflare tunnel persistence setup and validation

- ID: `WC-V1-0402`
- Title: Implement Cloudflare tunnel persistence setup and validation
- Priority: P0
- Owner mode: Codex/Builder plus operator validation
- Type: Networking setup
- Objective: Ensure public connector reachability survives reboot.
- Scope: Provide setup, persistence checks, status, remediation, and validation reporting for the Cloudflare tunnel.
- Acceptance criteria: Reboot persistence is configured, validated, and diagnosable without requiring routine CLI use.
- Validation: Deterministic local checks plus operator reboot validation.
- Dependencies or notes: Protected Cloudflare behavior; no implementation is authorized by this queue entry alone.

### WC-V1-0403 — Add public endpoint and connector Doctor/Fix actions

- ID: `WC-V1-0403`
- Title: Add public endpoint and connector Doctor/Fix actions
- Priority: P0
- Owner mode: Codex/Builder
- Type: Diagnostics/remediation
- Objective: Give semi-technical users one-click repair for public connector failures.
- Scope: Diagnose and fix endpoint reachability, metadata, OAuth/DCR, tunnel status, connector discovery, and tool visibility where safe.
- Acceptance criteria: Doctor/Fix actions report what was checked, what was changed, what remains blocked, and what the operator must validate.
- Validation: Unit tests, deterministic endpoint checks, and live ChatGPT connector validation.
- Dependencies or notes: Fix actions must stay purpose-built and audited.

## Phase 5 — Public-User Setup And Dashboard UX

### WC-V1-0501 — Build guided first-run setup for semi-technical public users

- ID: `WC-V1-0501`
- Title: Build guided first-run setup for semi-technical public users
- Priority: P0
- Owner mode: Codex/Builder
- Type: UX/setup
- Objective: Make first setup approachable without CLI or advanced networking knowledge.
- Scope: Guide repository selection, identity checks, OAuth/DCR, tunnel setup, connector readiness, safety scanning, and next steps.
- Acceptance criteria: A semi-technical user can reach a validated ready state with clear error handling and no routine manual git/network commands.
- Validation: Deterministic build/typecheck tests plus operator interactive validation.
- Dependencies or notes: UI visual quality requires operator approval under AGENTS.MD.

### WC-V1-0502 — Make Dashboard the operational home base

- ID: `WC-V1-0502`
- Title: Make Dashboard the operational home base
- Priority: P0
- Owner mode: Codex/Builder
- Type: UX/dashboard
- Objective: Center daily operation around the Dashboard.
- Scope: Surface connector status, repo identity, safety status, tunnel status, release readiness, recent audit events, and Doctor/Fix actions.
- Acceptance criteria: Dashboard clearly communicates ready/blocked states and routes users to one-click remediation where available.
- Validation: Deterministic checks plus operator visual/interactive validation.
- Dependencies or notes: Does not authorize subjective visual judgment by Builder.

### WC-V1-0503 — Implement one-click Doctor/Fix framework

- ID: `WC-V1-0503`
- Title: Implement one-click Doctor/Fix framework
- Priority: P0
- Owner mode: Codex/Builder
- Type: UX/remediation
- Objective: Standardize safe one-click diagnosis and remediation.
- Scope: Define fix action contracts, dry-run/reporting behavior, audit logging, confirmation requirements, rollback limits, and blocked-state reporting.
- Acceptance criteria: Doctor/Fix actions are safe, auditable, explicit about changes, and compatible with semi-technical users.
- Validation: Unit tests, permission tests, audit log checks, and operator UI validation.
- Dependencies or notes: Fix actions must not become arbitrary command execution.

## Phase 6 — Distribution, Signing, Installer, And Updates

### WC-V1-0601 — Implement code signing for v1.0

- ID: `WC-V1-0601`
- Title: Implement code signing for v1.0
- Priority: P0
- Owner mode: Operator credential setup; Codex/Builder implementation
- Type: Distribution security
- Objective: Ship v1.0 with signed Windows artifacts.
- Scope: Select signing flow, protect credentials, sign executable/installer artifacts, verify signatures, and document operator-managed secrets.
- Acceptance criteria: Release artifacts are signed and verification evidence is included without exposing signing credentials.
- Validation: Signature verification, release report, public safety scan, and operator approval.
- Dependencies or notes: Requires operator approval for certificate/provider and secret-handling approach.

### WC-V1-0602 — Implement installer generation

- ID: `WC-V1-0602`
- Title: Implement installer generation
- Priority: P0
- Owner mode: Codex/Builder
- Type: Distribution
- Objective: Provide installer distribution suitable for public users.
- Scope: Configure installer generation, validate final installer output, document install/uninstall behavior, and distinguish final artifacts from intermediate builder output.
- Acceptance criteria: Final versioned installer exists under release output and packaging success is not claimed from unpacked/intermediate artifacts.
- Validation: Packaging command, final artifact timestamp/size/hash report, and operator smoke test.
- Dependencies or notes: Do not run packaging unless the Work Card explicitly requests it.

### WC-V1-0603 — Implement auto-update path

- ID: `WC-V1-0603`
- Title: Implement auto-update path
- Priority: P0
- Owner mode: Codex/Builder
- Type: Distribution/update
- Objective: Support safe updates after v1.0 release.
- Scope: Define update channel, metadata, signing requirements, rollback/error states, and user-facing update UX.
- Acceptance criteria: Installed app can discover, verify, and apply updates without unsafe downgrade or unsigned artifact behavior.
- Validation: Controlled update test, signature checks, installer/update report, and operator validation.
- Dependencies or notes: Depends on code signing and installer decisions.

## Phase 7 — Figma/A2A/Work Cards Scope Cleanup

### WC-V1-0701 — Disable or de-scope current Figma implementation for v1.0

- ID: `WC-V1-0701`
- Title: Disable or de-scope current Figma implementation for v1.0
- Priority: P0
- Owner mode: Architect decides; Codex/Builder implements if scoped
- Type: Scope cleanup
- Objective: De-scope current Figma workflow from production-core v1.0.
- Scope: Decide whether to remove, disable, hide, or mark current Figma tooling experimental, then update roadmap/docs/UI only as separately authorized.
- Acceptance criteria: v1.0 does not present current Figma workflow as a supported production-core feature.
- Validation: Documentation review and operator UI validation if UI changes are made.
- Dependencies or notes: Protected Figma Make extraction architecture; implementation requires explicit scope.

### WC-V1-0702 — Exclude Work Cards and GitHub Projects sync from product scope

- ID: `WC-V1-0702`
- Title: Exclude Work Cards and GitHub Projects sync from product scope
- Priority: P0
- Owner mode: Architect with Codex/Builder documentation support
- Type: Scope cleanup
- Objective: Keep Work Cards as planning artifacts, not a ChampCity MCP app feature.
- Scope: Remove active roadmap commitments for GitHub Issues/Projects sync and Work Card product UI.
- Acceptance criteria: Product docs and roadmap consistently treat Work Cards as internal planning only.
- Validation: Documentation review and operator approval.
- Dependencies or notes: Does not prevent using Markdown Work Cards in the repository.

### WC-V1-0703 — Defer A2A and multi-agent workflows

- ID: `WC-V1-0703`
- Title: Defer A2A and multi-agent workflows
- Priority: P0
- Owner mode: Architect
- Type: Scope cleanup
- Objective: Keep v1.0 focused on ChatGPT-to-local-tools.
- Scope: Mark A2A and multi-agent workflows as future possibilities, not v1.0 deliverables.
- Acceptance criteria: Active roadmap and validation plans do not require A2A for v1.0.
- Validation: Roadmap review and operator approval.
- Dependencies or notes: Architectural notes are allowed only if they do not create v1.0 implementation scope.

## Phase 8 — Documentation, Validation, And v1.0 Release

### WC-V1-0801 — Produce public-user v1.0 documentation set

- ID: `WC-V1-0801`
- Title: Produce public-user v1.0 documentation set
- Priority: P0
- Owner mode: Codex/Builder
- Type: Documentation
- Objective: Create the public-user documentation required for setup, operation, security, and release validation.
- Scope: Cover installation, guided setup, ChatGPT connector, OAuth/DCR, Cloudflare tunnel, Dashboard, Doctor/Fix, source-control/release workflows, security, privacy, troubleshooting, and deferred scope.
- Acceptance criteria: Semi-technical public users can complete normal setup and understand supported/unsupported workflows.
- Validation: Markdown review, public safety scan, and operator review.
- Dependencies or notes: Must not include secrets, tokens, private paths, or local-only credentials.

### WC-V1-0802 — Create v1.0 validation suite

- ID: `WC-V1-0802`
- Title: Create v1.0 validation suite
- Priority: P0
- Owner mode: Codex/Builder
- Type: Release validation
- Objective: Define the complete v1.0 release gate.
- Scope: Include install/dependency checks, typecheck, build, tests, lint, public scan, audit, MCP self-test, tool manifest validation, live ChatGPT test, OAuth/DCR test, Cloudflare persistence test, source-control workflow test, release workflow test, installer/signing/update tests, and manual smoke tests.
- Acceptance criteria: v1.0 cannot release unless all P0 checks pass or are explicitly waived by the operator.
- Validation: Full release candidate validation run and report.
- Dependencies or notes: Local deterministic tests do not replace live ChatGPT connector validation. Consumes the ChatGPT-only acceptance matrix produced by `WC-V1-0101`.

### WC-V1-0803 — v1.0 release candidate freeze

- ID: `WC-V1-0803`
- Title: v1.0 release candidate freeze
- Priority: P0
- Owner mode: Architect plus Codex/Builder
- Type: Release governance
- Objective: Freeze v1.0 scope before final release validation.
- Scope: Confirm P0 completion, P1/P2 deferrals, docs, safety-layer status, connector/tunnel readiness, release pipeline readiness, and operator approval.
- Acceptance criteria: RC report exists, operator approves freeze, and unrelated feature work stops until final release.
- Validation: Full release-readiness scan and manual operator approval.
- Dependencies or notes: Depends on closure or explicit waiver of all prior P0 cards.

### WC-V1-0804 — v1.0 final release

- ID: `WC-V1-0804`
- Title: v1.0 final release
- Priority: P0
- Owner mode: ChampCity MCP first; Codex fallback only if MCP is blocked
- Type: Release
- Objective: Tag, package, sign, publish, and verify v1.0 without operator-managed git.
- Scope: Final validation, version update, commit, tag, package installer/executable, sign artifacts, generate checksums, generate validation report, smoke test, live ChatGPT connector test, publish GitHub Release assets, and record final release report.
- Acceptance criteria: v1.0 tag points to intended commit, release assets are verified, checksums/notes/reports are attached, no binaries or secrets are committed, and final status is clean.
- Validation: Full v1.0 validation suite, GitHub Release verification, and operator signoff.
- Dependencies or notes: This card is not authorized by WC-V1-0001; no release, tag, package, push, or publication work occurs until explicitly prompted.

## Work Card Count

This queue contains 34 P0 Work Cards.
