import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { AppError } from "../../utils/errors.js";

export type ArchitectStatus =
  | "passed"
  | "failed"
  | "timed_out"
  | "not_configured"
  | "not_packaged"
  | "source_unavailable"
  | "blocked_by_environment"
  | "execution_error"
  | "validation_failure"
  | "analysis_failure"
  | "startup_failure";

export interface StructuredToolError {
  code: string;
  message: string;
}

export interface ArchitectToolResult<T> {
  ok: boolean;
  status: ArchitectStatus;
  tool: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  repositoryRoot: string;
  headBefore?: string;
  headAfter?: string;
  warnings: string[];
  errors: StructuredToolError[];
  truncated: boolean;
  data?: T;
}

export interface FixedProcessResult {
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  terminationReason: "exit" | "signal" | "timeout" | "spawn_error";
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

export interface ChangedFiles {
  added: string[];
  modified: string[];
  deleted: string[];
  renamed: Array<{ from: string; to: string }>;
  untracked: string[];
}

const REDACTED = "<REDACTED_SECRET>";
const SAFE_ENV_KEYS = [
  "ALLUSERSPROFILE",
  "APPDATA",
  "ComSpec",
  "HOMEDRIVE",
  "HOMEPATH",
  "LOCALAPPDATA",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "Path",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "SystemDrive",
  "SystemRoot",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "windir"
] as const;

function canonicalPath(value: string): string {
  return fs.realpathSync.native(path.resolve(value));
}

export function assertVerifiedRepositoryRoot(root: string): string {
  const resolved = canonicalPath(root);
  if (!fs.existsSync(path.join(resolved, ".git")) || !fs.existsSync(path.join(resolved, "package.json"))) {
    throw new AppError("GIT_REQUIRED", "Architect diagnostics require a repository root containing .git and package.json.");
  }
  return resolved;
}

export function safeFixedProcessEnv(additions: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  for (const [key, value] of Object.entries(additions)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

export function redactDiagnosticText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/giu, `Bearer ${REDACTED}`)
    .replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|figd_[A-Za-z0-9_-]{20,})\b/gu, REDACTED)
    .replace(
      /\b(access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|client[_-]?secret|password|secret)\b\s*[:=]\s*["']?[^"'\s\r\n]+["']?/giu,
      `$1=${REDACTED}`
    );
}

function appendBounded(
  current: Buffer<ArrayBufferLike>,
  chunk: Buffer<ArrayBufferLike>,
  maxBytes: number
): { value: Buffer<ArrayBufferLike>; truncated: boolean } {
  if (current.length >= maxBytes) {
    return { value: current, truncated: true };
  }
  const next = Buffer.concat([current, chunk]);
  return next.length > maxBytes
    ? { value: next.subarray(0, maxBytes), truncated: true }
    : { value: next, truncated: false };
}

async function terminateProcessTree(pid: number): Promise<void> {
  if (process.platform !== "win32") {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // The process already exited.
      }
    }
    return;
  }

  await new Promise<void>((resolve) => {
    const killer = spawn("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
      shell: false,
      windowsHide: true,
      stdio: "ignore"
    });
    killer.once("error", () => resolve());
    killer.once("close", () => resolve());
  });
}

export function runFixedProcess(options: {
  executable: string;
  args: readonly string[];
  cwd: string;
  timeoutMs: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<FixedProcessResult> {
  const cwd = assertVerifiedRepositoryRoot(options.cwd);
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const maxStdoutBytes = options.maxStdoutBytes ?? 300_000;
  const maxStderrBytes = options.maxStderrBytes ?? 200_000;

  return new Promise((resolve) => {
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let spawnError: Error | undefined;
    let settled = false;

    const child = spawn(options.executable, [...options.args], {
      cwd,
      env: options.env ?? safeFixedProcessEnv(),
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      const completed = Date.now();
      resolve({
        stdout: redactDiagnosticText(stdout.toString("utf8")),
        stderr: redactDiagnosticText(stderr.toString("utf8")),
        stdoutTruncated,
        stderrTruncated,
        exitCode,
        signal,
        timedOut,
        terminationReason: timedOut ? "timeout" : spawnError ? "spawn_error" : signal ? "signal" : "exit",
        startedAt,
        completedAt: new Date(completed).toISOString(),
        durationMs: completed - started
      });
    };

    child.stdout.on("data", (chunk: Buffer) => {
      const appended = appendBounded(stdout, chunk, maxStdoutBytes);
      stdout = appended.value;
      stdoutTruncated ||= appended.truncated;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const appended = appendBounded(stderr, chunk, maxStderrBytes);
      stderr = appended.value;
      stderrTruncated ||= appended.truncated;
    });
    child.once("error", (error) => {
      spawnError = error;
      finish(null, null);
    });
    child.once("close", finish);

    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) {
        void terminateProcessTree(child.pid).finally(() => {
          setTimeout(() => finish(null, null), 1500).unref();
        });
      } else {
        finish(null, null);
      }
    }, options.timeoutMs);
    timer.unref();
  });
}

function emptyChangedFiles(): ChangedFiles {
  return { added: [], modified: [], deleted: [], renamed: [], untracked: [] };
}

export function parseGitStatusShort(output: string): ChangedFiles {
  const changed = emptyChangedFiles();
  for (const line of output.split(/\r?\n/u).filter(Boolean)) {
    const status = line.slice(0, 2);
    const rawPath = line.slice(3).trim().replace(/^"|"$/gu, "");
    if (status === "??") {
      changed.untracked.push(rawPath);
    } else if (status.includes("R") && rawPath.includes(" -> ")) {
      const [from, to] = rawPath.split(" -> ", 2);
      changed.renamed.push({ from, to });
    } else if (status.includes("D")) {
      changed.deleted.push(rawPath);
    } else if (status.includes("A")) {
      changed.added.push(rawPath);
    } else if (status.includes("M") || status.includes("T")) {
      changed.modified.push(rawPath);
    }
  }
  return changed;
}

export async function captureRepositoryState(root: string): Promise<{ head: string; changedFiles: ChangedFiles }> {
  const env = safeFixedProcessEnv({ GIT_PAGER: "cat", GIT_TERMINAL_PROMPT: "0", GIT_EXTERNAL_DIFF: "" });
  const [headResult, statusResult] = await Promise.all([
    runFixedProcess({ executable: process.platform === "win32" ? "git.exe" : "git", args: ["rev-parse", "HEAD"], cwd: root, timeoutMs: 15_000, maxStdoutBytes: 2000, env }),
    runFixedProcess({ executable: process.platform === "win32" ? "git.exe" : "git", args: ["status", "--short", "--untracked-files=all"], cwd: root, timeoutMs: 15_000, maxStdoutBytes: 200_000, env })
  ]);
  if (headResult.exitCode !== 0 || statusResult.exitCode !== 0) {
    throw new AppError("PROCESS_FAILED", "Could not capture repository state for architect diagnostics.");
  }
  return {
    head: headResult.stdout.trim(),
    changedFiles: parseGitStatusShort(statusResult.stdout)
  };
}

export function completedResult<T>(options: {
  tool: string;
  root: string;
  startedAt: string;
  status: ArchitectStatus;
  data?: T;
  headBefore?: string;
  headAfter?: string;
  warnings?: string[];
  errors?: StructuredToolError[];
  truncated?: boolean;
}): ArchitectToolResult<T> {
  const completedAt = new Date().toISOString();
  return {
    ok: options.status === "passed",
    status: options.status,
    tool: options.tool,
    startedAt: options.startedAt,
    completedAt,
    durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(options.startedAt)),
    repositoryRoot: options.root,
    headBefore: options.headBefore,
    headAfter: options.headAfter,
    warnings: options.warnings ?? [],
    errors: options.errors ?? [],
    truncated: options.truncated ?? false,
    data: options.data
  };
}
