import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { AppConfig } from "../config.js";
import { assertPatchMatchesPendingProposal, markPatchProposalUsed } from "../pendingPatches.js";
import { resolveAllowedRoot } from "../security/pathPolicy.js";
import { AppError } from "../utils/errors.js";
import { assertInsideGitRepo, getGitDiffSummary, runGit } from "../utils/git.js";
import { assertChangedPathsAreNotSymlinks, collectPatchTargetPaths, validatePatchTargets } from "../utils/patch.js";
import { assertValidWriteApprovalToken } from "../writeAccess.js";
import { withAudit } from "./common.js";
import { MAX_APPROVAL_TOKEN_LENGTH, MAX_PATCH_LENGTH, MAX_ROOT_LENGTH } from "./inputLimits.js";

export const ApplyApprovedPatchInputSchema = z.object({
  root: z.string().min(1).max(MAX_ROOT_LENGTH),
  patch: z.string().min(1).max(MAX_PATCH_LENGTH),
  proposalId: z.string().uuid().optional(),
  patchHash: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  approvalToken: z.string().max(MAX_APPROVAL_TOKEN_LENGTH).optional()
});

export type ApplyApprovedPatchInput = z.infer<typeof ApplyApprovedPatchInputSchema>;

export interface ApplyApprovedPatchOutput {
  changedFiles: string[];
  gitDiffSummary: string;
}

type PreApplyPathState =
  | { relativePath: string; existed: false }
  | { relativePath: string; existed: true; kind: "file"; data: Buffer; mode: number }
  | { relativePath: string; existed: true; kind: "directory"; mode: number }
  | { relativePath: string; existed: true; kind: "symlink"; linkTarget: string; linkType: "file" | "dir"; mode: number }
  | { relativePath: string; existed: true; kind: "other"; mode: number };

function isNotFoundError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function capturePreApplyPathState(root: string, relativePath: string): PreApplyPathState {
  const absolutePath = path.resolve(root, relativePath);

  try {
    const stats = fs.lstatSync(absolutePath);
    const mode = stats.mode & 0o777;

    if (stats.isSymbolicLink()) {
      let linkType: "file" | "dir" = "file";
      try {
        linkType = fs.statSync(absolutePath).isDirectory() ? "dir" : "file";
      } catch {
        linkType = "file";
      }

      return {
        relativePath,
        existed: true,
        kind: "symlink",
        linkTarget: fs.readlinkSync(absolutePath),
        linkType,
        mode
      };
    }

    if (stats.isFile()) {
      return {
        relativePath,
        existed: true,
        kind: "file",
        data: fs.readFileSync(absolutePath),
        mode
      };
    }

    if (stats.isDirectory()) {
      return {
        relativePath,
        existed: true,
        kind: "directory",
        mode
      };
    }

    return {
      relativePath,
      existed: true,
      kind: "other",
      mode
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        relativePath,
        existed: false
      };
    }

    throw error;
  }
}

function removePathIfPresent(absolutePath: string): void {
  try {
    const stats = fs.lstatSync(absolutePath);
    if (stats.isDirectory() && !stats.isSymbolicLink()) {
      fs.rmSync(absolutePath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(absolutePath);
    }
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

function rollbackAppliedPatchChanges(root: string, preApplyStates: PreApplyPathState[]): string[] {
  const rollbackErrors: string[] = [];

  for (const state of [...preApplyStates].reverse()) {
    const absolutePath = path.resolve(root, state.relativePath);

    try {
      if (!state.existed) {
        removePathIfPresent(absolutePath);
        continue;
      }

      if (state.kind === "file") {
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, state.data);
        fs.chmodSync(absolutePath, state.mode);
        continue;
      }

      if (state.kind === "symlink") {
        removePathIfPresent(absolutePath);
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.symlinkSync(state.linkTarget, absolutePath, state.linkType);
        continue;
      }

      if (state.kind === "directory") {
        fs.mkdirSync(absolutePath, { recursive: true });
        fs.chmodSync(absolutePath, state.mode);
      }
    } catch (error) {
      rollbackErrors.push(`${state.relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return rollbackErrors;
}

export async function applyApprovedPatch(rawInput: unknown, config: AppConfig): Promise<ApplyApprovedPatchOutput> {
  return withAudit(config, { toolName: "apply_approved_patch" }, async (updateAudit) => {
    const input = ApplyApprovedPatchInputSchema.parse(rawInput);
    if (!config.patchWritesAllowed) {
      throw new AppError("APPROVAL_REQUIRED", "apply_approved_patch requires writeMode patch or elevated.");
    }

    const root = resolveAllowedRoot(input.root, config.allowedRoots);
    let proposalIdToMark: string | undefined;
    try {
      const proposal = assertPatchMatchesPendingProposal(config.repoRoot, root.rootRealPath, input.patch, input.proposalId, input.patchHash);
      proposalIdToMark = proposal.id;
    } catch (error) {
      if (config.writeMode !== "elevated") {
        throw error;
      }
      assertValidWriteApprovalToken("apply_approved_patch", input.approvalToken, config.writeApprovalToken);
    }

    const changedFiles = validatePatchTargets(input.root, input.patch, config.allowedRoots);
    const patchTargetPaths = collectPatchTargetPaths(input.patch);
    const pathsToVerify = [...new Set([...changedFiles, ...patchTargetPaths])].sort();
    const preApplyStates = pathsToVerify.map((relativePath) => capturePreApplyPathState(root.rootRealPath, relativePath));

    if (config.requireGitRoot) {
      for (const changedFile of changedFiles) {
        assertInsideGitRepo(`${root.rootRealPath}/${changedFile}`);
      }
    }

    updateAudit({
      requestedPath: changedFiles.join(";"),
      resolvedPath: root.rootRealPath
    });

    const applyResult = await runGit(root.rootRealPath, ["apply", "--whitespace=nowarn", "-"], {
      timeoutMs: 60_000,
      maxBytes: 200_000,
      stdin: input.patch
    });

    if (applyResult.exitCode !== 0 || applyResult.timedOut) {
      throw new AppError("PATCH_DENIED", "git apply failed.", {
        exitCode: applyResult.exitCode,
        timedOut: applyResult.timedOut,
        stderr: applyResult.stderr
      });
    }

    try {
      assertChangedPathsAreNotSymlinks(root.rootRealPath, pathsToVerify);
    } catch (error) {
      const rollbackErrors = rollbackAppliedPatchChanges(root.rootRealPath, preApplyStates);
      const details = error instanceof AppError && error.details ? error.details : {};
      throw new AppError(
        "PATCH_DENIED",
        rollbackErrors.length > 0
          ? "Patch produced or touched symbolic link path(s); rollback encountered errors."
          : "Patch produced or touched symbolic link path(s); changes were rolled back.",
        {
          ...details,
          rollbackErrors
        }
      );
    }

    if (proposalIdToMark) {
      markPatchProposalUsed(config.repoRoot, proposalIdToMark);
    }

    return {
      changedFiles,
      gitDiffSummary: await getGitDiffSummary(root.rootRealPath)
    };
  });
}
