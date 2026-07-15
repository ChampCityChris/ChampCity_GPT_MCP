import fs from "node:fs";
import path from "node:path";

import {
  assertVerifiedRepositoryRoot,
  captureRepositoryState,
  completedResult,
  runFixedProcess,
  safeFixedProcessEnv,
  type ArchitectToolResult,
  type ChangedFiles,
  type FixedProcessResult
} from "./common.js";

export type ProjectValidationOperation = "typecheck" | "build" | "test" | "release_checks";

interface ValidationStep {
  id: string;
  script: string;
  timeoutMs: number;
}

export interface ProjectValidationData {
  operation: ProjectValidationOperation;
  executionLane: "normal_windows";
  resolvedFixedCommand: string;
  safeFixedArguments: string[];
  exitCode: number | null;
  terminationReason: FixedProcessResult["terminationReason"] | "not_started";
  timeout: boolean;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  changedFiles: ChangedFiles;
  steps: Array<{
    id: string;
    script: string;
    fixedArguments: string[];
    result: FixedProcessResult;
  }>;
}

const FIXED_OPERATIONS: Record<ProjectValidationOperation, ValidationStep[]> = {
  typecheck: [{ id: "typecheck", script: "typecheck", timeoutMs: 180_000 }],
  build: [{ id: "build", script: "build", timeoutMs: 300_000 }],
  test: [{ id: "test", script: "test", timeoutMs: 600_000 }],
  release_checks: [
    { id: "typecheck", script: "typecheck", timeoutMs: 180_000 },
    { id: "build", script: "build", timeoutMs: 300_000 },
    { id: "test", script: "test", timeoutMs: 600_000 },
    { id: "public_safety", script: "check:public", timeoutMs: 180_000 },
    { id: "release_safety", script: "check:release", timeoutMs: 180_000 }
  ]
};

function readScripts(root: string): Record<string, string> {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { scripts?: Record<string, unknown> };
  return Object.fromEntries(
    Object.entries(packageJson.scripts ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function fixedNpmLaunch(): { executable: string; prefixArgs: string[] } | undefined {
  if (process.platform !== "win32") {
    return { executable: process.execPath, prefixArgs: [path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js")] };
  }
  const nodeExecutable = path.basename(process.execPath).toLowerCase() === "node.exe"
    ? process.execPath
    : "C:\\Program Files\\nodejs\\node.exe";
  const npmCli = path.join(path.dirname(nodeExecutable), "node_modules", "npm", "bin", "npm-cli.js");
  if (!fs.existsSync(nodeExecutable) || !fs.existsSync(npmCli)) {
    return undefined;
  }
  return { executable: nodeExecutable, prefixArgs: [npmCli] };
}

export async function runProjectValidation(
  rootInput: string,
  operation: ProjectValidationOperation
): Promise<ArchitectToolResult<ProjectValidationData>> {
  const root = assertVerifiedRepositoryRoot(rootInput);
  const startedAt = new Date().toISOString();
  const before = await captureRepositoryState(root);
  const steps = FIXED_OPERATIONS[operation];
  const scripts = readScripts(root);
  const missing = steps.filter((step) => !scripts[step.script]).map((step) => step.script);
  const npmLaunch = fixedNpmLaunch();

  const emptyData: ProjectValidationData = {
    operation,
    executionLane: "normal_windows",
    resolvedFixedCommand: npmLaunch?.executable ?? "node",
    safeFixedArguments: steps.length === 1 ? [...(npmLaunch?.prefixArgs ?? []), "run", steps[0].script] : [],
    exitCode: null,
    terminationReason: "not_started",
    timeout: false,
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    changedFiles: before.changedFiles,
    steps: []
  };

  if (missing.length > 0) {
    return completedResult({
      tool: "diagnostics_toolbox.project_validation",
      root,
      startedAt,
      status: "not_configured",
      headBefore: before.head,
      headAfter: before.head,
      data: emptyData,
      errors: [{ code: "not_configured", message: `Required fixed package scripts are missing: ${missing.join(", ")}.` }]
    });
  }

  if (!npmLaunch) {
    return completedResult({
      tool: "diagnostics_toolbox.project_validation",
      root,
      startedAt,
      status: "blocked_by_environment",
      headBefore: before.head,
      headAfter: before.head,
      data: emptyData,
      errors: [{ code: "blocked_by_environment", message: "The fixed Node.js and npm CLI installation could not be resolved without a shell." }]
    });
  }

  if (process.platform !== "win32") {
    return completedResult({
      tool: "diagnostics_toolbox.project_validation",
      root,
      startedAt,
      status: "blocked_by_environment",
      headBefore: before.head,
      headAfter: before.head,
      data: emptyData,
      errors: [{ code: "blocked_by_environment", message: "The repository validation lane is defined as normal Windows execution." }]
    });
  }

  const executed: ProjectValidationData["steps"] = [];
  for (const step of steps) {
    const fixedArguments = [...npmLaunch.prefixArgs, "run", step.script];
    const result = await runFixedProcess({
      executable: npmLaunch.executable,
      args: fixedArguments,
      cwd: root,
      timeoutMs: step.timeoutMs,
      env: safeFixedProcessEnv({ CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" })
    });
    executed.push({ id: step.id, script: step.script, fixedArguments, result });
    if (result.exitCode !== 0 || result.timedOut) {
      break;
    }
  }

  const after = await captureRepositoryState(root);
  const finalStep = executed.at(-1)?.result;
  const stdout = executed.map((step) => `[${step.id}]\n${step.result.stdout}`).join("\n");
  const stderr = executed.map((step) => `[${step.id}]\n${step.result.stderr}`).join("\n");
  const timedOut = executed.some((step) => step.result.timedOut);
  const passed = executed.length === steps.length && executed.every((step) => step.result.exitCode === 0 && !step.result.timedOut);
  const warnings = JSON.stringify(before.changedFiles) === JSON.stringify(after.changedFiles)
    ? []
    : ["The fixed validation operation changed the repository working-tree state; no automatic revert was attempted."];

  const data: ProjectValidationData = {
    operation,
    executionLane: "normal_windows",
    resolvedFixedCommand: npmLaunch.executable,
    safeFixedArguments: steps.length === 1 ? [...npmLaunch.prefixArgs, "run", steps[0].script] : [],
    exitCode: finalStep?.exitCode ?? null,
    terminationReason: finalStep?.terminationReason ?? "not_started",
    timeout: timedOut,
    stdout,
    stderr,
    stdoutTruncated: executed.some((step) => step.result.stdoutTruncated),
    stderrTruncated: executed.some((step) => step.result.stderrTruncated),
    changedFiles: after.changedFiles,
    steps: executed
  };

  return completedResult({
    tool: "diagnostics_toolbox.project_validation",
    root,
    startedAt,
    status: passed ? "passed" : timedOut ? "timed_out" : "failed",
    headBefore: before.head,
    headAfter: after.head,
    warnings,
    errors: passed ? [] : [{ code: timedOut ? "timeout" : "validation_failure", message: `Fixed validation operation ${operation} did not pass.` }],
    truncated: data.stdoutTruncated || data.stderrTruncated,
    data
  });
}
