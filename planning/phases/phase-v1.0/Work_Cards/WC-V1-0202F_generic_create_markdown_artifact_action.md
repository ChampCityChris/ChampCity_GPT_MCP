<!-- CHAMPCITY-METADATA
{
  "schemaVersion": 1,
  "artifactType": "work-card",
  "artifactRevision": 1,
  "participationRole": "gatingReview",
  "identity": {
    "phaseId": "phase-v1.0",
    "workCardId": "WC-V1-0202F"
  },
  "sourceRevisions": [
    {
      "path": "planning/phases/phase-v1.0/Work_Cards/WC-V1-0202E_remove_domain_authority_from_mcp_persistence.md",
      "revision": 1
    }
  ],
  "workflowData": {
    "title": "Generic Create Markdown Artifact Action",
    "status": "approved_for_implementation",
    "executionMode": "one generic artifact-toolbox implementation pass",
    "gitMutationAuthorized": false,
    "additionalRepairAuthorized": false,
    "builderReportPath": "planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202F_generic_create_markdown_artifact_action.md"
  },
  "documentDisposition": {
    "status": "Approved",
    "notes": "Add one reusable artifact-toolbox action that writes exact Markdown content to a caller-selected safe repository-relative path without interpreting document meaning.",
    "reviewedAt": "2026-07-30"
  }
}
CHAMPCITY-METADATA -->

# WC-V1-0202F — Generic Create Markdown Artifact Action

Status: Approved for Implementer execution  
Repository: ChampCity_GPT  
Git mutation: prohibited  
Packaging and promotion: prohibited until Architect approval

## Objective

Add one generic, reusable Markdown write action to the artifact toolbox:

```text
artifact_toolbox.create_markdown_artifact
```

The tool must write exact Markdown content supplied by the caller to an exact safe repository-relative path supplied by the caller.

The tool is for all configured repositories and projects. It must not contain ChampCity A/I-specific paths, document names, artifact types, workflow concepts, schemas, or review logic.

## Public Action

Add this artifact-toolbox action:

```text
create_markdown_artifact
```

Invocation shape:

```json
{
  "action": "create_markdown_artifact",
  "workspaceId": "<configured workspace ID>",
  "params": {
    "relativePath": "docs/example.md",
    "content": "# Example\n\nComplete Markdown content.",
    "overwrite": false
  }
}
```

`overwrite` is optional and defaults to `false`.

The params object contains exactly:

```text
relativePath
content
overwrite
```

Unknown fields are rejected.

Do not accept:

- `handoffKind`;
- artifact type;
- participation role;
- identity;
- source revisions;
- artifact revision;
- workflow data;
- disposition;
- target families;
- schema names;
- hash, digest, checksum, revision token, or concurrency token;
- application-specific authority fields.

## Generic Storage Semantics

### Target missing

When the target does not exist:

- create the Markdown file;
- create missing parent directories when allowed by existing path policy;
- write the exact supplied content;
- reread the file and verify exact byte equality;
- return `saved`.

### Target exists with identical content

When the target already contains exactly the supplied bytes:

- do not rewrite it;
- return `already_saved`;
- `overwrite` does not affect this result.

### Target exists with different content and overwrite is false

When the target exists with different bytes and `overwrite` is `false`:

- fail without changing the target;
- return a clear existing-target conflict;
- do not interpret the existing file.

### Target exists with different content and overwrite is true

When the target exists with different bytes and `overwrite` is `true`:

- snapshot the existing raw bytes internally;
- reread the target immediately before replacement;
- fail without mutation if the raw bytes changed during the operation;
- otherwise replace the target atomically with the exact supplied content;
- reread and verify exact byte equality;
- restore the original raw bytes if installation or verification fails;
- return `saved`.

No caller-visible hash or token is used.

## Exact Content Boundary

`content` is opaque Markdown file content.

The tool must not:

- parse Markdown headings;
- parse front matter or canonical metadata;
- validate JSON or fenced blocks;
- normalize whitespace or line endings;
- add metadata;
- remove metadata;
- calculate artifact revisions;
- set or modify document status;
- infer a document type;
- inspect other repository files to authorize the write;
- compare the file against a workflow schema;
- decide whether the caller should create or overwrite a workflow document.

The file written to disk must contain the exact supplied string bytes under the existing UTF-8 text-writing convention.

## Legitimate Generic Safety

Preserve and apply existing generic MCP safeguards:

- exact configured `workspaceId` resolution;
- `files.write` OAuth scope;
- local write mode `docs`, `patch`, or `elevated`;
- workspace write policy;
- repository-relative path normalization and containment;
- configured artifact-write roots for `artifact_only` workspaces;
- Markdown `.md` extension requirement;
- blocked path and blocked filename policy;
- absolute path, traversal, Windows device path, and alternate-stream rejection;
- symlink, junction, and reparse-point rejection for existing path segments and target;
- input content size limit;
- temporary-file cleanup;
- exact-byte reread verification;
- bounded redacted audit logging.

These are generic storage protections. They must not inspect or govern document meaning.

## Multi-Repository Requirement

The implementation must be independent of ChampCity A/I.

Prohibited production constants and assumptions include:

```text
planning/project
PROJECT_PROFILE
PROJECT_ROADMAP
Architect Interview
Project Planning
Phase Map
Revisionary
champcity-phase-map
Pending
Approved
RevisionRequested
Rejected
```

The tool may write beneath `planning/` when the caller supplies such a safe path, but the implementation must not prefer, require, derive, or understand that path.

Tests must use neutral examples from more than one allowed workspace policy and more than one repository-relative directory, such as:

```text
docs/example.md
notes/session.md
artifacts/report.md
```

## Public Response

Return only generic persistence information:

```json
{
  "status": "saved",
  "workspaceId": "example-workspace",
  "relativePath": "docs/example.md",
  "sizeBytes": 37
}
```

Allowed status values:

```text
saved
already_saved
```

Do not return:

- hashes or digests;
- artifact revision;
- disposition;
- handoff kind;
- document type;
- workflow state;
- interpreted metadata.

## Artifact Toolbox Placement

The action must be available through:

```text
artifact_toolbox
```

Required routing and policy updates may include:

```text
src/tools/domainToolboxes.ts
src/tools/toolboxActionPolicy.ts
```

The implementation may add a focused generic module such as:

```text
src/tools/createMarkdownArtifact.ts
```

or a neutrally named internal exact-byte Markdown writer.

Do not restore or reuse the deleted domain-aware handoff contract modules.

Do not name the implementation after Architect Interview, Project Planning, Phase Map, or ChampCity A/I.

## Relationship to Existing Generic Writer

`repo_toolbox.write_markdown_artifact` is an existing generic repository action.

The implementer may reuse a genuinely generic internal filesystem helper when doing so does not change the existing repo-toolbox public contract unexpectedly.

The implementer must not:

- expose raw filesystem roots through the new artifact action;
- route the new action through a domain-aware wrapper;
- reintroduce deleted handoff logic;
- add hidden workflow checks;
- change unrelated repo-toolbox behavior merely to satisfy this card.

Any shared-helper extraction must remain storage-only and must be identified in the Builder Report.

## No Bundle or Workflow Features

This Work Card creates one single-file action only.

Do not add:

- multi-file bundle writes;
- transaction groups across multiple targets;
- handoff dispatch;
- application callbacks;
- schema registration;
- workflow-specific output slots;
- application-specific metadata templates;
- review-state logic;
- automatic target derivation;
- migration behavior;
- compatibility aliases for `submit_handoff_outputs`;
- replacement of deleted actions under old names.

A consuming application may call the generic tool multiple times. Whether a consuming application needs a separate generic batch tool can be evaluated later through a separate numbered Work Card.

## Authorized Production Surface

Expected changes are limited to:

```text
src/tools/createMarkdownArtifact.ts or equivalent generic module
src/tools/domainToolboxes.ts
src/tools/toolboxActionPolicy.ts
src/tools/inputLimits.ts only when a generic limit constant is required
docs/TOOL_REFERENCE.md
docs/SECURITY_MODEL.md
docs/CHATGPT_CONNECTION_GUIDE.md when the tool inventory is listed
focused tests
Builder Report
```

Direct changes to generic path or file-policy helpers are authorized only when a concrete missing generic safety check is proven. Such changes must not introduce document semantics and must be identified explicitly in the Builder Report.

Do not add dependencies.

Do not modify ChampCity A/I.

Do not create or alter Revisionary artifacts.

Do not perform Git operations.

## Required Tests

Add focused tests proving:

1. a missing neutral `.md` target is created with exact content;
2. missing safe parent directories are created;
3. an identical retry returns `already_saved` without rewriting;
4. an existing different target fails when `overwrite=false`;
5. an existing different target is atomically replaced when `overwrite=true`;
6. a pre-install raw-byte change causes a conflict without overwriting the changed file;
7. an installation or reread-verification failure restores the original bytes;
8. temporary files are removed after success and failure;
9. traversal, absolute paths, Windows device paths, alternate streams, non-Markdown extensions, blocked paths, symlinks, junctions, and artifact-root escapes are rejected;
10. oversized content is rejected before writing;
11. complete canonical-looking Markdown, arbitrary headings, JSON blocks, and unknown document structures are written unchanged;
12. no hash, digest, checksum, revision token, workflow field, or domain-specific field is accepted in params;
13. the public response contains no hash or interpreted document field;
14. the action is discoverable under `artifact_toolbox` and requires `files.write`;
15. unrelated toolbox actions and their schemas remain unchanged;
16. `submit_handoff_outputs` remains unsupported and is not restored as an alias.

## Required Proof

Record each item as `Proven`, `OperatorValidationPending`, or `NotProven`.

1. `artifact_toolbox.create_markdown_artifact` is registered and discoverable.
2. The action uses exactly `relativePath`, `content`, and optional `overwrite` params.
3. The implementation contains no ChampCity A/I-specific path, document, workflow, or schema logic.
4. Content is treated as opaque and written exactly.
5. No planning corpus or other repository evidence is scanned to authorize a write.
6. No canonical metadata or Markdown domain content is parsed.
7. No hash, digest, checksum, or revision token is used in the public request or response.
8. Create, identical retry, conflict, and overwrite behavior match this card.
9. Replacement concurrency uses only internal direct raw-byte comparison during the operation.
10. Generic workspace, path, file, size, symlink, write-mode, and audit safeguards remain effective.
11. Tests cover neutral paths and multiple workspace policies.
12. `submit_handoff_outputs` remains absent and unsupported.
13. No compatibility alias, domain wrapper, fallback, or application-specific behavior exists.
14. Typecheck passes.
15. Clean build passes.
16. Complete tests pass.
17. Public safety and release safety pass.
18. Builder Report states plainly that this is a generic reusable Markdown writer and does not implement ChampCity A/I workflow behavior.

## Completion

Create the Builder Report only after proof items 1–17 pass.

Do not package, promote, restart, reconnect, stage, commit, or push in this Work Card.
