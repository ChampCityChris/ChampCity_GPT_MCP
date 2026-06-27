import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { AppError } from "./errors.js";

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
}

function executableForPlatform(command: string): string {
  if (process.platform !== "win32") {
    return command;
  }

  if (command === "npm" || command === "pnpm" || command === "yarn" || command === "npx") {
    return `${command}.cmd`;
  }

  if (command === "git") {
    return "git.exe";
  }

  return command;
}

export function nearestExistingDirectory(startPath: string): string {
  let current = path.resolve(startPath);

  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      throw new AppError("PATH_DENIED", "Could not find an existing parent directory.", {
        startPath
      });
    }

    current = parent;
  }

  const stats = fs.statSync(current);
  return stats.isDirectory() ? current : path.dirname(current);
}

export function findGitRoot(startPath: string): string | null {
  let current = nearestExistingDirectory(startPath);

  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }

    current = parent;
  }
}

export function assertInsideGitRepo(targetPath: string): string {
  const gitRoot = findGitRoot(targetPath);
  if (!gitRoot) {
    throw new AppError("GIT_REQUIRED", "Writes require the target to belong to a git repository.", {
      targetPath
    });
  }

  return gitRoot;
}

export function runProcess(
  command: string,
  args: string[],
  cwd: string,
  options: { timeoutMs?: number; maxBytes?: number; stdin?: string } = {}
): Promise<ProcessResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxBytes = options.maxBytes ?? 500_000;

  return new Promise((resolve, reject) => {
    const child = spawn(executableForPlatform(command), args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let truncated = false;
    let settled = false;

    const appendOutput = (current: Buffer, chunk: Buffer): Buffer => {
      if (current.length >= maxBytes) {
        truncated = true;
        return current;
      }

      const next = Buffer.concat([current, chunk]);
      if (next.length > maxBytes) {
        truncated = true;
        return next.subarray(0, maxBytes);
      }

      return next;
    };

    const timer = setTimeout(() => {
      child.kill();
      settled = true;
      resolve({
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        exitCode: null,
        timedOut: true,
        truncated
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendOutput(stdout, chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendOutput(stderr, chunk);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      if (!settled) {
        reject(new AppError("PROCESS_FAILED", error.message));
      }
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (!settled) {
        resolve({
          stdout: stdout.toString("utf8"),
          stderr: stderr.toString("utf8"),
          exitCode,
          timedOut: false,
          truncated
        });
      }
    });

    if (options.stdin !== undefined) {
      child.stdin.end(options.stdin);
    } else {
      child.stdin.end();
    }
  });
}

export async function runGit(root: string, args: string[], options: { timeoutMs?: number; maxBytes?: number; stdin?: string } = {}): Promise<ProcessResult> {
  return runProcess("git", args, root, options);
}

export async function getGitDiffSummary(root: string): Promise<string> {
  const result = await runGit(root, ["diff", "--stat"], {
    timeoutMs: 30_000,
    maxBytes: 100_000
  });

  return result.stdout.trim();
}
