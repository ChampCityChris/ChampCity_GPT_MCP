import fs from "node:fs";
import path from "node:path";

import { AppError } from "../../utils/errors.js";
import {
  assertVerifiedRepositoryRoot,
  completedResult,
  runFixedProcess,
  safeFixedProcessEnv,
  type ArchitectToolResult,
  type FixedProcessResult
} from "./common.js";

export type GitInspectionInput =
  | { operation: "log"; maxCount: number; ref?: string }
  | { operation: "show_commit"; ref: string }
  | { operation: "diff_refs"; baseRef: string; targetRef: string }
  | { operation: "file_history"; file: string; maxCount: number }
  | { operation: "blame"; file: string; ref?: string; startLine?: number; endLine?: number }
  | { operation: "merge_base"; baseRef: string; targetRef: string }
  | { operation: "check_ancestry"; ancestorRef: string; descendantRef: string };

const SAFE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,127}$/u;
const COMMIT_FORMAT = "%H%x1f%P%x1f%an%x1f%aI%x1f%cn%x1f%cI%x1f%s%x1f%b%x1e";

function assertSafeRef(value: string): string {
  if (
    !SAFE_REF_PATTERN.test(value) ||
    value.startsWith("-") ||
    value.includes("..") ||
    value.includes("//") ||
    value.endsWith(".") ||
    value.endsWith("/") ||
    value.includes("@{")
  ) {
    throw new AppError("INVALID_INPUT", "Git ref was rejected by the fixed read-only inspection policy.");
  }
  return value;
}

function assertSafeRepoPath(root: string, value: string): string {
  if (!value || path.isAbsolute(value) || value.includes("\0")) {
    throw new AppError("PATH_DENIED", "Git inspection paths must be repository-relative.");
  }
  const normalized = value.replaceAll("\\", "/");
  if (normalized.split("/").some((segment) => segment === ".." || segment === "." || !segment)) {
    throw new AppError("PATH_DENIED", "Git inspection paths must not contain traversal or empty segments.");
  }
  const absolute = path.resolve(root, ...normalized.split("/"));
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new AppError("PATH_DENIED", "Git inspection path escapes the repository.");
  }
  return normalized;
}

function gitExecutable(): string {
  return process.platform === "win32" ? "git.exe" : "git";
}

function gitEnv(): NodeJS.ProcessEnv {
  return safeFixedProcessEnv({
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    GIT_EXTERNAL_DIFF: "",
    GIT_CONFIG_NOSYSTEM: "1",
    LC_ALL: "C",
    NO_COLOR: "1"
  });
}

async function git(root: string, args: string[], maxStdoutBytes = 400_000): Promise<FixedProcessResult> {
  return runFixedProcess({
    executable: gitExecutable(),
    args: ["--no-pager", ...args],
    cwd: root,
    timeoutMs: 45_000,
    maxStdoutBytes,
    maxStderrBytes: 100_000,
    env: gitEnv()
  });
}

function assertGitResult(result: FixedProcessResult, operation: string, acceptedExitCodes: number[] = [0]): void {
  if (result.timedOut) {
    throw new AppError("PROCESS_FAILED", `${operation} timed out.`);
  }
  if (result.exitCode === null || !acceptedExitCodes.includes(result.exitCode)) {
    throw new AppError("PROCESS_FAILED", `${operation} failed: ${result.stderr || result.stdout}`);
  }
}

function parseCommits(output: string) {
  return output
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash = "", parents = "", author = "", authorDate = "", committer = "", committerDate = "", subject = "", body = ""] = record.split("\x1f");
      return { hash, parents: parents.split(" ").filter(Boolean), author, authorDate, committer, committerDate, subject, body: body.trim() };
    });
}

function parseNameStatus(output: string) {
  const changedFiles: Array<{ status: string; path: string; previousPath?: string }> = [];
  for (const line of output.split(/\r?\n/u).filter(Boolean)) {
    const fields = line.split("\t");
    const status = fields[0] ?? "";
    if ((status.startsWith("R") || status.startsWith("C")) && fields.length >= 3) {
      changedFiles.push({ status, previousPath: fields[1], path: fields[2] });
    } else if (fields[1]) {
      changedFiles.push({ status, path: fields[1] });
    }
  }
  return changedFiles;
}

function parseBlame(output: string) {
  const entries: Array<Record<string, unknown>> = [];
  const lines = output.split(/\r?\n/u);
  let current: Record<string, unknown> | undefined;
  for (const line of lines) {
    const header = /^([a-f0-9]{40}) (\d+) (\d+)(?: (\d+))?$/u.exec(line);
    if (header) {
      if (current) {
        entries.push(current);
      }
      current = { commit: header[1], originalLine: Number(header[2]), finalLine: Number(header[3]), lineCount: Number(header[4] ?? 1) };
    } else if (current && line.startsWith("author ")) {
      current.author = line.slice(7);
    } else if (current && line.startsWith("author-time ")) {
      current.authorTime = Number(line.slice(12));
    } else if (current && line.startsWith("summary ")) {
      current.summary = line.slice(8);
    } else if (current && line.startsWith("filename ")) {
      current.file = line.slice(9);
    } else if (current && line.startsWith("\t")) {
      current.content = line.slice(1);
    }
  }
  if (current) {
    entries.push(current);
  }
  return entries;
}

function binaryIndicators(patch: string): string[] {
  return patch.split(/\r?\n/u).filter((line) => /^Binary files |^GIT binary patch$/u.test(line));
}

export async function runGitInspection(rootInput: string, input: GitInspectionInput): Promise<ArchitectToolResult<unknown>> {
  const root = assertVerifiedRepositoryRoot(rootInput);
  const startedAt = new Date().toISOString();
  try {
    let data: unknown;
    let truncated = false;
    switch (input.operation) {
      case "log": {
        const ref = input.ref ? assertSafeRef(input.ref) : undefined;
        const result = await git(root, ["log", "--no-color", `--max-count=${input.maxCount}`, `--format=${COMMIT_FORMAT}`, ...(ref ? [ref] : []), "--"]);
        assertGitResult(result, "git log");
        truncated = result.stdoutTruncated;
        data = { operation: input.operation, ref: ref ?? "HEAD", commits: parseCommits(result.stdout), truncation: truncated };
        break;
      }
      case "show_commit": {
        const ref = assertSafeRef(input.ref);
        const [metadata, names, patch] = await Promise.all([
          git(root, ["show", "--no-color", "--no-ext-diff", "--no-patch", `--format=${COMMIT_FORMAT}`, ref, "--"], 100_000),
          git(root, ["diff-tree", "--root", "--no-commit-id", "--name-status", "-r", "-M", ref, "--"], 200_000),
          git(root, ["show", "--no-color", "--no-ext-diff", "--format=", "--find-renames", "--patch", ref, "--"], 400_000)
        ]);
        [metadata, names, patch].forEach((result, index) => assertGitResult(result, ["git show metadata", "git show names", "git show patch"][index]));
        truncated = metadata.stdoutTruncated || names.stdoutTruncated || patch.stdoutTruncated;
        data = {
          operation: input.operation,
          ref,
          commit: parseCommits(metadata.stdout)[0],
          changedFiles: parseNameStatus(names.stdout),
          patch: patch.stdout,
          binaryFileIndicators: binaryIndicators(patch.stdout),
          truncation: truncated
        };
        break;
      }
      case "diff_refs": {
        const baseRef = assertSafeRef(input.baseRef);
        const targetRef = assertSafeRef(input.targetRef);
        const [mergeBase, names, patch] = await Promise.all([
          git(root, ["merge-base", baseRef, targetRef], 5000),
          git(root, ["diff", "--no-color", "--no-ext-diff", "--name-status", "-M", baseRef, targetRef, "--"], 200_000),
          git(root, ["diff", "--no-color", "--no-ext-diff", "--find-renames", "--patch", baseRef, targetRef, "--"], 400_000)
        ]);
        [mergeBase, names, patch].forEach((result, index) => assertGitResult(result, ["git merge-base", "git diff names", "git diff patch"][index]));
        truncated = names.stdoutTruncated || patch.stdoutTruncated;
        data = {
          operation: input.operation,
          baseRef,
          targetRef,
          mergeBase: mergeBase.stdout.trim(),
          changedFiles: parseNameStatus(names.stdout),
          renameInformation: parseNameStatus(names.stdout).filter((entry) => entry.previousPath),
          patch: patch.stdout,
          binaryFileIndicators: binaryIndicators(patch.stdout),
          truncation: truncated
        };
        break;
      }
      case "file_history": {
        const file = assertSafeRepoPath(root, input.file);
        const result = await git(root, ["log", "--no-color", `--max-count=${input.maxCount}`, `--format=${COMMIT_FORMAT}`, "--follow", "--", file]);
        assertGitResult(result, "git file history");
        truncated = result.stdoutTruncated;
        data = { operation: input.operation, file, commits: parseCommits(result.stdout), truncation: truncated };
        break;
      }
      case "blame": {
        const file = assertSafeRepoPath(root, input.file);
        if (input.startLine !== undefined && input.endLine !== undefined && input.endLine < input.startLine) {
          throw new AppError("INVALID_INPUT", "Blame endLine must be greater than or equal to startLine.");
        }
        if (fs.existsSync(path.join(root, file)) && input.endLine !== undefined) {
          const lineCount = fs.readFileSync(path.join(root, file), "utf8").split(/\r?\n/u).length;
          if (input.endLine > lineCount) {
            throw new AppError("INVALID_INPUT", "Blame endLine exceeds the current file length.");
          }
        }
        const ref = input.ref ? assertSafeRef(input.ref) : undefined;
        const range = input.startLine !== undefined ? [`-L${input.startLine},${input.endLine ?? input.startLine}`] : [];
        const result = await git(root, ["blame", "--line-porcelain", "--no-progress", ...range, ...(ref ? [ref] : []), "--", file]);
        assertGitResult(result, "git blame");
        truncated = result.stdoutTruncated;
        data = { operation: input.operation, file, ref: ref ?? "HEAD", entries: parseBlame(result.stdout), truncation: truncated };
        break;
      }
      case "merge_base": {
        const baseRef = assertSafeRef(input.baseRef);
        const targetRef = assertSafeRef(input.targetRef);
        const result = await git(root, ["merge-base", baseRef, targetRef], 5000);
        assertGitResult(result, "git merge-base");
        data = { operation: input.operation, baseRef, targetRef, mergeBase: result.stdout.trim() };
        break;
      }
      case "check_ancestry": {
        const ancestorRef = assertSafeRef(input.ancestorRef);
        const descendantRef = assertSafeRef(input.descendantRef);
        const result = await git(root, ["merge-base", "--is-ancestor", ancestorRef, descendantRef], 5000);
        assertGitResult(result, "git ancestry check", [0, 1]);
        data = { operation: input.operation, ancestorRef, descendantRef, isAncestor: result.exitCode === 0 };
        break;
      }
    }
    return completedResult({
      tool: "git_toolbox.inspect_history",
      root,
      startedAt,
      status: "passed",
      truncated,
      data
    });
  } catch (error) {
    return completedResult({
      tool: "git_toolbox.inspect_history",
      root,
      startedAt,
      status: error instanceof AppError && (error.code === "INVALID_INPUT" || error.code === "PATH_DENIED") ? "validation_failure" : "execution_error",
      errors: [{
        code: error instanceof AppError ? error.code.toLowerCase() : "process_failure",
        message: error instanceof Error ? error.message : String(error)
      }]
    });
  }
}
