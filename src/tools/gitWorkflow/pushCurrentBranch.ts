import { z } from "zod";

import { type AppConfig } from "../../config.js";
import { AppError } from "../../utils/errors.js";
import { runGit } from "../../utils/git.js";
import { MAX_ROOT_LENGTH } from "../inputLimits.js";
import { auditGitWorkflow, auditGitWorkflowError } from "./audit.js";
import { currentBranch, preCommitSafetyScan, redactRemoteUrl, sanitizeProcessText, validateRootGitRepo } from "./safety.js";

export const PushCurrentBranchInputSchema = z.object({
  root: z.string().min(1).max(MAX_ROOT_LENGTH),
  remote: z.literal("origin"),
  setUpstream: z.boolean(),
  allowMainPush: z.boolean().default(false)
});

export type PushCurrentBranchInput = z.infer<typeof PushCurrentBranchInputSchema>;

export interface PushCurrentBranchOutput {
  branch: string;
  remote: "origin";
  pushed: boolean;
  stdout: string;
  stderr: string;
  remoteUrl?: string;
}

async function upstreamBranch(root: string): Promise<string | undefined> {
  const result = await runGit(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], {
    timeoutMs: 30_000,
    maxBytes: 50_000
  });

  if (result.exitCode !== 0) {
    return undefined;
  }

  return result.stdout.trim() || undefined;
}

async function revCount(root: string, range: string): Promise<number> {
  const result = await runGit(root, ["rev-list", "--count", range], { timeoutMs: 30_000, maxBytes: 50_000 });
  if (result.exitCode !== 0 || result.timedOut) {
    throw new AppError("PROCESS_FAILED", "git rev-list --count failed.", {
      range,
      exitCode: result.exitCode,
      timedOut: result.timedOut
    });
  }

  return Number.parseInt(result.stdout.trim(), 10);
}

async function redactedRemoteUrl(root: string): Promise<string | undefined> {
  const result = await runGit(root, ["config", "--get", "remote.origin.url"], {
    timeoutMs: 30_000,
    maxBytes: 100_000
  });

  if (result.exitCode !== 0) {
    return undefined;
  }

  return redactRemoteUrl(result.stdout.trim());
}

export async function pushCurrentBranch(rawInput: unknown, config: AppConfig): Promise<PushCurrentBranchOutput> {
  const input = PushCurrentBranchInputSchema.parse(rawInput);
  const auditMeta = {
    toolName: "push_current_branch",
    action: "push",
    root: input.root,
    fileCount: 0
  };

  try {
    const root = validateRootGitRepo(input.root, config);
    const branch = await currentBranch(root);
    if (branch === "main" && !input.allowMainPush) {
      throw new AppError("COMMAND_DENIED", "Pushing main is refused by default. Push dev or a feature branch, or pass allowMainPush=true explicitly.");
    }

    const scanSummary = await preCommitSafetyScan({ root, mode: "staged" }, config);
    if (!scanSummary.safe) {
      throw new AppError("COMMAND_DENIED", "Refusing to push because staged safety scan has blockers.", {
        blockingFindings: scanSummary.blockingFindings
      });
    }

    const upstream = await upstreamBranch(root);
    if (!upstream && !input.setUpstream) {
      throw new AppError("COMMAND_DENIED", "Current branch has no upstream. Re-run with setUpstream=true to push with -u origin <branch>.");
    }

    if (upstream) {
      const ahead = await revCount(root, `${upstream}..HEAD`);
      if (ahead <= 0) {
        throw new AppError("COMMAND_DENIED", "Current branch has no commits ahead of upstream.");
      }
    }

    const args = input.setUpstream || !upstream ? ["push", "-u", "origin", branch] : ["push", "origin", branch];
    const pushResult = await runGit(root, args, { timeoutMs: 120_000, maxBytes: 500_000 });
    if (pushResult.exitCode !== 0 || pushResult.timedOut) {
      throw new AppError("PROCESS_FAILED", "git push failed.", {
        exitCode: pushResult.exitCode,
        timedOut: pushResult.timedOut,
        stderr: sanitizeProcessText(pushResult.stderr)
      });
    }

    await auditGitWorkflow(config, { ...auditMeta, root, branch }, "allow");
    return {
      branch,
      remote: "origin",
      pushed: true,
      stdout: sanitizeProcessText(pushResult.stdout),
      stderr: sanitizeProcessText(pushResult.stderr),
      remoteUrl: await redactedRemoteUrl(root)
    };
  } catch (error) {
    await auditGitWorkflowError(config, auditMeta, error);
    throw error;
  }
}
