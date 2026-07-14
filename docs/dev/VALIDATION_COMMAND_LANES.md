# Validation Command Lanes

## Purpose

This document defines how Codex must run validation for this repository.

ChampCity_GPT has a known false-failure mode where sandboxed Codex execution may block child-process spawning. This commonly appears as `spawn EPERM`, especially when tools such as esbuild, Vite, Vitest, Electron, Playwright, or build pipelines try to spawn subprocesses.

This is an execution-lane issue, not primary evidence of an application defect.

## Required behavior

Before running validation, Codex must determine whether the command may invoke child-process spawning.

If the command may invoke child-process spawning, Codex must use the approved normal Windows validation lane instead of repeatedly retrying inside the sandbox.

Use the repo validation wrapper where available:

- `npm run validate:codex`
- `npm run validate:codex:unit`
- `npm run validate:codex:build`

## Commands covered by this rule

Use the normal Windows execution lane for:

- `npm test`
- `npm run test`
- `npm run test:unit`
- `npm run build`
- `npm run dev`
- `npm run electron:dev`
- Vite
- Vitest
- Electron
- Playwright
- esbuild
- TypeScript build pipelines
- any command that invokes child-process spawning

## Known false failure symptoms

The following symptoms are known sandbox-lane failures unless reproduced in the normal Windows execution lane:

- `spawn EPERM`
- `esbuild` failed to spawn
- child-process spawn denied
- Electron cannot start
- Vite cannot start
- Vitest cannot start
- Playwright cannot start

If one of these occurs inside the sandbox, do not investigate source code as the first cause. Rerun through the normal Windows validation lane.

## Reporting requirement

Every validation report must include:

- command run
- execution lane used
- pass/fail result
- whether any sandbox-only failure occurred
- whether the result was validated in the approved lane

Do not claim validation passed unless the required command completed successfully in the approved lane.

Do not claim implementation failure based only on a sandboxed `spawn EPERM` failure.
