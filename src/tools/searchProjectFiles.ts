import fs from "node:fs/promises";

import { z } from "zod";

import { AppConfig } from "../config.js";
import { DEFAULT_MAX_SEARCH_FILE_BYTES, assertReadableTextFile } from "../security/filePolicy.js";
import { withAudit } from "./common.js";
import { MAX_GLOB_LENGTH, MAX_QUERY_LENGTH, MAX_RELATIVE_PATH_LENGTH, MAX_ROOT_LENGTH } from "./inputLimits.js";
import { resolveRepoPath, walkRepoFiles, type WalkDiagnostics } from "./repoTraversal.js";

export const SearchProjectFilesInputSchema = z.object({
  root: z.string().min(1).max(MAX_ROOT_LENGTH),
  query: z.string().min(1).max(MAX_QUERY_LENGTH),
  scopePath: z.string().max(MAX_RELATIVE_PATH_LENGTH).default("."),
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
  matchType: "path" | "filename" | "content";
  source: "live_traversal";
}

export interface SearchProjectFilesOutput {
  root: string;
  query: string;
  scopePath: string;
  diagnostics: WalkDiagnostics;
  searchSources: string[];
  matches: SearchMatch[];
  truncated: boolean;
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
      after: lines.slice(index + 1, afterEnd),
      matchType: "content",
      source: "live_traversal"
    });
  });

  return matches;
}

function normalizedQueryPath(query: string): string {
  return query.split(/[\\/]+/u).filter(Boolean).join("/");
}

export async function searchProjectFiles(rawInput: unknown, config: AppConfig): Promise<SearchProjectFilesOutput> {
  return withAudit(config, { toolName: "search_project_files" }, async (updateAudit) => {
    const input = SearchProjectFilesInputSchema.parse(rawInput);
    const resolved = await resolveRepoPath(input.root, input.scopePath, config.allowedRoots);
    updateAudit({
      requestedPath: input.scopePath,
      resolvedPath: resolved.resolvedPath
    });

    const walked = await walkRepoFiles(resolved, { glob: input.glob, maxResults: input.maxResults, recursive: true });
    const matches: SearchMatch[] = [];
    let truncated = false;
    const queryPath = normalizedQueryPath(input.query).toLowerCase();

    for (const file of walked.files) {
      const rootRelativeLower = file.rootRelativePath.toLowerCase();
      const scopeRelativeLower = file.scopeRelativePath.toLowerCase();
      const basenameLower = file.rootRelativePath.split("/").pop()?.toLowerCase() ?? "";
      if (queryPath && (rootRelativeLower === queryPath || scopeRelativeLower === queryPath || basenameLower === queryPath)) {
        matches.push({
          relativePath: file.rootRelativePath,
          lineNumber: 0,
          line: "",
          before: [],
          after: [],
          matchType: rootRelativeLower === queryPath || scopeRelativeLower === queryPath ? "path" : "filename",
          source: "live_traversal"
        });
        if (matches.length >= input.maxResults) {
          truncated = true;
          break;
        }
        continue;
      }

      try {
        const fileMatches = await searchFile(file.absolutePath, file.rootRelativePath, input.query, input.contextLines);
        for (const match of fileMatches) {
          matches.push(match);
          if (matches.length >= input.maxResults) {
            truncated = true;
            break;
          }
        }
      } catch {
        continue;
      }

      if (truncated) {
        break;
      }
    }

    return {
      root: resolved.rootRealPath,
      query: input.query,
      scopePath: resolved.normalizedRelativePath,
      diagnostics: walked.diagnostics,
      searchSources: ["live_traversal"],
      matches,
      truncated: truncated || walked.truncated
    };
  });
}
