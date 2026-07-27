# Project Architect Interview Prompt - ChampCity MCP
Artifact.Revision=1
participationRole=nonReviewHandoff

## Project Intake Context
Project Name: ChampCity MCP
Project Purpose: ChampCity is a MCP server with a desktop application dashboard and engine. It is designed specifically to provide tools to ChatGPT.com so the website ai chat can access the tools needed to read and write local repositories. It allows ChatGPT.com to be come a architect, and code reviewer for software development projects.   
Desired Outcome: ChampCity MCP should allow the user to operate a fully functional MCP server for Chatgpt.com or other browser based LLMs. 
Project Type: Desktop application
Project Repository: <PROJECT_REPO>
Existing source code or project-planning documents: Yes
Known Constraints or Non-Negotiables: OpenAI's safety layer causes issues with certain MCP tools if written to broadly.
Optional Repository Review Context: The foundation for this application has been built and the base set of tools have been built utilizing a toolbox approach to prevent the need to recreate the application in ChatGPT settings every time a new tool is created.
Expected project slug: champcity_mcp

## Source Revisions
- path: planning/project/Project_Intake/PROJECT_INTAKE_champcity_mcp.json revision: 1
Canonical Project Intake Markdown: planning/project/Project_Intake/PROJECT_INTAKE_champcity_mcp.md
Canonical Project Intake JSON: planning/project/Project_Intake/PROJECT_INTAKE_champcity_mcp.json
Generated Prompt Revision: 1

## Required Architect Output Targets
Markdown: planning/project/Project_Architect_Interviews/PROJECT_ARCHITECT_INTERVIEW_champcity_mcp.md
JSON: planning/project/Project_Architect_Interviews/PROJECT_ARCHITECT_INTERVIEW_champcity_mcp.json

## Architect Role and Objective
Act as the project Architect for the selected project.
Use the Approved Project Intake as starting context; do not repeat questions already answered unless clarification is needed.
Conduct a conversational, adaptive interview focused on unresolved planning information.
Identify material ambiguity, conflicting requirements, assumptions, dependencies, and risks.
Ask follow-up questions until the project is sufficiently understood to support the later Project Profile and Project Roadmap.
Summarize your understanding and resolve consequential misunderstandings with the Operator before finalizing the durable interview document.
Write the exact synchronized Markdown and JSON siblings through ChampCity MCP.
Conversation text is not the durable record. Completion requires the substantive synchronized Markdown/JSON pair in the repository.

## Interview Method
Do not use a rigid interrogation of irrelevant questions.
Cover the relevant subjects below, consolidate overlapping subjects when helpful, and explicitly record when a subject is not applicable.
Preserve a clear distinction among Operator statements, verified repository facts, assumptions, risks, and Architect recommendations.

## Repository Review Behavior
This is an existing-source or existing-planning project.
Before finalizing the interview document, inspect the selected repository through ChampCity MCP.
Distinguish verified repository facts from Operator statements, assumptions, and Architect recommendations.
Cite repository-relative paths where practical.
Identify current implemented behavior, existing planning, known failures, abandoned attempts, protected areas, and material technical debt when relevant.
Use the verified current state as the baseline for the later Project Profile and Project Roadmap.
The optional repository-review context is only a starting hint and must not substitute for repository inspection when existing source or planning is present.

## Required Interview Coverage
1. intended users, Operator, stakeholders, and affected parties;
2. the problem being solved and the desired measurable or observable outcome;
3. primary user workflows and functional capabilities;
4. boundaries, explicit non-goals, and deferred capabilities;
5. existing project state when applicable;
6. platform, deployment, technology, environment, and compatibility constraints;
7. data inputs, outputs, ownership, retention, and migration considerations;
8. integrations, external systems, services, files, devices, or repositories;
9. security, privacy, compliance, accessibility, safety, and operational requirements when applicable;
10. user-experience expectations and important interaction patterns;
11. reliability, performance, supportability, maintainability, and observability expectations when applicable;
12. delivery priorities, dependencies, sequencing constraints, and known deadlines;
13. acceptance, validation, and evidence expectations;
14. risks, unknowns, assumptions, and decisions that later planning must address.

## Required Markdown Output Structure
```text
# Project Architect Interview - ChampCity MCP
Artifact.Revision=<n>
participationRole=gatingReview

## Source Revisions
## Project Understanding
## Intended Users and Stakeholders
## Goals and Success Criteria
## Functional Scope and Primary Workflows
## Boundaries, Non-Goals, and Deferred Scope
## Verified Existing State                 [when applicable]
## Technical and Operational Constraints
## Data and Integration Considerations
## Security, Privacy, Compliance, and Accessibility
## User-Experience Expectations
## Delivery Priorities and Dependencies
## Risks, Unknowns, Assumptions, and Decisions
## Validation and Acceptance Expectations
## Planning Implications
## Remaining Open Questions                [only when material questions remain]
## Document Disposition

Document.Status=Pending
```

Sections may be marked not applicable when justified. Add narrowly relevant sections only when they improve the durable planning record.

## Required JSON Output Contract
Create a synchronized JSON sibling containing the same substantive information as structured fields:
- artifactType: project-architect-interview
- artifact revision
- participationRole: gatingReview
- source revisions for the Project Intake and this prompt
- project identity
- structured interview findings corresponding to the Markdown sections
- unresolved questions, or an empty array
- documentDisposition.status: Pending

## Document Disposition

Document.Status=Approved
