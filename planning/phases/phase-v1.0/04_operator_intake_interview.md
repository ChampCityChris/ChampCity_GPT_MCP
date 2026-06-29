# Operator Intake Interview for v1.0 Roadmap Direction

Answer these in one pass if possible. Short answers are fine. The goal is to lock v1.0 scope and avoid building features that are interesting but not necessary.

## Product and user direction

1. Who is the primary v1.0 user: only you, a small trusted group, or public users?

	Answer:  Primary v1.0 user will be public users.

2. Should v1.0 be positioned as a local developer/operator tool, a general MCP launcher, or a release/governance workstation?

	Answer: This is a local developer/operator tool made to assist the User in implementing a Operator/Architect/Builder workflow. ChatGPT.com can be a powerful Architect but it can be enhanced further by the ability to read and write documentation directly to the Users Project Repositories. It's goal is to Broaden ChatGPT.com's tool infrastructure to alleviate manual workflow processes needing completed by the Operator.

3. What are the top three outcomes v1.0 must accomplish for you to consider the project successful?

	Answer:
		1. Solid set of foundational tools required to allow ChatGPT.com to interact with a project repository without needing Operator intervention to attach/download documents, manage github push, pull, tag, and release process, and review code from the Builder agent.
		2. Consistently function without violating ChatGPT.com's safety layer
		3. Provide an easy setup experience for a User unfamiliar with CLI, or advanced Networking processes.

4. Which workflow matters most: ChatGPT connector reliability, local repo automation, Figma Make handoff, release automation, or general MCP server management?

	Answer: ChatGPT.com connnector reliability

5. Should the app assume the operator is technical, semi-technical, or non-technical?

	Answer: Semi-Technical
## Security and permissions

6. Is “operator never manually manages git” a hard product requirement for v1.0, or only a design preference?

	Answer: It is a hard product requirement for v1.0. There are too many security risk created when a User can commit and publish to a public repository. ChampCity MCP should have strong protocol in place to scan for secrets, correctly manage .gitignore, and accurately release clean source code and executables

7. Should write access remain limited to docs/patch/elevated modes, or do you want additional modes such as read-only release, release-publisher, or admin?

	Answer: This requires more knowledge about security and safety than I currently have.  If additional modes will provide better security, and more defensive tool calls I would welcome it.

8. Should v1.0 allow any arbitrary command execution through MCP if allowlisted, or should all important workflows become purpose-built tools?

	Answer: workflows should become purpose-built tools so as to control risk and create an auditable log

9. What is the maximum acceptable risk for ChatGPT-initiated writes: planning docs only, patch proposals only, approved file edits, commits, release publication, or elevated scripts?

	Answer: acceptable risk is high however the execution of elevated scripts should be prohibited

10. Should v1.0 require tamper-evident audit logs for release/write/elevated operations?

	Answer: Yes
## Connector and transport

11. Is live ChatGPT connector support mandatory for v1.0, or can v1.0 be local-first with ChatGPT treated as beta?

	Answer:  Live support is mandatory the application ceases having a function if a connector to ChatGPT.com cannot be made.

12. Is Cloudflare tunnel persistence after reboot a v1.0 requirement?

	Answer: Yes

13. Which MCP hosts should be tested before v1.0: ChatGPT only, ChatGPT plus Claude, or a broader matrix including Cursor/Copilot/Windsurf?

	Answer: ChatGPT only

14. Should OAuth/DCR be the only supported public connector path, or should bearer/PAT/manual auth remain available for advanced testing?

	Answer: OAuth/DCR should be the only supported public connector path unless it is determined that another method would provide a fix to safety layer issues.

## Release and distribution

15. Should v1.0 include GitHub Release publication from inside ChampCity MCP, or is Codex-assisted publication acceptable?

	Answer: Codex-assisted publication is acceptable but would strongly prefer this aspect was handled by ChatGPT

16. Do you want code signing, installer generation, and auto-update in v1.0, or should v1.0 keep portable executable distribution?

	Answer: Yes code signing, installer generation, and auto-update should come with v1.0

17. Should release assets include only the Windows portable executable, or also checksums, release notes, and validation reports?

	Answer it should include all of these

18. What release cadence do you want after v1.0: ad hoc, monthly, milestone-based, or only when a major Work Card set completes?

	Answer: milestone-based

## UI and operator experience

19. What is more important for v1.0 UI: polished visual design, dense diagnostics, simple guided setup, or fast expert controls?

	Answer: Simple Guided Setup

20. Which app screen should become the operational “home base”: Dashboard, Connection, Tools, Release, Logs, or a new Command Center?

	Answer: Dashboard

21. Should the app provide one-click “doctor/fix” actions, or should it only diagnose and produce Codex prompts?

	Answer: One-Click 'Doctor/Fix" actions'

22. Should generated Builder/Codex prompts remain a core feature, or should the app try to perform more actions itself through MCP tools?

	Answer: This is strictly an MCP Connector for ChatGPT it will serve in a suite of tools but the core feature of this app is providing ChatGPT with local repo access so it can fulfill its job as Architect

## Feature roadmap

23. Is Figma Make handoff a v1.0 requirement, or can it be v1.1 after core MCP/release reliability is stable?

	Answer: Figma tools will need revisited. Our current implementation is not the correct workflow and does not serve a purpose.

24. Do you want GitHub Issues/Projects sync for Work Cards in v1.0, or should planning remain Markdown-first?

	Answer: Work Cards is a feature for another product not ChampCity MCP

25. Should future architecture prepare for multi-agent/A2A workflows, or should v1.0 stay focused on ChatGPT-to-local-tools?

	Answer: V1.0 should state focused on ChatGPT-to-local-tools. A2A workflows may be a compelling future feature.
