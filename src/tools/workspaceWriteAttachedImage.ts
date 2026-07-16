import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

import { z } from "zod";

import { type AppConfig } from "../config.js";
import { writeAuditLog } from "../security/auditLog.js";
import { isPathInside } from "../security/pathPolicy.js";
import { AppError, serializeError } from "../utils/errors.js";
import { runGit } from "../utils/git.js";
import { resolveWorkspace } from "../workspaces.js";
import { MAX_RELATIVE_PATH_LENGTH } from "./inputLimits.js";

export const WORKSPACE_WRITE_ATTACHED_IMAGE_TOOL_NAME = "workspace_write_attached_image";
export const MAX_ATTACHED_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHED_IMAGE_WIDTH = 16_384;
export const MAX_ATTACHED_IMAGE_HEIGHT = 16_384;
export const MAX_ATTACHED_IMAGE_PIXELS = 100_000_000;
export const ATTACHED_IMAGE_DOWNLOAD_CONNECTION_TIMEOUT_MS = 10_000;
export const ATTACHED_IMAGE_DOWNLOAD_TOTAL_TIMEOUT_MS = 30_000;
export const ATTACHED_IMAGE_DOWNLOAD_MAX_REDIRECTS = 3;

type DetectedImageFormat = "png" | "jpeg" | "webp";
type WorkspaceWriteAttachedImageStatus =
  | "created"
  | "destination_exists"
  | "workspace_not_found"
  | "workspace_not_writable"
  | "invalid_path"
  | "path_outside_workspace"
  | "reparse_point_rejected"
  | "unsupported_image"
  | "mime_mismatch"
  | "extension_mismatch"
  | "file_too_large"
  | "image_dimensions_rejected"
  | "download_failed"
  | "download_timed_out"
  | "write_failed"
  | "verification_failed";

export interface StructuredToolError {
  code: string;
  message: string;
  details?: unknown;
}

export interface WorkspaceWriteAttachedImageOutput {
  status: WorkspaceWriteAttachedImageStatus;
  workspaceId: string;
  workspaceName?: string;
  relativePath: string;
  detectedMimeType?: string;
  detectedFormat?: DetectedImageFormat;
  originalFileName?: string;
  bytesWritten?: number;
  width?: number;
  height?: number;
  sha256?: string;
  createdDirectories?: string[];
  gitFileStatus?: string;
  warnings: string[];
  errors: StructuredToolError[];
}

interface OpenAIFileReference {
  download_url: string;
  file_id: string;
  mime_type?: string;
  file_name?: string;
}

interface WorkspaceWriteAttachedImageInput {
  workspaceId: string;
  relativePath: string;
  image: OpenAIFileReference;
}

interface DestinationPlan {
  workspaceRootRealPath: string;
  absolutePath: string;
  relativePath: string;
  segments: string[];
}

interface ImageMetadata {
  detectedFormat: DetectedImageFormat;
  detectedMimeType: string;
  width: number;
  height: number;
}

export type AttachedImageDownloader = (file: OpenAIFileReference) => Promise<Buffer>;

const OpenAIFileReferenceSchema = z
  .object({
    download_url: z.string().min(1),
    file_id: z.string().min(1).max(256),
    mime_type: z.string().min(1).max(128).optional(),
    file_name: z.string().min(1).max(512).optional()
  })
  .strict();

export const WorkspaceWriteAttachedImageInputSchema = z
  .object({
    workspaceId: z.string().min(1).max(64),
    relativePath: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH),
    image: OpenAIFileReferenceSchema
  })
  .strict();

const FORMAT_EXTENSIONS: Record<DetectedImageFormat, string[]> = {
  png: [".png"],
  jpeg: [".jpg", ".jpeg"],
  webp: [".webp"]
};

const FORMAT_MIME_TYPES: Record<DetectedImageFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp"
};

const RESERVED_WINDOWS_DEVICE_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9"
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function structuredError(error: unknown, fallbackCode = "error"): StructuredToolError {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details
    };
  }

  if (error instanceof Error) {
    return {
      code: fallbackCode,
      message: error.message
    };
  }

  return {
    code: fallbackCode,
    message: String(error)
  };
}

function output(
  status: WorkspaceWriteAttachedImageStatus,
  partial: Partial<WorkspaceWriteAttachedImageOutput> = {},
  error?: unknown
): WorkspaceWriteAttachedImageOutput {
  return {
    status,
    workspaceId: partial.workspaceId ?? "",
    workspaceName: partial.workspaceName,
    relativePath: partial.relativePath ?? "",
    detectedMimeType: partial.detectedMimeType,
    detectedFormat: partial.detectedFormat,
    originalFileName: partial.originalFileName,
    bytesWritten: partial.bytesWritten,
    width: partial.width,
    height: partial.height,
    sha256: partial.sha256,
    createdDirectories: partial.createdDirectories ?? [],
    gitFileStatus: partial.gitFileStatus,
    warnings: partial.warnings ?? [],
    errors: error ? [...(partial.errors ?? []), structuredError(error, status)] : partial.errors ?? []
  };
}

function isUncPath(value: string): boolean {
  return value.startsWith("\\\\") || value.startsWith("//");
}

function hasDriveSpecifier(value: string): boolean {
  return /^[a-zA-Z]:/u.test(value);
}

function isWindowsDeviceSegment(segment: string): boolean {
  const withoutExtension = segment.split(".")[0].toLowerCase();
  return RESERVED_WINDOWS_DEVICE_NAMES.has(withoutExtension);
}

function isReparsePoint(stats: fsSync.Stats): boolean {
  return stats.isSymbolicLink();
}

function assertAllowedExtension(relativePath: string): void {
  const ext = path.posix.extname(relativePath).toLowerCase();
  if (!Object.values(FORMAT_EXTENSIONS).flat().includes(ext)) {
    throw new AppError("FILE_DENIED", "Destination path must end in .png, .jpg, .jpeg, or .webp.", {
      relativePath,
      allowedExtensions: Object.values(FORMAT_EXTENSIONS).flat()
    });
  }
}

function parseRelativeDestination(relativePath: string): string[] {
  if (relativePath.includes("\0")) {
    throw new AppError("PATH_DENIED", "Destination path contains a null byte.");
  }

  if (/^file:/iu.test(relativePath)) {
    throw new AppError("PATH_DENIED", "File URI destinations are not allowed.");
  }

  if (
    path.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    path.posix.isAbsolute(relativePath) ||
    isUncPath(relativePath) ||
    hasDriveSpecifier(relativePath)
  ) {
    throw new AppError("PATH_DENIED", "Destination must be a repository-relative path.");
  }

  if (relativePath.includes(":")) {
    throw new AppError("PATH_DENIED", "Destination path may not contain ':' characters.");
  }

  const segments = relativePath.split(/[\\/]+/u);
  if (segments.some((segment) => segment.length === 0)) {
    throw new AppError("PATH_DENIED", "Destination path contains an empty segment.");
  }

  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new AppError("PATH_DENIED", "Destination path traversal is not allowed.");
  }

  for (const segment of segments) {
    if (segment.endsWith(".") || segment.endsWith(" ")) {
      throw new AppError("PATH_DENIED", "Destination path segments may not end with a dot or space.", {
        segment
      });
    }

    if (isWindowsDeviceSegment(segment)) {
      throw new AppError("PATH_DENIED", "Destination path may not use a reserved Windows device name.", {
        segment
      });
    }
  }

  if (!segments.at(-1)?.trim()) {
    throw new AppError("PATH_DENIED", "Destination filename must not be empty.");
  }

  return segments;
}

function deepestExistingPath(candidatePath: string): string {
  let current = path.resolve(candidatePath);
  while (!fsSync.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      throw new AppError("PATH_DENIED", "Could not resolve an existing destination ancestor.");
    }
    current = parent;
  }
  return current;
}

function assertExistingPathSafe(existingPath: string, workspaceRootRealPath: string, requireDirectory: boolean): void {
  const stats = fsSync.lstatSync(existingPath);
  if (isReparsePoint(stats)) {
    const realExistingPath = fsSync.realpathSync.native(existingPath);
    if (!isPathInside(realExistingPath, workspaceRootRealPath)) {
      throw new AppError("REPARSE_POINT_REJECTED", "Destination ancestor resolves outside the selected workspace.", {
        relativePath: path.relative(workspaceRootRealPath, existingPath).split(path.sep).join("/")
      });
    }
  }

  if (requireDirectory && !stats.isDirectory()) {
    throw new AppError("PATH_DENIED", "Destination parent path contains an existing non-directory segment.", {
      relativePath: path.relative(workspaceRootRealPath, existingPath).split(path.sep).join("/")
    });
  }

  const realExistingPath = fsSync.realpathSync.native(existingPath);
  if (!isPathInside(realExistingPath, workspaceRootRealPath)) {
    throw new AppError("PATH_DENIED", "Destination ancestor resolves outside the selected workspace.", {
      relativePath: path.relative(workspaceRootRealPath, existingPath).split(path.sep).join("/")
    });
  }
}

function buildDestinationPlan(workspaceRoot: string, relativePath: string): DestinationPlan {
  const workspaceRootRealPath = fsSync.realpathSync.native(workspaceRoot);
  const segments = parseRelativeDestination(relativePath);
  const normalizedRelativePath = segments.join("/");
  assertAllowedExtension(normalizedRelativePath);

  const absolutePath = path.resolve(workspaceRootRealPath, ...segments);
  if (absolutePath === workspaceRootRealPath) {
    throw new AppError("PATH_DENIED", "Destination must include a filename.");
  }

  if (!isPathInside(absolutePath, workspaceRootRealPath) || absolutePath === workspaceRootRealPath) {
    throw new AppError("PATH_DENIED", "Destination resolves outside the selected workspace.", {
      relativePath: normalizedRelativePath
    });
  }

  const existing = deepestExistingPath(path.dirname(absolutePath));
  assertExistingPathSafe(existing, workspaceRootRealPath, true);

  if (fsSync.existsSync(absolutePath)) {
    const stats = fsSync.lstatSync(absolutePath);
    if (isReparsePoint(stats)) {
      throw new AppError("REPARSE_POINT_REJECTED", "Existing destination is a reparse point and is rejected.", {
        relativePath: normalizedRelativePath
      });
    }
  }

  return {
    workspaceRootRealPath,
    absolutePath,
    relativePath: normalizedRelativePath,
    segments
  };
}

function readUInt24LE(data: Buffer, offset: number): number {
  return data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16);
}

function detectPng(data: Buffer): ImageMetadata | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const valid = data.length >= 24 && data.subarray(0, signature.length).equals(signature) && data.readUInt32BE(8) === 13 && data.toString("ascii", 12, 16) === "IHDR";
  if (!valid) {
    return null;
  }

  return {
    detectedFormat: "png",
    detectedMimeType: FORMAT_MIME_TYPES.png,
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20)
  };
}

function detectJpeg(data: Buffer): ImageMetadata | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) {
    return null;
  }

  const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 3 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    while (offset < data.length && data[offset] === 0xff) {
      offset += 1;
    }

    const marker = data[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    if (offset + 2 > data.length) {
      break;
    }
    const segmentLength = data.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > data.length) {
      break;
    }

    if (startOfFrameMarkers.has(marker) && segmentLength >= 7) {
      return {
        detectedFormat: "jpeg",
        detectedMimeType: FORMAT_MIME_TYPES.jpeg,
        height: data.readUInt16BE(offset + 3),
        width: data.readUInt16BE(offset + 5)
      };
    }

    offset += segmentLength;
  }

  throw new AppError("UNSUPPORTED_IMAGE", "JPEG dimensions could not be determined from image headers.");
}

function detectWebp(data: Buffer): ImageMetadata | null {
  if (data.length < 30 || data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WEBP") {
    return null;
  }

  const chunkType = data.toString("ascii", 12, 16);
  const chunkDataOffset = 20;
  if (chunkType === "VP8X" && data.length >= chunkDataOffset + 10) {
    return {
      detectedFormat: "webp",
      detectedMimeType: FORMAT_MIME_TYPES.webp,
      width: readUInt24LE(data, chunkDataOffset + 4) + 1,
      height: readUInt24LE(data, chunkDataOffset + 7) + 1
    };
  }

  if (chunkType === "VP8L" && data.length >= chunkDataOffset + 5 && data[chunkDataOffset] === 0x2f) {
    const bits = data.readUInt32LE(chunkDataOffset + 1);
    return {
      detectedFormat: "webp",
      detectedMimeType: FORMAT_MIME_TYPES.webp,
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1
    };
  }

  if (chunkType === "VP8 " && data.length >= chunkDataOffset + 10 && data.toString("hex", chunkDataOffset + 3, chunkDataOffset + 6) === "9d012a") {
    return {
      detectedFormat: "webp",
      detectedMimeType: FORMAT_MIME_TYPES.webp,
      width: data.readUInt16LE(chunkDataOffset + 6) & 0x3fff,
      height: data.readUInt16LE(chunkDataOffset + 8) & 0x3fff
    };
  }

  throw new AppError("UNSUPPORTED_IMAGE", "WebP dimensions could not be determined from image headers.");
}

export function detectAttachedImage(data: Buffer): ImageMetadata {
  if (data.length === 0) {
    throw new AppError("UNSUPPORTED_IMAGE", "Attached image is empty.");
  }

  const metadata = detectPng(data) ?? detectJpeg(data) ?? detectWebp(data);
  if (!metadata) {
    throw new AppError("UNSUPPORTED_IMAGE", "Attached file is not a supported PNG, JPEG, or WebP image.");
  }

  if (metadata.width <= 0 || metadata.height <= 0) {
    throw new AppError("IMAGE_DIMENSIONS_REJECTED", "Image dimensions are invalid.", {
      width: metadata.width,
      height: metadata.height,
      detectedFormat: metadata.detectedFormat,
      detectedMimeType: metadata.detectedMimeType
    });
  }

  if (
    metadata.width > MAX_ATTACHED_IMAGE_WIDTH ||
    metadata.height > MAX_ATTACHED_IMAGE_HEIGHT ||
    metadata.width * metadata.height > MAX_ATTACHED_IMAGE_PIXELS
  ) {
    throw new AppError("IMAGE_DIMENSIONS_REJECTED", "Image dimensions exceed configured limits.", {
      width: metadata.width,
      height: metadata.height,
      maxWidth: MAX_ATTACHED_IMAGE_WIDTH,
      maxHeight: MAX_ATTACHED_IMAGE_HEIGHT,
      maxPixels: MAX_ATTACHED_IMAGE_PIXELS
    });
  }

  return metadata;
}

function assertExtensionMatchesFormat(relativePath: string, format: DetectedImageFormat): void {
  const ext = path.posix.extname(relativePath).toLowerCase();
  if (!FORMAT_EXTENSIONS[format].includes(ext)) {
    throw new AppError("EXTENSION_MISMATCH", "Destination extension does not match the detected image format.", {
      relativePath,
      detectedFormat: format,
      expectedExtensions: FORMAT_EXTENSIONS[format]
    });
  }
}

function assertMimeMatchesFormat(mimeType: string | undefined, format: DetectedImageFormat): void {
  if (!mimeType) {
    return;
  }

  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  if (normalized !== FORMAT_MIME_TYPES[format]) {
    throw new AppError("MIME_MISMATCH", "Reported MIME type conflicts with the detected image format.", {
      reportedMimeType: mimeType,
      detectedMimeType: FORMAT_MIME_TYPES[format]
    });
  }
}

function statusForError(error: unknown): WorkspaceWriteAttachedImageStatus {
  if (error instanceof AppError) {
    if (error.code === "WORKSPACE_NOT_FOUND" || error.code === "WORKSPACE_REQUIRED") {
      return "workspace_not_found";
    }
    if (error.code === "REPARSE_POINT_REJECTED") {
      return "reparse_point_rejected";
    }
    if (error.code === "EXTENSION_MISMATCH") {
      return "extension_mismatch";
    }
    if (error.code === "MIME_MISMATCH") {
      return "mime_mismatch";
    }
    if (error.code === "UNSUPPORTED_IMAGE") {
      return "unsupported_image";
    }
    if (error.code === "IMAGE_DIMENSIONS_REJECTED") {
      return "image_dimensions_rejected";
    }
    if (error.code === "FILE_TOO_LARGE") {
      return "file_too_large";
    }
    if (error.code === "DOWNLOAD_TIMED_OUT") {
      return "download_timed_out";
    }
    if (error.code === "DOWNLOAD_FAILED") {
      return "download_failed";
    }
    if (error.code === "PATH_DENIED") {
      return /outside|escapes/iu.test(error.message) ? "path_outside_workspace" : "invalid_path";
    }
  }

  return "write_failed";
}

function assertHttpsDownloadUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError("DOWNLOAD_FAILED", "Image download URL is invalid.");
  }

  if (url.protocol !== "https:") {
    throw new AppError("DOWNLOAD_FAILED", "Image download URL must use HTTPS.");
  }

  return url;
}

export async function downloadAttachedImage(file: OpenAIFileReference): Promise<Buffer> {
  let currentUrl = assertHttpsDownloadUrl(file.download_url);
  const startedAt = Date.now();

  for (let redirectCount = 0; redirectCount <= ATTACHED_IMAGE_DOWNLOAD_MAX_REDIRECTS; redirectCount += 1) {
    const remainingMs = ATTACHED_IMAGE_DOWNLOAD_TOTAL_TIMEOUT_MS - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      throw new AppError("DOWNLOAD_TIMED_OUT", "Image download timed out.");
    }

    const controller = new AbortController();
    const requestTimer = setTimeout(() => controller.abort(), Math.min(remainingMs, ATTACHED_IMAGE_DOWNLOAD_CONNECTION_TIMEOUT_MS));
    let response: Response;
    try {
      response = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal
      });
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") {
        throw new AppError("DOWNLOAD_TIMED_OUT", "Image download timed out.");
      }
      throw new AppError("DOWNLOAD_FAILED", "Image download failed.", {
        cause: error instanceof Error ? error.message : String(error)
      });
    } finally {
      clearTimeout(requestTimer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new AppError("DOWNLOAD_FAILED", "Image download redirect did not include a Location header.");
      }
      if (redirectCount === ATTACHED_IMAGE_DOWNLOAD_MAX_REDIRECTS) {
        throw new AppError("DOWNLOAD_FAILED", "Image download exceeded the redirect limit.");
      }
      currentUrl = assertHttpsDownloadUrl(new URL(location, currentUrl).toString());
      continue;
    }

    if (!response.ok || !response.body) {
      throw new AppError("DOWNLOAD_FAILED", "Image download failed.");
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_ATTACHED_IMAGE_BYTES) {
      throw new AppError("FILE_TOO_LARGE", "Attached image exceeds the configured byte limit.", {
        maxBytes: MAX_ATTACHED_IMAGE_BYTES
      });
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const reader = response.body.getReader();
    while (true) {
      if (Date.now() - startedAt > ATTACHED_IMAGE_DOWNLOAD_TOTAL_TIMEOUT_MS) {
        throw new AppError("DOWNLOAD_TIMED_OUT", "Image download timed out.");
      }

      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const chunk = Buffer.from(value);
      totalBytes += chunk.length;
      if (totalBytes > MAX_ATTACHED_IMAGE_BYTES) {
        throw new AppError("FILE_TOO_LARGE", "Attached image exceeds the configured byte limit.", {
          maxBytes: MAX_ATTACHED_IMAGE_BYTES
        });
      }
      chunks.push(chunk);
    }

    return Buffer.concat(chunks);
  }

  throw new AppError("DOWNLOAD_FAILED", "Image download exceeded the redirect limit.");
}

async function ensureParentDirectories(plan: DestinationPlan): Promise<string[]> {
  const createdDirectories: string[] = [];
  let current = plan.workspaceRootRealPath;
  for (const segment of plan.segments.slice(0, -1)) {
    current = path.join(current, segment);
    if (fsSync.existsSync(current)) {
      assertExistingPathSafe(current, plan.workspaceRootRealPath, true);
      continue;
    }

    try {
      await fs.mkdir(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
    assertExistingPathSafe(current, plan.workspaceRootRealPath, true);
    createdDirectories.push(path.relative(plan.workspaceRootRealPath, current).split(path.sep).join("/"));
  }

  return createdDirectories;
}

async function gitFileStatus(root: string, relativePath: string): Promise<string> {
  try {
    const result = await runGit(root, ["status", "--short", "--", relativePath], { timeoutMs: 30_000, maxBytes: 20_000 });
    if (result.exitCode !== 0 || result.timedOut) {
      return "unknown";
    }

    const line = result.stdout.split(/\r?\n/u).find(Boolean);
    if (!line) {
      return "unknown";
    }

    const code = line.slice(0, 2);
    if (code === "??") {
      return "untracked";
    }
    if (code.includes("A")) {
      return "added";
    }
    if (code.includes("M")) {
      return "modified";
    }
    if (code === "!!") {
      return "ignored";
    }
    return code.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

async function writeExactBytesCreateOnly(plan: DestinationPlan, data: Buffer): Promise<void> {
  let handle: fs.FileHandle | undefined;
  let createdFinal = false;
  try {
    handle = await fs.open(plan.absolutePath, "wx");
    createdFinal = true;
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
    if (createdFinal) {
      await fs.unlink(plan.absolutePath).catch(() => undefined);
    }
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new AppError("DESTINATION_EXISTS", "Destination already exists.", {
        relativePath: plan.relativePath
      });
    }
    throw error;
  }
}

async function verifyWrittenBytes(plan: DestinationPlan, expectedSha256: string, expectedBytes: number): Promise<void> {
  const stats = await fs.stat(plan.absolutePath);
  if (!stats.isFile() || stats.size !== expectedBytes) {
    await fs.unlink(plan.absolutePath).catch(() => undefined);
    throw new AppError("VERIFICATION_FAILED", "Written image size did not match the approved bytes.", {
      relativePath: plan.relativePath
    });
  }

  const data = await fs.readFile(plan.absolutePath);
  const actualSha256 = createHash("sha256").update(data).digest("hex");
  if (actualSha256 !== expectedSha256) {
    await fs.unlink(plan.absolutePath).catch(() => undefined);
    throw new AppError("VERIFICATION_FAILED", "Written image hash did not match the approved bytes.", {
      relativePath: plan.relativePath
    });
  }
}

export async function workspaceWriteAttachedImage(
  rawInput: unknown,
  config: AppConfig,
  downloader: AttachedImageDownloader = downloadAttachedImage
): Promise<WorkspaceWriteAttachedImageOutput> {
  const startedAt = Date.now();
  const correlationId = randomUUID();
  let finalResult: WorkspaceWriteAttachedImageOutput | undefined;
  let auditWorkspaceId: string | undefined;
  let auditRelativePath: string | undefined;
  let auditDetectedFormat: string | undefined;
  let auditByteCount: number | undefined;
  let auditSha256: string | undefined;

  async function finish(result: WorkspaceWriteAttachedImageOutput): Promise<WorkspaceWriteAttachedImageOutput> {
    finalResult = result;
    await writeAuditLog(config.auditLogPath, {
      toolName: WORKSPACE_WRITE_ATTACHED_IMAGE_TOOL_NAME,
      correlationId,
      workspaceId: auditWorkspaceId || result.workspaceId || undefined,
      requestedPath: isPlainObject(rawInput) && typeof rawInput.relativePath === "string" ? rawInput.relativePath : undefined,
      normalizedRelativePath: auditRelativePath || result.relativePath || undefined,
      result: result.status === "created" ? "allow" : "deny",
      reason: result.errors[0]?.message ?? result.status,
      byteCount: auditByteCount ?? result.bytesWritten,
      detectedFormat: auditDetectedFormat ?? result.detectedFormat,
      status: result.status,
      durationMs: Date.now() - startedAt,
      sha256: auditSha256 ?? result.sha256
    });
    return result;
  }

  try {
    const input: WorkspaceWriteAttachedImageInput = WorkspaceWriteAttachedImageInputSchema.parse(rawInput);
    auditWorkspaceId = input.workspaceId;

    if (!config.docsWritesAllowed) {
      return finish(output("workspace_not_writable", {
        workspaceId: input.workspaceId,
        relativePath: input.relativePath,
        originalFileName: input.image.file_name
      }, new AppError("APPROVAL_REQUIRED", "workspace_write_attached_image requires writeMode docs, patch, or elevated.")));
    }

    let workspace;
    try {
      workspace = resolveWorkspace(input.workspaceId, config);
    } catch (error) {
      return finish(output(statusForError(error), {
        workspaceId: input.workspaceId,
        relativePath: input.relativePath,
        originalFileName: input.image.file_name
      }, error));
    }

    const plan = buildDestinationPlan(workspace.root, input.relativePath);
    auditRelativePath = plan.relativePath;

    if (fsSync.existsSync(plan.absolutePath)) {
      const stats = fsSync.lstatSync(plan.absolutePath);
      if (isReparsePoint(stats)) {
        return finish(output("reparse_point_rejected", {
          workspaceId: workspace.workspaceId,
          workspaceName: workspace.label,
          relativePath: plan.relativePath,
          originalFileName: input.image.file_name
        }, new AppError("REPARSE_POINT_REJECTED", "Existing destination is a reparse point and is rejected.")));
      }

      return finish(output("destination_exists", {
        workspaceId: workspace.workspaceId,
        workspaceName: workspace.label,
        relativePath: plan.relativePath,
        originalFileName: input.image.file_name
      }, new AppError("DESTINATION_EXISTS", "Destination already exists.", { relativePath: plan.relativePath })));
    }

    let data: Buffer;
    try {
      data = await downloader(input.image);
    } catch (error) {
      return finish(output(statusForError(error), {
        workspaceId: workspace.workspaceId,
        workspaceName: workspace.label,
        relativePath: plan.relativePath,
        originalFileName: input.image.file_name
      }, error));
    }

    if (data.length > MAX_ATTACHED_IMAGE_BYTES) {
      return finish(output("file_too_large", {
        workspaceId: workspace.workspaceId,
        workspaceName: workspace.label,
        relativePath: plan.relativePath,
        originalFileName: input.image.file_name
      }, new AppError("FILE_TOO_LARGE", "Attached image exceeds the configured byte limit.", { maxBytes: MAX_ATTACHED_IMAGE_BYTES })));
    }

    let metadata: ImageMetadata;
    try {
      metadata = detectAttachedImage(data);
      assertExtensionMatchesFormat(plan.relativePath, metadata.detectedFormat);
      assertMimeMatchesFormat(input.image.mime_type, metadata.detectedFormat);
    } catch (error) {
      return finish(output(statusForError(error), {
        workspaceId: workspace.workspaceId,
        workspaceName: workspace.label,
        relativePath: plan.relativePath,
        originalFileName: input.image.file_name,
      }, error));
    }

    auditDetectedFormat = metadata.detectedFormat;
    auditByteCount = data.length;
    const sha256 = createHash("sha256").update(data).digest("hex");
    auditSha256 = sha256;

    let createdDirectories: string[] = [];
    try {
      createdDirectories = await ensureParentDirectories(plan);
      assertExistingPathSafe(deepestExistingPath(path.dirname(plan.absolutePath)), plan.workspaceRootRealPath, true);
      if (!isPathInside(plan.absolutePath, plan.workspaceRootRealPath)) {
        throw new AppError("PATH_DENIED", "Destination resolves outside the selected workspace.");
      }
      await writeExactBytesCreateOnly(plan, data);
      await verifyWrittenBytes(plan, sha256, data.length);
    } catch (error) {
      if (error instanceof AppError && error.code === "DESTINATION_EXISTS") {
        return finish(output("destination_exists", {
          workspaceId: workspace.workspaceId,
          workspaceName: workspace.label,
          relativePath: plan.relativePath,
          detectedMimeType: metadata.detectedMimeType,
          detectedFormat: metadata.detectedFormat,
          originalFileName: input.image.file_name,
          width: metadata.width,
          height: metadata.height,
          createdDirectories
        }, error));
      }

      return finish(output(error instanceof AppError && error.code === "VERIFICATION_FAILED" ? "verification_failed" : statusForError(error), {
        workspaceId: workspace.workspaceId,
        workspaceName: workspace.label,
        relativePath: plan.relativePath,
        detectedMimeType: metadata.detectedMimeType,
        detectedFormat: metadata.detectedFormat,
        originalFileName: input.image.file_name,
        width: metadata.width,
        height: metadata.height,
        createdDirectories
      }, error));
    }

    const status = await gitFileStatus(plan.workspaceRootRealPath, plan.relativePath);
    return finish(output("created", {
      workspaceId: workspace.workspaceId,
      workspaceName: workspace.label,
      relativePath: plan.relativePath,
      detectedMimeType: metadata.detectedMimeType,
      detectedFormat: metadata.detectedFormat,
      originalFileName: input.image.file_name,
      bytesWritten: data.length,
      width: metadata.width,
      height: metadata.height,
      sha256,
      createdDirectories,
      gitFileStatus: status
    }));
  } catch (error) {
    const serialized = serializeError(error);
    return finish(output("invalid_path", {
      workspaceId: auditWorkspaceId ?? "",
      relativePath: auditRelativePath ?? (isPlainObject(rawInput) && typeof rawInput.relativePath === "string" ? rawInput.relativePath : "")
    }, new AppError("INVALID_INPUT", serialized.message, serialized.details)));
  } finally {
    if (!finalResult) {
      await writeAuditLog(config.auditLogPath, {
        toolName: WORKSPACE_WRITE_ATTACHED_IMAGE_TOOL_NAME,
        correlationId,
        workspaceId: auditWorkspaceId,
        requestedPath: isPlainObject(rawInput) && typeof rawInput.relativePath === "string" ? rawInput.relativePath : undefined,
        normalizedRelativePath: auditRelativePath,
        result: "deny",
        reason: "tool exited before producing a result",
        byteCount: auditByteCount,
        detectedFormat: auditDetectedFormat,
        status: "write_failed",
        durationMs: Date.now() - startedAt,
        sha256: auditSha256
      });
    }
  }
}
