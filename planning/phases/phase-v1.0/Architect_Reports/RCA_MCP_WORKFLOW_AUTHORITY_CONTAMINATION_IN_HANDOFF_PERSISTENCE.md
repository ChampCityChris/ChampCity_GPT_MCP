<!-- CHAMPCITY-METADATA
{
  "schemaVersion": 1,
  "artifactType": "architect-report",
  "artifactRevision": 2,
  "participationRole": "contextOnly",
  "identity": {
    "phaseId": "phase-v1.0",
    "reportId": "RCA-MCP-WORKFLOW-AUTHORITY-CONTAMINATION"
  },
  "sourceRevisions": [
    {
      "path": "planning/phases/phase-v1.0/Work_Cards/WC-V1-0202D_unified_handoff_output_submission_action.md",
      "revision": 1
    }
  ],
  "workflowData": {
    "title": "MCP Workflow Authority Contamination in Handoff Persistence",
    "status": "complete"
  },
  "documentDisposition": {
    "status": "Approved",
    "notes": "Repository-backed RCA identifying workflow authority incorrectly implemented inside the MCP persistence layer. Revision 2 removes hash-based caller contracts and hash-gated replacement semantics.",
    "reviewedAt": "2026-07-30"
  }
}
CHAMPCITY-METADATA -->

# RCA — MCP Workflow Authority Contamination in Handoff Persistence

## Finding

The ChampCity_GPT MCP handoff-output subsystem was implemented as a workflow engine rather than a constrained persistence service.

The MCP currently interprets ChampCity A/I planning artifacts, selects workflow authority, validates domain schemas and document structure, constructs canonical metadata, enforces review state, and decides whether a document may be created or revised. Those responsibilities belong to ChampCity A/I and Operator review.

The MCP should only persist exact caller-authorized files inside a configured workspace while enforcing filesystem, atomicity, rollback, and audit safety.

## Confirmed Contaminated Production Locations

### 1. Architect Interview contract engine

`src/tools/internal/handoffContracts/architectInterview.ts`

The module currently:

- scans Project Intake and Architect Interview Prompt directories;
- requires exactly one current Approved Intake and Prompt;
- validates artifact types, participation roles, source revisions, and dispositions;
- derives project identity and the output target from Prompt metadata;
- constructs the complete canonical Interview metadata envelope;
- forces `gatingReview` and `Pending`;
- blocks overwriting Approved output;
- enforces reviewed-output substantive-revision rules;
- compares canonical metadata for idempotency;
- rechecks repository evidence before persistence.

This entire domain contract is workflow authority inside the MCP.

### 2. Project Planning contract engine

`src/tools/internal/handoffContracts/projectPlanning.ts`

The module currently:

- scans the complete `planning/project` corpus;
- selects one current Approved Project Planning handoff;
- validates contract identifiers and exact workflow-data fields;
- selects current Approved Intake, Prompt, and Interview evidence;
- rejects competing current sources;
- validates exact source-association chains and identity;
- validates Project Profile and Project Roadmap headings and reconciliation content;
- interprets `greenfield`, `reconciliation-required`, and `needs-attention`;
- derives both target paths and canonical metadata;
- forces `compoundGatingReview` and `Pending`;
- blocks Approved targets;
- enforces reviewed-output and substantive-revision rules;
- owns artifact revision calculation;
- rechecks evidence before an atomic pair write.

All document contract, current-source, review-state, and revision authority belongs to ChampCity A/I.

### 3. Phase Map contract engine

The Phase Map implementation is embedded in:

`src/tools/submitHandoffOutputs.ts`

It currently:

- scans the planning corpus;
- selects current Approved Profile, Roadmap, and Phase Map handoff evidence;
- validates the Phase Map contract identifier and handoff fields;
- validates exact Profile/Roadmap source association;
- merges identity and derives a canonical target family;
- parses the Markdown heading and `champcity-phase-map` block;
- validates the complete Phase Map domain schema, dependencies, cycles, paths, and completion-field prohibition;
- constructs canonical metadata and persists normalized `workflowData.phases`;
- forces `gatingReview` and `Pending`;
- blocks Approved targets;
- enforces reviewed-output and revision behavior;
- rechecks workflow evidence before persistence.

The Phase Map schema and workflow rules belong to ChampCity A/I. The MCP must not interpret them.

### 4. Domain-aware dispatcher and public schema

`src/tools/submitHandoffOutputs.ts`

The public action currently requires:

- `handoffKind`;
- registered domain-specific output slot names;
- body-only Markdown that excludes canonical metadata and authority fields.

The registry then dispatches into three workflow engines. This schema itself encodes the incorrect authority boundary.

### 5. MCP-owned canonical document construction

`src/tools/internal/canonicalSubmission/canonicalMarkdown.ts`

This module parses and serializes canonical workflow metadata for the three contract engines. Production references are limited to the contaminated handoff-output subsystem. It should be removed from that subsystem and deleted if no production references remain after the repair.

## Required Supporting Cleanup

The following tests and documentation encode the same incorrect boundary and must be replaced, not preserved:

- `tests/submitHandoffOutputsArchitectInterview.test.ts`
- `tests/submitHandoffOutputsProjectPlanning.test.ts`
- `tests/submitHandoffOutputsPhaseMap.test.ts`
- domain-specific portions of `src/tools/domainToolboxes.ts`
- `docs/SECURITY_MODEL.md`
- `docs/TOOL_REFERENCE.md`
- any self-test or evidence wording claiming the MCP derives targets, identity, source revisions, roles, revisions, dispositions, schemas, or current workflow authority.

## Locations That Are Not Workflow Authority Contamination

The following are legitimate MCP persistence safeguards and should remain:

- configured workspace resolution;
- OAuth `files.write` scope and local write-mode enforcement;
- repository-relative path normalization and containment;
- configured artifact-write-root enforcement;
- Markdown extension and blocked-file policy;
- symlink, junction, and reparse-point rejection;
- payload-size limits;
- duplicate-target rejection;
- atomic multi-file installation and rollback;
- exact-byte reread verification;
- direct byte-snapshot conflict detection inside the write transaction;
- bounded, redacted audit logging.

No caller-supplied digest, hash, checksum, or expected-hash field is needed. Hashes must not be part of the public contract, overwrite authority, idempotency, approval, or workflow state.

`src/workspaceAuthority.ts` and `src/tools/writeMarkdownArtifact.ts` demonstrate the correct filesystem-safety boundary, although the current single-file writer is insufficient for atomic Project Planning bundles and its public response shape need not be copied.

## Correct Architecture

### ChampCity A/I owns

- current workflow selection;
- document eligibility and review state;
- artifact types, participation roles, identity, source revisions, artifact revisions, and dispositions;
- complete canonical Markdown construction;
- Project Planning headings and reconciliation rules;
- Phase Map schema and dependency rules;
- exact output target paths;
- create-versus-replace intent;
- Operator review and workflow advancement.

### ChampCity_GPT MCP owns

- exact configured workspace resolution;
- safe repository-relative target validation;
- exact-byte persistence of complete files supplied by the caller;
- create/replace file-state enforcement;
- direct byte-snapshot conflict detection between preflight and installation;
- atomic bundle installation and rollback;
- exact-byte verification and bounded audit logging.

The MCP must not parse canonical metadata or Markdown domain content to decide whether a write is authorized.

## Replacement Public Action

The existing public action name may remain, but its schema must be hard-replaced with a neutral atomic Markdown bundle writer.

Conceptual shape:

```json
{
  "action": "submit_handoff_outputs",
  "workspaceId": "revisionary",
  "params": {
    "outputs": [
      {
        "relativePath": "planning/project/PROJECT_PROFILE.md",
        "content": "<complete canonical Markdown bytes>",
        "operation": "create"
      },
      {
        "relativePath": "planning/project/Project_Roadmap/PROJECT_ROADMAP_revisionary.md",
        "content": "<complete canonical Markdown bytes>",
        "operation": "replace"
      }
    ]
  }
}
```

The action may validate only persistence concerns. It must not accept `handoffKind`, inspect repository planning evidence, parse metadata, validate headings or domain blocks, derive targets, alter supplied content, or require caller-provided hashes.

## Root Cause

The design attempted to prevent caller-supplied authority by moving authority into the MCP. That did not remove authority; it duplicated ChampCity A/I's workflow engine inside the persistence layer. The duplicated engines then drifted from the application contract and blocked valid writes.

The subsequent attempt to use caller-provided expected hashes repeated the same mistake in a different form by turning a storage implementation detail into public workflow contract data.

The correct solution is not another contract-version gate or hash gate. It is removal of workflow interpretation and caller-visible concurrency tokens from the MCP.

## Disposition

WC-V1-0202E must implement a persistence-only writer with no domain authority and no hash-based caller contract. A paired ChampCity A/I repair is required because the application must supply complete canonical files, exact targets, and create-or-replace intent after the MCP stops constructing them.
