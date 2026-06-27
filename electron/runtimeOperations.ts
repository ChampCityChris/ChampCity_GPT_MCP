import os from "node:os";

import { assertAllowedLauncherCommand } from "./launcherCore.js";
import { defaultRuntimeCommandRunner, detectRuntimes, shouldUseShellForCommand, type RuntimeCommandRunner, type RuntimeDetectionResult } from "./runtimeDetection.js";

export interface OperationResult {
  ok: boolean;
  output: string;
  exitCode?: number | null;
}

export type OutputAppender = (channel: string, message: string) => void;

export interface RuntimeOperationOptions {
  repoRoot: string;
  appendOutput?: OutputAppender;
  commandRunner?: RuntimeCommandRunner;
  detectRuntime?: () => Promise<RuntimeDetectionResult>;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  rerunDoctor?: () => Promise<unknown>;
}

interface NpmOperationSpec {
  args: string[];
  label: string;
  startMessage: string;
  successMessage: string;
  failureLabel: string;
}

const NPM_MISSING_MESSAGE = "npm not found. Install Node.js LTS and restart the app.";

function buildOutput(statusLines: string[], stdout: string, stderr: string): string {
  return [...statusLines, stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join(os.EOL);
}

async function resolveRuntime(options: RuntimeOperationOptions): Promise<RuntimeDetectionResult> {
  if (options.detectRuntime) {
    return options.detectRuntime();
  }

  return detectRuntimes({
    runner: options.commandRunner,
    env: options.env
  });
}

async function runNpmOperation(options: RuntimeOperationOptions, spec: NpmOperationSpec): Promise<OperationResult> {
  const statusLines: string[] = [];
  const appendStatus = (message: string): void => {
    statusLines.push(message);
    options.appendOutput?.(spec.label, message);
  };

  appendStatus("Checking npm...");
  const runtime = await resolveRuntime(options);
  if (!runtime.npm.found || !runtime.npm.path) {
    appendStatus(NPM_MISSING_MESSAGE);
    return { ok: false, output: buildOutput(statusLines, "", ""), exitCode: null };
  }

  appendStatus(`Found npm: ${runtime.npm.path}`);
  assertAllowedLauncherCommand(runtime.npm.path, spec.args, options.repoRoot);
  appendStatus(spec.startMessage);

  const runner = options.commandRunner ?? defaultRuntimeCommandRunner;
  const commandResult = await runner(runtime.npm.path, spec.args, {
    cwd: options.repoRoot,
    env: options.env ?? process.env,
    windowsHide: true,
    shell: shouldUseShellForCommand(runtime.npm.path, options.platform ?? process.platform),
    onStdout: (chunk) => {
      const line = chunk.trimEnd();
      if (line) {
        options.appendOutput?.(spec.label, line);
      }
    },
    onStderr: (chunk) => {
      const line = chunk.trimEnd();
      if (line) {
        options.appendOutput?.(spec.label, line);
      }
    }
  });

  if (commandResult.ok) {
    appendStatus(spec.successMessage);
  } else {
    appendStatus(`${spec.failureLabel} failed${commandResult.exitCode === null ? "" : ` with exit code ${commandResult.exitCode}`}.`);
  }

  if (options.rerunDoctor) {
    appendStatus("Re-running Doctor...");
    await options.rerunDoctor();
  }

  return {
    ok: commandResult.ok,
    output: buildOutput(statusLines, commandResult.stdout, commandResult.stderr),
    exitCode: commandResult.exitCode
  };
}

export function installDependencies(options: RuntimeOperationOptions): Promise<OperationResult> {
  return runNpmOperation(options, {
    args: ["install"],
    label: "npm install",
    startMessage: "Running npm install...",
    successMessage: "npm install completed successfully.",
    failureLabel: "npm install"
  });
}

export function buildMcpServer(options: RuntimeOperationOptions): Promise<OperationResult> {
  return runNpmOperation(options, {
    args: ["run", "build"],
    label: "npm run build",
    startMessage: "Running npm run build...",
    successMessage: "npm run build completed successfully.",
    failureLabel: "npm run build"
  });
}
