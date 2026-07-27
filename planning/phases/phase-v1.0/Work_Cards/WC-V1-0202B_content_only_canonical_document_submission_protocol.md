# WC-V1-0202B — Content-Only Canonical Document Submission Protocol

## Work Card Identity

- ID: `WC-V1-0202B`
- Title: Content-Only Canonical Document Submission Protocol
- Phase: v1.0 — ChatGPT Connector and Safety-Layer Reliability
- Parent planning area: `WC-V1-0202 — Implement v1.0 permission modes and toolsets`
- Priority: P0
- Type: Bounded MCP protocol and artifact-toolbox extension
- Owner mode: Architect specifies; Codex/Implementer implements; Architect reviews; Operator performs later live validation
- Repository: `%USERPROFILE%\Projects\ChampCity_GPT`
- Remote: `ChampCityChris/ChampCity_GPT_MCP`
- Expected branch: `dev`
- Source architecture: ChampCity A/I `planning/project/Design_Documents/APPLICATION_OWNED_CANONICAL_DOCUMENT_CONSTRUCTION.md`
- Source application repair: ChampCity A/I `planning/phases/phase-08/Work_Cards/WC25-REPAIR02_embedded_browser_status_context_menu_reload_and_feedback_semantics_repair.md`
- Required Builder Report: `planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202B_content_only_canonical_document_submission_protocol.md`

## Authorization and Repository Boundary

This Work Card is approved for Implementer execution by the Operator through ChatGPT.

Implementation authority is limited to the `ChampCity_GPT` repository. This card does not authorize source or planning changes in `ChampCity_AI`.

Git mutation is not authorized. Do not stage, commit, push, merge, rebase, tag, reset, clean, restore, or stash.

The repository is already dirty. Record the exact starting dirty-tree inventory and preserve every unrelated or prior-pass change. Do not replace whole shared files without reconciling their current diff.

## Dependency Gate

Do not invent the receiving protocol.

Before implementation, verify that ChampCity A/I WC25-REPAIR02 has produced a stable application-side contract defining all of the following:

- creation-contract identity format;
- creation-contract repository lookup or discovery location;
- content schema identifier and version;
- permitted substantive payload fields;
- contract freshness, supersession, and invalidation semantics;
- application-controlled submission destination or handoff mechanism;
- submission receipt or acknowledgement format;
- maximum payload size and any document-specific limits;
- the rule excluding creation contracts and content submissions from workflow-document discovery and disposition resolution.

The Implementer may read the approved ChampCity A/I design and implementation evidence through ChampCity MCP. It may not modify ChampCity A/I.

If the application-side protocol is absent, still changing, ambiguous, or requires the MCP server to invent canonical-document rules, stop and report the exact dependency blocker. No fallback protocol is authorized.

## Problem Statement

Generic Markdown and JSON write actions require ChatGPT to construct complete governed workflow artifacts. That exposes canonical paths, source revisions, field names, participation roles, dispositions, sibling synchronization, and serialization to language-model drift.

ChampCity A/I now owns canonical document construction. ChatGPT must submit only substantive content against an application-generated creation contract.

ChampCity_GPT needs one bounded MCP adapter that transports that content without becoming a second document authority, serializer, workflow resolver, or canonical artifact writer.

## Objective

Add one stable artifact-toolbox action:

```text
artifact_toolbox.submit_document_content
```

Equivalent naming requires Architect approval. Do not expose a new top-level MCP tool when the stable artifact toolbox can carry the action.

The action must:

1. resolve an explicitly configured workspace;
2. resolve the exact application-generated creation contract;
3. validate that the contract is current and usable;
4. validate the substantive content against the contract-defined schema;
5. deliver the content only through the application-defined submission boundary;
6. return a bounded receipt;
7. never claim that the canonical Markdown/JSON artifact was created;
8. never accept caller-controlled canonical envelope or target authority.

## Public Action Contract

The public toolbox call is limited to:

```json
{
  "action": "submit_document_content",
  "workspaceId": "<configured-workspace-id>",
  "params": {
    "creationContractId": "<application-issued-contract-id>",
    "content": {}
  }
}
```

The exact `content` shape is document-specific and validated from the resolved creation contract. The outer action schema must not allow unknown top-level fields.

### Permitted caller inputs

- configured `workspaceId`;
- application-issued `creationContractId`;
- substantive `content` only.

### Prohibited caller inputs

Reject, rather than ignore:

- filesystem root or absolute path;
- repository-relative canonical target path;
- submission destination path;
- artifact type;
- artifact revision;
- participation role;
- source revisions;
- output targets;
- disposition;
- review metadata;
- project, phase, Work Card, repair, candidate, or attempt identity when derivable from the contract;
- Markdown envelope;
- serialized canonical JSON;
- serializer, renderer, template, or schema selection;
- arbitrary schema definitions;
- shell commands, scripts, environment variables, URLs, or executable instructions;
- overwrite flags for canonical workflow artifacts;
- generic upstream MCP passthrough parameters.

Unknown keys must fail strict validation.

## Authority Boundary

ChampCity_GPT is a transport and policy-enforcement adapter only.

It must not:

- construct canonical workflow Markdown;
- construct canonical workflow JSON;
- choose canonical paths;
- resolve source revisions independently of the application contract;
- calculate artifact revisions;
- assign participation roles or dispositions;
- infer workflow progression;
- mutate existing governed artifacts;
- repair malformed canonical documents;
- mark a creation contract consumed unless the application-defined protocol explicitly delegates that bounded operation;
- report downstream workflow completion.

ChampCity A/I remains the sole authority for validation, canonical serialization, atomic sibling writing, production-parser verification, and lifecycle progression.

## Creation-Contract Resolution

Use the exact application-defined discovery mechanism.

Required invariants:

1. The contract must belong to the selected configured workspace.
2. Contract lookup must be deterministic; no broad filename search or newest-file heuristic.
3. The contract ID must match exactly.
4. The contract must identify one supported content schema and version.
5. The contract must be current for the repository evidence/context key it records.
6. Superseded, stale, expired, consumed, ambiguous, malformed, or missing contracts must fail with structured evidence.
7. The caller cannot choose a schema or contract location.
8. Contract contents are not returned wholesale to ChatGPT when a minimal safe projection is sufficient.
9. Absolute local roots and private paths remain redacted from responses and audit output.

If the application protocol uses a contract registry rather than contract files, implement the exact registry adapter. Do not substitute file scanning.

## Content Validation

Validate content before any persistence or delivery.

Requirements:

- strict object validation;
- contract-defined schema identifier and version;
- reject unknown content fields unless the contract explicitly permits them;
- enforce required and optional fields;
- enforce string, number, boolean, array, object, enum, and nullability rules;
- enforce maximum payload size, nesting depth, array length, string length, and key count;
- reject prototype-pollution keys and unsafe object shapes;
- reject binary, base64 file payloads, executable content, and file references unless a future separately approved contract explicitly supports them;
- preserve substantive text exactly after schema normalization; do not summarize, rewrite, or fabricate content;
- do not validate canonical envelope fields because callers are prohibited from supplying them.

Use existing repository schema conventions, expected to be Zod. Do not add a dependency unless the repository lacks a suitable current validator and the Architect explicitly approves one.

## Submission Delivery

Use only the application-defined submission destination or transport.

The delivery implementation must:

- derive the destination entirely from the resolved contract and server configuration;
- prevent traversal, absolute paths, symlink/junction/reparse-point escape, and non-regular target replacement;
- require OAuth `files.write` and an applicable local write mode when persistence is used;
- comply with the selected workspace write policy and configured artifact/submission roots;
- write atomically when the protocol uses a repository submission file;
- avoid canonical workflow target paths;
- avoid `planningDocumentService` artifact naming conventions unless the application protocol explicitly defines a non-workflow inbox beneath an excluded path;
- avoid Git commands unless the receiving protocol explicitly requires a Git-backed write policy; this action itself does not authorize Git mutation;
- avoid arbitrary callback URLs, local sockets, subprocesses, shell commands, or unapproved IPC;
- create a unique application-compatible submission or receipt identity when required by the protocol;
- never overwrite a prior submission silently;
- return success only after the submission is durably delivered and re-read or otherwise acknowledged according to the application protocol.

The action response must distinguish:

```text
content submission accepted by transport
```

from:

```text
canonical artifact created and verified by ChampCity A/I
```

The latter must never be claimed by ChampCity_GPT unless a future application acknowledgement protocol explicitly provides that evidence.

## Receipt Contract

Return only bounded safe fields, expected to include:

- toolbox and action;
- workspace ID;
- creation-contract ID;
- submission or receipt ID;
- transport status;
- schema ID and version;
- accepted timestamp when applicable;
- safe next action indicating that ChampCity A/I must consume and verify the submission.

Do not return:

- absolute roots;
- canonical target paths unless the application contract explicitly classifies them as safe and necessary;
- full creation-contract contents;
- submitted content;
- credentials, tokens, cookies, browser state, account identity, or environment data;
- claims about canonical artifact or lifecycle completion.

## Toolbox Integration

Integrate through the existing stable artifact toolbox.

Expected implementation areas may include:

- `src/tools/domainToolboxes.ts`
- `src/server/registerTools.ts`
- a focused module under `src/tools/`, `src/artifacts/`, or `src/integrations/` for creation-contract resolution, schema validation, and submission delivery
- `src/config.ts` or `src/workspaces.ts` only if the approved application protocol requires bounded configured submission roots or capabilities
- `src/security/filePolicy.ts` and `src/security/pathPolicy.ts` only where necessary for the dedicated submission boundary
- `src/utils/errors.ts` only for structured protocol errors
- `src/validation/mcpSelfTest.ts`
- `tests/domainToolboxes.test.ts`
- focused new tests for the content-submission protocol
- `tests/toolSchema.test.ts`
- `docs/TOOL_REFERENCE.md`
- `docs/SECURITY_MODEL.md`
- `docs/CHATGPT_CONNECTION_GUIDE.md` only where the Operator workflow must be documented
- `planning/phases/phase-v1.0/CHATGPT_CONNECTOR_ACCEPTANCE_MATRIX.md`
- the required Builder Report

Do not redesign unrelated toolbox actions, OAuth, browser authentication, trace infrastructure, package promotion, launcher UI, release plumbing, or generic file writers.

## Existing Generic Writer Boundary

Do not remove generic Markdown/JSON artifact actions under this card. They remain available for their separately governed use cases.

However:

- documentation must state that generic writers are not the default path for application-governed canonical workflow artifacts;
- `submit_document_content` must not internally delegate to a generic writer with caller-controlled paths;
- tool descriptions must clearly distinguish content submission from canonical artifact creation;
- no broad compatibility alias may permit complete canonical envelopes through the new action.

## Error Semantics

Use structured errors that distinguish at minimum:

- `CREATION_CONTRACT_NOT_FOUND`
- `CREATION_CONTRACT_STALE`
- `CREATION_CONTRACT_SUPERSEDED`
- `CREATION_CONTRACT_UNUSABLE`
- `CONTENT_SCHEMA_UNSUPPORTED`
- `CONTENT_SCHEMA_VALIDATION_FAILED`
- `CALLER_AUTHORITY_FIELD_DENIED`
- `SUBMISSION_DESTINATION_DENIED`
- `SUBMISSION_ALREADY_EXISTS`
- `SUBMISSION_DELIVERY_FAILED`
- OAuth scope denial
- local write-mode denial
- workspace-policy denial

Equivalent existing error conventions are acceptable. Do not collapse these into a generic invalid-input response when safe, actionable detail is available.

## Audit and Redaction

Audit metadata may include:

- action name;
- workspace ID;
- creation-contract ID or safe hash;
- schema ID/version;
- payload byte count;
- result status;
- safe error code;
- submission/receipt ID.

Do not audit:

- substantive content;
- full contract contents;
- canonical or local absolute paths;
- credentials, tokens, cookies, clipboard content, account identity, or browser content.

Tool-call trace behavior must preserve the repository's approved parameter-name-only and type/shape-safe redaction rules.

## Required Deterministic Tests

1. Artifact toolbox advertises `submit_document_content` in the supported action list.
2. Tool schema accepts only workspace ID, creation-contract ID, and content.
3. Unknown outer params are rejected.
4. Caller-supplied canonical target path is rejected.
5. Caller-supplied source revisions are rejected.
6. Caller-supplied role, disposition, artifact type, or revision is rejected.
7. Caller-supplied schema or serializer selection is rejected.
8. Exact configured workspace resolution is required.
9. Missing workspace ID is rejected when multiple workspaces exist.
10. Exact creation-contract lookup succeeds.
11. Broad search or newest-contract selection is not used.
12. Missing contract returns structured failure.
13. Stale contract returns structured failure.
14. Superseded or consumed contract returns structured failure according to the application protocol.
15. Contract from another workspace is rejected.
16. Unsupported content schema/version is rejected.
17. Missing required substantive fields are rejected.
18. Unknown substantive fields are rejected when the schema is closed.
19. Type, enum, size, depth, array, key-count, and string-length limits are enforced.
20. Prototype-pollution and unsafe object keys are rejected.
21. Valid substantive content is preserved without rewriting.
22. Destination is derived only from the contract/configuration.
23. Traversal, absolute path, symlink, junction, reparse-point, and escape attempts are rejected.
24. Canonical workflow target paths cannot be used as submission destinations unless the approved protocol explicitly defines a non-workflow excluded destination there.
25. OAuth and local write-mode gates remain enforced.
26. Workspace write policy remains enforced.
27. Atomic delivery succeeds for the approved persistence mechanism.
28. Existing submission overwrite is denied.
29. Delivery failure does not return success.
30. Receipt omits substantive content and absolute roots.
31. Response does not claim canonical artifact creation or workflow completion.
32. Content submissions are not surfaced by artifact discovery or review queues when the approved protocol stores them in the workspace.
33. Generic Markdown/JSON writers remain behaviorally unchanged.
34. Existing toolbox actions remain registered and passing.
35. MCP self-test recognizes the new action and remains green.
36. Public safety scan remains green.
37. Tool-call trace does not record substantive content.
38. A curated integration fixture proves ChampCity A/I-compatible contract → content submission → bounded receipt behavior without requiring live browser credentials.

## Validation Requirements

Before child-process validation, read the repository's validation-lane documentation and use the approved normal Windows lane.

Run in order:

1. repository-defined typecheck;
2. focused content-submission schema tests;
3. focused contract-resolution tests;
4. focused destination, file-policy, and write-gate tests;
5. focused artifact-toolbox dispatch tests;
6. focused trace/redaction tests;
7. repository-defined build;
8. repository-defined full unit lane;
9. MCP self-test with JSON output;
10. public safety scan;
11. lint when defined;
12. `git diff --check`.

Do not package or promote the runtime.
Do not restart or reconnect the active connector.
Do not perform live ChatGPT validation during implementation.
Do not modify ChampCity A/I.

## Builder Report Requirements

Create:

`planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202B_content_only_canonical_document_submission_protocol.md`

The report must include:

- repository identity, branch, remote, HEAD, and exact starting/final dirty state;
- application-protocol dependency verification and exact source revision/hash used;
- files created, modified, and deleted;
- pre-existing dirty changes preserved;
- final public action schema;
- contract-resolution mechanism;
- content-schema validation design;
- destination and write-policy controls;
- receipt contract;
- authority boundary showing what remains owned by ChampCity A/I;
- audit and redaction behavior;
- exact test inventory and results for all 38 required checks;
- typecheck, build, full test, self-test, public-safety, lint, and diff-check results;
- remaining Operator validation;
- blockers and assumptions;
- confirmation that no source or planning change occurred in ChampCity A/I;
- confirmation that no Git operation, package, promotion, restart, reconnect, publication, or release occurred;
- explicit statement: `No fallback implementation was used.`

## Stop Conditions

Stop and report instead of improvising if:

- the stable ChampCity A/I creation-contract protocol cannot be identified;
- the application protocol requires inventing a second schema or canonical document model in ChampCity_GPT;
- the action would need caller-supplied target paths or envelope metadata;
- content cannot be validated without accepting arbitrary schemas;
- the submission cannot be excluded from workflow artifact discovery;
- delivery requires arbitrary commands, unapproved IPC, browser automation, external callbacks, or generic upstream MCP passthrough;
- implementation would expose substantive content in audit or trace logs;
- existing toolbox safety, OAuth, write-mode, workspace, or path-policy controls would be weakened;
- implementation requires changing ChampCity A/I;
- a fallback architecture is required.

No fallback is authorized.

## Manual Validation After Codex

Report these steps as not performed:

1. Architect reviews the Builder Report and complete ChampCity_GPT diff.
2. Architect verifies that the implementation exactly consumes the approved ChampCity A/I protocol.
3. After approval, a separately authorized pass integrates the change.
4. A separately authorized pass packages and promotes the runtime.
5. Operator restarts ChampCity MCP and reconnects ChatGPT.
6. Operator opens the ChampCity A/I Architect Interview workspace with a current creation contract.
7. Operator copies or invokes the application handoff in embedded ChatGPT.
8. ChatGPT calls `artifact_toolbox.submit_document_content` with substantive content only.
9. Operator confirms the MCP response reports a content-submission receipt, not canonical artifact completion.
10. Operator confirms ChampCity A/I consumes the submission, constructs and verifies the canonical pair, and progresses through its own workflow.
11. Operator confirms stale-contract and caller-authority-field attempts are denied.
12. Operator confirms submitted content and private paths do not appear in trace or audit output.

## Remaining Passes

After implementation:

- Architect review;
- authorized Git integration if approved;
- separate package-and-promote pass;
- connector restart and reconnect;
- live embedded ChatGPT content-submission validation with ChampCity A/I;
- final acceptance-matrix disposition.

## Document Disposition

Document.Status=ApprovedForImplementation
