import { z } from "zod";

import { type AppConfig } from "../../config.js";
import { AppError } from "../../utils/errors.js";
import { runGit } from "../../utils/git.js";
import { MAX_RELATIVE_PATH_LENGTH, MAX_ROOT_LENGTH } from "../inputLimits.js";
import { auditGitWorkflow, auditGitWorkflowError } from "./audit.js";
import {
  assertPathCanBeStaged,
  currentBranch,
  forbiddenFinding,
  scanFiles,
  stagedFiles,
  uniqueSorted,
  validateRelativeGitPath,
  validateRootGitRepo,
  workingTreeCandidateFiles,
  type SafetyFinding
} from "./safety.js";

export const SafeStageChangesInputSchema = z.object({
  root: z.string().min(1).max(MAX_ROOT_LENGTH),
  mode: z.enum(["all-safe", "paths"]),
  paths: z.array(z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH)).max(200).optional()
});

export type SafeStageChangesInput = z.infer<typeof SafeStageChangesInputSchema>;

export interface SafeStageChangesOutput {
  stagedFiles: string[];
  skippedFiles: string[];
  blockingFindings: SafetyFinding[];
  warnings: SafetyFinding[];
  safe: boolean;
}

async function gitAdd(root: string, files: string[]): Promise<void> {
  if (files.length === 0) {
    return;
  }

  const result = await runGit(root, ["add", "--", ...files], { timeoutMs: 60_000, maxBytes: 200_000 });
  if (result.exitCode !== 0 || result.timedOut) {
    throw new AppError("PROCESS_FAILED", "git add -- <validated paths> failed.", {
      exitCode: result.exitCode,
      timedOut: result.timedOut
    });
  }
}

export async function safeStageChanges(rawInput: unknown, config: AppConfig): Promise<SafeStageChangesOutput> {
  const input = SafeStageChangesInputSchema.parse(rawInput);
  const auditMeta = {
    toolName: "safe_stage_changes",
    action: "stage",
    root: input.root,
    fileCount: 0
  };

  try {
    const root = validateRootGitRepo(input.root, config);
    const branch = await currentBranch(root);
    auditMeta.root = root;
    auditMeta.fileCount = 0;

    let candidateFiles: string[];
    const skippedFiles: string[] = [];

    if (input.mode === "all-safe") {
      const allCandidates = await workingTreeCandidateFiles(root);
      candidateFiles = [];
      for (const candidate of allCandidates) {
        if (forbiddenFinding(candidate)) {
          skippedFiles.push(candidate);
        } else {
          candidateFiles.push(candidate);
        }
      }
    } else {
      if (!input.paths || input.paths.length === 0) {
        throw new AppError("INVALID_INPUT", "paths mode requires at least one path.");
      }
      candidateFiles = input.paths.map((entry) => validateRelativeGitPath(root, entry));
      const forbidden = candidateFiles.map(forbiddenFinding).filter((entry): entry is SafetyFinding => Boolean(entry));
      if (forbidden.length > 0) {
        const output = {
          stagedFiles: await stagedFiles(root),
          skippedFiles: uniqueSorted(forbidden.map((entry) => entry.relativePath)),
          blockingFindings: forbidden,
          warnings: [],
          safe: false
        };
        await auditGitWorkflow(config, { ...auditMeta, root, branch, fileCount: 0 }, "deny", "forbidden path requested");
        return output;
      }
    }

    candidateFiles = uniqueSorted(candidateFiles);
    for (const candidate of candidateFiles) {
      await assertPathCanBeStaged(root, candidate);
    }

    const scan = await scanFiles(root, candidateFiles, "paths");
    if (!scan.safe) {
      const output = {
        stagedFiles: await stagedFiles(root),
        skippedFiles: uniqueSorted([...skippedFiles, ...scan.skippedFiles]),
        blockingFindings: scan.blockingFindings,
        warnings: scan.warnings,
        safe: false
      };
      await auditGitWorkflow(config, { ...auditMeta, root, branch, fileCount: candidateFiles.length }, "deny", "candidate file safety scan failed");
      return output;
    }

    await gitAdd(root, candidateFiles);
    const staged = await stagedFiles(root);
    const output = {
      stagedFiles: staged,
      skippedFiles: uniqueSorted([...skippedFiles, ...scan.skippedFiles]),
      blockingFindings: [],
      warnings: scan.warnings,
      safe: true
    };
    await auditGitWorkflow(config, { ...auditMeta, root, branch, fileCount: candidateFiles.length }, "allow");
    return output;
  } catch (error) {
    await auditGitWorkflowError(config, auditMeta, error);
    throw error;
  }
}
