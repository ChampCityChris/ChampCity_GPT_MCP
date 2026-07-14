import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { type AppConfig } from "../config.js";
import { assertFilePolicyAllowsPath } from "../security/filePolicy.js";
import { assertSafeRelativePath, resolveProjectPath, toRootRelativePath } from "../security/pathPolicy.js";
import { AppError } from "../utils/errors.js";
import { resolveWorkspace } from "../workspaces.js";
import { withAudit } from "./common.js";

export const MAX_IMAGE_ARTIFACT_BYTES = 5_000_000;

const PNG_EXTENSION = ".png";
const PNG_MIME_TYPE = "image/png";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const APPROVED_IMAGE_ARTIFACT_DIRECTORIES = new Set([
  "planning",
  "evidence",
  "artifacts",
  "builder_reports",
  "release",
  "reports",
  "validation",
  "screenshots"
]);
const BLOCKED_IMAGE_ARTIFACT_SEGMENTS = new Set([
  ".aws",
  ".cache",
  ".credentials",
  ".git",
  ".gnupg",
  ".npm",
  ".pnpm",
  ".pnpm-store",
  ".secrets",
  ".ssh",
  ".yarn",
  "appdata",
  "browser-profile",
  "browser-profiles",
  "cache",
  "caches",
  "credentials",
  "dependency-cache",
  "dependency-caches",
  "node_modules",
  "secret",
  "secrets"
]);

export interface ReadImageArtifactInput {
  workspaceId: string;
  path: string;
  maxBytes: number;
}

export interface ImageArtifactMetadata {
  path: string;
  workspaceId: string;
  mimeType: typeof PNG_MIME_TYPE;
  sizeBytes: number;
  width: number;
  height: number;
  sha256: string;
  lastModifiedAt: string;
}

export interface ReadImageArtifactOutput {
  metadata: ImageArtifactMetadata;
  base64Data: string;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(/[\\/]+/u).filter(Boolean).join("/");
}

function assertApprovedImageArtifactPath(relativePath: string): void {
  const segments = normalizeRelativePath(relativePath).toLowerCase().split("/").filter(Boolean);
  const topLevelDirectory = segments[0];

  if (!topLevelDirectory || !APPROVED_IMAGE_ARTIFACT_DIRECTORIES.has(topLevelDirectory)) {
    throw new AppError("FILE_DENIED", "Image reads are limited to approved evidence and artifact directories.", {
      relativePath,
      allowedDirectories: [...APPROVED_IMAGE_ARTIFACT_DIRECTORIES].sort()
    });
  }

  const blockedSegment = segments.find((segment) => BLOCKED_IMAGE_ARTIFACT_SEGMENTS.has(segment));
  if (blockedSegment) {
    throw new AppError("FILE_DENIED", "Image artifact path contains a blocked directory.", {
      relativePath,
      blockedSegment
    });
  }
}

function assertPngExtension(relativePath: string): void {
  if (path.posix.extname(relativePath).toLowerCase() !== PNG_EXTENSION) {
    throw new AppError("FILE_DENIED", "Unsupported image artifact type. Only PNG files are allowed.", {
      relativePath,
      allowedExtensions: [PNG_EXTENSION]
    });
  }
}

function readPngDimensions(data: Buffer, relativePath: string): { width: number; height: number } {
  const hasPngSignature = data.length >= PNG_SIGNATURE.length && data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
  const hasIhdr = data.length >= 24 && data.readUInt32BE(8) === 13 && data.toString("ascii", 12, 16) === "IHDR";

  if (!hasPngSignature || !hasIhdr) {
    throw new AppError("FILE_DENIED", "Image contents do not match the PNG extension.", {
      relativePath,
      expectedMimeType: PNG_MIME_TYPE
    });
  }

  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width === 0 || height === 0) {
    throw new AppError("FILE_DENIED", "PNG image dimensions are invalid.", {
      relativePath
    });
  }

  return { width, height };
}

export async function readImageArtifact(input: ReadImageArtifactInput, config: AppConfig): Promise<ReadImageArtifactOutput> {
  return withAudit(
    config,
    {
      toolName: "artifact_toolbox",
      action: "read_image_artifact",
      requestedPath: input.path
    },
    async (updateAudit) => {
      const safePath = assertSafeRelativePath(input.path);
      const requestedRelativePath = normalizeRelativePath(safePath);
      assertApprovedImageArtifactPath(requestedRelativePath);
      assertPngExtension(requestedRelativePath);

      const workspace = resolveWorkspace(input.workspaceId, config);
      const resolved = resolveProjectPath(workspace.root, requestedRelativePath, config.allowedRoots);
      const relativePath = toRootRelativePath(resolved.rootRealPath, resolved.resolvedPath);
      assertApprovedImageArtifactPath(relativePath);
      assertPngExtension(relativePath);
      assertFilePolicyAllowsPath(resolved.resolvedPath, relativePath);

      let fileHandle: Awaited<ReturnType<typeof fs.open>>;
      try {
        fileHandle = await fs.open(resolved.resolvedPath, "r");
      } catch {
        throw new AppError("FILE_DENIED", "Image artifact does not exist or cannot be read.", {
          relativePath
        });
      }

      try {
        const stats = await fileHandle.stat();
        if (!stats.isFile()) {
          throw new AppError("FILE_DENIED", "Requested image artifact is not a file.", {
            relativePath
          });
        }

        if (stats.size > input.maxBytes) {
          throw new AppError("FILE_DENIED", "Image artifact exceeds the configured read size limit.", {
            relativePath,
            sizeBytes: stats.size,
            maxBytes: input.maxBytes
          });
        }

        const data = await fileHandle.readFile();
        if (data.length > input.maxBytes) {
          throw new AppError("FILE_DENIED", "Image artifact exceeds the configured read size limit.", {
            relativePath,
            sizeBytes: data.length,
            maxBytes: input.maxBytes
          });
        }

        const { width, height } = readPngDimensions(data, relativePath);
        updateAudit({
          requestedPath: input.path,
          resolvedPath: resolved.resolvedPath,
          byteCount: data.length
        });

        return {
          metadata: {
            path: relativePath,
            workspaceId: workspace.workspaceId,
            mimeType: PNG_MIME_TYPE,
            sizeBytes: data.length,
            width,
            height,
            sha256: createHash("sha256").update(data).digest("hex"),
            lastModifiedAt: stats.mtime.toISOString()
          },
          base64Data: data.toString("base64")
        };
      } finally {
        await fileHandle.close();
      }
    }
  );
}
