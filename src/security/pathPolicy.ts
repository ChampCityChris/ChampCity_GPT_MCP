import fs from "node:fs";
import path from "node:path";

import { AppError } from "../utils/errors.js";

export interface ResolvedRoot {
  requestedRoot: string;
  rootRealPath: string;
}

export interface ResolvedProjectPath extends ResolvedRoot {
  requestedPath: string;
  resolvedPath: string;
  relativePath: string;
}

function normalizeForComparison(value: string): string {
  const normalized = path.resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function isPathInside(childPath: string, parentPath: string): boolean {
  const child = normalizeForComparison(childPath);
  const parent = normalizeForComparison(parentPath);
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isUncPath(value: string): boolean {
  return value.startsWith("\\\\") || value.startsWith("//");
}

function hasDriveSpecifier(value: string): boolean {
  return /^[a-zA-Z]:/.test(value);
}

export function assertSafeRelativePath(relativePath: string): string {
  if (relativePath.includes("\0")) {
    throw new AppError("PATH_DENIED", "Path contains a null byte.");
  }

  const normalizedInput = relativePath.trim() === "" ? "." : relativePath;

  if (path.isAbsolute(normalizedInput) || isUncPath(normalizedInput) || hasDriveSpecifier(normalizedInput)) {
    throw new AppError("PATH_DENIED", "Expected a relative path inside the selected root.");
  }

  if (normalizedInput.includes(":")) {
    throw new AppError("PATH_DENIED", "Relative paths may not contain ':' characters.");
  }

  const segments = normalizedInput.split(/[\\/]+/).filter(Boolean);
  if (segments.some((segment) => segment === "..")) {
    throw new AppError("PATH_DENIED", "Path traversal is not allowed.");
  }

  return normalizedInput;
}

function realpathStrict(value: string, label: string): string {
  try {
    return fs.realpathSync.native(value);
  } catch (error) {
    throw new AppError("PATH_DENIED", `${label} does not exist or cannot be resolved.`, {
      path: value,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
}

function resolveExistingPathOrParent(candidatePath: string): string {
  const missingSegments: string[] = [];
  let current = path.resolve(candidatePath);

  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      throw new AppError("PATH_DENIED", "Could not resolve an existing parent for the requested path.");
    }

    missingSegments.unshift(path.basename(current));
    current = parent;
  }

  const realBase = fs.realpathSync.native(current);
  return path.resolve(realBase, ...missingSegments);
}

export function resolveAllowedRoot(root: string, allowedRoots: string[]): ResolvedRoot {
  if (!path.isAbsolute(root)) {
    throw new AppError("PATH_DENIED", "Root must be an absolute path.");
  }

  if (isUncPath(root) && !allowedRoots.some((allowedRoot) => isUncPath(allowedRoot))) {
    throw new AppError("PATH_DENIED", "UNC roots are denied unless explicitly configured as an allowed root.");
  }

  const rootRealPath = realpathStrict(root, "Requested root");
  const allowedRealPaths = allowedRoots.map((allowedRoot) => realpathStrict(allowedRoot, "Allowed root"));
  const matchedRoot = allowedRealPaths.find((allowedRoot) => normalizeForComparison(allowedRoot) === normalizeForComparison(rootRealPath));

  if (!matchedRoot) {
    throw new AppError("PATH_DENIED", "Requested root is not in the configured allowlist.", {
      root
    });
  }

  return {
    requestedRoot: root,
    rootRealPath: matchedRoot
  };
}

export function resolveProjectPath(root: string, relativePath: string, allowedRoots: string[]): ResolvedProjectPath {
  const safeRelativePath = assertSafeRelativePath(relativePath);
  const resolvedRoot = resolveAllowedRoot(root, allowedRoots);
  const requestedPath = path.resolve(resolvedRoot.rootRealPath, safeRelativePath);
  const resolvedPath = resolveExistingPathOrParent(requestedPath);

  if (!isPathInside(resolvedPath, resolvedRoot.rootRealPath)) {
    throw new AppError("PATH_DENIED", "Resolved path escapes the selected allowed root.", {
      requestedPath,
      resolvedPath,
      root: resolvedRoot.rootRealPath
    });
  }

  return {
    ...resolvedRoot,
    requestedPath,
    resolvedPath,
    relativePath: safeRelativePath
  };
}

export function toRootRelativePath(rootRealPath: string, resolvedPath: string): string {
  const relative = path.relative(rootRealPath, resolvedPath);
  return relative === "" ? "." : relative.split(path.sep).join("/");
}
