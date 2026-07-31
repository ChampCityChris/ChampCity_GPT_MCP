<!-- CHAMPCITY-METADATA
{
  "schemaVersion": 1,
  "artifactType": "work-card",
  "artifactRevision": 1,
  "participationRole": "gatingReview",
  "identity": {
    "phaseId": "phase-v1.0",
    "workCardId": "WC-V1-0202F-REPAIR01",
    "repairId": "WC-V1-0202F-REPAIR01"
  },
  "sourceRevisions": [
    {
      "path": "planning/phases/phase-v1.0/Work_Cards/WC-V1-0202F_generic_create_markdown_artifact_action.md",
      "revision": 1
    },
    {
      "path": "planning/phases/phase-v1.0/Architect_Reports/ARCHITECT_REVIEW_WC-V1-0202F_generic_create_markdown_artifact_action.md",
      "revision": 1
    }
  ],
  "workflowData": {
    "title": "Create-Only Concurrency and Transaction Safety",
    "status": "approved_for_implementation",
    "parentWorkCardId": "WC-V1-0202F",
    "executionMode": "one bounded storage-transaction repair pass",
    "gitMutationAuthorized": false,
    "additionalRepairAuthorized": false,
    "builderReportPath": "planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202F-REPAIR01_create_only_concurrency_and_transaction_safety.md"
  },
  "documentDisposition": {
    "status": "Approved",
    "notes": "Preserve the accepted generic Markdown writer boundary while correcting create-only concurrency, post-directory path validation, and verified rollback behavior.",
    "reviewedAt": "2026-07-30"
  }
}
CHAMPCITY-METADATA -->

# WC-V1-0202F-REPAIR01 — Create-Only Concurrency and Transaction Safety

Status: Approved for Implementer execution  
Parent: `WC-V1-0202F`  
Repository: ChampCity_GPT  
Git mutation: prohibited  
Packaging and promotion: prohibited until Architect approval

## Objective

Correct three bounded transaction defects in the otherwise accepted generic action:

```text
artifact_toolbox.create_markdown_artifact
```

The repair must:

1. make missing-target creation atomically create-only;
2. revalidate parent-path safety after directory creation and immediately before installation;
3. verify rollback and report rollback failure instead of suppressing it.

Do not redesign the public action, add workflow behavior, or broaden scope.

## Preserve the Accepted Boundary

Preserve all accepted WC-V1-0202F behavior:

- public action name `artifact_toolbox.create_markdown_artifact`;
- exactly `relativePath`, `content`, and optional `overwrite` params;
- strict rejection of unknown params;
- generic configured-workspace resolution;
- OAuth `files.write` and local write-mode enforcement;
- Markdown `.md` restriction;
- artifact-root, blocked-path, device-name, alternate-stream, traversal, absolute-path, size, symlink, junction, and reparse safeguards;
- opaque exact UTF-8 content handling;
- no Markdown, metadata, schema, workflow, review-state, or planning-corpus interpretation;
- no caller-visible hash, digest, revision token, concurrency token, artifact type, or disposition;
- public response containing only `status`, `workspaceId`, `relativePath`, and `sizeBytes`;
- `submit_handoff_outputs` remaining unsupported;
- no alias, wrapper, domain adapter, fallback, bundle writer, or application callback.

Do not modify ChampCity A/I or Revisionary artifacts.

## Required Change 1 — Atomically Exclusive Missing-Target Creation

The missing-target path must not use a final rename operation that can replace a target created by another writer after the initial existence check.

Required behavior:

### No competing writer

- create the final target without permitting replacement;
- write the exact supplied bytes;
- complete or close the write before verification;
- reread and verify exact byte equality;
- return `saved`.

### Competing writer creates identical bytes

- do not replace or rewrite the competing writer's file;
- reread the final target as a regular safe file;
- when its bytes exactly equal the requested content, return `already_saved`;
- leave the competing writer's bytes and timestamps unchanged after detection.

### Competing writer creates different bytes

- do not replace or rewrite the competing writer's file;
- return the existing-target conflict using the current generic error vocabulary;
- preserve the competing writer's exact bytes.

Use a create-only filesystem operation such as exclusive open mode or an equivalent proven no-replace primitive. Do not implement caller-visible locks, hashes, or concurrency tokens.

If exclusive creation fails after creating a partial final file, remove only the file created by this operation. Never remove a file created by another writer.

## Required Change 2 — Revalidate Parent Paths After Creation

Initial path resolution is not sufficient when parent directories are missing.

Required behavior:

- create missing parent directories one segment at a time or through an equivalent approach that permits validation of each resulting segment;
- after each create or `EEXIST` result, use `lstat` and real-path containment checks to prove the segment is an allowed directory and not a symlink, junction, or supported reparse point;
- immediately before final target creation or replacement, revalidate the complete parent chain;
- prove the final parent real path remains inside the selected workspace root;
- reject a parent link or reparse-point condition introduced after the initial path check;
- do not write through an unvalidated parent path.

A neutral storage helper may be extracted only when it remains generic and does not alter unrelated public contracts.

## Required Change 3 — Verified Rollback and Truthful Failure

When overwrite installation or post-write verification fails after replacing an existing target:

- restore the original raw-byte snapshot through a replace-safe operation;
- reread the restored target;
- verify exact byte equality with the original snapshot;
- remove restoration temporary files after success or failure.

Do not suppress restoration errors.

When restoration succeeds:

- throw the original installation or verification error;
- preserve the original target bytes.

When restoration fails or restored bytes do not match:

- surface a clear generic verification failure stating that rollback was unsuccessful;
- include the original operation failure and rollback failure only as bounded, redacted diagnostic details;
- do not claim the original bytes were restored;
- do not expose file content, hashes, absolute paths, or stack traces in the public response.

Use the existing project error vocabulary unless a new generic error code is separately proven necessary. Do not add application-specific error semantics.

## Required Tests

Add focused tests proving:

1. two concurrent create attempts with different bytes produce one `saved` result and one existing-target conflict, with the winner's bytes preserved;
2. two concurrent create attempts with identical bytes produce one `saved` result and one `already_saved` result without a rewrite;
3. a target created after the initial missing-target observation is never overwritten when `overwrite=false`;
4. partial files created by the losing operation are removed without deleting the winning file;
5. each newly created parent directory is revalidated;
6. a symlink, junction, or supported reparse-point parent introduced after initial resolution is rejected without writing outside the workspace, when the platform permits the fixture;
7. the final parent real path is revalidated immediately before installation;
8. successful rollback restores exact original bytes and removes temporary files;
9. injected rollback-write failure is surfaced as rollback failure and is not silently converted into only the original error;
10. injected rollback-verification mismatch is surfaced as rollback failure;
11. temporary create, replace, and restore files are absent after every success and failure path;
12. existing ordinary create, identical retry, conflict, overwrite, opaque-content, path-policy, artifact-only, scope, write-mode, and response-shape tests continue to pass;
13. no public schema, response, action inventory, or domain-boundary change occurs;
14. `submit_handoff_outputs` remains unsupported.

Use deterministic hooks for race placement and failure injection. Do not rely on timing-only sleeps.

## Authorized Production Surface

Expected changes are limited to:

```text
src/tools/createMarkdownArtifact.ts
tests/createMarkdownArtifact.test.ts
planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202F-REPAIR01_create_only_concurrency_and_transaction_safety.md
```

A neutrally named internal storage helper and focused tests may be added only if required to implement the same bounded transaction safely.

Do not change:

- the public action name;
- action params or response fields;
- toolbox action policy except compile-only cleanup if strictly required;
- OAuth, PKCE, HTTP transport, Git workflow, browser, integration, artifact catalog, image, packaging, or release behavior;
- documentation unless an implementation detail stated there becomes inaccurate;
- existing `repo_toolbox.write_markdown_artifact` behavior.

Do not add dependencies.

## Required Proof

Record each item as `Proven`, `OperatorValidationPending`, or `NotProven`.

1. Missing-target installation is atomically create-only and cannot replace a concurrent winner.
2. Concurrent identical creation returns one `saved` and one `already_saved` without rewriting the winner.
3. Concurrent different creation returns one `saved` and one conflict while preserving the winner.
4. A target appearing after the initial check is never overwritten when `overwrite=false`.
5. Parent directories are validated after creation or concurrent appearance.
6. The complete final parent chain is revalidated immediately before installation.
7. Symlink, junction, reparse-point, and containment protections remain effective under the added race hooks.
8. Successful rollback restores and verifies exact original bytes.
9. Rollback failure is surfaced truthfully and is never suppressed.
10. Temporary files are removed across create, replacement, verification, and rollback paths.
11. The public request and response contracts are unchanged.
12. Content remains opaque and exact.
13. No workflow, application, schema, review, hash-token, or domain authority is introduced.
14. Existing generic workspace, artifact-root, file-policy, size, write-mode, OAuth, and audit safeguards remain effective.
15. `submit_handoff_outputs` remains absent and unsupported.
16. Typecheck passes.
17. Clean build passes.
18. Complete tests pass.
19. Public safety passes.
20. Release safety passes.
21. The repair Builder Report acknowledges the original concurrency, parent-path, and rollback gaps.

## Completion

Create the repair Builder Report only after proof items 1–20 pass.

Do not package, promote, restart, reconnect, stage, commit, or push in this repair.
