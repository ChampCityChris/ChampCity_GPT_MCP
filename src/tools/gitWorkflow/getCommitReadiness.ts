import { z } from "zod";

import { type AppConfig } from "../../config.js";
import { runGit } from "../../utils/git.js";
import { withAudit } from "../common.js";
import { MAX_ROOT_LENGTH } from "../inputLimits.js";
import { currentBranch, preCommitSafetyScan, stagedFiles, validateRootGitRepo, type SafetyFinding } from "./safety.js";

export const GetCommitReadinessInputSchema = z.object({
  root: z.string().min(1).max(MAX_ROOT_LENGTH),
  targetBranch: z.enum(["dev", "feature", "main"])
});

export type GetCommitReadinessInput = z.infer<typeof GetCommitReadinessInputSchema>;

export interface CommitReadinessOutput {
  readyToCommit: boolean;
  readyToPush: boolean;
  branch: string;
  stagedFiles: string[];
  blockingFindings: SafetyFinding[];
  warnings: SafetyFinding[];
  recommendedNextSteps: string[];
}

async function hasUpstreamAhead(root: string): Promise<boolean> {
  const upstream = await runGit(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], {
    timeoutMs: 30_000,
    maxBytes: 50_000
  });
  if (upstream.exitCode !== 0 || !upstream.stdout.trim()) {
    return false;
  }

  const ahead = await runGit(root, ["rev-list", "--count", `${upstream.stdout.trim()}..HEAD`], {
    timeoutMs: 30_000,
    maxBytes: 50_000
  });
  return ahead.exitCode === 0 && Number.parseInt(ahead.stdout.trim(), 10) > 0;
}

function targetBranchWarning(branch: string, targetBranch: GetCommitReadinessInput["targetBranch"]): string | undefined {
  if (targetBranch === "dev" && branch !== "dev") {
    return `Switch to dev before committing; current branch is ${branch}.`;
  }

  if (targetBranch === "main" && branch !== "main") {
    return `Switch to main only if an explicit main commit is intended; current branch is ${branch}.`;
  }

  if (targetBranch === "feature" && (branch === "main" || branch === "dev")) {
    return `Switch to a feature branch before committing with targetBranch=feature; current branch is ${branch}.`;
  }

  return undefined;
}

export async function getCommitReadiness(rawInput: unknown, config: AppConfig): Promise<CommitReadinessOutput> {
  return withAudit(config, { toolName: "get_commit_readiness" }, async (updateAudit) => {
    const input = GetCommitReadinessInputSchema.parse(rawInput);
    const root = validateRootGitRepo(input.root, config);
    const branch = await currentBranch(root);
    const staged = await stagedFiles(root);
    const scan = await preCommitSafetyScan({ root, mode: "staged" }, config);
    const recommendedNextSteps: string[] = [];

    const branchStep = targetBranchWarning(branch, input.targetBranch);
    if (branchStep) {
      recommendedNextSteps.push(branchStep);
    }

    if (branch === "main") {
      recommendedNextSteps.push("Use dev or a feature branch; main commits and pushes are refused by default.");
    }

    if (staged.length === 0) {
      recommendedNextSteps.push("Run safe_stage_changes after reviewing candidate files.");
    }

    if (!scan.safe) {
      recommendedNextSteps.push("Remove or fix blocking safety findings before committing.");
    }

    const targetBranchMatches =
      (input.targetBranch === "dev" && branch === "dev") ||
      (input.targetBranch === "main" && branch === "main") ||
      (input.targetBranch === "feature" && branch !== "main" && branch !== "dev");
    const readyToCommit = staged.length > 0 && scan.safe && targetBranchMatches && branch !== "main";
    const readyToPush = branch !== "main" && scan.safe && (await hasUpstreamAhead(root));

    if (!readyToCommit && staged.length > 0 && scan.safe && branch !== "main" && targetBranchMatches) {
      recommendedNextSteps.push("Run commit_validated_changes with a reviewed commit message.");
    }

    if (!readyToPush && branch !== "main") {
      recommendedNextSteps.push("Push only after a successful local commit; use setUpstream=true for a new branch.");
    }

    updateAudit({
      requestedPath: ".",
      resolvedPath: root
    });

    return {
      readyToCommit,
      readyToPush,
      branch,
      stagedFiles: staged,
      blockingFindings: scan.blockingFindings,
      warnings: scan.warnings,
      recommendedNextSteps
    };
  });
}
