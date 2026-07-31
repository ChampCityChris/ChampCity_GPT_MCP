# WC-V1-0202C — Project Planning Bundle Submission Action

Status: Approved for Implementer execution  
Repository: `%USERPROFILE%\Projects\ChampCity_GPT`  
Remote: `ChampCityChris/ChampCity_GPT_MCP`  
Expected branch: `dev`  
Git mutation: prohibited  
Required Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202C_project_planning_bundle_submission_action.md`

## Dependency Resolution

The prior circular dependency is removed.

This card does **not** wait for WC27 source implementation or a live WC27-generated handoff. Its stable dependency is the Approved cross-repository contract:

```text
ChampCity_AI/
planning/project/Design_Documents/
PROJECT_PLANNING_OUTPUT_SUBMISSION_CONTRACT.md
Artifact revision: 2
Contract ID: project-planning-output-submission-v1
```

Read that contract through ChampCity MCP before implementation and record its revision/hash in the Builder Report.

Implement and deterministically validate this action using curated fixture handoffs conforming to the Approved contract. Live embedded ChatGPT validation is performed later through ChampCity A/I WC27 after the MCP runtime is integrated and available.

Stop only if the Approved contract is missing, unreadable, or internally inconsistent. Do not wait for WC27 application code and do not invent another protocol.

## Objective

Add one action to the existing stable toolbox:

```text
artifact_toolbox.save_project_planning_outputs
```

Do not add a top-level MCP tool.

The action accepts two complete substantive Markdown bodies and atomically creates or revises the canonical Project Profile and Project Roadmap using authority derived from the current Approved Project Planning handoff.

## Public Invocation

```json
{
  "action": "save_project_planning_outputs",
  "workspaceId": "<configured workspace ID>",
  "params": {
    "projectProfileMarkdown": "<complete Project Profile Markdown>",
    "projectRoadmapMarkdown": "<complete Project Roadmap Markdown>"
  }
}
```

Reject unknown params and every caller-supplied authority field.

The caller cannot supply:

- roots or target paths;
- identity, artifact type, role, revision, source revisions, disposition, or review notes;
- reconciliation mode or contract fields;
- canonical metadata delimiters;
- JSON siblings;
- force, overwrite, migration, Git, or fallback flags.

## Permission Boundary

Register the action under `artifact_toolbox` with:

```text
requiredScope=files.write
mappedInternalOperation=write_markdown_artifact
```

Require the existing docs, patch, or elevated local write mode.

Do not delegate to a generic writer with caller-controlled paths.

Preserve:

- the seven stable public toolbox tools;
- public tool count;
- old-chat action discoverability;
- OAuth and local write-mode enforcement;
- HTTP transport and existing connector behavior.

## Evidence Resolution

Resolve the configured workspace and exactly one current canonical handoff matching:

```text
artifactType=generated-handoff
participationRole=nonReviewHandoff
workflowData.handoffKind=project-planning
workflowData.contractId=project-planning-output-submission-v1
Document.Status=Approved
```

Verify its exact current source revisions for:

1. Approved Project Intake;
2. Approved Architect Interview Prompt;
3. Approved Project Architect Interview.

Reject missing, duplicate, stale, malformed, historical, wrong-role, wrong-type, unrelated, or identity-conflicting evidence.

Do not select by newest timestamp, lexicographic order, first match, or last match.

## Derived Authority

Derive from the verified handoff and its sources:

- Project Profile target;
- Project Roadmap target;
- project identity;
- source revisions;
- reconciliation mode;
- repository-review requirement;
- required Profile and Roadmap headings;
- bounded reconciliation workflow data.

The caller cannot override any derived value.

All targets must remain repository-relative Markdown files inside the selected workspace and pass existing path, regular-file, symlink, junction, and reparse-point controls.

## Body Validation

Use strict Zod input validation and existing size limits.

Reject empty bodies and bodies containing canonical metadata delimiters or authority fields.

Validate only the deterministic structure specified by `project-planning-output-submission-v1`.

Required Project Profile headings:

```text
# Project Profile
## Current-State Baseline
## Existing Implementation
## Legacy Planning Reconciliation
## Risks and Unknowns
```

Required Project Roadmap headings:

```text
# Project Roadmap
## Baseline Summary
## Work-State Classification
## Sequenced Roadmap
## Dependencies and Constraints
```

Mode rules:

- `greenfield`: Profile states that no prior implementation baseline exists.
- `reconciliation-required`: required reconciliation sections contain substantive content.
- `needs-attention`: refuse the entire save without writing either file.

Do not perform open-ended LLM quality evaluation. Operator review remains the quality gate.

## Canonical Outputs

Project Profile:

```text
artifactType=project-profile
participationRole=compoundGatingReview
```

Project Roadmap:

```text
artifactType=project-roadmap
participationRole=compoundGatingReview
```

Both outputs use:

```text
identity=<derived project identity>
sourceRevisions=<Intake, Prompt, Interview, Handoff>
Document.Status=Pending
Document.Notes=""
Document.ReviewedAt=null
```

Serialize the current canonical `CHAMPCITY-METADATA` Markdown envelope used by `save_architect_interview_output` and ChampCity A/I.

Create no JSON siblings.

## Existing Targets and Retry

- Missing targets begin at artifact revision 1.
- Valid Pending, Rejected, or RevisionRequested targets may be substantively revised.
- A changed body increments the affected revision exactly once.
- A substantive bundle revision returns both outputs to coherent Pending review state.
- An identical complete Pending pair returns `already_saved` without rewriting or revision increase.
- An Approved target blocks the entire bundle.
- An unmanaged, malformed, wrong-type, wrong-role, identity-mismatched, source-mismatched, unsafe, or escaping target blocks the entire bundle.
- Do not select alternate targets.

## Atomic Pair Transaction

The two outputs are one transaction.

Required behavior:

1. resolve and snapshot handoff, sources, targets, bytes, hashes, and revisions;
2. validate both complete outputs before changing either target;
3. immediately re-read evidence and fail if it changed;
4. install both through a rollback-capable transaction;
5. re-read and verify both canonical files;
6. restore or remove both if either install or verification fails;
7. remove temporary and backup files.

Never return success with only one output installed.

Reuse or safely generalize current canonical parsing and artifact transaction code. Do not create divergent serializers.

## Result

Return only bounded safe data:

```json
{
  "status": "saved | already_saved",
  "workspaceId": "<id>",
  "projectProfile": {
    "relativePath": "<relative path>",
    "artifactRevision": 1,
    "sizeBytes": 0,
    "sha256": "<hash>"
  },
  "projectRoadmap": {
    "relativePath": "<relative path>",
    "artifactRevision": 1,
    "sizeBytes": 0,
    "sha256": "<hash>"
  },
  "disposition": "Pending",
  "reconciliationMode": "greenfield | reconciliation-required"
}
```

Do not return bodies, absolute paths, credentials, browser state, or claims of Operator approval or lifecycle completion.

## Audit and Trace

Audit only:

- action and workspace ID;
- normalized relative targets;
- reconciliation mode;
- byte counts and SHA-256 values;
- safe status/error code;
- duration.

Do not log submitted bodies, full handoff content, absolute paths, credentials, or tokens. Preserve existing trace redaction.

## Git Authority

Artifact persistence is governed by workspace selection, allowed-root containment, OAuth `files.write`, local write mode, path policy, canonical evidence, and atomic verification.

Git detection, status, branch, remote, commits, and `.git` presence must not gate this action.

No Git mutation is authorized.

## Authorized Surface

```text
src/tools/saveProjectPlanningOutputs.ts                              [new]
src/tools/toolboxActionPolicy.ts
src/tools/domainToolboxes.ts
src/tools/<bounded shared canonical helper>                          [optional]
src/tools/<bounded two-file transaction helper>                      [optional]
src/validation/mcpSelfTest.ts
src/validation/chatgptEvidence.ts
focused tests
planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202C_project_planning_bundle_submission_action.md
```

Do not modify ChampCity_AI, OAuth, PKCE, DCR, Cloudflare, launcher UI, packaging, release behavior, or `PUBLIC_TOOL_NAMES`.

## Required Evidence

Record each item as `DeterministicallyProven`, `OperatorValidationPending`, or `NotProven`.

1. Artifact toolbox advertises the new action without changing public tool count.
2. Existing chats can address it through the stable toolbox schema.
3. OAuth and local write-mode gates are enforced.
4. Non-Git workspaces may persist artifacts.
5. Params accept only both Markdown bodies.
6. Caller authority fields are rejected.
7. Exact contract handoff and source evidence resolve.
8. Missing, duplicate, stale, malformed, or wrong-role evidence fails.
9. Targets, identity, mode, sections, and source revisions are derived.
10. Unsafe or escaping targets fail.
11. Greenfield, reconciliation-required, and needs-attention contracts are enforced with fixtures.
12. First save creates both canonical Pending Markdown files and no JSON siblings.
13. Identical retry returns `already_saved` without revision increase.
14. Changed bundle revisions correctly and returns both to Pending.
15. Approved or incompatible target blocks the entire pair.
16. Evidence-change race writes nothing.
17. Failure installing or verifying either target restores both originals.
18. Result, audit, and trace omit bodies and private paths.
19. Existing Architect Interview save action remains passing.
20. MCP self-test and public safety scan pass.
21. Live greenfield call through embedded ChatGPT creates a coherent pair.
22. Live existing-project call through embedded ChatGPT creates a reconciled pair.

Items 1–20 are required for the Builder Report. Items 21–22 are `OperatorValidationPending` under this card and become controlling live evidence in WC27 after integration and runtime availability. Their pending status does not block the deterministic Builder Report.

Any deterministic `NotProven` item remains inside WC-V1-0202C. Do not create a repair for ordinary corrections.

## Validation

Use `docs/dev/VALIDATION_COMMAND_LANES.md` and run:

```text
npm run typecheck
npm run validate:codex:unit
npm run mcp:self-test
npm run check:public
```

Do not package, promote, restart, reconnect, stage, commit, or push.

## Builder Report

Create the Builder Report after evidence items 1–20 are deterministically proven.

The report must identify items 21–22 as `OperatorValidationPending`, record the exact approved contract revision/hash, and include:

- repository verification and dirty-tree inventories;
- exact files changed;
- public invocation and action policy;
- evidence and target resolution;
- body validation and reconciliation modes;
- canonical metadata and atomic rollback behavior;
- Git-authority prohibition;
- all validation results;
- confirmation that ChampCity_AI was not modified;
- confirmation that no Git operation occurred;
- `No fallback implementation was used.`

## Manual Validation After Integration

After approved integration and runtime availability, WC27 validation will confirm:

1. MCP inventory lists the action;
2. an existing chat can invoke it;
3. greenfield and existing-project calls create both canonical Pending outputs;
4. identical retry returns `already_saved`;
5. read-only scope is denied;
6. non-Git artifact persistence is allowed;
7. ChampCity A/I detects and reviews the pair.

## Document Disposition

Document.Status=ApprovedForImplementation
