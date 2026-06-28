import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import { type AppConfig } from "../config.js";
import { assertFilePolicyAllowsPath, isLikelyTextBuffer } from "../security/filePolicy.js";
import { assertSafeRelativePath, isPathInside, resolveAllowedRoot, resolveProjectPath, toRootRelativePath } from "../security/pathPolicy.js";
import { AppError } from "../utils/errors.js";
import { assertInsideGitRepo } from "../utils/git.js";
import { redactSecrets, redactUnknown } from "./figmaMcpClient.js";
import { type FigmaMakeHandoffStatus } from "./figmaMakeHandoff.js";

export interface RunFigmaMakeFileHandoffInput {
  makeFilePath: string;
  targetUiArea?: string;
  implementationScope?: string;
  outputDirectory?: string;
  codexPromptFile?: string;
  notes?: string;
}

export interface RunFigmaMakeFileHandoffOutput {
  status: FigmaMakeHandoffStatus;
  sourceType: "figma_make_file";
  makeFilePath: string;
  handoffDirectory: string;
  codexPromptFile: string;
  createdFiles: string[];
  metadataFiles: string[];
  resourceFiles: string[];
  assetFiles: string[];
  reconstructedSourceFiles: string[];
  warnings: string[];
  errors: string[];
}

interface SafeWriteResult {
  relativePath: string;
  sizeBytes: number;
  sha256: string;
}

interface ResolvedMakeFile {
  rootRealPath: string;
  absolutePath: string;
  safePath: string;
  sizeBytes: number;
  sha256: string;
}

interface AllowedRootCandidate {
  requestedRoot: string;
  rootRealPath: string;
}

interface ZipEntry {
  path: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  data: Buffer;
}

interface PackageInventoryEntry {
  entryPath: string;
  category: string;
  size: number;
  compressedSize: number;
  compressionMethod: number;
  extracted: boolean;
  localOutputPath?: string;
  skippedReason?: string;
}

interface ReconstructedSource {
  archivePath: string;
  content: string;
  confidence: "complete" | "partial" | "uncertain";
  reason: string;
  provenance: string[];
  sequence: number;
}

interface PartialSourceFinding {
  archivePath: string;
  reason: string;
  provenance: string[];
}

interface ReconstructionResult {
  reconstructedFiles: ReconstructedSource[];
  partialFiles: PartialSourceFinding[];
  unresolvedReferences: string[];
  toolCalls: string[];
  messageCount?: number;
  versionCount?: number;
  designBrief?: string;
  events: string[];
}

const DEFAULT_TARGET_UI_AREA = "ChampCity GPT UI";
const DEFAULT_OUTPUT_DIRECTORY = "design/figma-handoff/make-file";
const DEFAULT_CODEX_PROMPT_FILE = "docs/handoffs/CODEX_FIGMA_MAKE_FILE_HANDOFF.md";
const PACKAGE_PROMPT_FILE = "CODEX_FIGMA_MAKE_FILE_HANDOFF.md";
const MAX_MAKE_FILE_BYTES = 250 * 1024 * 1024;
const MAX_ZIP_ENTRY_BYTES = 75 * 1024 * 1024;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".scss", ".json", ".html", ".md"]);
const COMPLETE_CONTENT_KEYS = new Set(["content", "code", "source", "sourceCode", "text", "fileContent", "newContent", "value"]);
const PATH_KEYS = new Set(["path", "filePath", "filepath", "filename", "fileName", "name", "targetPath"]);
const EDIT_KEYS = new Set(["edit", "edits", "patch", "diff", "oldString", "newString", "replace", "operation", "operations"]);

function ensureDocsWriteMode(config: AppConfig): void {
  if (!config.docsWritesAllowed) {
    throw new AppError("APPROVAL_REQUIRED", "run_figma_make_file_handoff requires writeMode docs, patch, or elevated.");
  }
}

function normalizeSlashPath(value: string): string {
  return value.replace(/\\/gu, "/");
}

function safeDisplayPath(absolutePath: string, config: AppConfig): string {
  for (const allowedRoot of config.allowedRoots) {
    const realRoot = fsSync.existsSync(allowedRoot) ? fsSync.realpathSync.native(allowedRoot) : path.resolve(allowedRoot);
    if (isPathInside(absolutePath, realRoot)) {
      return toRootRelativePath(realRoot, absolutePath);
    }
  }
  return path.basename(absolutePath);
}

function outputBase(input: RunFigmaMakeFileHandoffInput): RunFigmaMakeFileHandoffOutput {
  return {
    status: "failed",
    sourceType: "figma_make_file",
    makeFilePath: input.makeFilePath,
    handoffDirectory: input.outputDirectory?.trim() || DEFAULT_OUTPUT_DIRECTORY,
    codexPromptFile: input.codexPromptFile?.trim() || DEFAULT_CODEX_PROMPT_FILE,
    createdFiles: [],
    metadataFiles: [],
    resourceFiles: [],
    assetFiles: [],
    reconstructedSourceFiles: [],
    warnings: [],
    errors: []
  };
}

function normalizeForDedupe(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function allowedRootCandidates(config: AppConfig): AllowedRootCandidate[] {
  const roots: AllowedRootCandidate[] = [];
  const seen = new Set<string>();

  for (const candidate of [config.repoRoot, ...config.allowedRoots]) {
    let resolvedRoot: AllowedRootCandidate;
    try {
      resolvedRoot = resolveAllowedRoot(candidate, config.allowedRoots);
    } catch (error) {
      if (candidate === config.repoRoot) {
        continue;
      }
      throw error;
    }

    const key = normalizeForDedupe(resolvedRoot.rootRealPath);
    if (!seen.has(key)) {
      seen.add(key);
      roots.push(resolvedRoot);
    }
  }

  return roots;
}

function resolveOutputPath(root: string, relativePath: string, config: AppConfig, label: string) {
  try {
    return resolveProjectPath(root, relativePath, config.allowedRoots);
  } catch (error) {
    if (error instanceof AppError) {
      if (/Expected a relative path/iu.test(error.message)) {
        throw new AppError("PATH_DENIED", `${label} must be a relative path inside the selected root.`, error.details);
      }
      if (/Path traversal/iu.test(error.message)) {
        throw new AppError("PATH_DENIED", `${label} must be a relative path inside the selected root; path traversal is not allowed.`, error.details);
      }
      if (/escapes/iu.test(error.message)) {
        throw new AppError("PATH_DENIED", `${label} escapes the selected allowed root.`, error.details);
      }
    }
    throw error;
  }
}

function readResolvedMakeFile(resolved: ReturnType<typeof resolveProjectPath>, config: AppConfig): ResolvedMakeFile | undefined {
  if (path.extname(resolved.resolvedPath).toLowerCase() !== ".make") {
    throw new AppError("INVALID_INPUT", "makeFilePath has an invalid extension; expected a .make file.");
  }

  let stats: fsSync.Stats;
  try {
    stats = fsSync.statSync(resolved.resolvedPath);
  } catch {
    return undefined;
  }

  if (!stats.isFile()) {
    throw new AppError("FILE_DENIED", "makeFilePath must point to a regular file.");
  }

  if (stats.size > MAX_MAKE_FILE_BYTES) {
    throw new AppError("FILE_DENIED", "The .make file exceeds the supported parser size limit.", {
      sizeBytes: stats.size,
      maxBytes: MAX_MAKE_FILE_BYTES
    });
  }

  const relativePath = toRootRelativePath(resolved.rootRealPath, resolved.resolvedPath);
  assertFilePolicyAllowsPath(resolved.resolvedPath, relativePath);
  if (config.requireGitRoot) {
    assertInsideGitRepo(resolved.resolvedPath);
  }

  const data = fsSync.readFileSync(resolved.resolvedPath);
  return {
    rootRealPath: resolved.rootRealPath,
    absolutePath: resolved.resolvedPath,
    safePath: relativePath,
    sizeBytes: stats.size,
    sha256: crypto.createHash("sha256").update(data).digest("hex")
  };
}

function makeFileNotFound(makeFilePath: string): AppError {
  return new AppError("PATH_DENIED", "makeFilePath file not found or cannot be resolved inside the configured allowed roots.", {
    path: makeFilePath
  });
}

function resolveMakeFilePath(makeFilePath: string, config: AppConfig): ResolvedMakeFile {
  if (makeFilePath.includes("\0")) {
    throw new AppError("PATH_DENIED", "makeFilePath contains a null byte.");
  }

  const trimmed = makeFilePath.trim();
  if (!trimmed) {
    throw new AppError("INVALID_INPUT", "makeFilePath is required.");
  }

  const roots = allowedRootCandidates(config);
  if (path.isAbsolute(trimmed)) {
    const requestedPath = path.resolve(trimmed);
    const existingRealPath = fsSync.existsSync(requestedPath) ? fsSync.realpathSync.native(requestedPath) : undefined;
    const matchedRoot = roots.find(
      (allowedRoot) =>
        isPathInside(existingRealPath ?? requestedPath, allowedRoot.rootRealPath) ||
        isPathInside(requestedPath, allowedRoot.requestedRoot)
    );
    if (!matchedRoot) {
      throw new AppError("PATH_DENIED", "makeFilePath is outside the configured allowed roots.");
    }

    const relativePath = existingRealPath
      ? toRootRelativePath(matchedRoot.rootRealPath, existingRealPath)
      : toRootRelativePath(matchedRoot.requestedRoot, requestedPath);
    let resolved: ReturnType<typeof resolveProjectPath>;
    try {
      resolved = resolveProjectPath(matchedRoot.rootRealPath, relativePath, config.allowedRoots);
    } catch (error) {
      if (error instanceof AppError && /escapes/iu.test(error.message)) {
        throw new AppError("PATH_DENIED", "makeFilePath is outside the configured allowed roots.", error.details);
      }
      throw error;
    }

    const makeFile = readResolvedMakeFile(resolved, config);
    if (!makeFile) {
      throw makeFileNotFound(trimmed);
    }
    return makeFile;
  }

  let safeRelativePath: string;
  try {
    safeRelativePath = assertSafeRelativePath(trimmed);
  } catch (error) {
    if (error instanceof AppError && /Path traversal/iu.test(error.message)) {
      throw new AppError("PATH_DENIED", "makeFilePath path traversal is not allowed.", error.details);
    }
    throw error;
  }

  for (const root of roots) {
    const resolved = resolveProjectPath(root.rootRealPath, safeRelativePath, config.allowedRoots);
    const makeFile = readResolvedMakeFile(resolved, config);
    if (makeFile) {
      return makeFile;
    }
  }

  throw makeFileNotFound(trimmed);
}

async function safeWrite(root: string, relativePath: string, data: string | Buffer, config: AppConfig): Promise<SafeWriteResult> {
  const resolved = resolveOutputPath(root, relativePath, config, "output path");
  const normalizedRelativePath = toRootRelativePath(resolved.rootRealPath, resolved.resolvedPath);
  assertFilePolicyAllowsPath(resolved.resolvedPath, normalizedRelativePath);
  if (config.requireGitRoot) {
    assertInsideGitRepo(resolved.resolvedPath);
  }

  await fs.mkdir(path.dirname(resolved.resolvedPath), { recursive: true });
  const temporaryPath = path.join(path.dirname(resolved.resolvedPath), `.${path.basename(resolved.resolvedPath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(temporaryPath, data);
  await fs.rename(temporaryPath, resolved.resolvedPath);
  const buffer = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return {
    relativePath: normalizedRelativePath,
    sizeBytes: buffer.length,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex")
  };
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) {
      return offset;
    }
  }
  return -1;
}

function assertSafeArchivePath(entryPath: string): string {
  const normalized = normalizeSlashPath(entryPath).replace(/^\/+/u, "");
  if (!normalized || normalized.includes("\0")) {
    throw new AppError("PATH_DENIED", "Package entry path is empty or contains a null byte.");
  }
  assertSafeRelativePath(normalized);
  return normalized;
}

function parseZipEntries(buffer: Buffer): ZipEntry[] {
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== ZIP_LOCAL_FILE_SIGNATURE) {
    throw new AppError("INVALID_INPUT", "The .make file is not a ZIP-compatible package.");
  }

  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) {
    throw new AppError("INVALID_INPUT", "The .make package does not contain a ZIP central directory.");
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new AppError("INVALID_INPUT", "The .make ZIP central directory is malformed.");
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const rawName = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");
    offset += 46 + fileNameLength + extraLength + commentLength;

    if (rawName.endsWith("/")) {
      continue;
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new AppError("INVALID_INPUT", "ZIP64 .make packages are not supported yet.");
    }
    if (uncompressedSize > MAX_ZIP_ENTRY_BYTES) {
      throw new AppError("FILE_DENIED", `Package entry exceeds the supported size limit: ${rawName}`);
    }
    if (localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_FILE_SIGNATURE) {
      throw new AppError("INVALID_INPUT", `Package entry has a malformed local header: ${rawName}`);
    }

    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) {
      throw new AppError("INVALID_INPUT", `Package entry data extends beyond the file: ${rawName}`);
    }

    const compressed = buffer.subarray(dataStart, dataEnd);
    let data: Buffer;
    if (compressionMethod === 0) {
      data = Buffer.from(compressed);
    } else if (compressionMethod === 8) {
      data = zlib.inflateRawSync(compressed);
    } else {
      throw new AppError("INVALID_INPUT", `Unsupported ZIP compression method ${compressionMethod} for ${rawName}.`);
    }

    entries.push({
      path: assertSafeArchivePath(rawName),
      compressionMethod,
      compressedSize,
      uncompressedSize,
      data
    });
  }

  return entries;
}

function categoryForEntry(entryPath: string): string {
  const normalized = normalizeSlashPath(entryPath);
  const base = path.posix.basename(normalized).toLowerCase();
  if (base === "meta.json" || base === "make_binary_files.json" || base === "ai_chat.json") {
    return "metadata";
  }
  if (base === "thumbnail.png") {
    return "asset";
  }
  if (normalized.startsWith("images/") || normalized.startsWith("make_binary_files/") || normalized.startsWith("blob_store/")) {
    return "asset";
  }
  if (base === "canvas.fig") {
    return "resource";
  }
  return "resource";
}

function shouldPreserveRaw(entryPath: string): boolean {
  const normalized = normalizeSlashPath(entryPath);
  const base = path.posix.basename(normalized).toLowerCase();
  return base === "meta.json" || base === "ai_chat.json" || base === "make_binary_files.json" || base === "canvas.fig";
}

function assetOutputPath(entryPath: string): string | undefined {
  const normalized = normalizeSlashPath(entryPath);
  const base = path.posix.basename(normalized).toLowerCase();
  if (base === "thumbnail.png") {
    return "thumbnail.png";
  }
  if (normalized.startsWith("images/") || normalized.startsWith("make_binary_files/") || normalized.startsWith("blob_store/")) {
    return normalized;
  }
  return undefined;
}

function isTextLikeEntry(entryPath: string, data: Buffer): boolean {
  const extension = path.posix.extname(entryPath).toLowerCase();
  return [".json", ".txt", ".md", ".ts", ".tsx", ".js", ".jsx", ".css", ".html"].includes(extension) || isLikelyTextBuffer(data);
}

function dataForGeneratedFile(entryPath: string, data: Buffer): string | Buffer {
  return isTextLikeEntry(entryPath, data) ? `${redactSecrets(data.toString("utf8"))}` : data;
}

function parseJsonEntry<T>(entry: ZipEntry | undefined, warnings: string[], label: string): T | undefined {
  if (!entry) {
    return undefined;
  }
  try {
    return redactUnknown(JSON.parse(entry.data.toString("utf8"))) as T;
  } catch (error) {
    warnings.push(`Could not parse ${label}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function looksLikeSourcePath(value: string): boolean {
  const normalized = normalizeSlashPath(value).replace(/^["'`]+|["'`]+$/gu, "");
  const extension = path.posix.extname(normalized).toLowerCase();
  return SOURCE_EXTENSIONS.has(extension) && /^[A-Za-z0-9_./ -]+$/u.test(normalized) && !normalized.includes("..");
}

function normalizeSourcePath(value: string): string | undefined {
  const cleaned = normalizeSlashPath(value).replace(/^["'`]+|["'`]+$/gu, "").replace(/^\/+/u, "");
  if (!looksLikeSourcePath(cleaned)) {
    return undefined;
  }
  return assertSafeArchivePath(cleaned);
}

function isCodeLikeContent(value: string, sourcePath: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 8) {
    return false;
  }
  const extension = path.posix.extname(sourcePath).toLowerCase();
  if (extension === ".css" || extension === ".scss") {
    return /[{}:;]/u.test(trimmed);
  }
  if (extension === ".json") {
    return trimmed.startsWith("{") || trimmed.startsWith("[");
  }
  if (extension === ".md") {
    return trimmed.length > 20;
  }
  return /(?:import|export|function|const|let|var|class|return|<[\w])/u.test(trimmed);
}

function collectMessageAndVersionCounts(value: unknown): { messageCount?: number; versionCount?: number } {
  let messageCount: number | undefined;
  let versionCount: number | undefined;

  function visit(node: unknown): void {
    if (!node || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      for (const entry of node) {
        visit(entry);
      }
      return;
    }
    const record = node as Record<string, unknown>;
    for (const [key, entry] of Object.entries(record)) {
      if (/messages?|conversation|chat/iu.test(key) && Array.isArray(entry)) {
        messageCount = Math.max(messageCount ?? 0, entry.length);
      }
      if (/versions?|snapshots?/iu.test(key) && Array.isArray(entry)) {
        versionCount = Math.max(versionCount ?? 0, entry.length);
      }
      visit(entry);
    }
  }

  visit(value);
  return { messageCount, versionCount };
}

function sourcePathFromRecord(record: Record<string, unknown>): string | undefined {
  for (const [key, value] of Object.entries(record)) {
    if (!PATH_KEYS.has(key) || typeof value !== "string") {
      continue;
    }
    const normalized = normalizeSourcePath(value);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function recordHasEditSignal(record: Record<string, unknown>): boolean {
  return Object.keys(record).some((key) => EDIT_KEYS.has(key));
}

function provenanceFor(record: Record<string, unknown>, fallback: string): string {
  for (const key of ["id", "messageId", "toolCallId", "callId", "version", "versionId", "key"]) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") {
      return `${key}:${String(value)}`;
    }
  }
  return fallback;
}

function addCandidate(candidates: Map<string, ReconstructedSource>, candidate: ReconstructedSource): void {
  const existing = candidates.get(candidate.archivePath);
  if (!existing || candidate.sequence >= existing.sequence) {
    candidates.set(candidate.archivePath, candidate);
  }
}

function extractCodeFences(text: string, provenance: string, sequenceStart: number): ReconstructedSource[] {
  const results: ReconstructedSource[] = [];
  const fencePattern = /```([A-Za-z0-9.+#-]*)[^\n]*\n([\s\S]*?)```/gu;
  let match: RegExpExecArray | null;
  let sequence = sequenceStart;
  while ((match = fencePattern.exec(text)) !== null) {
    const beforeFence = text.slice(Math.max(0, match.index - 160), match.index);
    const pathMatch = /([A-Za-z0-9_./ -]+\.(?:tsx?|jsx?|css|scss|json|html|md))\s*$/u.exec(beforeFence);
    if (!pathMatch?.[1]) {
      continue;
    }
    const archivePath = normalizeSourcePath(pathMatch[1]);
    const content = match[2] ?? "";
    if (!archivePath || !isCodeLikeContent(content, archivePath)) {
      continue;
    }
    results.push({
      archivePath,
      content: redactSecrets(content.trimEnd()),
      confidence: "uncertain",
      reason: "Recovered from a code fence adjacent to a source file path in Make chat history.",
      provenance: [provenance],
      sequence
    });
    sequence += 1;
  }
  return results;
}

function reconstructFromAiChat(aiChat: unknown): ReconstructionResult {
  const candidates = new Map<string, ReconstructedSource>();
  const partialFiles = new Map<string, PartialSourceFinding>();
  const unresolvedReferences = new Set<string>();
  const toolCalls = new Set<string>();
  const events: string[] = [];
  let sequence = 0;
  let designBrief: string | undefined;
  const counts = collectMessageAndVersionCounts(aiChat);

  function visit(node: unknown, lineage: string): void {
    sequence += 1;
    if (typeof node === "string") {
      const redacted = redactSecrets(node);
      if (!designBrief && redacted.length > 20 && /(build|create|design|make|implement|dashboard|ui)/iu.test(redacted)) {
        designBrief = redacted.replace(/\s+/gu, " ").slice(0, 500);
      }
      for (const candidate of extractCodeFences(redacted, lineage, sequence)) {
        addCandidate(candidates, candidate);
      }
      return;
    }
    if (!node || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((entry, index) => visit(entry, `${lineage}[${index}]`));
      return;
    }

    const record = node as Record<string, unknown>;
    const provenance = provenanceFor(record, lineage);
    const toolName = ["toolName", "tool", "name", "type"].map((key) => record[key]).find((value): value is string => typeof value === "string");
    if (toolName && /(write|edit|file|code|snapshot|create|replace)/iu.test(toolName)) {
      toolCalls.add(toolName);
      events.push(`${provenance}: ${toolName}`);
    }

    for (const [key, value] of Object.entries(record)) {
      if (/(snapshot|blob|codeSnapshot)/iu.test(key) && typeof value === "string") {
        unresolvedReferences.add(`${key}:${redactSecrets(value)}`);
      }
      if ((key === "arguments" || key === "args" || key === "input") && typeof value === "string" && value.trim().startsWith("{")) {
        try {
          visit(JSON.parse(value), `${lineage}.${key}`);
        } catch {
          // Leave opaque tool arguments in the preserved raw ai_chat.json.
        }
      }
    }

    const archivePath = sourcePathFromRecord(record);
    if (archivePath) {
      for (const [key, value] of Object.entries(record)) {
        if (!COMPLETE_CONTENT_KEYS.has(key) || typeof value !== "string") {
          continue;
        }
        const content = redactSecrets(value);
        if (!isCodeLikeContent(content, archivePath)) {
          continue;
        }
        addCandidate(candidates, {
          archivePath,
          content: content.trimEnd(),
          confidence: "complete",
          reason: `Recovered from Make history field "${key}" paired with source path "${archivePath}".`,
          provenance: [provenance],
          sequence
        });
      }

      if (recordHasEditSignal(record) && !candidates.has(archivePath)) {
        partialFiles.set(archivePath, {
          archivePath,
          reason: "Only edit/patch operations were found; no deterministic full-file base content was available.",
          provenance: [provenance]
        });
      }
    }

    for (const [key, value] of Object.entries(record)) {
      visit(value, `${lineage}.${key}`);
    }
  }

  visit(aiChat, "ai_chat");

  return {
    reconstructedFiles: [...candidates.values()].sort((a, b) => a.archivePath.localeCompare(b.archivePath)),
    partialFiles: [...partialFiles.values()].filter((entry) => !candidates.has(entry.archivePath)),
    unresolvedReferences: [...unresolvedReferences].sort(),
    toolCalls: [...toolCalls].sort(),
    messageCount: counts.messageCount,
    versionCount: counts.versionCount,
    designBrief,
    events: events.slice(0, 100)
  };
}

function listPaths(paths: string[], fallback: string): string {
  return paths.length > 0 ? paths.map((entry) => `- \`${entry}\``).join("\n") : `- ${fallback}`;
}

function listPlain(values: string[], fallback = "None."): string {
  return values.length > 0 ? values.map((entry) => `- ${entry}`).join("\n") : `- ${fallback}`;
}

function buildExtractionSummary(options: {
  safeMakePath: string;
  extractedAt: string;
  status: FigmaMakeHandoffStatus;
  statusRationale: string;
  inventory: PackageInventoryEntry[];
  metaParsed: boolean;
  aiChatParsed: boolean;
  assetsCopied: string[];
  reconstructedSourceFiles: string[];
  warnings: string[];
  errors: string[];
}): string {
  const majorEntries = options.inventory
    .filter((entry) => ["meta.json", "ai_chat.json", "make_binary_files.json", "canvas.fig", "thumbnail.png"].includes(path.posix.basename(entry.entryPath)) || entry.category === "asset")
    .slice(0, 50)
    .map((entry) => `- \`${entry.entryPath}\` (${entry.category}, ${entry.size} bytes)`);

  return `# Figma Make File Extraction Summary

Source type: Figma Make .make export package
Make file: ${options.safeMakePath}
Extraction time: ${options.extractedAt}
Package format: ZIP-compatible .make package
Status: ${options.status}
Status rationale: ${options.statusRationale}

## Major Entries Found

${majorEntries.length > 0 ? majorEntries.join("\n") : "- No major Make entries were identified."}

## Parsed Content

- meta.json parsed: ${options.metaParsed ? "yes" : "no"}
- ai_chat.json parsed: ${options.aiChatParsed ? "yes" : "no"}
- assets copied: ${options.assetsCopied.length > 0 ? "yes" : "no"}
- source reconstructed: ${options.reconstructedSourceFiles.length > 0 ? "yes" : "no"}
- screenshot capture attempted: no
- browser scraping attempted: no
- network scraping attempted: no
- clipboard automation attempted: no

## Warnings

${listPlain(options.warnings)}

## Errors

${listPlain(options.errors)}
`;
}

function buildExtractedResourceInventory(options: {
  rawFiles: string[];
  assetFiles: string[];
  reconstructedSourceFiles: string[];
  metadataFiles: string[];
  skipped: PackageInventoryEntry[];
}): string {
  const skippedLines = options.skipped.map((entry) => `- \`${entry.entryPath}\`: ${entry.skippedReason ?? "not selected for extraction"}`);
  return `# Extracted Figma Make File Resource Inventory

## Raw Package Files

${listPaths(options.rawFiles, "No raw package files were preserved.")}

## Asset Files

${listPaths(options.assetFiles, "No assets were copied.")}

## Reconstructed Source Files

${listPaths(options.reconstructedSourceFiles, "No source files were reconstructed.")}

## Metadata And Reports

${listPaths(options.metadataFiles, "No metadata files were generated.")}

## Skipped Package Entries

${skippedLines.length > 0 ? skippedLines.join("\n") : "- None."}
`;
}

function buildReconstructionReport(result: ReconstructionResult): string {
  const reconstructed = result.reconstructedFiles.map(
    (entry) =>
      `- \`${entry.archivePath}\`: ${entry.confidence}; ${entry.reason}; provenance ${entry.provenance.map((item) => `\`${item}\``).join(", ")}`
  );
  const partial = result.partialFiles.map(
    (entry) => `- \`${entry.archivePath}\`: ${entry.reason}; provenance ${entry.provenance.map((item) => `\`${item}\``).join(", ")}`
  );
  return `# Figma Make Source Reconstruction Report

## Reconstructed Source Files

${reconstructed.length > 0 ? reconstructed.join("\n") : "- No complete source files were reconstructed."}

## Partial Or Unresolved Files

${partial.length > 0 ? partial.join("\n") : "- None."}

## Unresolved Snapshot Or Blob References

${listPlain(result.unresolvedReferences)}

## Parser Limitations

- Edit-only operations are reported as partial unless a deterministic full-file base is also present.
- Snapshot keys are resolved only when their referenced content is embedded in parsed package content.
- Missing source is not fabricated.
`;
}

function buildChatHistorySummary(result: ReconstructionResult, aiChatParsed: boolean): string {
  return `# Figma Make Chat History Summary

ai_chat.json parsed: ${aiChatParsed ? "yes" : "no"}
Messages detected: ${result.messageCount ?? "unknown"}
Make versions detected: ${result.versionCount ?? "unknown"}

## Tool Calls Detected

${listPlain(result.toolCalls)}

## Design Brief Or Prompt Summary

${result.designBrief ? `- ${result.designBrief}` : "- Not detected."}

## Code Generation And Editing Events

${listPlain(result.events.slice(0, 50))}
`;
}

function buildAssetInventory(options: { inventory: PackageInventoryEntry[]; assetFiles: string[] }): string {
  const thumbnail = options.assetFiles.find((entry) => /thumbnail\.png$/iu.test(entry));
  const imageAssets = options.inventory.filter((entry) => entry.entryPath.startsWith("images/")).map((entry) => `- \`${entry.localOutputPath ?? entry.entryPath}\` (${entry.size} bytes)`);
  const binaryAssets = options.inventory
    .filter((entry) => entry.entryPath.startsWith("make_binary_files/"))
    .map((entry) => `- \`${entry.localOutputPath ?? entry.entryPath}\` (${entry.size} bytes)`);
  const blobAssets = options.inventory.filter((entry) => entry.entryPath.startsWith("blob_store/")).map((entry) => `- \`${entry.localOutputPath ?? entry.entryPath}\` (${entry.size} bytes)`);

  return `# Figma Make Asset Inventory

Thumbnail: ${thumbnail ? `\`${thumbnail}\`` : "not present"}

## Image Assets

${imageAssets.length > 0 ? imageAssets.join("\n") : "- None."}

## Binary Assets

${binaryAssets.length > 0 ? binaryAssets.join("\n") : "- None."}

## Blob Store Entries

${blobAssets.length > 0 ? blobAssets.join("\n") : "- None."}
`;
}

function buildCodexPrompt(options: {
  safeMakePath: string;
  handoffDirectory: string;
  codexPromptFile: string;
  targetUiArea: string;
  implementationScope: string;
  notes: string;
  extractionSummaryPath: string;
  resourceInventoryPath: string;
  reconstructionReportPath: string;
  chatHistorySummaryPath: string;
  assetInventoryPath: string;
  rawAiChatPath?: string;
  reconstructedSourceFiles: string[];
  assetFiles: string[];
  warnings: string[];
}): string {
  return `# Codex Figma Make File Handoff

You are Codex implementing a UI change from a deterministic local Figma Make .make export package.

Before editing files, verify the repository path and confirm you are working in the intended ChampCity GPT MCP app checkout.

## Source

- Source type: Figma Make .make export package
- Local Make file: ${options.safeMakePath}
- Handoff directory: \`${options.handoffDirectory}\`
- Target UI area: ${options.targetUiArea}
- Implementation scope: ${options.implementationScope}
- Prompt file: \`${options.codexPromptFile}\`
- This is not a screenshot-based handoff.

## Required Reading

- Extraction summary: \`${options.extractionSummaryPath}\`
- Resource inventory: \`${options.resourceInventoryPath}\`
- Reconstruction report: \`${options.reconstructionReportPath}\`
- Chat history summary: \`${options.chatHistorySummaryPath}\`
- Asset inventory: \`${options.assetInventoryPath}\`
${options.rawAiChatPath ? `- Raw ai_chat.json: \`${options.rawAiChatPath}\`` : "- Raw ai_chat.json: not available"}

## Reconstructed Source Files

${listPaths(options.reconstructedSourceFiles, "No source files were reconstructed. Inspect the reports and raw package files before deciding whether implementation is possible.")}

## Asset Paths

${listPaths(options.assetFiles, "No assets were copied.")}

## Implementation Instructions

- Inspect reconstructed source and reports before coding.
- Preserve existing app functionality.
- Avoid broad refactors.
- Keep changes scoped to ${options.targetUiArea}.
- Verify the repo path before changing files.
- Do not modify OAuth, Cloudflare tunnel configuration, MCP authentication, Figma token storage, or server lifecycle unless specifically in scope.
- Do not expose, log, or write tokens, cookies, auth headers, credentials, or local secrets.
- If package evidence is incomplete, report the limitation clearly instead of guessing.

## Validation And Final Report

- Run typecheck, build, tests, and release/public checks relevant to the changed files.
- Report files changed.
- Report validation commands and results.
- Report any remaining extraction gaps or unresolved source reconstruction limits.

## Extraction Warnings

${listPlain(options.warnings)}

## User Notes

${options.notes || "No additional notes provided."}
`;
}

function statusFor(options: {
  rawUsefulCount: number;
  assetCount: number;
  reconstructedCount: number;
  aiChatParsed: boolean;
  warnings: string[];
  errors: string[];
  partialCount: number;
  unresolvedCount: number;
}): { status: FigmaMakeHandoffStatus; rationale: string } {
  const usefulCount = options.rawUsefulCount + options.assetCount + options.reconstructedCount + (options.aiChatParsed ? 1 : 0);
  if (usefulCount === 0) {
    return {
      status: "failed",
      rationale: "The package was parsed, but no useful non-metadata implementation evidence was extracted."
    };
  }
  if (options.errors.length > 0 || options.partialCount > 0 || options.unresolvedCount > 0) {
    return {
      status: "partial",
      rationale: "Useful package evidence was extracted, but some content could not be reconstructed cleanly."
    };
  }
  if (options.warnings.length > 0) {
    return {
      status: "partial",
      rationale: "Useful package evidence was extracted with parser warnings."
    };
  }
  return {
    status: "success",
    rationale: "The package was parsed and useful implementation evidence was extracted."
  };
}

export async function runFigmaMakeFileHandoff(input: RunFigmaMakeFileHandoffInput, config: AppConfig): Promise<RunFigmaMakeFileHandoffOutput> {
  ensureDocsWriteMode(config);

  const output = outputBase(input);
  const targetUiArea = input.targetUiArea?.trim() || DEFAULT_TARGET_UI_AREA;
  const implementationScope = input.implementationScope?.trim() || "Implement the UI indicated by the extracted Figma Make package contents.";
  const requestedOutputDirectory = input.outputDirectory?.trim() || DEFAULT_OUTPUT_DIRECTORY;
  const requestedCodexPromptFile = input.codexPromptFile?.trim() || DEFAULT_CODEX_PROMPT_FILE;
  const notes = redactSecrets(input.notes?.trim() || "");
  const extractedAt = new Date().toISOString();
  const warnings: string[] = [];
  const errors: string[] = [];
  const rawFiles: string[] = [];
  const assetFiles: string[] = [];
  const metadataFiles: string[] = [];
  const resourceFiles: string[] = [];
  const inventory: PackageInventoryEntry[] = [];

  try {
    const makeFile = resolveMakeFilePath(input.makeFilePath, config);
    const outputRoot = makeFile.rootRealPath;
    const resolvedOutputDirectory = resolveOutputPath(outputRoot, requestedOutputDirectory, config, "outputDirectory");
    const resolvedCodexPromptFile = resolveOutputPath(outputRoot, requestedCodexPromptFile, config, "codexPromptFile");
    const outputDirectory = toRootRelativePath(resolvedOutputDirectory.rootRealPath, resolvedOutputDirectory.resolvedPath);
    const codexPromptFile = toRootRelativePath(resolvedCodexPromptFile.rootRealPath, resolvedCodexPromptFile.resolvedPath);
    output.makeFilePath = makeFile.safePath;
    output.handoffDirectory = outputDirectory;
    output.codexPromptFile = codexPromptFile;
    const packageBuffer = await fs.readFile(makeFile.absolutePath);
    const entries = parseZipEntries(packageBuffer);
    if (entries.length === 0) {
      throw new AppError("INVALID_INPUT", "The .make package did not contain any readable file entries.");
    }

    const entryByPath = new Map(entries.map((entry) => [entry.path, entry]));
    const metaJson = parseJsonEntry<Record<string, unknown>>(entryByPath.get("meta.json"), warnings, "meta.json");
    const aiChatJson = parseJsonEntry<unknown>(entryByPath.get("ai_chat.json"), warnings, "ai_chat.json");
    const makeBinaryFilesJson = parseJsonEntry<unknown>(entryByPath.get("make_binary_files.json"), warnings, "make_binary_files.json");
    const reconstruction = aiChatJson ? reconstructFromAiChat(aiChatJson) : reconstructFromAiChat(undefined);

    const originalInfo = {
      sourceType: "figma_make_file",
      makeFilePath: makeFile.safePath,
      sizeBytes: makeFile.sizeBytes,
      sha256: makeFile.sha256,
      extractedAt
    };

    const originalInfoResult = await safeWrite(outputRoot, path.join(outputDirectory, "source-package", "original-file-info.json"), `${JSON.stringify(originalInfo, null, 2)}\n`, config);
    output.createdFiles.push(originalInfoResult.relativePath);
    metadataFiles.push(originalInfoResult.relativePath);

    for (const entry of entries) {
      const category = categoryForEntry(entry.path);
      const inventoryEntry: PackageInventoryEntry = {
        entryPath: entry.path,
        category,
        size: entry.uncompressedSize,
        compressedSize: entry.compressedSize,
        compressionMethod: entry.compressionMethod,
        extracted: false
      };
      inventory.push(inventoryEntry);

      if (shouldPreserveRaw(entry.path)) {
        const result = await safeWrite(outputRoot, path.join(outputDirectory, "raw", entry.path), dataForGeneratedFile(entry.path, entry.data), config);
        output.createdFiles.push(result.relativePath);
        rawFiles.push(result.relativePath);
        resourceFiles.push(result.relativePath);
        inventoryEntry.extracted = true;
        inventoryEntry.localOutputPath = result.relativePath;
      }

      const assetPath = assetOutputPath(entry.path);
      if (assetPath) {
        const result = await safeWrite(outputRoot, path.join(outputDirectory, "assets", assetPath), dataForGeneratedFile(entry.path, entry.data), config);
        output.createdFiles.push(result.relativePath);
        assetFiles.push(result.relativePath);
        inventoryEntry.extracted = true;
        inventoryEntry.localOutputPath = result.relativePath;
      }
    }

    for (const source of reconstruction.reconstructedFiles) {
      const result = await safeWrite(outputRoot, path.join(outputDirectory, "source", source.archivePath), source.content.endsWith("\n") ? source.content : `${source.content}\n`, config);
      output.createdFiles.push(result.relativePath);
      output.reconstructedSourceFiles.push(result.relativePath);
    }

    if (makeBinaryFilesJson && reconstruction.unresolvedReferences.length > 0) {
      warnings.push("make_binary_files.json was parsed, but one or more snapshot/blob references remained unresolved.");
    }

    const rawUsefulCount = rawFiles.filter((entry) => !/\/(?:meta|make_binary_files)\.json$/iu.test(entry)).length;
    const status = statusFor({
      rawUsefulCount,
      assetCount: assetFiles.length,
      reconstructedCount: output.reconstructedSourceFiles.length,
      aiChatParsed: Boolean(aiChatJson),
      warnings,
      errors,
      partialCount: reconstruction.partialFiles.length,
      unresolvedCount: reconstruction.unresolvedReferences.length
    });
    output.status = status.status;

    const inventoryJsonResult = await safeWrite(outputRoot, path.join(outputDirectory, "source-package", "package-inventory.json"), `${JSON.stringify({ entries: inventory }, null, 2)}\n`, config);
    output.createdFiles.push(inventoryJsonResult.relativePath);
    metadataFiles.push(inventoryJsonResult.relativePath);

    const summaryPath = path.join(outputDirectory, "reports", "extraction-summary.md");
    const resourceInventoryPath = path.join(outputDirectory, "reports", "extracted-resource-inventory.md");
    const reconstructionReportPath = path.join(outputDirectory, "reports", "reconstruction-report.md");
    const chatHistorySummaryPath = path.join(outputDirectory, "reports", "chat-history-summary.md");
    const assetInventoryPath = path.join(outputDirectory, "reports", "asset-inventory.md");
    const reportFiles: Record<string, string> = {
      [summaryPath]: buildExtractionSummary({
        safeMakePath: makeFile.safePath,
        extractedAt,
        status: output.status,
        statusRationale: status.rationale,
        inventory,
        metaParsed: Boolean(metaJson),
        aiChatParsed: Boolean(aiChatJson),
        assetsCopied: assetFiles,
        reconstructedSourceFiles: output.reconstructedSourceFiles,
        warnings,
        errors
      }),
      [resourceInventoryPath]: buildExtractedResourceInventory({
        rawFiles,
        assetFiles,
        reconstructedSourceFiles: output.reconstructedSourceFiles,
        metadataFiles,
        skipped: inventory.filter((entry) => !entry.extracted)
      }),
      [reconstructionReportPath]: buildReconstructionReport(reconstruction),
      [chatHistorySummaryPath]: buildChatHistorySummary(reconstruction, Boolean(aiChatJson)),
      [assetInventoryPath]: buildAssetInventory({ inventory, assetFiles })
    };

    for (const [relativePath, content] of Object.entries(reportFiles)) {
      const result = await safeWrite(outputRoot, relativePath, content, config);
      output.createdFiles.push(result.relativePath);
      metadataFiles.push(result.relativePath);
    }

    output.handoffDirectory = outputDirectory;

    const prompt = buildCodexPrompt({
      safeMakePath: makeFile.safePath,
      handoffDirectory: output.handoffDirectory,
      codexPromptFile,
      targetUiArea,
      implementationScope,
      notes,
      extractionSummaryPath: normalizeSlashPath(summaryPath),
      resourceInventoryPath: normalizeSlashPath(resourceInventoryPath),
      reconstructionReportPath: normalizeSlashPath(reconstructionReportPath),
      chatHistorySummaryPath: normalizeSlashPath(chatHistorySummaryPath),
      assetInventoryPath: normalizeSlashPath(assetInventoryPath),
      rawAiChatPath: rawFiles.find((entry) => /\/ai_chat\.json$/iu.test(entry)),
      reconstructedSourceFiles: output.reconstructedSourceFiles,
      assetFiles,
      warnings
    });
    const promptResult = await safeWrite(outputRoot, codexPromptFile, prompt, config);
    output.codexPromptFile = promptResult.relativePath;
    output.createdFiles.push(promptResult.relativePath);

    const packagePromptPath = path.join(outputDirectory, PACKAGE_PROMPT_FILE);
    if (normalizeSlashPath(packagePromptPath) !== normalizeSlashPath(promptResult.relativePath)) {
      const packagePromptResult = await safeWrite(outputRoot, packagePromptPath, prompt, config);
      output.createdFiles.push(packagePromptResult.relativePath);
      metadataFiles.push(packagePromptResult.relativePath);
    }

    output.metadataFiles = [...new Set(metadataFiles)];
    output.resourceFiles = [...new Set(resourceFiles)];
    output.assetFiles = [...new Set(assetFiles)];
    output.warnings = [...new Set(warnings.map(redactSecrets))];
    output.errors = [...new Set(errors.map(redactSecrets))];
    return output;
  } catch (error) {
    output.status = "failed";
    output.makeFilePath = safeDisplayPath(path.resolve(input.makeFilePath || "."), config);
    output.warnings = [...new Set(warnings.map(redactSecrets))];
    output.errors = [redactSecrets(error instanceof Error ? error.message : String(error))];
    return output;
  }
}
