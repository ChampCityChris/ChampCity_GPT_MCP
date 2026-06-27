import fs from "node:fs/promises";
import crypto from "node:crypto";

import { z } from "zod";

import { AppConfig } from "../config.js";
import { DEFAULT_MAX_TEXT_BYTES, assertReadableTextFile } from "../security/filePolicy.js";
import { resolveProjectPath, toRootRelativePath } from "../security/pathPolicy.js";
import { withAudit } from "./common.js";
import { MAX_RELATIVE_PATH_LENGTH, MAX_ROOT_LENGTH } from "./inputLimits.js";

export const ReadProjectFileInputSchema = z.object({
  root: z.string().min(1).max(MAX_ROOT_LENGTH),
  relativePath: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH),
  maxBytes: z.number().int().positive().max(5_000_000).default(DEFAULT_MAX_TEXT_BYTES)
});

export type ReadProjectFileInput = z.infer<typeof ReadProjectFileInputSchema>;

export interface ReadProjectFileOutput {
  relativePath: string;
  sizeBytes: number;
  modifiedAt: string;
  sha256: string;
  content: string;
}

export async function readProjectFile(rawInput: unknown, config: AppConfig): Promise<ReadProjectFileOutput> {
  const requestedPath = typeof rawInput === "object" && rawInput !== null ? String((rawInput as { relativePath?: unknown }).relativePath ?? "") : undefined;

  return withAudit(config, { toolName: "read_project_file", requestedPath }, async (updateAudit) => {
    const input = ReadProjectFileInputSchema.parse(rawInput);
    const resolved = resolveProjectPath(input.root, input.relativePath, config.allowedRoots);
    const relativePath = toRootRelativePath(resolved.rootRealPath, resolved.resolvedPath);
    const stats = assertReadableTextFile(resolved.resolvedPath, relativePath, input.maxBytes);
    const content = await fs.readFile(resolved.resolvedPath, "utf8");
    const sha256 = crypto.createHash("sha256").update(content).digest("hex");

    updateAudit({
      requestedPath: input.relativePath,
      resolvedPath: resolved.resolvedPath,
      byteCount: stats.size
    });

    return {
      relativePath,
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      sha256,
      content
    };
  });
}
