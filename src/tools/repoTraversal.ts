import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

import picomatch from "picomatch";

import { getFilePolicyDenial } from "../security/filePolicy.js";
import { assertSafeRelativePath, isPathInside, resolveAllowedRoot, toRootRelativePath } from "../security/pathPolicy.js";

export interface ResolvedRepoPath {
  requestedPath: string;
  normalizedRelativePath: string;
  rootRealPath: string;
  resolvedPath: string;
  exists: boolean;
  isDirectory: boolean;
  isFile: boolean;
  errorCode?: "path_not_found" | "not_a_directory" | "not_a_file" | "path_denied" | "read_failed";
  warning?: string;
}

export interface RepoFileEntry {
  absolutePath: string;
  rootRelativePath: string;
  scopeRelativePath: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface WalkDiagnostics {
  requestedPath: string;
  normalizedRelativePath: string;
  pathExists: boolean;
  isDirectory: boolean;
  recursive: boolean;
  glob: string;
  returnedEntryCount: number;
  errorCode?: string;
  warning?: string;
}

function normalizeRepoRelativePath(relativePath: string): string {
  const safePath = assertSafeRelativePath(relativePath);
  const normalized = safePath.split(/[\\/]+/u).filter(Boolean).join("/");
  return normalized || ".";
}

function resolveInsideRoot(rootRealPath: string, normalizedRelativePath: string): string {
  return normalizedRelativePath === "."
    ? rootRealPath
    : path.join(rootRealPath, ...normalizedRelativePath.split("/"));
}

export async function resolveRepoPath(root: string, relativePath: string, allowedRoots: string[]): Promise<ResolvedRepoPath> {
  const requestedPath = relativePath.trim() === "" ? "." : relativePath;
  const resolvedRoot = resolveAllowedRoot(root, allowedRoots);
  const normalizedRelativePath = normalizeRepoRelativePath(requestedPath);
  const candidatePath = resolveInsideRoot(resolvedRoot.rootRealPath, normalizedRelativePath);

  if (!isPathInside(candidatePath, resolvedRoot.rootRealPath)) {
    return {
      requestedPath,
      normalizedRelativePath,
      rootRealPath: resolvedRoot.rootRealPath,
      resolvedPath: candidatePath,
      exists: false,
      isDirectory: false,
      isFile: false,
      errorCode: "path_denied",
      warning: "Resolved path escapes the selected allowed root."
    };
  }

  try {
    const lstat = await fs.lstat(candidatePath);
    if (lstat.isSymbolicLink()) {
      return {
        requestedPath,
        normalizedRelativePath,
        rootRealPath: resolvedRoot.rootRealPath,
        resolvedPath: candidatePath,
        exists: true,
        isDirectory: false,
        isFile: false,
        errorCode: "path_denied",
        warning: "Symbolic links are not traversed."
      };
    }

    const realPath = await fs.realpath(candidatePath);
    if (!isPathInside(realPath, resolvedRoot.rootRealPath)) {
      return {
        requestedPath,
        normalizedRelativePath,
        rootRealPath: resolvedRoot.rootRealPath,
        resolvedPath: realPath,
        exists: true,
        isDirectory: false,
        isFile: false,
        errorCode: "path_denied",
        warning: "Resolved path escapes the selected allowed root."
      };
    }

    return {
      requestedPath,
      normalizedRelativePath: toRootRelativePath(resolvedRoot.rootRealPath, realPath),
      rootRealPath: resolvedRoot.rootRealPath,
      resolvedPath: realPath,
      exists: true,
      isDirectory: lstat.isDirectory(),
      isFile: lstat.isFile()
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      requestedPath,
      normalizedRelativePath,
      rootRealPath: resolvedRoot.rootRealPath,
      resolvedPath: candidatePath,
      exists: false,
      isDirectory: false,
      isFile: false,
      errorCode: code === "ENOENT" ? "path_not_found" : "read_failed",
      warning: code === "ENOENT" ? "Requested path does not exist." : "Requested path could not be read."
    };
  }
}

function slashPath(value: string): string {
  return value.split(path.sep).join("/");
}

function globMatches(glob: string, entry: RepoFileEntry): boolean {
  const matcher = picomatch(glob, { dot: true });
  const basename = path.posix.basename(entry.rootRelativePath);
  return matcher(entry.rootRelativePath) || matcher(entry.scopeRelativePath) || matcher(basename);
}

export async function walkRepoFiles(
  resolved: ResolvedRepoPath,
  options: { glob: string; maxResults: number; recursive?: boolean }
): Promise<{ files: RepoFileEntry[]; truncated: boolean; diagnostics: WalkDiagnostics }> {
  const recursive = options.recursive ?? true;
  const baseDiagnostics = {
    requestedPath: resolved.requestedPath,
    normalizedRelativePath: resolved.normalizedRelativePath,
    pathExists: resolved.exists,
    isDirectory: resolved.isDirectory,
    recursive,
    glob: options.glob
  };

  if (!resolved.exists) {
    return {
      files: [],
      truncated: false,
      diagnostics: { ...baseDiagnostics, returnedEntryCount: 0, errorCode: resolved.errorCode, warning: resolved.warning }
    };
  }

  if (!resolved.isDirectory) {
    return {
      files: [],
      truncated: false,
      diagnostics: {
        ...baseDiagnostics,
        returnedEntryCount: 0,
        errorCode: "not_a_directory",
        warning: "Requested path exists but is not a directory."
      }
    };
  }

  const files: RepoFileEntry[] = [];
  const pending = [resolved.resolvedPath];
  let truncated = false;
  let readFailure: string | undefined;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }

    let entries: fsSync.Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      readFailure = "Directory could not be read.";
      continue;
    }

    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      const rootRelativePath = slashPath(toRootRelativePath(resolved.rootRealPath, absolutePath));

      if (entry.isSymbolicLink() || getFilePolicyDenial(absolutePath, rootRelativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        if (recursive) {
          pending.push(absolutePath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const scopeRelativePath = slashPath(path.relative(resolved.resolvedPath, absolutePath));
      const stats = await fs.stat(absolutePath);
      const file = {
        absolutePath,
        rootRelativePath,
        scopeRelativePath,
        sizeBytes: stats.size,
        modifiedAt: stats.mtime.toISOString()
      };

      if (!globMatches(options.glob, file)) {
        continue;
      }

      files.push(file);
      if (files.length >= options.maxResults) {
        truncated = true;
        files.sort((left, right) => left.rootRelativePath.localeCompare(right.rootRelativePath));
        return {
          files,
          truncated,
          diagnostics: { ...baseDiagnostics, returnedEntryCount: files.length }
        };
      }
    }
  }

  files.sort((left, right) => left.rootRelativePath.localeCompare(right.rootRelativePath));
  return {
    files,
    truncated,
    diagnostics: {
      ...baseDiagnostics,
      returnedEntryCount: files.length,
      ...(readFailure ? { errorCode: "read_failed", warning: readFailure } : {}),
      ...(!files.length && !readFailure ? { warning: "Directory exists but no entries matched the supplied filter." } : {})
    }
  };
}
