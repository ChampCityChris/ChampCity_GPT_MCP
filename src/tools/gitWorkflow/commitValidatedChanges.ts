import { z } from "zod";

import { type AppConfig } from "../../config.js";
import { AppError } from "../../utils/errors.js";
import { runGit } from "../../utils/git.js";
import { MAX_ROOT_LENGTH } from "../inputLimits.js";
import { auditGitWorkflow, auditGitWorkflowError } from "./audit.js";
import { currentBranch, preCommitSafetyScan, sanitizeProcessText, stagedFiles, validateRootGitRepo, type SafetyScanSummary } from "./safety.js";

export const CommitValidatedChangesInputSchema = z.object({
  root: z.string().min(1).max(MAX_ROOT_LENGTH),
  message: z.string().min(1).max(10_000),
  targetBranch: z.enum(["dev", "feature", "main"]),
  allowMainCommit: z.boolean().default(false)
});

export type CommitValidatedChangesInput = z.infer<typeof CommitValidatedChangesInputSchema>;

export interface CommitValidatedChangesOutput {
  commitHash: string;
  branch: string;
  committedFiles: string[];
  scanSummary: SafetyScanSummary;
  gitStatusAfter: string;
}

function validateCommitMessage(message: string): string {
  const normalized = message.replace(/\r\n/gu, "\n").trim();
  if (!normalized) {
    throw new AppError("INVALID_INPUT", "Commit message must not be empty.");
  }

  const subject = normalized.split("\n", 1)[0] ?? "";
  if (subject.length > 200) {
    throw new AppError("INVALID_INPUT", "Commit message subject must be 200 characters or fewer.");
  }

  return normalized;
}

function assertTargetBranch(branch: string, targetBranch: CommitValidatedChangesInput["targetBranch"], allowMainCommit: boolean): void {
  if (branch === "main" && !allowMainCommit) {
    throw new AppError("COMMAND_DENIED", "Committing to main is refused by default. Switch to dev or pass allowMainCommit=true explicitly.");
  }

  if (targetBranch === "dev" && branch !== "dev") {
    throw new AppError("COMMAND_DENIED", `Current branch is ${branch}; targetBranch=dev requires the dev branch.`);
  }

  if (targetBranch === "main" && branch !== "main") {
    throw new AppError("COMMAND_DENIED", `Current branch is ${branch}; targetBranch=main requires the main branch.`);
  }

  if (targetBranch === "feature" && (branch === "main" || branch === "dev")) {
    throw new AppError("COMMAND_DENIED", `Current branch is ${branch}; targetBranch=feature requires a non-main feature branch.`);
  }
}

export async function commitValidatedChanges(rawInput: unknown, config: AppConfig): Promise<CommitValidatedChangesOutput> {
  const input = CommitValidatedChangesInputSchema.parse(rawInput);
  const auditMeta = {
    toolName: "commit_validated_changes",
    action: "commit",
    root: input.root,
    fileCount: 0
  };

  try {
    const root = validateRootGitRepo(input.root, config);
    const branch = await currentBranch(root);
    const message = validateCommitMessage(input.message);
    assertTargetBranch(branch, input.targetBranch, input.allowMainCommit);

    const committedFiles = await stagedFiles(root);
    if (committedFiles.length === 0) {
      throw new AppError("COMMAND_DENIED", "No staged files to commit.");
    }

    const scanSummary = await preCommitSafetyScan({ root, mode: "staged" }, config);
    if (!scanSummary.safe) {
      await auditGitWorkflow(config, { ...auditMeta, root, branch, fileCount: committedFiles.length }, "deny", "staged safety scan failed");
      throw new AppError("COMMAND_DENIED", "Refusing to commit because pre-commit safety scan has blockers.", {
        blockingFindings: scanSummary.blockingFindings
      });
    }

    const commitResult = await runGit(root, ["commit", "-m", message], { timeoutMs: 60_000, maxBytes: 500_000 });
    if (commitResult.exitCode !== 0 || commitResult.timedOut) {
      throw new AppError("PROCESS_FAILED", "git commit failed.", {
        exitCode: commitResult.exitCode,
        timedOut: commitResult.timedOut,
        stderr: sanitizeProcessText(commitResult.stderr)
      });
    }

    const hashResult = await runGit(root, ["rev-parse", "HEAD"], { timeoutMs: 30_000, maxBytes: 50_000 });
    if (hashResult.exitCode !== 0 || hashResult.timedOut) {
      throw new AppError("PROCESS_FAILED", "git rev-parse HEAD failed.", {
        exitCode: hashResult.exitCode,
        timedOut: hashResult.timedOut
      });
    }

    const statusResult = await runGit(root, ["status", "--short"], { timeoutMs: 30_000, maxBytes: 200_000 });
    if (statusResult.exitCode !== 0 || statusResult.timedOut) {
      throw new AppError("PROCESS_FAILED", "git status --short failed.", {
        exitCode: statusResult.exitCode,
        timedOut: statusResult.timedOut
      });
    }

    await auditGitWorkflow(config, { ...auditMeta, root, branch, fileCount: committedFiles.length }, "allow");
    return {
      commitHash: hashResult.stdout.trim(),
      branch,
      committedFiles,
      scanSummary,
      gitStatusAfter: statusResult.stdout
    };
  } catch (error) {
    await auditGitWorkflowError(config, auditMeta, error);
    throw error;
  }
}
