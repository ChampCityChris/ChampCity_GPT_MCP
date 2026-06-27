import fs from "node:fs/promises";
import path from "node:path";

import picomatch from "picomatch";
import { z } from "zod";

import { AppConfig } from "../config.js";
import { DEFAULT_MAX_SEARCH_FILE_BYTES, assertReadableTextFile, getFilePolicyDenial } from "../security/filePolicy.js";
import { resolveAllowedRoot, toRootRelativePath } from "../security/pathPolicy.js";
import { withAudit } from "./common.js";
import { MAX_GLOB_LENGTH, MAX_QUERY_LENGTH, MAX_ROOT_LENGTH } from "./inputLimits.js";

export const SearchProjectFilesInputSchema = z.object({
  root: z.string().min(1).max(MAX_ROOT_LENGTH),
  query: z.string().min(1).max(MAX_QUERY_LENGTH),
  glob: z.string().max(MAX_GLOB_LENGTH).default("**/*.{ts,tsx,js,jsx,json,md}"),
  maxResults: z.number().int().positive().max(1000).default(50),
  contextLines: z.number().int().min(0).max(10).default(2)
});

export type SearchProjectFilesInput = z.infer<typeof SearchProjectFilesInputSchema>;

export interface SearchMatch {
  relativePath: string;
  lineNumber: number;
  line: string;
  before: string[];
  after: string[];
}

export interface SearchProjectFilesOutput {
  root: string;
  query: string;
  matches: SearchMatch[];
  truncated: boolean;
}

function normalizeForGlob(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

async function searchFile(absolutePath: string, relativePath: string, query: string, contextLines: number): Promise<SearchMatch[]> {
  assertReadableTextFile(absolutePath, relativePath, DEFAULT_MAX_SEARCH_FILE_BYTES);
  const content = await fs.readFile(absolutePath, "utf8");
  const lines = content.split(/\r?\n/);
  const matches: SearchMatch[] = [];

  lines.forEach((line, index) => {
    if (!line.includes(query)) {
      return;
    }

    const beforeStart = Math.max(0, index - contextLines);
    const afterEnd = Math.min(lines.length, index + contextLines + 1);
    matches.push({
      relativePath,
      lineNumber: index + 1,
      line,
      before: lines.slice(beforeStart, index),
      after: lines.slice(index + 1, afterEnd)
    });
  });

  return matches;
}

export async function searchProjectFiles(rawInput: unknown, config: AppConfig): Promise<SearchProjectFilesOutput> {
  return withAudit(config, { toolName: "search_project_files" }, async (updateAudit) => {
    const input = SearchProjectFilesInputSchema.parse(rawInput);
    const root = resolveAllowedRoot(input.root, config.allowedRoots);
    updateAudit({
      requestedPath: ".",
      resolvedPath: root.rootRealPath
    });

    const matcher = picomatch(input.glob, { dot: true });
    const pending = [root.rootRealPath];
    const matches: SearchMatch[] = [];
    let truncated = false;

    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) {
        continue;
      }

      const entries = await fs.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const absolutePath = path.join(current, entry.name);
        const relativePath = toRootRelativePath(root.rootRealPath, absolutePath);
        const globPath = normalizeForGlob(relativePath);

        if (getFilePolicyDenial(absolutePath, relativePath) || entry.isSymbolicLink()) {
          continue;
        }

        if (entry.isDirectory()) {
          pending.push(absolutePath);
          continue;
        }

        if (!entry.isFile() || !matcher(globPath)) {
          continue;
        }

        try {
          const fileMatches = await searchFile(absolutePath, globPath, input.query, input.contextLines);
          for (const match of fileMatches) {
            matches.push(match);
            if (matches.length >= input.maxResults) {
              truncated = true;
              return {
                root: root.rootRealPath,
                query: input.query,
                matches,
                truncated
              };
            }
          }
        } catch {
          continue;
        }
      }
    }

    return {
      root: root.rootRealPath,
      query: input.query,
      matches,
      truncated
    };
  });
}
