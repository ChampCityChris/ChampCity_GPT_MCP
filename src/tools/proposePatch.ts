import fs from "node:fs/promises";

import { z } from "zod";

import { AppConfig } from "../config.js";
import { registerPatchProposal } from "../pendingPatches.js";
import { assertReadableTextFile } from "../security/filePolicy.js";
import { resolveProjectPath, toRootRelativePath } from "../security/pathPolicy.js";
import { AppError } from "../utils/errors.js";
import { PreparedTextChange, createUnifiedDiff } from "../utils/patch.js";
import { withAudit } from "./common.js";
import { MAX_PROPOSE_PATCH_TEXT_LENGTH, MAX_RELATIVE_PATH_LENGTH, MAX_ROOT_LENGTH } from "./inputLimits.js";

const ProposedChangeSchema = z.object({
  relativePath: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH),
  originalText: z.string().max(MAX_PROPOSE_PATCH_TEXT_LENGTH),
  replacementText: z.string().max(MAX_PROPOSE_PATCH_TEXT_LENGTH)
});

export const ProposePatchInputSchema = z.object({
  root: z.string().min(1).max(MAX_ROOT_LENGTH),
  changes: z.array(ProposedChangeSchema).min(1).max(50)
});

export type ProposePatchInput = z.infer<typeof ProposePatchInputSchema>;

export interface ProposePatchOutput {
  patch: string;
  proposalId: string;
  patchHash: string;
  affectedFiles: string[];
  expiresAt: string;
}

export async function proposePatch(rawInput: unknown, config: AppConfig): Promise<ProposePatchOutput> {
  return withAudit(config, { toolName: "propose_patch" }, async (updateAudit) => {
    const input = ProposePatchInputSchema.parse(rawInput);
    const preparedChanges: PreparedTextChange[] = [];
    const affectedFiles: string[] = [];
    let proposalRoot = input.root;

    for (const change of input.changes) {
      const resolved = resolveProjectPath(input.root, change.relativePath, config.allowedRoots);
      proposalRoot = resolved.rootRealPath;
      const relativePath = toRootRelativePath(resolved.rootRealPath, resolved.resolvedPath);
      assertReadableTextFile(resolved.resolvedPath, relativePath);
      const originalContent = await fs.readFile(resolved.resolvedPath, "utf8");

      if (!originalContent.includes(change.originalText)) {
        throw new AppError("PATCH_DENIED", "originalText was not found in the target file.", {
          relativePath
        });
      }

      const updatedContent = originalContent.replace(change.originalText, change.replacementText);
      preparedChanges.push({
        relativePath,
        originalContent,
        updatedContent
      });
      affectedFiles.push(relativePath);
      updateAudit({
        requestedPath: change.relativePath,
        resolvedPath: resolved.resolvedPath
      });
    }

    const patch = createUnifiedDiff(preparedChanges);
    const proposal = registerPatchProposal(config.repoRoot, proposalRoot, patch, affectedFiles);

    return {
      patch,
      proposalId: proposal.id,
      patchHash: proposal.patchHash,
      affectedFiles,
      expiresAt: proposal.expiresAt
    };
  });
}
