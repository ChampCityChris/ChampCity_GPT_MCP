import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { type AppConfig } from "../../config.js";
import { resolveAllowedRoot, assertSafeRelativePath, isPathInside, toRootRelativePath } from "../../security/pathPolicy.js";
import { AppError } from "../../utils/errors.js";
import { runGit, type ProcessResult } from "../../utils/git.js";
import { MAX_RELATIVE_PATH_LENGTH, MAX_ROOT_LENGTH } from "../inputLimits.js";

export type SafetyScanMode = "staged" | "working-tree" | "paths";

export interface SafetyFinding {
  relativePath: string;
  severity: "blocker" | "warning";
  rule: string;
  message: string;
}

export interface SafetyScanSummary {
  mode: SafetyScanMode;
  scannedFiles: string[];
  skippedFiles: string[];
  blockingFindings: SafetyFinding[];
  warnings: SafetyFinding[];
  safe: boolean;
}

export const PreCommitSafetyScanInputSchema = z.object({
  root: z.string().min(1).max(MAX_ROOT_LENGTH),
  mode: z.enum(["staged", "working-tree", "paths"]).default("staged"),
  paths: z.array(z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH)).max(200).optional()
});

export type PreCommitSafetyScanInput = z.infer<typeof PreCommitSafetyScanInputSchema>;

const TEXT_SCAN_MAX_BYTES = 5_000_000;

const FORBIDDEN_RULES: Array<{ rule: string; matches: (relativePath: string) => boolean; message: string }> = [
  {
    rule: "local-config",
    matches: (relativePath) => /^config\/[^/]+\.local\.json$/u.test(relativePath),
    message: "Local config files must not be staged or committed."
  },
  {
    rule: "env-file",
    matches: (relativePath) => relativePath === ".env" || (relativePath.startsWith(".env.") && relativePath !== ".env.example"),
    message: "Environment files must not be staged or committed."
  },
  {
    rule: "logs",
    matches: (relativePath) => relativePath.startsWith("logs/"),
    message: "Log directories must not be staged or committed."
  },
  {
    rule: "generated",
    matches: (relativePath) => relativePath.startsWith("generated/"),
    message: "Generated output must not be staged or committed."
  },
  {
    rule: "release",
    matches: (relativePath) => relativePath.startsWith("release/"),
    message: "Release artifacts must not be staged or committed."
  },
  {
    rule: "dist",
    matches: (relativePath) => relativePath.startsWith("dist/"),
    message: "Build output must not be staged or committed."
  },
  {
    rule: "node-modules",
    matches: (relativePath) => relativePath.startsWith("node_modules/"),
    message: "Dependency directories must not be staged or committed."
  },
  {
    rule: "package-lock-zip",
    matches: (relativePath) => relativePath === "package-lock.zip",
    message: "Packaged lockfile archives must not be staged or committed."
  },
  {
    rule: "pid-file",
    matches: (relativePath) => relativePath.endsWith(".pid"),
    message: "Process ID files must not be staged or committed."
  },
  {
    rule: "status-json",
    matches: (relativePath) => relativePath.endsWith(".status.json"),
    message: "Local status files must not be staged or committed."
  },
  {
    rule: "log-file",
    matches: (relativePath) => relativePath.endsWith(".log"),
    message: "Log files must not be staged or committed."
  },
  {
    rule: "coverage",
    matches: (relativePath) => relativePath.startsWith("coverage/"),
    message: "Coverage output must not be staged or committed."
  }
];

const PRIVATE_PATH_PATTERNS: Array<{ rule: string; regex: RegExp; message: string }> = [
  {
    rule: "windows-user-path",
    regex: /[A-Z]:(?:\\{1,2})Users(?:\\{1,2})[^\\\s"'`<>]+/iu,
    message: "Private local Windows user path detected."
  },
  {
    rule: "unix-user-path",
    regex: /\/(?:Users|home)\/[^/\s"'`<>]+/iu,
    message: "Private local user path detected."
  }
];

const TOKEN_PATTERNS: Array<{ rule: string; regex: RegExp; message: string }> = [
  {
    rule: "named-secret",
    regex: /(?:token|secret|client_secret|refresh_token|access_token|api[_-]?key)["']?\s*[:=]\s*["'][A-Za-z0-9_.-]{24,}["']/iu,
    message: "Token-looking value detected."
  },
  {
    rule: "figma-access-token",
    regex: /figmaAccessToken["']?\s*:\s*["'](?!<FIGMA_ACCESS_TOKEN>)[A-Za-z0-9_.-]{24,}["']/u,
    message: "Figma access token-looking value detected."
  },
  {
    rule: "figma-token-prefix",
    regex: /figd_[A-Za-z0-9_-]{20,}/u,
    message: "Figma token-looking value detected."
  },
  {
    rule: "bearer-token",
    regex: /bearer\s+[A-Za-z0-9_.-]{24,}/iu,
    message: "Bearer token-looking value detected."
  },
  {
    rule: "jwt",
    regex: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/u,
    message: "JWT-looking value detected."
  }
];

function assertGitSuccess(result: ProcessResult, operation: string): void {
  if (result.exitCode !== 0 || result.timedOut) {
    throw new AppError("PROCESS_FAILED", `${operation} failed.`, {
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      stderr: sanitizeProcessText(result.stderr)
    });
  }
}

export function sanitizeProcessText(value: string): string {
  return redactRemoteUrl(value).replace(/[A-Za-z0-9._%+-]+:[A-Za-z0-9._%+-]+@/gu, "***:***@");
}

export function redactRemoteUrl(value: string): string {
  return value
    .replace(/(https?:\/\/)([^/@\s:]+):([^/@\s]+)@/giu, "$1***:***@")
    .replace(/(https?:\/\/)([^/@\s:]+)@/giu, "$1***@");
}

export function normalizeGitPath(relativePath: string): string {
  return relativePath.replace(/\\/gu, "/").replace(/^\.\//u, "");
}

export function forbiddenFinding(relativePath: string): SafetyFinding | undefined {
  const normalized = normalizeGitPath(relativePath);
  const rule = FORBIDDEN_RULES.find((entry) => entry.matches(normalized));
  if (!rule) {
    return undefined;
  }

  return {
    relativePath: normalized,
    severity: "blocker",
    rule: rule.rule,
    message: rule.message
  };
}

export function validateRootGitRepo(root: string, config: AppConfig): string {
  const resolvedRoot = resolveAllowedRoot(root, config.allowedRoots);
  if (!fs.existsSync(path.join(resolvedRoot.rootRealPath, ".git"))) {
    throw new AppError("GIT_REQUIRED", "Root must be an allowed git repository root.", {
      root: resolvedRoot.rootRealPath
    });
  }

  return resolvedRoot.rootRealPath;
}

export function validateRelativeGitPath(root: string, rawPath: string): string {
  const safePath = assertSafeRelativePath(rawPath);
  if (safePath === ".") {
    throw new AppError("PATH_DENIED", "A concrete file path is required.");
  }

  const resolvedPath = path.resolve(root, safePath);
  if (!isPathInside(resolvedPath, root)) {
    throw new AppError("PATH_DENIED", "Resolved path escapes the selected root.", {
      relativePath: rawPath
    });
  }

  return normalizeGitPath(toRootRelativePath(root, resolvedPath));
}

export async function currentBranch(root: string): Promise<string> {
  const result = await runGit(root, ["branch", "--show-current"], { timeoutMs: 30_000, maxBytes: 50_000 });
  assertGitSuccess(result, "git branch --show-current");
  const branch = result.stdout.trim();
  if (!branch) {
    throw new AppError("GIT_REQUIRED", "Detached HEAD is not supported for this workflow.");
  }

  return branch;
}

export async function stagedFiles(root: string): Promise<string[]> {
  const result = await runGit(root, ["diff", "--cached", "--name-only"], { timeoutMs: 30_000, maxBytes: 500_000 });
  assertGitSuccess(result, "git diff --cached --name-only");
  return uniqueSorted(result.stdout.split(/\r?\n/u).map(normalizeGitPath).filter(Boolean));
}

export async function statusShort(root: string): Promise<string> {
  const result = await runGit(root, ["status", "--short", "--untracked-files=all"], { timeoutMs: 30_000, maxBytes: 500_000 });
  assertGitSuccess(result, "git status --short");
  return result.stdout;
}

export function parseStatusPaths(status: string): string[] {
  const paths: string[] = [];
  for (const line of status.split(/\r?\n/u)) {
    if (!line.trim() || line.startsWith("!!")) {
      continue;
    }

    const statusCode = line.slice(0, 2);
    if (statusCode === "  ") {
      continue;
    }

    const rawPath = line.slice(3);
    const renamedPath = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) ?? rawPath : rawPath;
    paths.push(normalizeGitPath(renamedPath.replace(/^"|"$/gu, "")));
  }

  return uniqueSorted(paths);
}

export async function workingTreeCandidateFiles(root: string): Promise<string[]> {
  return parseStatusPaths(await statusShort(root));
}

export async function isIgnored(root: string, relativePath: string): Promise<boolean> {
  const result = await runGit(root, ["check-ignore", "--quiet", "--", relativePath], {
    timeoutMs: 30_000,
    maxBytes: 50_000
  });
  if (result.timedOut) {
    throw new AppError("PROCESS_FAILED", "git check-ignore timed out.", {
      relativePath
    });
  }

  return result.exitCode === 0;
}

export async function assertPathCanBeStaged(root: string, relativePath: string): Promise<void> {
  if (await isIgnored(root, relativePath)) {
    throw new AppError("FILE_DENIED", "Ignored files must not be staged.", {
      relativePath
    });
  }

  const absolutePath = path.resolve(root, relativePath);
  if (fs.existsSync(absolutePath)) {
    const stats = fs.lstatSync(absolutePath);
    if (stats.isDirectory()) {
      throw new AppError("FILE_DENIED", "Only concrete file paths can be staged.", {
        relativePath
      });
    }
  }
}

function isTextBuffer(buffer: Buffer): boolean {
  return !buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0);
}

function readWorkingTreeContent(root: string, relativePath: string): Buffer | undefined {
  const absolutePath = path.resolve(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return undefined;
  }

  const stats = fs.lstatSync(absolutePath);
  if (!stats.isFile()) {
    return undefined;
  }

  if (stats.size > TEXT_SCAN_MAX_BYTES) {
    throw new AppError("FILE_DENIED", "File is too large for safety scanning.", {
      relativePath
    });
  }

  return fs.readFileSync(absolutePath);
}

async function readStagedContent(root: string, relativePath: string): Promise<Buffer | undefined> {
  const result = await runGit(root, ["show", `:${relativePath}`], {
    timeoutMs: 30_000,
    maxBytes: TEXT_SCAN_MAX_BYTES + 1
  });
  if (result.exitCode !== 0) {
    return undefined;
  }

  const buffer = Buffer.from(result.stdout, "utf8");
  if (buffer.length > TEXT_SCAN_MAX_BYTES || result.truncated) {
    throw new AppError("FILE_DENIED", "Staged file is too large for safety scanning.", {
      relativePath
    });
  }

  return buffer;
}

function scanText(relativePath: string, text: string): SafetyFinding[] {
  const findings: SafetyFinding[] = [];
  for (const pattern of PRIVATE_PATH_PATTERNS) {
    if (pattern.regex.test(text)) {
      findings.push({
        relativePath,
        severity: "blocker",
        rule: pattern.rule,
        message: pattern.message
      });
    }
  }

  for (const pattern of TOKEN_PATTERNS) {
    if (pattern.regex.test(text)) {
      findings.push({
        relativePath,
        severity: "blocker",
        rule: pattern.rule,
        message: pattern.message
      });
    }
  }

  return findings;
}

async function scanFileContent(root: string, relativePath: string, mode: SafetyScanMode): Promise<{ blockers: SafetyFinding[]; warnings: SafetyFinding[]; scanned: boolean }> {
  const content = mode === "staged" ? await readStagedContent(root, relativePath) : readWorkingTreeContent(root, relativePath);
  if (!content) {
    return { blockers: [], warnings: [], scanned: false };
  }

  if (!isTextBuffer(content)) {
    return {
      blockers: [],
      warnings: [
        {
          relativePath,
          severity: "warning",
          rule: "binary-skip",
          message: "Binary-looking file was not scanned as text."
        }
      ],
      scanned: false
    };
  }

  return {
    blockers: scanText(relativePath, content.toString("utf8")),
    warnings: [],
    scanned: true
  };
}

export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export async function scanFiles(root: string, files: string[], mode: SafetyScanMode): Promise<SafetyScanSummary> {
  const scannedFiles: string[] = [];
  const skippedFiles: string[] = [];
  const blockingFindings: SafetyFinding[] = [];
  const warnings: SafetyFinding[] = [];

  for (const file of uniqueSorted(files.map(normalizeGitPath).filter(Boolean))) {
    const forbidden = forbiddenFinding(file);
    if (forbidden) {
      blockingFindings.push(forbidden);
      skippedFiles.push(file);
      continue;
    }

    const contentScan = await scanFileContent(root, file, mode);
    if (contentScan.scanned) {
      scannedFiles.push(file);
    }
    blockingFindings.push(...contentScan.blockers);
    warnings.push(...contentScan.warnings);
  }

  return {
    mode,
    scannedFiles: uniqueSorted(scannedFiles),
    skippedFiles: uniqueSorted(skippedFiles),
    blockingFindings,
    warnings,
    safe: blockingFindings.length === 0
  };
}

export async function preCommitSafetyScan(rawInput: unknown, config: AppConfig): Promise<SafetyScanSummary> {
  const input = PreCommitSafetyScanInputSchema.parse(rawInput);
  const root = validateRootGitRepo(input.root, config);
  let files: string[];

  if (input.mode === "staged") {
    files = await stagedFiles(root);
  } else if (input.mode === "working-tree") {
    files = await workingTreeCandidateFiles(root);
  } else {
    if (!input.paths || input.paths.length === 0) {
      throw new AppError("INVALID_INPUT", "paths mode requires at least one path.");
    }
    files = input.paths.map((entry) => validateRelativeGitPath(root, entry));
  }

  return scanFiles(root, files, input.mode);
}
