import fs from "node:fs";
import path from "node:path";

import { assertSafeRelativePath, isPathInside } from "./security/pathPolicy.js";
import { AppError } from "./utils/errors.js";

export const WORKSPACE_WRITE_POLICIES = ["git_required", "artifact_only"] as const;
export type WorkspaceWritePolicy = (typeof WORKSPACE_WRITE_POLICIES)[number];

export const DEFAULT_ARTIFACT_WRITE_ROOTS = ["planning"] as const;

export type WorkspaceOperationClass =
  | "filesystem_read"
  | "workspace_diagnostics"
  | "artifact_persistence"
  | "patch_workflow"
  | "git_inspection"
  | "git_mutation"
  | "release_inspection"
  | "release_publication";

export interface WorkspaceAuthority {
  workspaceId: string;
  policy: WorkspaceWritePolicy;
  gitDetected: boolean;
  artifactWriteRoots: string[];
  artifactRootWarnings: string[];
  legacyRequireGitRootDeprecated: boolean;
  operation: WorkspaceOperationClass;
  allowed: boolean;
  denialReason?: "WORKSPACE_POLICY_DENIED" | "GIT_CAPABILITY_UNAVAILABLE" | "TARGET_OUTSIDE_ARTIFACT_ROOTS";
}

const URL_PATTERN = /^[a-z][a-z0-9+.-]*:/iu;
const DRIVE_PATTERN = /^[a-z]:/iu;
const GLOB_PATTERN = /[*?[\]{}]/u;
const SHELL_METACHAR_PATTERN = /[;$`"'|&<>]/u;
const BLOCKED_ARTIFACT_ROOT_SEGMENTS = new Set([
  ".git",
  ".hg",
  ".svn",
  "appdata",
  "config",
  "coverage",
  "dist",
  "generated",
  "logs",
  "node_modules",
  "release",
  "secrets",
  "tmp",
  "temp"
]);

function isUncPath(value: string): boolean {
  return value.startsWith("\\\\") || value.startsWith("//");
}

export function assertWorkspaceWritePolicy(value: unknown, label = "writePolicy"): WorkspaceWritePolicy {
  if (value === "git_required" || value === "artifact_only") {
    return value;
  }

  throw new AppError("INVALID_INPUT", `${label} must be git_required or artifact_only.`);
}

function normalizeArtifactRootValue(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new AppError("INVALID_INPUT", `${label} must be a non-empty workspace-relative directory prefix.`);
  }

  if (trimmed.includes("\0")) {
    throw new AppError("INVALID_INPUT", `${label} contains a null byte.`);
  }

  if (trimmed !== "." && URL_PATTERN.test(trimmed)) {
    throw new AppError("INVALID_INPUT", `${label} must not be a URL or scheme path.`);
  }

  if (path.isAbsolute(trimmed) || DRIVE_PATTERN.test(trimmed) || isUncPath(trimmed)) {
    throw new AppError("INVALID_INPUT", `${label} must be workspace-relative.`);
  }

  if (GLOB_PATTERN.test(trimmed)) {
    throw new AppError("INVALID_INPUT", `${label} must not contain wildcard or glob syntax.`);
  }

  if (SHELL_METACHAR_PATTERN.test(trimmed)) {
    throw new AppError("INVALID_INPUT", `${label} must not contain shell metacharacters.`);
  }

  const safePath = assertSafeRelativePath(trimmed);
  if (safePath === ".") {
    return ".";
  }

  const normalized = safePath.replace(/\\/gu, "/").replace(/\/+/gu, "/").replace(/^\.\/+/u, "").replace(/\/+$/u, "");
  const segments = normalized.split("/").filter(Boolean);
  const blocked = segments.find((segment) => BLOCKED_ARTIFACT_ROOT_SEGMENTS.has(segment.toLowerCase()));
  if (blocked) {
    throw new AppError("INVALID_INPUT", `${label} contains blocked directory segment: ${blocked}.`);
  }

  return normalized;
}

export function normalizeArtifactWriteRoots(
  value: unknown,
  workspaceRoot: string,
  label = "artifactWriteRoots"
): { roots: string[]; warnings: string[] } {
  if (!Array.isArray(value)) {
    throw new AppError("INVALID_INPUT", `${label} must be an array of workspace-relative directory prefixes.`);
  }

  const seen = new Set<string>();
  const roots: string[] = [];
  const warnings: string[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string") {
      throw new AppError("INVALID_INPUT", `${label}[${index}] must be a string.`);
    }

    const normalized = normalizeArtifactRootValue(entry, `${label}[${index}]`);
    const resolved = path.resolve(workspaceRoot, normalized);
    if (!isPathInside(resolved, workspaceRoot)) {
      throw new AppError("INVALID_INPUT", `${label}[${index}] escapes the configured workspace root.`);
    }

    const comparison = process.platform === "win32" ? normalized.toLowerCase() : normalized;
    if (seen.has(comparison)) {
      continue;
    }
    seen.add(comparison);
    roots.push(normalized);

    if (normalized === ".") {
      warnings.push("Artifact root '.' permits Markdown/JSON artifact-extension writes throughout this workspace.");
    }
  }

  if (roots.length === 0) {
    throw new AppError("INVALID_INPUT", `${label} must include at least one safe artifact write root.`);
  }

  return { roots, warnings };
}

export function defaultArtifactWriteRootsForPolicy(policy: WorkspaceWritePolicy): string[] {
  return policy === "artifact_only" ? [...DEFAULT_ARTIFACT_WRITE_ROOTS] : [];
}

export function detectGitRepository(root: string): boolean {
  return fs.existsSync(path.join(root, ".git"));
}

export function isRelativePathInsideArtifactRoots(relativePath: string, artifactWriteRoots: readonly string[]): boolean {
  const normalizedRelativePath = relativePath.replace(/\\/gu, "/").replace(/^\.\//u, "");
  return artifactWriteRoots.some((root) => {
    if (root === ".") {
      return true;
    }
    return normalizedRelativePath === root || normalizedRelativePath.startsWith(`${root}/`);
  });
}
