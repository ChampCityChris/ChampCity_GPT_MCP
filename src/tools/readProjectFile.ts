import { z } from "zod";

import { AppConfig } from "../config.js";
import { DEFAULT_MAX_TEXT_BYTES } from "../security/filePolicy.js";
import { withAudit } from "./common.js";
import { MAX_RELATIVE_PATH_LENGTH, MAX_ROOT_LENGTH } from "./inputLimits.js";
import {
  TEXT_PROJECTION_DEFAULT_CHUNK_BYTES,
  TEXT_PROJECTION_INLINE_THRESHOLD_BYTES,
  boundedTextStructuredContent,
  inlineTextReadResult,
  loadTextProjectionSource,
  readTextChunk
} from "./textProjection.js";

export const ReadProjectFileInputSchema = z.object({
  root: z.string().min(1).max(MAX_ROOT_LENGTH),
  relativePath: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH),
  workspaceId: z.string().min(1).max(64).default("default"),
  maxBytes: z.number().int().positive().max(5_000_000).default(DEFAULT_MAX_TEXT_BYTES)
});

export type ReadProjectFileInput = z.infer<typeof ReadProjectFileInputSchema>;

export interface ReadProjectFileOutput {
  relativePath: string;
  sizeBytes: number;
  modifiedAt: string;
  sha256: string;
  sourceSha256?: string;
  content?: string;
  contentComplete: boolean;
  inlineThresholdBytes: number;
  recommendedNextAction?: "read_text_chunk";
  firstChunk?: Record<string, unknown>;
}

export async function readProjectFile(rawInput: unknown, config: AppConfig): Promise<ReadProjectFileOutput> {
  const requestedPath = typeof rawInput === "object" && rawInput !== null ? String((rawInput as { relativePath?: unknown }).relativePath ?? "") : undefined;

  return withAudit(config, { toolName: "read_project_file", requestedPath }, async (updateAudit) => {
    const input = ReadProjectFileInputSchema.parse(rawInput);
    const source = await loadTextProjectionSource(config, {
      workspaceId: input.workspaceId,
      root: input.root,
      relativePath: input.relativePath,
      maxBytes: input.maxBytes
    });

    updateAudit({
      requestedPath: input.relativePath,
      resolvedPath: source.resolvedPath,
      byteCount: source.sizeBytes
    });

    if (source.sizeBytes <= TEXT_PROJECTION_INLINE_THRESHOLD_BYTES) {
      return inlineTextReadResult(source);
    }

    const firstChunk = await readTextChunk(config, {
      workspaceId: input.workspaceId,
      root: input.root,
      relativePath: source.relativePath,
      maximumBytes: TEXT_PROJECTION_DEFAULT_CHUNK_BYTES,
      expectedSourceSha256: source.sourceSha256,
      maxBytes: input.maxBytes
    });

    return {
      relativePath: source.relativePath,
      sizeBytes: source.sizeBytes,
      modifiedAt: source.modifiedAt,
      sha256: source.sourceSha256,
      sourceSha256: source.sourceSha256,
      contentComplete: false,
      inlineThresholdBytes: TEXT_PROJECTION_INLINE_THRESHOLD_BYTES,
      recommendedNextAction: "read_text_chunk",
      firstChunk: boundedTextStructuredContent(firstChunk)
    };
  });
}
