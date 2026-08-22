import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { type AppConfig } from "../config.js";
import { assertFilePolicyAllowsPath } from "../security/filePolicy.js";
import { resolveProjectPath, toRootRelativePath } from "../security/pathPolicy.js";
import { AppError } from "../utils/errors.js";
import { assertWorkspaceAuthorityAllowed, resolveWorkspaceAuthorityForRoot } from "../workspaceAuthority.js";
import { forbiddenFinding, normalizeGitPath } from "./gitWorkflow/safety.js";
import { MAX_JSON_ARTIFACT_CONTENT_LENGTH, MAX_RELATIVE_PATH_LENGTH, MAX_ROOT_LENGTH } from "./inputLimits.js";
import { withAudit } from "./common.js";

export const WriteJsonArtifactInputSchema = z
  .object({
    root: z.string().min(1).max(MAX_ROOT_LENGTH),
    relativePath: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH),
    content: z.string().max(MAX_JSON_ARTIFACT_CONTENT_LENGTH),
    overwrite: z.boolean().default(false)
  })
  .strict();

export type WriteJsonArtifactInput = z.infer<typeof WriteJsonArtifactInputSchema>;

export interface WriteJsonArtifactOutput {
  relativePath: string;
  sizeBytes: number;
  modifiedTime: string;
  sha256: string;
  workspaceId: string;
  writePolicy: "git_required" | "artifact_only";
}

function normalizeJsonContent(content: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new AppError("INVALID_INPUT", "JSON artifact content must parse as valid JSON.", {
      cause: error instanceof Error ? error.message : String(error)
    });
  }

  return `${JSON.stringify(parsed, null, 2)}\n`;
}

async function assertJsonArtifactPathAllowed(resolvedPath: string, relativePath: string): Promise<void> {
  assertFilePolicyAllowsPath(resolvedPath, relativePath);

  if (path.extname(resolvedPath).toLowerCase() !== ".json") {
    throw new AppError("FILE_DENIED", "JSON artifact writes only allow .json files.", {
      relativePath
    });
  }

  const normalizedRelativePath = normalizeGitPath(relativePath);
  const forbidden = forbiddenFinding(normalizedRelativePath);
  if (forbidden) {
    throw new AppError("FILE_DENIED", forbidden.message, {
      relativePath: normalizedRelativePath,
      rule: forbidden.rule
    });
  }
}

async function assertExistingTargetIsRegularFile(resolvedPath: string, relativePath: string): Promise<boolean> {
  try {
    const stats = await fs.lstat(resolvedPath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new AppError("FILE_DENIED", "Existing artifact target must be a regular file.", {
        relativePath
      });
    }
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function writeJsonArtifact(rawInput: unknown, config: AppConfig): Promise<WriteJsonArtifactOutput> {
  const requestedPath = typeof rawInput === "object" && rawInput !== null ? String((rawInput as { relativePath?: unknown }).relativePath ?? "") : undefined;

  return withAudit(config, { toolName: "write_json_artifact", requestedPath }, async (updateAudit) => {
    const input = WriteJsonArtifactInputSchema.parse(rawInput);
    if (!config.docsWritesAllowed) {
      throw new AppError("APPROVAL_REQUIRED", "write_json_artifact requires writeMode docs, patch, or elevated.");
    }

    const normalizedContent = normalizeJsonContent(input.content);
    const resolved = resolveProjectPath(input.root, input.relativePath, config.allowedRoots);
    const relativePath = toRootRelativePath(resolved.rootRealPath, resolved.resolvedPath);
    const authority = resolveWorkspaceAuthorityForRoot(resolved.rootRealPath, config, "artifact_persistence", relativePath);
    assertWorkspaceAuthorityAllowed(authority);
    await assertJsonArtifactPathAllowed(resolved.resolvedPath, relativePath);

    const exists = await assertExistingTargetIsRegularFile(resolved.resolvedPath, relativePath);

    if (exists && !input.overwrite) {
      throw new AppError("APPROVAL_REQUIRED", "Refusing to overwrite an existing JSON artifact unless overwrite is true.", {
        relativePath
      });
    }

    await fs.mkdir(path.dirname(resolved.resolvedPath), { recursive: true });
    const temporaryPath = path.join(path.dirname(resolved.resolvedPath), `.${path.basename(resolved.resolvedPath)}.${process.pid}.${Date.now()}.tmp`);
    await fs.writeFile(temporaryPath, normalizedContent, "utf8");
    await fs.rename(temporaryPath, resolved.resolvedPath);

    const stats = await fs.stat(resolved.resolvedPath);
    const sizeBytes = Buffer.byteLength(normalizedContent, "utf8");
    const sha256 = crypto.createHash("sha256").update(normalizedContent).digest("hex");
    updateAudit({
      requestedPath: input.relativePath,
      resolvedPath: resolved.resolvedPath,
      byteCount: sizeBytes,
      workspaceId: authority.workspaceId
    });

    return {
      relativePath,
      sizeBytes,
      modifiedTime: stats.mtime.toISOString(),
      sha256,
      workspaceId: authority.workspaceId,
      writePolicy: authority.policy
    };
  });
}
