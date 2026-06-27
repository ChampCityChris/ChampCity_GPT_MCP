import { z } from "zod";

import { AppConfig } from "../config.js";
import { resolveAllowedRoot } from "../security/pathPolicy.js";
import { runGit } from "../utils/git.js";
import { withAudit } from "./common.js";
import { MAX_ROOT_LENGTH } from "./inputLimits.js";

export const GitDiffInputSchema = z.object({
  root: z.string().min(1).max(MAX_ROOT_LENGTH),
  staged: z.boolean().default(false),
  maxBytes: z.number().int().positive().max(5_000_000).default(300_000)
});

export type GitDiffInput = z.infer<typeof GitDiffInputSchema>;

export interface GitDiffOutput {
  diff: string;
  truncated: boolean;
}

export async function gitDiff(rawInput: unknown, config: AppConfig): Promise<GitDiffOutput> {
  return withAudit(config, { toolName: "git_diff" }, async (updateAudit) => {
    const input = GitDiffInputSchema.parse(rawInput);
    const root = resolveAllowedRoot(input.root, config.allowedRoots);
    updateAudit({
      requestedPath: ".",
      resolvedPath: root.rootRealPath
    });

    const result = await runGit(root.rootRealPath, input.staged ? ["diff", "--staged"] : ["diff"], {
      timeoutMs: 30_000,
      maxBytes: input.maxBytes
    });

    return {
      diff: result.stdout,
      truncated: result.truncated
    };
  });
}
