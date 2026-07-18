import { z } from "zod";

import { AppConfig } from "../config.js";
import { withAudit } from "./common.js";
import { MAX_GLOB_LENGTH, MAX_RELATIVE_PATH_LENGTH, MAX_ROOT_LENGTH } from "./inputLimits.js";
import { resolveRepoPath, walkRepoFiles, type WalkDiagnostics } from "./repoTraversal.js";

export const ListProjectFilesInputSchema = z.object({
  root: z.string().min(1).max(MAX_ROOT_LENGTH),
  relativePath: z.string().max(MAX_RELATIVE_PATH_LENGTH).default("."),
  glob: z.string().max(MAX_GLOB_LENGTH).default("**/*"),
  maxResults: z.number().int().positive().max(5000).default(200)
});

export type ListProjectFilesInput = z.infer<typeof ListProjectFilesInputSchema>;

export interface ListProjectFilesOutput {
  root: string;
  requestedPath: string;
  relativePath: string;
  diagnostics: WalkDiagnostics;
  files: string[];
  truncated: boolean;
}

export async function listProjectFiles(rawInput: unknown, config: AppConfig): Promise<ListProjectFilesOutput> {
  const requestedPath = typeof rawInput === "object" && rawInput !== null ? String((rawInput as { relativePath?: unknown }).relativePath ?? ".") : undefined;

  return withAudit(config, { toolName: "list_project_files", requestedPath }, async (updateAudit) => {
    const input = ListProjectFilesInputSchema.parse(rawInput);
    const resolved = await resolveRepoPath(input.root, input.relativePath, config.allowedRoots);
    updateAudit({
      requestedPath: input.relativePath,
      resolvedPath: resolved.resolvedPath
    });

    const result = await walkRepoFiles(resolved, { glob: input.glob, maxResults: input.maxResults, recursive: true });
    return {
      root: resolved.rootRealPath,
      requestedPath: input.relativePath,
      relativePath: resolved.normalizedRelativePath,
      diagnostics: result.diagnostics,
      files: result.files.map((file) => file.rootRelativePath),
      truncated: result.truncated
    };
  });
}
