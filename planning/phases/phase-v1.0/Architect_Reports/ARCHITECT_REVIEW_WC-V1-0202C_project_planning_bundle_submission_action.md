# Architect Review — WC-V1-0202C Project Planning Bundle Submission Action

Review result: `RepairRequired`  
Parent Work Card: `WC-V1-0202C`  
Repair Work Card: `WC-V1-0202C-REPAIR01`  
Git mutation: none

## Disposition

WC-V1-0202C implementation is not accepted as complete. The parent Work Card remains unchanged. Four bounded defects are assigned to:

`planning/phases/phase-v1.0/Work_Cards/WC-V1-0202C-REPAIR01_contract_identity_revision_submission_and_retry_integrity.md`

Do not continue implementation under the parent card and do not edit the parent card to absorb review findings.

## Accepted Implementation

The following are materially correct and must be preserved:

- stable `artifact_toolbox.save_project_planning_outputs` action registration;
- no new top-level MCP tool;
- files.write and local write-mode gates;
- caller input limited to two Markdown bodies;
- target derivation and path containment;
- canonical Markdown-only output;
- atomic pair installation and rollback;
- no JSON sibling creation;
- non-Git artifact persistence;
- bounded result and audit redaction;
- existing Architect Interview save action preservation.

Independent validation passed:

```text
npm run typecheck       → passed
npm test                → 387/387 passed
release checks          → passed
public safety           → passed
release safety          → passed
```

## Repair Findings

### 1. Output identity includes handoff identity

The implementation merges Intake, Prompt, Interview, and handoff identity. The actual ChampCity A/I Project Planning handoff uses handoff-only identity such as `handoffKind=project-planning`. Profile and Roadmap identity must derive only from Intake, Prompt, and Interview.

### 2. Review disposition can be cleared without substantive revision

ChampCity A/I owns Operator review disposition. The MCP action may return a revised bundle to Pending only after at least one submitted body substantively changes.

Current behavior can rewrite an identical `RevisionRequested` or `Rejected` pair as Pending. That erases an A/I review decision without a revision.

Required rule:

```text
identical RevisionRequested/Rejected bodies
→ reject and preserve files

at least one changed body
→ revised bundle may return to Pending
```

### 3. `already_saved` ignores workflow data

The retry check must include the complete application-owned reconciliation workflow data and canonical disposition fields, not only body, identity, sources, and Pending status.

### 4. Handoff/source contract validation is incomplete

The action must verify Prompt→Intake and Interview→Intake/Prompt associations, enforce reconciliation-mode/repository-review consistency, and safely deduplicate evidence-path arrays.

## Validation Boundary

Live greenfield and existing-project ChatGPT calls remain WC27 Operator validation after integration. They are not required to complete the deterministic repair implementation.

No Git operation occurred.
