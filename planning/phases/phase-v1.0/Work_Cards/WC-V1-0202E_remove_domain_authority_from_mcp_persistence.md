<!-- CHAMPCITY-METADATA
{
  "schemaVersion": 1,
  "artifactType": "work-card",
  "artifactRevision": 1,
  "participationRole": "gatingReview",
  "identity": {
    "phaseId": "phase-v1.0",
    "workCardId": "WC-V1-0202E"
  },
  "sourceRevisions": [
    {
      "path": "planning/phases/phase-v1.0/Architect_Reports/RCA_MCP_WORKFLOW_AUTHORITY_CONTAMINATION_IN_HANDOFF_PERSISTENCE.md",
      "revision": 2
    }
  ],
  "workflowData": {
    "title": "Remove Domain Authority from MCP Persistence",
    "status": "approved_for_implementation",
    "executionMode": "one deletion-only cleanup pass",
    "gitMutationAuthorized": false,
    "additionalRepairAuthorized": false,
    "builderReportPath": "planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-V1-0202E_remove_domain_authority_from_mcp_persistence.md"
  },
  "documentDisposition": {
    "status": "Approved",
    "notes": "Delete the domain-aware handoff persistence subsystem and its public action. Do not build a replacement tool in this Work Card.",
    "reviewedAt": "2026-07-30"
  }
}
CHAMPCITY-METADATA -->

# WC-V1-0202E — Remove Domain Authority from MCP Persistence

Status: Approved for Implementer execution  
Repository: ChampCity_GPT  
Git mutation: prohibited  
Packaging and promotion: prohibited until Architect approval

## Objective

Delete the contaminated domain-aware handoff persistence subsystem from ChampCity_GPT.

This Work Card does one thing only:

```text
remove MCP code that interprets or governs Architect Interview, Project Planning, or Phase Map workflow documents
```

Do not build a replacement writer, compatibility layer, alias, wrapper, migration path, or temporary fallback in this Work Card.

## Architectural Boundary

ChampCity_GPT is a reusable MCP server. It must not contain workflow authority that is specific to ChampCity A/I or any other consuming application.

The MCP may enforce generic transport and filesystem safety in generic tools. It must not decide:

- which workflow step is current;
- whether a document is Approved, Pending, Rejected, or RevisionRequested;
- whether an output may be created or revised;
- what artifact type, role, identity, source revision, or artifact revision means;
- whether a Project Profile, Roadmap, Interview, or Phase Map is structurally or substantively correct;
- what headings or domain blocks a document requires;
- what target path a consuming application should use;
- whether a revision is substantive;
- whether a consuming application may advance its workflow.

## Required Deletion 1 — Domain Contract Engines

Delete these production modules:

```text
src/tools/internal/handoffContracts/architectInterview.ts
src/tools/internal/handoffContracts/projectPlanning.ts
```

Remove every production import and reference to them.

Do not preserve their logic in another file.

## Required Deletion 2 — Domain-Aware Unified Submission Action

Delete the current production implementation of:

```text
src/tools/submitHandoffOutputs.ts
```

Remove all behavior formerly contained there, including:

- `SUPPORTED_HANDOFF_KINDS`;
- `HANDOFF_OUTPUT_CONTRACT_REGISTRY`;
- `handoffKind` dispatch;
- Architect Interview output-slot handling;
- Project Planning output-slot handling;
- Phase Map output-slot handling;
- planning-corpus scans;
- current or Approved evidence selection;
- handoff contract selection;
- canonical metadata construction;
- target derivation;
- artifact revision calculation;
- disposition enforcement;
- reviewed-output gates;
- Project Planning heading or reconciliation validation;
- Phase Map heading, JSON, schema, dependency, or cycle validation;
- source-revision association checks;
- workflow evidence rechecks;
- domain-specific idempotency or overwrite rules.

Do not retain an empty shell under the same module name.

## Required Deletion 3 — Public Action Exposure

Remove the current public action:

```text
artifact_toolbox.submit_handoff_outputs
```

Required cleanup includes:

```text
src/tools/domainToolboxes.ts
src/tools/toolboxActionPolicy.ts
public action descriptions and schemas
MCP discovery and inventory expectations
```

After this Work Card, `submit_handoff_outputs` must be unsupported.

Do not alias it to another writer.

Do not keep it as a deprecated compatibility action.

## Required Deletion 4 — Canonical Construction Helper

Delete:

```text
src/tools/internal/canonicalSubmission/canonicalMarkdown.ts
```

when no production references remain.

This Work Card must not move that parser or serializer elsewhere for handoff persistence.

A generic MCP writer must treat Markdown as opaque file content. Any future generic parser needed for unrelated read functionality must be separately justified and must not be retained merely to support deleted workflow behavior.

## Required Deletion 5 — Domain-Authority Tests

Delete these tests:

```text
tests/submitHandoffOutputsArchitectInterview.test.ts
tests/submitHandoffOutputsProjectPlanning.test.ts
tests/submitHandoffOutputsPhaseMap.test.ts
```

Remove or update any additional tests that expect:

- `submit_handoff_outputs` to be exposed;
- registered handoff kinds;
- MCP-derived targets or metadata;
- Approved handoff selection;
- document disposition gates;
- Project Planning document validation;
- Phase Map schema validation;
- domain-specific save results.

Do not replace these tests with tests for a new writer in this Work Card.

Add only focused absence tests needed to prove the contaminated code and public action are gone.

## Required Deletion 6 — Documentation and Evidence Claims

Remove current claims about `submit_handoff_outputs` and MCP-owned workflow authority from:

```text
docs/SECURITY_MODEL.md
docs/TOOL_REFERENCE.md
docs/CHATGPT_CONNECTION_GUIDE.md
planning/phases/phase-v1.0/Live_Connector_Evidence/CHATGPT_LIVE_CONNECTOR_EVIDENCE_TEMPLATE.md
```

when those files contain the claims.

Remove language stating that the MCP derives or validates:

- current Approved handoffs;
- workflow target paths;
- canonical metadata;
- identity or source revisions;
- artifact type, role, revision, or disposition;
- Project Planning headings or reconciliation rules;
- Phase Map schema or normalized phases.

Do not document a replacement action in this Work Card.

## Preserve Unrelated Generic MCP Capabilities

Do not change unrelated tools or safety behavior, including:

- workspace registration and resolution;
- OAuth scope handling;
- local write-mode handling;
- generic repository path containment;
- blocked-path policy;
- symlink, junction, and reparse-point protection;
- existing generic repository writers;
- Git tools;
- diagnostics tools;
- browser tools;
- image tools;
- release and package tooling.

The existing generic `repo_toolbox.write_markdown_artifact` behavior is outside this deletion card except for compile-only import cleanup. Do not redesign it here.

## No Replacement or Bridging Behavior

This Work Card must not:

- create `create_markdown_artifact`;
- create another artifact writer;
- redirect `submit_handoff_outputs` to `repo_toolbox.write_markdown_artifact`;
- add a generic bundle writer;
- add hash, digest, revision-token, or concurrency-token inputs;
- add compatibility with old prompts;
- add a temporary local writer;
- modify ChampCity A/I;
- create or alter Revisionary project artifacts;
- perform packaging, promotion, restart, or reconnect actions.

The repository may temporarily have no artifact-toolbox Markdown write action after this deletion. That is intentional. The generic replacement is a separate numbered Work Card.

## Authorized Production Surface

Expected production changes are limited to deletion and direct reference cleanup in:

```text
src/tools/internal/handoffContracts/architectInterview.ts
src/tools/internal/handoffContracts/projectPlanning.ts
src/tools/submitHandoffOutputs.ts
src/tools/internal/canonicalSubmission/canonicalMarkdown.ts
src/tools/domainToolboxes.ts
src/tools/toolboxActionPolicy.ts
```

Additional direct compile-reference cleanup is authorized only where required by deletion.

Expected test and documentation changes are limited to the files named above and direct inventory/discovery expectations.

Do not add dependencies.

Do not perform Git operations.

## Required Proof

Record each item as `Proven`, `OperatorValidationPending`, or `NotProven`.

1. `architectInterview.ts` is deleted.
2. `projectPlanning.ts` is deleted.
3. `submitHandoffOutputs.ts` is deleted.
4. `canonicalSubmission/canonicalMarkdown.ts` is deleted when no production reference remains.
5. `artifact_toolbox.submit_handoff_outputs` is no longer registered, discoverable, or callable.
6. `handoffKind`, domain output-slot registration, and domain contract registry code are absent from production source.
7. No production code scans planning evidence to authorize a write for Architect Interview, Project Planning, or Phase Map.
8. No production code constructs canonical workflow metadata for those outputs.
9. No production code validates Project Planning headings or Phase Map schema as part of persistence.
10. No production code enforces document disposition or reviewed-output rules for those outputs.
11. The three domain-authority test suites are deleted.
12. Documentation no longer claims that the MCP owns those workflow decisions.
13. No replacement writer, alias, wrapper, fallback, or migration behavior was added.
14. Unrelated public tools and generic safety behavior remain unchanged.
15. Typecheck passes.
16. Clean build passes.
17. Complete tests pass.
18. Public safety and release safety pass.
19. Builder Report states plainly that this Work Card only deleted contaminated code and intentionally did not add a replacement tool.

## Completion

Create the Builder Report only after proof items 1–18 pass.

Do not package, promote, restart, reconnect, stage, commit, or push in this Work Card.
