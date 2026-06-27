import fs from "node:fs/promises";
import path from "node:path";

import picomatch from "picomatch";
import { z } from "zod";

import { AppConfig } from "../config.js";
import { getFilePolicyDenial } from "../security/filePolicy.js";
import { resolveProjectPath, toRootRelativePath } from "../security/pathPolicy.js";
import { AppError } from "../utils/errors.js";
import { withAudit } from "./common.js";
import { MAX_GLOB_LENGTH, MAX_RELATIVE_PATH_LENGTH, MAX_ROOT_LENGTH } from "./inputLimits.js";

export const ListProjectFilesInputSchema = z.object({
  root: z.string().min(1).max(MAX_ROOT_LENGTH),
  relativePath: z.string().max(MAX_RELATIVE_PATH_LENGTH).default("."),
  glob: z.string().max(MAX_GLOB_LENGTH).default("**/*"),
  maxResults: z.number().int().positive().max(5000).default(200)
});

export type ListProjectFilesInput = z.infer<typeof ListProjectFilesInputSchema>;

export interface ListProjectFilesOutput {
  root: string;
  relativePath: string;
  files: string[];
  truncated: boolean;
}

function normalizeForGlob(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

async function walkFiles(rootRealPath: string, directory: string, glob: string, maxResults: number): Promise<{ files: string[]; truncated: boolean }> {
  const matcher = picomatch(glob, { dot: true });
  const files: string[] = [];
  const pending = [directory];
  let truncated = false;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }

    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      const relativePath = toRootRelativePath(rootRealPath, absolutePath);
      const globPath = normalizeForGlob(relativePath);

      if (getFilePolicyDenial(absolutePath, relativePath)) {
        continue;
      }

      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        pending.push(absolutePath);
        continue;
      }

      if (entry.isFile() && matcher(globPath)) {
        files.push(globPath);
        if (files.length >= maxResults) {
          truncated = true;
          return {
            files,
            truncated
          };
        }
      }
    }
  }

  files.sort();
  return {
    files,
    truncated
  };
}

export async function listProjectFiles(rawInput: unknown, config: AppConfig): Promise<ListProjectFilesOutput> {
  const requestedPath = typeof rawInput === "object" && rawInput !== null ? String((rawInput as { relativePath?: unknown }).relativePath ?? ".") : undefined;

  return withAudit(config, { toolName: "list_project_files", requestedPath }, async (updateAudit) => {
    const input = ListProjectFilesInputSchema.parse(rawInput);
    const resolved = resolveProjectPath(input.root, input.relativePath, config.allowedRoots);
    updateAudit({
      requestedPath: input.relativePath,
      resolvedPath: resolved.resolvedPath
    });

    const stats = await fs.stat(resolved.resolvedPath);
    if (!stats.isDirectory()) {
      throw new AppError("FILE_DENIED", "list_project_files requires a directory path.");
    }

    const result = await walkFiles(resolved.rootRealPath, resolved.resolvedPath, input.glob, input.maxResults);
    return {
      root: resolved.rootRealPath,
      relativePath: toRootRelativePath(resolved.rootRealPath, resolved.resolvedPath),
      ...result
    };
  });
}
