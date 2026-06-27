import { z } from "zod";

import { AppConfig } from "../config.js";
import { resolveAllowedRoot } from "../security/pathPolicy.js";
import { runGit } from "../utils/git.js";
import { withAudit } from "./common.js";
import { MAX_ROOT_LENGTH } from "./inputLimits.js";

export const GitStatusInputSchema = z.object({
  root: z.string().min(1).max(MAX_ROOT_LENGTH)
});

export type GitStatusInput = z.infer<typeof GitStatusInputSchema>;

export interface GitStatusOutput {
  branch: string;
  status: string;
}

export async function gitStatus(rawInput: unknown, config: AppConfig): Promise<GitStatusOutput> {
  return withAudit(config, { toolName: "git_status" }, async (updateAudit) => {
    const input = GitStatusInputSchema.parse(rawInput);
    const root = resolveAllowedRoot(input.root, config.allowedRoots);
    updateAudit({
      requestedPath: ".",
      resolvedPath: root.rootRealPath
    });

    const [status, branch] = await Promise.all([
      runGit(root.rootRealPath, ["status", "--short"], { timeoutMs: 30_000, maxBytes: 200_000 }),
      runGit(root.rootRealPath, ["branch", "--show-current"], { timeoutMs: 30_000, maxBytes: 50_000 })
    ]);

    return {
      branch: branch.stdout.trim(),
      status: status.stdout
    };
  });
}
