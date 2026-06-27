import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

import { z } from "zod";

import { AppConfig } from "../config.js";
import { assertMarkdownArtifactPath } from "../security/filePolicy.js";
import { resolveProjectPath, toRootRelativePath } from "../security/pathPolicy.js";
import { AppError } from "../utils/errors.js";
import { assertInsideGitRepo } from "../utils/git.js";
import { withAudit } from "./common.js";
import { MAX_APPROVAL_TOKEN_LENGTH, MAX_MARKDOWN_ARTIFACT_CONTENT_LENGTH, MAX_RELATIVE_PATH_LENGTH, MAX_ROOT_LENGTH } from "./inputLimits.js";

export const WriteMarkdownArtifactInputSchema = z.object({
  root: z.string().min(1).max(MAX_ROOT_LENGTH),
  relativePath: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH),
  content: z.string().max(MAX_MARKDOWN_ARTIFACT_CONTENT_LENGTH),
  approvalToken: z.string().max(MAX_APPROVAL_TOKEN_LENGTH).optional(),
  overwrite: z.boolean().default(false)
});

export type WriteMarkdownArtifactInput = z.infer<typeof WriteMarkdownArtifactInputSchema>;

export interface WriteMarkdownArtifactOutput {
  relativePath: string;
  sizeBytes: number;
  sha256: string;
}

export async function writeMarkdownArtifact(rawInput: unknown, config: AppConfig): Promise<WriteMarkdownArtifactOutput> {
  const requestedPath = typeof rawInput === "object" && rawInput !== null ? String((rawInput as { relativePath?: unknown }).relativePath ?? "") : undefined;

  return withAudit(config, { toolName: "write_markdown_artifact", requestedPath }, async (updateAudit) => {
    const input = WriteMarkdownArtifactInputSchema.parse(rawInput);
    if (!config.docsWritesAllowed) {
      throw new AppError("APPROVAL_REQUIRED", "write_markdown_artifact requires writeMode docs, patch, or elevated.");
    }

    const resolved = resolveProjectPath(input.root, input.relativePath, config.allowedRoots);
    const relativePath = toRootRelativePath(resolved.rootRealPath, resolved.resolvedPath);
    assertMarkdownArtifactPath(resolved.resolvedPath, relativePath);

    if (config.requireGitRoot) {
      assertInsideGitRepo(resolved.resolvedPath);
    }

    const exists = await fs
      .stat(resolved.resolvedPath)
      .then(() => true)
      .catch(() => false);

    if (exists && !input.overwrite) {
      throw new AppError("APPROVAL_REQUIRED", "Refusing to overwrite an existing Markdown artifact unless overwrite is true.", {
        relativePath
      });
    }

    await fs.mkdir(path.dirname(resolved.resolvedPath), { recursive: true });
    const temporaryPath = path.join(path.dirname(resolved.resolvedPath), `.${path.basename(resolved.resolvedPath)}.${process.pid}.${Date.now()}.tmp`);
    await fs.writeFile(temporaryPath, input.content, "utf8");
    await fs.rename(temporaryPath, resolved.resolvedPath);

    const sha256 = crypto.createHash("sha256").update(input.content).digest("hex");
    updateAudit({
      requestedPath: input.relativePath,
      resolvedPath: resolved.resolvedPath,
      byteCount: Buffer.byteLength(input.content, "utf8")
    });

    return {
      relativePath,
      sizeBytes: Buffer.byteLength(input.content, "utf8"),
      sha256
    };
  });
}
