import fs from "node:fs";
import path from "node:path";

import { AppError } from "../utils/errors.js";

const BLOCKED_DIRECTORY_NAMES = new Set([".git", "node_modules", "appdata"]);
const BLOCKED_FILE_NAMES = new Set(["id_rsa", "id_ed25519"]);
const BLOCKED_EXTENSIONS = new Set([".pem", ".key", ".pfx", ".sqlite", ".sqlite3", ".db"]);
const BROWSER_PROFILE_PATTERNS = [
  "/google/chrome/user data/",
  "/microsoft/edge/user data/",
  "/mozilla/firefox/profiles/",
  "/brave-software/brave-browser/user data/"
];

export const DEFAULT_MAX_TEXT_BYTES = 200_000;
export const DEFAULT_MAX_SEARCH_FILE_BYTES = 1_000_000;

function splitPathSegments(value: string): string[] {
  return value.split(/[\\/]+/).filter(Boolean);
}

function normalizeSlashPath(value: string): string {
  return `/${value.split(/[\\/]+/).filter(Boolean).join("/")}/`.toLowerCase();
}

export function getFilePolicyDenial(resolvedPath: string, relativePath = resolvedPath): string | null {
  const segments = splitPathSegments(relativePath);
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  const blockedDirectory = lowerSegments.find((segment) => BLOCKED_DIRECTORY_NAMES.has(segment));

  if (blockedDirectory) {
    return `Blocked directory segment: ${blockedDirectory}`;
  }

  const slashPath = normalizeSlashPath(relativePath);
  if (BROWSER_PROFILE_PATTERNS.some((pattern) => slashPath.includes(pattern))) {
    return "Browser profile folders are blocked.";
  }

  const fileName = path.basename(resolvedPath).toLowerCase();
  if (fileName === ".env" || (fileName.startsWith(".env.") && fileName !== ".env.example")) {
    return "Environment files are blocked.";
  }

  if (BLOCKED_FILE_NAMES.has(fileName)) {
    return `Sensitive key file is blocked: ${fileName}`;
  }

  const extension = path.extname(fileName);
  if (BLOCKED_EXTENSIONS.has(extension)) {
    return `Blocked sensitive file extension: ${extension}`;
  }

  return null;
}

export function assertFilePolicyAllowsPath(resolvedPath: string, relativePath = resolvedPath): void {
  const denial = getFilePolicyDenial(resolvedPath, relativePath);
  if (denial) {
    throw new AppError("FILE_DENIED", denial, {
      relativePath
    });
  }
}

export function assertMarkdownArtifactPath(resolvedPath: string, relativePath = resolvedPath): void {
  assertFilePolicyAllowsPath(resolvedPath, relativePath);

  if (path.extname(resolvedPath).toLowerCase() !== ".md") {
    throw new AppError("FILE_DENIED", "Markdown artifact writes only allow .md files.", {
      relativePath
    });
  }
}

export function isLikelyTextBuffer(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return true;
  }

  let suspicious = 0;
  for (const byte of buffer) {
    if (byte === 0) {
      return false;
    }

    const isAllowedControl = byte === 9 || byte === 10 || byte === 12 || byte === 13;
    if (byte < 32 && !isAllowedControl) {
      suspicious += 1;
    }
  }

  return suspicious / buffer.length < 0.05;
}

export function assertReadableTextFile(resolvedPath: string, relativePath: string, maxBytes = DEFAULT_MAX_TEXT_BYTES): fs.Stats {
  assertFilePolicyAllowsPath(resolvedPath, relativePath);

  const stats = fs.statSync(resolvedPath);
  if (!stats.isFile()) {
    throw new AppError("FILE_DENIED", "Requested path is not a file.", {
      relativePath
    });
  }

  if (stats.size > maxBytes) {
    throw new AppError("FILE_DENIED", "File exceeds the configured read size limit.", {
      relativePath,
      sizeBytes: stats.size,
      maxBytes
    });
  }

  const sampleSize = Math.min(stats.size, 8192);
  const fd = fs.openSync(resolvedPath, "r");
  try {
    const sample = Buffer.alloc(sampleSize);
    fs.readSync(fd, sample, 0, sampleSize, 0);
    if (!isLikelyTextBuffer(sample)) {
      throw new AppError("FILE_DENIED", "Binary files are blocked by default.", {
        relativePath
      });
    }
  } finally {
    fs.closeSync(fd);
  }

  return stats;
}
