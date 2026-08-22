# Code Review and Root Cause Analysis — OpenAI Safety-Layer False Positives, Tool-Result Delivery Blindness, and Git Coupling

## Review Identity

- Repository: `%USERPROFILE%\Projects\ChampCity_GPT`
- Remote: `ChampCityChris/ChampCity_GPT_MCP`
- Branch reviewed: `dev`
- Starting HEAD: `db6aa399716db271f2b38a6927de33f0f29a55ec`
- Review date: `2026-07-31`
- Review type: Cross-cutting source review and incident RCA
- Priority: P0
- Controlling incident: ChatGPT reported that it could not inspect `planning/project/Project_Architect_Interviews/PROJECT_ARCHITECT_INTERVIEW_revisionary.md` because an OpenAI safety check blocked the MCP call.
- Authorized follow-on work cards:
  - `WC-V1-0104B — Result Delivery Telemetry, Acknowledgement, and Failure Attribution`
  - `WC-V1-0202G — Bounded Text Projection and Safety-Resilient Read Protocol`
  - `WC-V1-0202H — Workspace Capability Model and Git Isolation`

## Executive Disposition

The incident is real, but the original assistant explanation was not sufficiently precise.

ChampCity MCP cannot currently determine whether ChatGPT actually consumed a returned result. The server records receipt, dispatch, helper execution, tool return, and HTTP completion. It does not record the serialized response dimensions, socket-delivery evidence, or a client acknowledgement after content consumption. A server-side `RESPONSE_COMPLETED` classification therefore means only that ChampCity MCP completed its HTTP response. It does not prove that the ChatGPT host accepted, exposed, or supplied the content to the model.

The alleged safety-blocked `repo_toolbox.read_file` attempt is not represented by a corresponding server-side denial. A later read of the exact same path and the exact 41,389-byte document completed successfully. The document contains benign education-product planning content involving teachers, students, grades, privacy, educational records, and OpenAI integration. Because the identical content later succeeded, the evidence does not support a deterministic rule that the words `student`, `minor`, or similar terms alone caused the block.

The most defensible causal conclusion is:

1. the ChatGPT platform intermittently blocked or suppressed a tool call or result outside the ChampCity MCP application boundary;
2. ChampCity MCP returned large text documents as one JSON-escaped MCP text item, increasing dependence on a single opaque host-side content decision;
3. ChampCity MCP had no bounded range/section fallback and no delivery acknowledgement protocol;
4. the model then attempted an unsupported `artifact_toolbox.read_markdown_artifact` action because action-specific contracts are not fully discoverable on the generic toolbox surface;
5. diagnostics mislabeled that contract error as an application policy denial; and
6. a general-sounding `public_safety_status` action invoked a Git-only readiness function against the non-Git Revisionary workspace, adding an unrelated `GIT_REQUIRED` failure to the incident.

The workspace ID `revisionary` was correct. It identifies the project being planned. The workspace ID `champcity_gpt` identifies the repository containing the MCP service itself. These are intentionally different roles and must remain distinct.

The external OpenAI safety classifier cannot be disabled or rewritten from this repository. It is therefore impossible to guarantee that no future host-side false positive will occur. The implementable objective is to eliminate large single-payload dependence, make failures attributable to the correct boundary, provide deterministic bounded retries, and ensure that Git can never break or contaminate non-Git planning workflows.

## Repository State and Preservation

The repository was already dirty before this review. Current status identifies an unrelated tracked modification outside the four documents created by this review:

- `docs/CHATGPT_CONNECTION_GUIDE.md`

This review did not modify that file. It did not reset, restore, discard, stage, commit, push, merge, integrate, package, promote, restart, reconnect, publish, or release anything. That modification and every other unrelated change discovered at implementation start must remain untouched.

## Review Scope

The review inspected the governing planning records and the production/test paths responsible for:

- workspace registration and authority;
- artifact persistence and Git mutation authority;
- repository and artifact reads;
- public toolbox schemas and action routing;
- action-level OAuth policy;
- result serialization;
- HTTP MCP request and response handling;
- request-bound tool-call trace persistence;
- audit logging and redaction;
- artifact catalog reads and corpus exports;
- diagnostic action naming and implementation;
- runtime-versus-workspace provenance checks; and
- tests that encode current behavior.

Primary files reviewed:

- `AGENTS.MD`
- `src/workspaces.ts`
- `src/workspaceAuthority.ts`
- `src/workspaceWritePolicy.ts`
- `src/tools/domainToolboxes.ts`
- `src/tools/toolboxActionPolicy.ts`
- `src/tools/readProjectFile.ts`
- `src/tools/artifactCatalog.ts`
- `src/tools/publicSafeFacade.ts`
- `src/tools/common.ts`
- `src/server/registerTools.ts`
- `src/server/toolCallTrace.ts`
- `src/transports/httpTransport.ts`
- `src/security/auditLog.ts`
- `src/security/diagnosticRedaction.ts`
- `src/utils/errorClassification.ts`
- `tests/domainToolboxes.test.ts`
- `tests/toolCallTrace.test.ts`
- existing v1.0 work cards governing trace and Git-independent artifact persistence.

This was a complete review of the incident-relevant architecture and its directly coupled production/test surfaces. It was not a claim that every unrelated line in the repository was re-reviewed.

## Incident Evidence

### 1. Exact document behavior

The target document was later read successfully through:

- public tool: `repo_toolbox`
- action: `read_file`
- workspace: `revisionary`
- path: `planning/project/Project_Architect_Interviews/PROJECT_ARCHITECT_INTERVIEW_revisionary.md`
- size: `41,389` bytes
- SHA-256: `166febdeba8e828aecedf86b4ad9cee46f9a68caed0320a1648255d26c0f5e60`

The successful content is a normal Project Architect Interview for an educational writing-analysis application. It contains repeated references to students, teachers, grades 8–12, educational records, aliases, PII, provider governance, and school/district deployment. It does not contain instructions for exploitation, sexual content involving minors, or other substantively prohibited material.

Conclusion: the exact document is readable by the current MCP action. A lexical claim that `students` or `minors` deterministically triggers the block is disproved by the successful identical read. A context-sensitive or intermittent platform decision remains plausible.

### 2. Unsupported artifact action

The attempted action:

`artifact_toolbox.read_markdown_artifact`

is not part of `TOOLBOX_ACTION_POLICY` and is not implemented by `artifactToolbox`. The application correctly returned:

- code: `INVALID_INPUT`
- message: `Unsupported toolbox action.`

This was not an OpenAI safety denial and was not a repository read failure. It was a contract-selection failure by the calling model.

### 3. Artifact-list attempt

The server trace contains successful `artifact_toolbox.list_artifacts` calls in the same environment. The reported safety-blocked list attempt does not have a matching server denial record. That leaves two possible external-boundary cases:

- the host prevented the tool call before it reached ChampCity MCP; or
- the call/result was blocked in a layer not observable through current MCP logs.

The existing evidence cannot distinguish those cases.

### 4. Git diagnostic failure

`diagnostics_toolbox.public_safety_status` calls `getChangeSetReadinessSummary`, which resolves the selected workspace through a helper that throws `GIT_REQUIRED` when `.git` is absent. On `revisionary`, this produced:

`Configured workspace is not a git repository.`

That result is technically accurate only for Git change-set readiness. It is misleading as a general public-safety assessment because Revisionary remains valid for file reads and canonical Markdown artifact persistence.

## Root Cause Analysis

## RC-1 — Opaque Host-Side Safety or Result-Handling Boundary

### Classification

External dependency defect; confirmed boundary, unconfirmed internal classifier rule.

### Evidence

- The reported error text is generated by the ChatGPT/OpenAI host, not by ChampCity MCP.
- ChampCity MCP has no error code or policy named after the quoted OpenAI safety message.
- The exact document later succeeded through the same public action.
- Current logs cannot record a platform classifier decision.

### Root cause

The platform may independently evaluate tool arguments, tool results, or the model-visible representation of those results. ChampCity MCP does not control that evaluation and receives no structured callback explaining the rule, classifier, content span, or decision stage.

### What cannot honestly be concluded

- It cannot be proven that the word `minor` caused the incident.
- It cannot be proven that the original blocked call reached the server unless a matching correlation is identified.
- It cannot be proven from server logs that a completed HTTP response was consumed by ChatGPT.

### Required engineering response

Treat platform acceptance as a separate delivery stage. Add bounded result formats, delivery receipts, acknowledgement, and a repeatable live canary matrix. Do not treat HTTP completion as model consumption.

## RC-2 — Large Single-Item Text Result Serialization

### Classification

Internal architectural defect; confirmed.

### Evidence

`readProjectFile` reads the entire UTF-8 file and returns the complete string in `result.content`.

`toolResponse` then executes:

`JSON.stringify(data, null, 2)`

and places the entire serialized object into one MCP text content item.

The same pattern affects:

- `repo_toolbox.read_file`;
- `artifact_toolbox.read_artifact_by_id` for Markdown up to approximately 200 KB;
- `artifact_toolbox.latest_artifact` with content;
- `artifact_toolbox.export_planning_corpus` with full text; and
- other toolbox actions returning substantial nested text.

### Root cause

The public result boundary was designed around convenient JSON serialization rather than robust delivery through an opaque host classifier. There is no default chunk size, line cursor, heading index, section read, content handle, or multi-block serializer.

### Consequence

One false positive invalidates the entire controlling document read. The model has no supported way to ask for a smaller exact range and continue without improvising.

## RC-3 — No Result Materialization, Serialization, or Client-Acknowledgement Evidence

### Classification

Internal observability defect; confirmed.

### Evidence

Current trace stages are:

- `http_received`
- `dispatch_started`
- `toolbox_entered`
- `helper_started`
- `helper_allowed`
- `helper_denied`
- `tool_result_returned`
- `http_response_completed`
- `transport_error`

The trace does not persist:

- result byte count;
- serialized byte count;
- result SHA-256;
- serializer name/version;
- content item count and types;
- maximum content-item size;
- top-level result keys;
- truncation or chunk metadata;
- response body byte count;
- response `finish`, `close`, or socket-error evidence;
- an acknowledgement that ChatGPT consumed the result.

`tool_result_returned` is logged before `toolResponse` finishes serializing the result. `http_response_completed` is recorded after the MCP transport handler returns, not after a client acknowledgement.

### Root cause

Earlier trace repairs focused correctly on request identity and server lifecycle, but the trace model stops at the server boundary. It does not model result delivery as a separate protocol.

### Consequence

The server can prove that it executed a helper and returned a response, but not that the caller received usable content. Assistant statements such as “MCP could not read the file” or “the server definitely returned content to the model” cannot be adjudicated precisely.

## RC-4 — Incomplete Action Contract Discoverability

### Classification

Internal tool-contract defect; confirmed.

### Evidence

The public toolbox schema exposes only:

- `action: string`
- optional `workspaceId`
- generic `params: object`

Action-specific parameter schemas are enforced internally but are not represented in the public JSON schema.

`TOOLBOX_ACTION_POLICY` is a complete action registry for all seven toolboxes. However, `mcp_tool_inventory` reports explicit action lists only for a subset of toolboxes and omits complete contract descriptions for repository, integration, and browser actions.

The model attempted the nonexistent `artifact_toolbox.read_markdown_artifact` action even though the supported alternatives were:

- `repo_toolbox.read_file`; or
- `artifact_toolbox.read_artifact_by_id` after artifact discovery.

### Root cause

The public contract is stable but intentionally generic. The implementation lacks a complete, model-readable action-description endpoint and precise corrective recommendations for unsupported actions.

### Consequence

The calling model can hallucinate plausible action names. The resulting error is then easy to misinterpret as another safety failure.

## RC-5 — Contract Errors Are Classified as Policy Denials

### Classification

Internal diagnostic taxonomy defect; confirmed.

### Evidence

`src/utils/errorClassification.ts` classifies `INVALID_INPUT` as `policy`.

`toolCallTrace.classify` therefore labels unsupported actions and malformed action parameters as:

`APP_POLICY_DENIED`

### Root cause

Validation/contract errors, security-policy denials, and authorization denials were grouped under one broad category.

### Consequence

An unsupported action looks like a safety or policy rejection. This materially degrades RCA quality.

### Required taxonomy

At minimum, distinguish:

- `APP_CONTRACT_REJECTED`
- `APP_POLICY_DENIED`
- `APP_AUTHORIZATION_DENIED`
- `APP_EXECUTION_ERROR`
- `TRANSPORT_ERROR`
- `RESPONSE_FINISHED_UNACKNOWLEDGED`
- `CLIENT_ACKNOWLEDGED`
- `NO_SERVER_RECEIPT_EVIDENCE`

## RC-6 — Git-Centric General Diagnostics

### Classification

Internal architecture and naming defect; confirmed.

### Evidence

`public_safety_status` calls `getChangeSetReadinessSummary`.

`getChangeSetReadinessSummary` calls `resolveWorkspaceContext` in `publicSafeFacade.ts`.

`resolveWorkspaceContext` throws `GIT_REQUIRED` when `.git` is absent.

The same Git-only context resolver supports `getWorkspaceStatusSummary`, meaning `repo_toolbox.status` is also effectively a Git status operation despite residing in the repository toolbox.

### Root cause

A facade originally built for public-repository and release safety was reused as a general workspace diagnostic surface. Git readiness and workspace safety were not separated by capability.

### Consequence

A non-Git planning workspace can successfully read and persist documents while a general-sounding safety diagnostic reports failure. This creates false workflow blockers and encourages the model to conflate “not a Git repository” with “not a valid ChampCity workspace.”

## RC-7 — Workspace Policy Naming Preserves Git as the Default Mental Model

### Classification

Internal domain-model defect; confirmed but partially mitigated by prior repair.

### Evidence

Persisted workspace policy values are:

- `git_required`
- `artifact_only`

The current `artifact_persistence` authority correctly does not require Git for a `git_required` workspace. `list_workspaces` also correctly reports artifact persistence as available for Revisionary while Git mutation is unavailable.

However, the policy name `git_required` remains attached to a non-Git workspace and produces warnings such as:

`git_required workspace does not currently contain .git; artifact persistence remains available but Git mutation is unavailable.`

### Root cause

The policy enum encodes implementation history rather than independent capabilities.

### Consequence

The system continually reintroduces Git into discussions and diagnostics that have nothing to do with source control.

### Required direction

Migrate from a single write-policy enum to independent capabilities. Preserve backward compatibility when reading existing configuration, but do not use `git_required` as authority for file reads, artifact persistence, general diagnostics, or planning workflows.

## RC-8 — Runtime Diagnostics Compare the MCP Service to the Target Project

### Classification

Internal workspace-role conflation defect; confirmed.

### Evidence

`buildRuntimeScopeToolDiagnostics` compares:

- the running ChampCity GPT package version and source commit; against
- the package metadata and Git HEAD of the selected target workspace.

Tests explicitly require a warning when the selected workspace package version differs from the ChampCity GPT runtime package version.

This is meaningful only when the selected workspace is `champcity_gpt`. It is meaningless when the target is Revisionary, ChampCity AI, ChampCity RP Desktop, or any unrelated project.

### Root cause

Service-runtime provenance and target-workspace state are represented in one diagnostic record without role separation.

### Consequence

Normal differences between products can be reported as runtime drift. A non-Git target can also produce irrelevant unknown Git provenance.

## Confirmed Non-Causes

The following were not root causes of the document-read incident:

- using workspace ID `revisionary`;
- absence of `.git` in Revisionary for the read itself;
- OAuth `files.read` scope;
- ChampCity MCP path-policy denial;
- file-size denial at 41,389 bytes;
- binary-file detection;
- deterministic prohibition of education terminology; or
- lack of artifact persistence authority.

## Required Solution Architecture

## 1. End-to-End Result Delivery Evidence

Add a delivery-attempt identity distinct from request correlation. Every potentially substantive result must have:

- `correlationId`
- `resultAttemptId`
- `attemptNumber`
- `serializer`
- `payloadBytes`
- `payloadSha256`
- content item count/types
- maximum content item bytes
- truncation/chunk indicators
- source file SHA when applicable
- HTTP finish/close/error evidence
- optional client acknowledgement.

No document content, prompt text, patch text, credential, absolute path, or secret may be persisted in telemetry.

## 2. Bounded Exact Text Projection

Introduce shared read primitives:

- inspect text metadata and Markdown headings without returning full content;
- read an exact line range or opaque-cursor chunk under a strict byte limit;
- read an exact Markdown section with pagination;
- return source SHA, range, chunk SHA, next cursor, and completion state;
- use the same primitive from repository and artifact workflows.

Large whole-file reads must default to a bounded projection rather than a single JSON-escaped response.

## 3. Multi-Block/Structured Result Serialization

For bounded text reads, return:

- a short human-readable metadata text block;
- one or more bounded text content blocks; and
- structured metadata without duplicating the full content.

Do not base64-, hex-, compress-, obfuscate-, or transform text to evade safety systems. The solution must remain transparent, exact, and auditable.

## 4. Deterministic Retry Protocol

When a host blocks a full or larger result, the next attempt must be mechanically smaller and identified as a retry of the same source SHA. The model must not invent alternate actions.

The preferred progression is:

1. `inspect_text_file`
2. `read_text_chunk` using an opaque server cursor
3. continue until `complete=true`
4. acknowledge consumed chunks when delivery diagnostics are active.

## 5. Complete Action Contract Discovery

Expose every action in all seven toolboxes with:

- required scope;
- exact accepted parameter names and bounds;
- result mode;
- deprecation state;
- recommended replacement for obsolete/unsupported actions.

Unsupported `read_markdown_artifact` must return a contract error that explicitly recommends the valid alternatives.

## 6. Git Isolation

General workspace operations must not call Git helpers. Git checks belong only in `git_toolbox` and explicitly Git/release-specific artifact actions.

Required separation:

- `workspace_status`: filesystem/configuration/artifact capability; no Git requirement;
- `workspace_safety_status`: allowed-root, path-policy, audit, read/write capability; no Git requirement;
- `git_toolbox.status`: optional Git status;
- `git_toolbox.readiness_summary`: optional Git change-set readiness;
- release-publication actions: explicitly Git/repository-dependent.

`GIT_REQUIRED` must never escape from repository reads, artifact reads/writes, planning corpus operations, general diagnostics, or workspace enumeration.

## 7. Runtime and Target Workspace Role Separation

Runtime provenance must always describe the ChampCity GPT service installation and its own source/package identity.

Target workspace diagnostics must separately describe the selected project. The system must never compare Revisionary’s package version or Git HEAD against the ChampCity GPT runtime and call the difference drift.

## Work Card Decomposition

### WC-V1-0104B

Implements result-attempt telemetry, response materialization/serialization evidence, HTTP finish/close evidence, acknowledgement, delivery-status queries, and corrected error taxonomy.

### WC-V1-0202G

Implements bounded file/Markdown inspection and chunk projection, multi-block result serialization, deterministic retries, complete action-contract discovery, and a live canary matrix using benign sensitive-vocabulary fixtures.

### WC-V1-0202H

Implements independent workspace capabilities, removes Git from general workspace/repository diagnostics, separates service runtime from target workspace provenance, and confines `GIT_REQUIRED` to explicit Git operations.

## Sequencing

Required order:

1. `WC-V1-0104B`
2. `WC-V1-0202G`
3. `WC-V1-0202H`
4. package/promote/reconnect only after Architect review of all three Builder Reports
5. live ChatGPT reproduction matrix

The telemetry card must precede the read-protocol card so live tests can identify where each attempt stopped. Git isolation can be implemented in parallel only if touched shared files do not overlap; otherwise follow the stated sequence.

## Acceptance Direction

The combined repair is acceptable only when all of the following are true:

1. The exact Revisionary Architect Interview can be consumed through bounded exact reads without requiring one 41 KB text item.
2. Every returned chunk is bound to the source SHA and exact line/byte range.
3. A blocked or abandoned attempt can be distinguished from an application denial, contract rejection, execution failure, transport failure, completed-but-unacknowledged response, and acknowledged response.
4. No telemetry contains document text or secrets.
5. Unsupported toolbox actions are reported as contract rejections, not policy denials.
6. The complete seven-toolbox action contract is discoverable.
7. `revisionary` passes general workspace status and safety diagnostics without `.git`.
8. Revisionary reads and canonical Markdown writes do not execute Git commands.
9. Explicit Git actions against Revisionary return a localized not-Git capability result and do not poison the broader workflow.
10. Runtime diagnostics do not compare the ChampCity GPT service package to an unrelated target project.
11. Existing public tool count and stable toolbox names remain unchanged unless a separately reviewed public-surface change is explicitly authorized.
12. Existing path, OAuth, write-mode, artifact-root, secret-redaction, and request-ID protections remain passing.

## Limitation and External Escalation Evidence

No repository change can guarantee that OpenAI will never produce another false positive. A genuine external escalation package requires:

- UTC timestamp;
- ChatGPT conversation identifier when available to the Operator;
- public tool/action/workspace/path;
- correlation and result-attempt IDs;
- payload byte count and SHA-256;
- serializer and content-item dimensions;
- server receipt/dispatch/result/HTTP lifecycle;
- acknowledgement state;
- exact benign fixture identifier;
- platform error text captured by the Operator.

The new design must produce that package without logging the protected document itself.

## Final Disposition

- OpenAI safety-layer false positive: `Confirmed as an external-boundary failure class; exact internal classifier rule not observable.`
- Deterministic trigger by education/minor terminology: `Not supported; identical content later succeeded.`
- ChampCity MCP large-result resilience: `Defective.`
- ChampCity MCP failure attribution: `Insufficient.`
- Toolbox action discoverability: `Defective.`
- Contract-versus-policy error taxonomy: `Defective.`
- Revisionary workspace selection: `Correct.`
- Git requirement for Revisionary planning workflow: `Invalid and must be isolated.`
- Implementation authority: `Approved through the three work cards listed above.`

## Document Disposition

Document.Status=Approved
