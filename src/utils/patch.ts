import fs from "node:fs";
import path from "node:path";

import { createTwoFilesPatch, parsePatch } from "diff";

import { assertMarkdownArtifactPath, assertFilePolicyAllowsPath } from "../security/filePolicy.js";
import { assertSafeRelativePath, resolveProjectPath, toRootRelativePath } from "../security/pathPolicy.js";
import { AppError } from "./errors.js";

export interface PreparedTextChange {
  relativePath: string;
  originalContent: string;
  updatedContent: string;
}

function normalizePatchPath(fileName: string | undefined): string | null {
  if (!fileName || fileName === "/dev/null") {
    return null;
  }

  let normalized = fileName.replace(/\\/g, "/");
  if (normalized.startsWith("a/") || normalized.startsWith("b/")) {
    normalized = normalized.slice(2);
  }

  return normalized;
}

const REGULAR_GIT_FILE_MODES = new Set(["100644", "100755"]);
const GIT_MODE_LINE_PATTERN = /^(?:(?:new file|deleted file) mode|(?:old|new) mode|mode) ([0-7]{6})$/;
const GIT_INDEX_MODE_PATTERN = /^index [0-9a-fA-F]+\.\.[0-9a-fA-F]+(?: [0-7]{6})?$/;

function assertRegularGitMode(mode: string, line: string): void {
  if (!REGULAR_GIT_FILE_MODES.has(mode)) {
    throw new AppError("PATCH_DENIED", "Patch contains a symlink, submodule, or special file mode.", {
      mode,
      line
    });
  }
}

export function assertPatchContainsOnlyRegularFiles(patch: string): void {
  for (const line of patch.split(/\r?\n/)) {
    const modeLineMatch = GIT_MODE_LINE_PATTERN.exec(line);
    if (modeLineMatch) {
      assertRegularGitMode(modeLineMatch[1], line);
      continue;
    }

    if (GIT_INDEX_MODE_PATTERN.test(line)) {
      const maybeMode = line.split(" ").at(-1);
      if (maybeMode && /^[0-7]{6}$/.test(maybeMode)) {
        assertRegularGitMode(maybeMode, line);
      }
    }
  }
}

export function createUnifiedDiff(changes: PreparedTextChange[]): string {
  return changes
    .map((change) =>
      createTwoFilesPatch(
        `a/${change.relativePath}`,
        `b/${change.relativePath}`,
        change.originalContent,
        change.updatedContent,
        "",
        "",
        { context: 3 }
      )
    )
    .join("\n");
}

export function collectPatchTargetPaths(patch: string): string[] {
  const parsedPatch = parsePatch(patch);
  const targets = new Set<string>();

  for (const filePatch of parsedPatch) {
    const oldPath = normalizePatchPath(filePatch.oldFileName);
    const newPath = normalizePatchPath(filePatch.newFileName);

    if (oldPath) {
      targets.add(oldPath);
    }

    if (newPath) {
      targets.add(newPath);
    }
  }

  if (targets.size === 0) {
    throw new AppError("PATCH_DENIED", "Patch does not contain any recognizable file targets.");
  }

  return [...targets];
}

export function assertChangedPathsAreNotSymlinks(root: string, relativePaths: string[]): void {
  const symlinkPaths: string[] = [];

  for (const relativePath of relativePaths) {
    const absolutePath = path.resolve(root, relativePath);

    try {
      if (fs.lstatSync(absolutePath).isSymbolicLink()) {
        symlinkPaths.push(relativePath);
      }
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        continue;
      }

      throw error;
    }
  }

  if (symlinkPaths.length > 0) {
    throw new AppError("PATCH_DENIED", "Patch produced or touched symbolic link path(s).", {
      symlinkPaths
    });
  }
}

export function validatePatchTargets(root: string, patch: string, allowedRoots: string[]): string[] {
  assertPatchContainsOnlyRegularFiles(patch);
  const targetPaths = collectPatchTargetPaths(patch);
  const validated = new Set<string>();

  for (const targetPath of targetPaths) {
    assertSafeRelativePath(targetPath);
    const resolved = resolveProjectPath(root, targetPath, allowedRoots);
    const relativePath = toRootRelativePath(resolved.rootRealPath, resolved.resolvedPath);
    assertFilePolicyAllowsPath(resolved.resolvedPath, relativePath);
    validated.add(relativePath);
  }

  return [...validated].sort();
}

export function validateMarkdownPatchTarget(root: string, relativePath: string, allowedRoots: string[]): string {
  const resolved = resolveProjectPath(root, relativePath, allowedRoots);
  const normalizedRelativePath = toRootRelativePath(resolved.rootRealPath, resolved.resolvedPath);
  assertMarkdownArtifactPath(resolved.resolvedPath, normalizedRelativePath);
  return normalizedRelativePath;
}

export function stripPatchPrefixes(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.startsWith("a/") || normalized.startsWith("b/")) {
    return normalized.slice(2);
  }

  return normalized;
}

export function normalizeDiffRelativePath(relativePath: string): string {
  const normalized = relativePath.split(path.sep).join("/");
  return normalized === "." ? "" : normalized;
}
