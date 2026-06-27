import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type RuntimeSource = "where" | "commonPath" | "powershell";

export interface RuntimeExecutable {
  found: boolean;
  path: string | null;
  version: string | null;
  source: RuntimeSource | null;
}

export interface RuntimeDetectionResult {
  node: RuntimeExecutable;
  npm: RuntimeExecutable;
  errors: string[];
}

export interface RuntimeCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
}

export interface RuntimeCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  windowsHide?: boolean;
  shell?: boolean;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export type RuntimeCommandRunner = (command: string, args: string[], options?: RuntimeCommandOptions) => Promise<RuntimeCommandResult>;

interface RuntimeCandidate {
  path: string;
  source: RuntimeSource;
}

export const WINDOWS_COMMON_NODE_PATH = "C:\\Program Files\\nodejs\\node.exe";
export const WINDOWS_COMMON_NPM_CMD_PATH = "C:\\Program Files\\nodejs\\npm.cmd";
export const WINDOWS_COMMON_NPM_PATH = "C:\\Program Files\\nodejs\\npm";
export const WINDOWS_COMMON_NPM_EXE_PATH = "C:\\Program Files\\nodejs\\npm.exe";

const WINDOWS_COMMON_NPM_PATHS = [WINDOWS_COMMON_NPM_CMD_PATH, WINDOWS_COMMON_NPM_PATH, WINDOWS_COMMON_NPM_EXE_PATH];

export interface RuntimeDetectionOptions {
  platform?: NodeJS.Platform;
  fileExists?: (filePath: string) => boolean;
  runner?: RuntimeCommandRunner;
  env?: NodeJS.ProcessEnv;
  commonNodePaths?: string[];
  commonNpmPaths?: string[];
}

export function defaultRuntimeCommandRunner(command: string, args: string[], options: RuntimeCommandOptions = {}): Promise<RuntimeCommandResult> {
  return new Promise((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const spawnRequest = getSpawnRequest(command, args, options);
    let child;
    try {
      child = spawn(spawnRequest.command, spawnRequest.args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        windowsHide: options.windowsHide ?? true,
        shell: spawnRequest.shell,
        windowsVerbatimArguments: spawnRequest.windowsVerbatimArguments
      });
    } catch (error) {
      resolve({
        ok: false,
        stdout: "",
        stderr: "",
        exitCode: null,
        error: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      options.onStdout?.(chunk.toString("utf8"));
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      options.onStderr?.(chunk.toString("utf8"));
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        ok: false,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode: null,
        error: error.message
      });
    });

    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        ok: exitCode === 0,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode
      });
    });
  });
}

function emptyExecutable(): RuntimeExecutable {
  return {
    found: false,
    path: null,
    version: null,
    source: null
  };
}

function splitCommandOutput(output: string): string[] {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/gu, "");
}

function normalizeForComparison(value: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? value.toLowerCase() : value;
}

function commandBasename(command: string): string {
  return path.win32.basename(command).toLowerCase();
}

export function shouldUseShellForCommand(command: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32" && path.win32.extname(command).toLowerCase() === ".cmd";
}

function quoteWindowsCommandArg(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function getSpawnRequest(command: string, args: string[], options: RuntimeCommandOptions): { command: string; args: string[]; shell: boolean; windowsVerbatimArguments?: boolean } {
  if (options.shell === true && shouldUseShellForCommand(command)) {
    const commandLine = `"${[quoteWindowsCommandArg(command), ...args.map(quoteWindowsCommandArg)].join(" ")}"`;
    return {
      command: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", commandLine],
      shell: false,
      windowsVerbatimArguments: true
    };
  }

  return {
    command,
    args,
    shell: options.shell ?? false
  };
}

function addCandidate(candidates: RuntimeCandidate[], candidatePath: string, source: RuntimeSource, platform: NodeJS.Platform): void {
  const cleaned = stripQuotes(candidatePath.trim());
  if (!cleaned) {
    return;
  }

  const normalized = normalizeForComparison(cleaned, platform);
  if (candidates.some((candidate) => normalizeForComparison(candidate.path, platform) === normalized)) {
    return;
  }

  candidates.push({ path: cleaned, source });
}

async function addWhereCandidates(
  tool: "node" | "npm",
  candidates: RuntimeCandidate[],
  runner: RuntimeCommandRunner,
  platform: NodeJS.Platform,
  env?: NodeJS.ProcessEnv
): Promise<void> {
  const result = await runner("where.exe", [tool], { env, windowsHide: true, shell: false });
  if (!result.ok) {
    return;
  }

  for (const line of splitCommandOutput(result.stdout)) {
    addCandidate(candidates, line, "where", platform);
  }
}

async function addPowerShellCandidate(
  tool: "node" | "npm",
  candidates: RuntimeCandidate[],
  runner: RuntimeCommandRunner,
  platform: NodeJS.Platform,
  env?: NodeJS.ProcessEnv
): Promise<void> {
  const command = `Get-Command ${tool} | Select-Object -ExpandProperty Source`;
  const result = await runner("powershell.exe", ["-NoProfile", "-Command", command], { env, windowsHide: true, shell: false });
  if (!result.ok) {
    return;
  }

  for (const line of splitCommandOutput(result.stdout)) {
    addCandidate(candidates, line, "powershell", platform);
  }
}

function addCommonPathCandidates(
  candidates: RuntimeCandidate[],
  commonPaths: string[],
  fileExists: (filePath: string) => boolean,
  platform: NodeJS.Platform
): void {
  for (const candidatePath of commonPaths) {
    if (fileExists(candidatePath)) {
      addCandidate(candidates, candidatePath, "commonPath", platform);
    }
  }
}

function selectNodeCandidate(candidates: RuntimeCandidate[], platform: NodeJS.Platform): RuntimeCandidate | null {
  if (platform === "win32") {
    const commonNode = candidates.find(
      (candidate) => normalizeForComparison(candidate.path, platform) === normalizeForComparison(WINDOWS_COMMON_NODE_PATH, platform)
    );
    if (commonNode) {
      return commonNode;
    }
  }

  return candidates[0] ?? null;
}

function npmCandidateScore(candidate: RuntimeCandidate, platform: NodeJS.Platform): number {
  if (platform !== "win32") {
    return 0;
  }

  const normalized = normalizeForComparison(candidate.path, platform);
  const baseName = commandBasename(candidate.path);
  if (normalized === normalizeForComparison(WINDOWS_COMMON_NPM_CMD_PATH, platform)) {
    return 0;
  }
  if (baseName === "npm.cmd") {
    return 1;
  }
  if (normalized === normalizeForComparison(WINDOWS_COMMON_NPM_PATH, platform)) {
    return 2;
  }
  if (normalized === normalizeForComparison(WINDOWS_COMMON_NPM_EXE_PATH, platform)) {
    return 3;
  }
  if (baseName === "npm.exe") {
    return 4;
  }
  if (baseName === "npm") {
    return 5;
  }

  return 6;
}

function selectNpmCandidate(candidates: RuntimeCandidate[], platform: NodeJS.Platform): RuntimeCandidate | null {
  if (candidates.length === 0) {
    return null;
  }

  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => npmCandidateScore(left.candidate, platform) - npmCandidateScore(right.candidate, platform) || left.index - right.index)[0].candidate;
}

async function getVersion(
  command: string,
  tool: "node" | "npm",
  runner: RuntimeCommandRunner,
  env: NodeJS.ProcessEnv | undefined,
  platform: NodeJS.Platform,
  errors: string[]
): Promise<string | null> {
  const result = await runner(command, ["--version"], { env, windowsHide: true, shell: shouldUseShellForCommand(command, platform) });
  const firstLine = splitCommandOutput(`${result.stdout}${result.stderr}`)[0] ?? null;
  if (result.ok) {
    return firstLine;
  }

  errors.push(`${tool} version check failed for ${command}: ${result.error ?? firstLine ?? "unknown error"}`);
  return firstLine;
}

async function detectWindowsRuntime(options: Required<Pick<RuntimeDetectionOptions, "fileExists" | "runner">> & RuntimeDetectionOptions): Promise<RuntimeDetectionResult> {
  const platform = options.platform ?? process.platform;
  const errors: string[] = [];
  const nodeCandidates: RuntimeCandidate[] = [];
  const npmCandidates: RuntimeCandidate[] = [];
  const commonNodePaths = options.commonNodePaths ?? [WINDOWS_COMMON_NODE_PATH];
  const commonNpmPaths = options.commonNpmPaths ?? WINDOWS_COMMON_NPM_PATHS;

  await addWhereCandidates("node", nodeCandidates, options.runner, platform, options.env);
  await addWhereCandidates("npm", npmCandidates, options.runner, platform, options.env);

  addCommonPathCandidates(nodeCandidates, commonNodePaths, options.fileExists, platform);
  addCommonPathCandidates(npmCandidates, commonNpmPaths, options.fileExists, platform);

  if (nodeCandidates.length === 0) {
    await addPowerShellCandidate("node", nodeCandidates, options.runner, platform, options.env);
  }

  if (!npmCandidates.some((candidate) => commandBasename(candidate.path) === "npm.cmd")) {
    await addPowerShellCandidate("npm", npmCandidates, options.runner, platform, options.env);
  }

  const nodeCandidate = selectNodeCandidate(nodeCandidates, platform);
  const npmCandidate = selectNpmCandidate(npmCandidates, platform);
  const node = nodeCandidate
    ? {
        found: true,
        path: nodeCandidate.path,
        version: await getVersion(nodeCandidate.path, "node", options.runner, options.env, platform, errors),
        source: nodeCandidate.source
      }
    : emptyExecutable();
  const npm = npmCandidate
    ? {
        found: true,
        path: npmCandidate.path,
        version: await getVersion(npmCandidate.path, "npm", options.runner, options.env, platform, errors),
        source: npmCandidate.source
      }
    : emptyExecutable();

  return { node, npm, errors };
}

async function detectPosixRuntime(options: Required<Pick<RuntimeDetectionOptions, "runner">> & RuntimeDetectionOptions): Promise<RuntimeDetectionResult> {
  const errors: string[] = [];

  async function detectTool(tool: "node" | "npm"): Promise<RuntimeExecutable> {
    const result = await options.runner("which", [tool], { env: options.env, windowsHide: true, shell: false });
    const commandPath = result.ok ? splitCommandOutput(result.stdout)[0] : null;
    if (!commandPath) {
      return emptyExecutable();
    }

    return {
      found: true,
      path: commandPath,
      version: await getVersion(commandPath, tool, options.runner, options.env, options.platform ?? process.platform, errors),
      source: "where"
    };
  }

  return {
    node: await detectTool("node"),
    npm: await detectTool("npm"),
    errors
  };
}

export async function detectRuntimes(options: RuntimeDetectionOptions = {}): Promise<RuntimeDetectionResult> {
  const platform = options.platform ?? process.platform;
  const resolvedOptions = {
    ...options,
    platform,
    fileExists: options.fileExists ?? fs.existsSync,
    runner: options.runner ?? defaultRuntimeCommandRunner
  };

  if (platform === "win32") {
    return detectWindowsRuntime(resolvedOptions);
  }

  return detectPosixRuntime(resolvedOptions);
}
