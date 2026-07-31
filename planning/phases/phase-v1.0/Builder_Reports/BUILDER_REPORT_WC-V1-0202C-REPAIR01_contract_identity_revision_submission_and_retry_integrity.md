# BUILDER_REPORT_WC-V1-0202C-REPAIR01 - Contract Identity, Revision Submission, and Retry Integrity

Work Card: `WC-V1-0202C-REPAIR01_contract_identity_revision_submission_and_retry_integrity.md`

## Repository State

- Repository: `%USERPROFILE%\Projects\ChampCity_GPT`
- Remote: `origin https://github.com/ChampCityChris/ChampCity_GPT_MCP.git`
- Branch: `dev`
- HEAD: `10fc3caa6fa063569f27072c14153b4fe7aab74b`
- Git mutation: none. No stage, commit, push, merge, reset, clean, stash, tag, or publish operation was run.

Dirty tree inventory at report time:

```text
 M planning/phases/phase-v1.0/Live_Connector_Evidence/CHATGPT_LIVE_CONNECTOR_EVIDENCE_TEMPLATE.md
 M src/security/auditLog.ts
 M src/tools/domainToolboxes.ts
 M src/tools/saveArchitectInterviewOutput.ts
 M src/tools/toolboxActionPolicy.ts
 M src/validation/chatgptEvidence.ts
 M src/validation/mcpSelfTest.ts
 M tests/toolboxActionPolicy.test.ts
?? planning/phases/phase-v1.0/Architect_Reports/ARCHITECT_REVIEW_WC-V1-0202C_project_planning_bundle_submission_action.md
?? planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202C_project_planning_bundle_submission_action.md
?? planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202C-REPAIR01_contract_identity_revision_submission_and_retry_integrity.md
?? planning/phases/phase-v1.0/Work_Cards/WC-V1-0202C-REPAIR01_contract_identity_revision_submission_and_retry_integrity.md
?? planning/phases/phase-v1.0/Work_Cards/WC-V1-0202C_project_planning_bundle_submission_action.md
?? src/tools/saveProjectPlanningOutputs.ts
?? tests/saveProjectPlanningOutputs.test.ts
```

## Files Changed

- `src/tools/saveProjectPlanningOutputs.ts`
- `tests/saveProjectPlanningOutputs.test.ts`
- `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202C-REPAIR01_contract_identity_revision_submission_and_retry_integrity.md`

ChampCity_AI and the shared contract were not modified.

## Corrected Identity Derivation

Output identity is now derived only from the current Approved Project Intake, Architect Interview Prompt, and Project Architect Interview evidence. The Project Planning handoff remains the source revision and workflow contract authority, but its identity object is no longer merged into Project Profile or Project Roadmap output identity.

Mutual identity conflicts across Intake, Prompt, and Interview fail before target writes.

## Disposition and Revision State Table

| Existing pair state | Submitted bodies | Result |
| --- | --- | --- |
| Pending pair | Bodies identical and complete canonical authority metadata identical | `already_saved`; no bytes or revisions change |
| Pending pair | Bodies identical but workflow data or authority metadata differs | canonical rewrite is allowed when target compatibility checks pass; body revisions are retained |
| Pending pair | At least one body changed | save as `Pending`; only changed body revisions increment |
| Rejected or RevisionRequested target present | Both bodies identical | reject; preserve both target files byte-for-byte |
| Rejected or RevisionRequested target present | At least one body changed | save both outputs as `Pending`; only changed body revisions increment |
| Approved target present | Any submission | block the entire pair |
| Incompatible identity/source target | Any submission | block the entire pair |

No caller-controlled disposition field was added.

## Retry Equality Contract

`already_saved` now requires both Project Profile and Project Roadmap to match the submitted normalized body and complete canonical authority metadata:

- artifact type;
- participation role;
- identity;
- source revisions;
- application-owned workflow data;
- `Pending` disposition with blank notes and null `reviewedAt`;
- existing artifact revision preserved.

Stale workflow data no longer qualifies as `already_saved`.

## Source Association and Reconciliation Validation

The complete source association chain is validated:

- Prompt `sourceRevisions` must exactly equal the current Intake path and revision.
- Interview `sourceRevisions` must exactly equal the current Intake and Prompt paths and revisions.
- Project Planning handoff `sourceRevisions` must exactly equal the current Intake, Prompt, and Interview paths and revisions.

Reconciliation consistency is enforced:

- `greenfield` requires `repositoryReviewRequired=false`.
- `reconciliation-required` requires `repositoryReviewRequired=true`.
- `needs-attention` is refused.

## Path Deduplication Behavior

`legacyPlanningPaths` and `sourceEvidencePaths` are validated with the existing safe relative path policy, normalized to slash paths, and deduplicated by preserving the first occurrence. Unsafe paths are rejected before output writes.

## Proof Results

| # | Proof item | Result |
| --- | --- | --- |
| 1 | Output identity is derived from Intake, Prompt, and Interview only; handoff-only identity fields are absent. | DeterministicallyProven |
| 2 | Conflicting Intake, Prompt, or Interview identity fails without writes. | DeterministicallyProven |
| 3 | Prompt-to-Intake and Interview-to-Intake/Prompt associations are exact and unrelated evidence fails. | DeterministicallyProven |
| 4 | Reconciliation mode and `repositoryReviewRequired` consistency is enforced. | DeterministicallyProven |
| 5 | Legacy and source-evidence path arrays are safely normalized and deduplicated in first-occurrence order. | DeterministicallyProven |
| 6 | Pending identical complete pair returns `already_saved` only when workflow data and all canonical authority fields also match. | DeterministicallyProven |
| 7 | RevisionRequested identical pair is rejected and preserved byte-for-byte. | DeterministicallyProven |
| 8 | Rejected identical pair is rejected and preserved byte-for-byte. | DeterministicallyProven |
| 9 | A substantive revision to one document returns both outputs to Pending, increments only the changed document revision, and preserves the unchanged companion revision. | DeterministicallyProven |
| 10 | A substantive revision to both documents increments each exactly once and returns both to Pending. | DeterministicallyProven |
| 11 | Approved or incompatible target still blocks the entire pair. | DeterministicallyProven |
| 12 | Atomic rollback, evidence-race protection, result redaction, audit redaction, non-Git persistence, and existing Architect Interview save behavior remain passing. | DeterministicallyProven |
| 13 | `npm run typecheck`, `npm run validate:codex:unit`, `npm run mcp:self-test`, and `npm run check:public` pass in approved lanes. | DeterministicallyProven |
| 14 | Live greenfield and existing-project calls remain `OperatorValidationPending` for WC27. | OperatorValidationPending |

## Validation Commands and Lanes

| Command | Execution lane | Result | Sandbox-only failure observed | Approved lane validated |
| --- | --- | --- | --- | --- |
| `npm run typecheck` | Approved normal Windows lane | Pass | No | Yes |
| `npm run validate:codex:unit` | Approved normal Windows lane | Pass; 392 tests passed, 0 failed | No | Yes |
| `npm run mcp:self-test` | Approved normal Windows lane | Pass; 23 checks passed, 0 failed | No | Yes |
| `npm run check:public` | Approved normal Windows lane | Pass; publication cleanliness checked 232 source candidate files after report cleanup | No | Yes |

An intermediate `npm run check:public` run after initial report creation failed because the report used a literal private local path. The report was corrected to use `%USERPROFILE%\Projects\ChampCity_GPT`, and the final approved-lane run passed.

## Scope Notes

- Production changes were limited to `src/tools/saveProjectPlanningOutputs.ts`.
- Test changes were limited to `tests/saveProjectPlanningOutputs.test.ts`.
- Builder Report was created at the required path.
- No OAuth, MCP transport, tool discovery/exposure, Cloudflare, runtime path, packaging, token storage, server lifecycle, preload API, or `window.champcity` API changes were made.
- No packaging, promotion, restart, reconnect, stage, commit, push, merge, reset, clean, stash, tag, or publish operation was run.

No fallback implementation was used.
