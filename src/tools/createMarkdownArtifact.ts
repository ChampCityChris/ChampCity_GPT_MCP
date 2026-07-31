import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { type AppConfig } from "../config.js";
import { assertMarkdownArtifactPath } from "../security/filePolicy.js";
import { resolveProjectPath, toRootRelativePath } from "../security/pathPolicy.js";
import { AppError } from "../utils/errors.js";
import { assertWorkspaceAuthorityAllowed, resolveWorkspaceAuthorityForRoot } from "../workspaceAuthority.js";
import { resolveWorkspaceRoot } from "../workspaces.js";
import { withAudit } from "./common.js";
import { MAX_MARKDOWN_ARTIFACT_CONTENT_LENGTH, MAX_RELATIVE_PATH_LENGTH } from "./inputLimits.js";

export const CreateMarkdownArtifactParamsSchema = z
  .object({
    relativePath: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH),
    content: z.string().max(MAX_MARKDOWN_ARTIFACT_CONTENT_LENGTH),
    overwrite: z.boolean().default(false)
  })
  .strict();

export type CreateMarkdownArtifactParams = z.infer<typeof CreateMarkdownArtifactParamsSchema>;

export interface CreateMarkdownArtifactInput extends CreateMarkdownArtifactParams {
  workspaceId: string;
}

export interface CreateMarkdownArtifactOutput {
  status: "saved" | "already_saved";
  workspaceId: string;
  relativePath: string;
  sizeBytes: number;
}

export interface CreateMarkdownArtifactTestHooks {
  afterInitialSnapshot?: (targetPath: string) => Promise<void> | void;
  afterReplaceBeforeVerify?: (targetPath: string) => Promise<void> | void;
}

const WINDOWS_RESERVED_DEVICE_NAME_PATTERN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

function isWindowsReparsePoint(stats: Awaited<ReturnType<typeof fs.lstat>>): boolean {
  const taggedStats = stats as Awaited<ReturnType<typeof fs.lstat>> & { reparsePointTag?: number };
  return typeof taggedStats.reparsePointTag === "number" && taggedStats.reparsePointTag !== 0;
}

function assertNoWindowsDeviceNames(relativePath: string): void {
  const deniedSegment = relativePath
    .split(/[\\/]+/u)
    .filter(Boolean)
    .find((segment) => WINDOWS_RESERVED_DEVICE_NAME_PATTERN.test(segment));

  if (deniedSegment) {
    throw new AppError("PATH_DENIED", "Windows device file names are not allowed.", {
      relativePath,
      segment: deniedSegment
    });
  }
}

async function assertNoExistingReparseSegments(rootRealPath: string, requestedRelativePath: string): Promise<void> {
  let current = rootRealPath;
  for (const segment of requestedRelativePath.split(/[\\/]+/u).filter(Boolean)) {
    current = path.join(current, segment);
    let stats: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      stats = await fs.lstat(current);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return;
      }
      throw error;
    }

    if (stats.isSymbolicLink() || isWindowsReparsePoint(stats)) {
      throw new AppError("PATH_DENIED", "Symlinks, junctions, and reparse points are not allowed in artifact paths.", {
        relativePath: requestedRelativePath
      });
    }
  }
}

async function readExistingRegularFile(targetPath: string, relativePath: string): Promise<Buffer | null> {
  let stats: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stats = await fs.lstat(targetPath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }

  if (stats.isSymbolicLink() || isWindowsReparsePoint(stats) || !stats.isFile()) {
    throw new AppError("FILE_DENIED", "Existing artifact target must be a regular file.", {
      relativePath
    });
  }

  return fs.readFile(targetPath);
}

function temporaryPathFor(targetPath: string, label: string): string {
  const suffix = `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  return path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${label}.${suffix}.tmp`);
}

async function writeTempAndRename(targetPath: string, bytes: Buffer, label: string): Promise<void> {
  const temporaryPath = temporaryPathFor(targetPath, label);
  try {
    await fs.writeFile(temporaryPath, bytes);
    await fs.rename(temporaryPath, targetPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function verifyExactBytes(targetPath: string, expectedBytes: Buffer, relativePath: string): Promise<void> {
  const actualBytes = await readExistingRegularFile(targetPath, relativePath);
  if (!actualBytes || !actualBytes.equals(expectedBytes)) {
    throw new AppError("VERIFICATION_FAILED", "Markdown artifact verification failed after write.", {
      relativePath
    });
  }
}

async function restoreOriginalBytes(targetPath: string, originalBytes: Buffer): Promise<void> {
  await writeTempAndRename(targetPath, originalBytes, "restore");
}

export async function createMarkdownArtifact(
  rawInput: unknown,
  config: AppConfig,
  testHooks: CreateMarkdownArtifactTestHooks = {}
): Promise<CreateMarkdownArtifactOutput> {
  const requestedPath = typeof rawInput === "object" && rawInput !== null ? String((rawInput as { relativePath?: unknown }).relativePath ?? "") : undefined;

  return withAudit(config, { toolName: "artifact_toolbox", action: "create_markdown_artifact", requestedPath }, async (updateAudit) => {
    const input = z
      .object({
        workspaceId: z.string().min(1).max(64),
        relativePath: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH),
        content: z.string().max(MAX_MARKDOWN_ARTIFACT_CONTENT_LENGTH),
        overwrite: z.boolean().default(false)
      })
      .strict()
      .parse(rawInput);

    if (!config.docsWritesAllowed) {
      throw new AppError("APPROVAL_REQUIRED", "create_markdown_artifact requires writeMode docs, patch, or elevated.");
    }

    const root = resolveWorkspaceRoot(input.workspaceId, config);
    const resolved = resolveProjectPath(root, input.relativePath, config.allowedRoots);
    const relativePath = toRootRelativePath(resolved.rootRealPath, resolved.resolvedPath);
    assertNoWindowsDeviceNames(resolved.relativePath);
    assertMarkdownArtifactPath(resolved.resolvedPath, relativePath);
    await assertNoExistingReparseSegments(resolved.rootRealPath, resolved.relativePath);

    const authority = resolveWorkspaceAuthorityForRoot(resolved.rootRealPath, config, "artifact_persistence", relativePath);
    assertWorkspaceAuthorityAllowed(authority);

    const contentBytes = Buffer.from(input.content, "utf8");
    const existingBytes = await readExistingRegularFile(resolved.resolvedPath, relativePath);
    if (existingBytes?.equals(contentBytes)) {
      updateAudit({
        requestedPath: input.relativePath,
        normalizedRelativePath: relativePath,
        resolvedPath: resolved.resolvedPath,
        byteCount: contentBytes.length,
        workspaceId: authority.workspaceId
      });
      return {
        status: "already_saved",
        workspaceId: authority.workspaceId,
        relativePath,
        sizeBytes: contentBytes.length
      };
    }

    if (existingBytes && !input.overwrite) {
      throw new AppError("DESTINATION_EXISTS", "Markdown artifact already exists with different content.", {
        relativePath
      });
    }

    await fs.mkdir(path.dirname(resolved.resolvedPath), { recursive: true });

    if (!existingBytes) {
      await writeTempAndRename(resolved.resolvedPath, contentBytes, "create");
      await verifyExactBytes(resolved.resolvedPath, contentBytes, relativePath);
    } else {
      await testHooks.afterInitialSnapshot?.(resolved.resolvedPath);
      const preReplaceBytes = await readExistingRegularFile(resolved.resolvedPath, relativePath);
      if (!preReplaceBytes || !preReplaceBytes.equals(existingBytes)) {
        throw new AppError("DESTINATION_EXISTS", "Markdown artifact changed before replacement; no write was performed.", {
          relativePath
        });
      }

      try {
        await writeTempAndRename(resolved.resolvedPath, contentBytes, "replace");
        await testHooks.afterReplaceBeforeVerify?.(resolved.resolvedPath);
        await verifyExactBytes(resolved.resolvedPath, contentBytes, relativePath);
      } catch (error) {
        await restoreOriginalBytes(resolved.resolvedPath, existingBytes).catch(() => undefined);
        throw error;
      }
    }

    updateAudit({
      requestedPath: input.relativePath,
      normalizedRelativePath: relativePath,
      resolvedPath: resolved.resolvedPath,
      byteCount: contentBytes.length,
      workspaceId: authority.workspaceId
    });

    return {
      status: "saved",
      workspaceId: authority.workspaceId,
      relativePath,
      sizeBytes: contentBytes.length
    };
  });
}
