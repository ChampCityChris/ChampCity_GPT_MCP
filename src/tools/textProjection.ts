import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

import { type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { type AppConfig } from "../config.js";
import { assertReadableTextFile } from "../security/filePolicy.js";
import { resolveProjectPath, toRootRelativePath } from "../security/pathPolicy.js";
import { AppError } from "../utils/errors.js";

export const TEXT_PROJECTION_INLINE_THRESHOLD_BYTES = 16_384;
export const TEXT_PROJECTION_DEFAULT_CHUNK_BYTES = 8_192;
export const TEXT_PROJECTION_HARD_CONTENT_ITEM_BYTES = 16_384;
export const TEXT_PROJECTION_DEFAULT_MAX_LINES = 240;
export const TEXT_PROJECTION_HARD_MAX_LINES = 1_000;
export const TEXT_PROJECTION_MAX_HEADING_TEXT_CHARS = 240;
export const TEXT_PROJECTION_DEFAULT_MAX_HEADINGS = 200;
export const TEXT_PROJECTION_HARD_MAX_HEADINGS = 1_000;
export const TEXT_PROJECTION_MAX_SOURCE_BYTES = 500_000;
export const BOUNDED_TEXT_SERIALIZER = "bounded-text-v1";
export const BOUNDED_MARKDOWN_SECTION_SERIALIZER = "bounded-markdown-section-v1";

type LineEndingClassification = "lf" | "crlf" | "mixed" | "none";
type TruncationReason = "byte_limit" | "line_limit" | "section_complete" | "source_complete" | null;
type TextProjectionCursorMode = "full_text" | "line_range" | "markdown_section" | "artifact_text";
type TextProjectionRetryAction = "read_text_chunk" | "read_text_lines" | "read_markdown_section" | "read_artifact_text_chunk";

export interface TextProjectionSource {
  workspaceId: string;
  root: string;
  relativePath: string;
  resolvedPath: string;
  sizeBytes: number;
  modifiedAt: string;
  sourceSha256: string;
  hasByteOrderMark: boolean;
  lineEnding: LineEndingClassification;
  lineCount: number;
  maximumLineByteLength: number;
  markdownDetected: boolean;
  buffer: Buffer;
  text: string;
  lineStarts: number[];
}

export interface MarkdownHeadingEntry {
  sectionId: string;
  level: number;
  text: string;
  startLine: number;
  endLine: number;
  approximateSectionBytes: number;
}

export interface TextProjectionInspection {
  workspaceId: string;
  relativePath: string;
  sizeBytes: number;
  modifiedAt: string;
  sourceSha256: string;
  encoding: "utf-8";
  hasByteOrderMark: boolean;
  lineEnding: LineEndingClassification;
  lineCount: number;
  maximumLineByteLength: number;
  markdownDetected: boolean;
  headingIndex: MarkdownHeadingEntry[];
  headingIndexTruncated: boolean;
  recommendedChunkBytes: number;
  recommendedFirstAction: "read_text_chunk";
  recommendedFirstCursor: string | null;
  contentOmitted: true;
}

export interface TextProjectionChunk {
  serializer: {
    name: typeof BOUNDED_TEXT_SERIALIZER | typeof BOUNDED_MARKDOWN_SECTION_SERIALIZER;
    version: "1";
  };
  workspaceId: string;
  relativePath: string;
  sourceSha256: string;
  chunkSha256: string;
  range: {
    startLine: number;
    endLine: number;
    startByteOffset: number;
    endByteOffset: number;
  };
  returnedByteCount: number;
  returnedLineCount: number;
  complete: boolean;
  nextCursor: string | null;
  staleSource: boolean;
  truncationReason: TruncationReason;
  retryable: boolean;
  retryAction: TextProjectionRetryAction | null;
  chunkIndex: number;
  priorResultAttemptId?: string;
  section?: {
    sectionId: string;
    startLine: number;
    endLine: number;
  };
  oversizedLine?: {
    lineNumber: number;
    lineByteLength: number;
    exactContinuationAvailable: boolean;
  };
  text: string;
}

interface CursorPayload {
  v: 1;
  mode: TextProjectionCursorMode;
  workspaceId: string;
  relativePath: string;
  sourceSha256: string;
  offset: number;
  hardEndOffset: number;
  chunkIndex: number;
  lineRangeStartLine?: number;
  lineRangeMaximumLines?: number;
  lineRangeStartOffset?: number;
  lineRangeHardEndOffset?: number;
  sectionId?: string;
  artifactId?: string;
  artifactComponent?: "markdown";
  expiresAt: number;
}

export interface TextProjectionCursorBinding {
  mode: TextProjectionCursorMode;
  workspaceId: string;
  relativePath: string;
  sourceSha256: string;
  offset: number;
  hardEndOffset: number;
  chunkIndex: number;
  lineRangeStartLine?: number;
  lineRangeMaximumLines?: number;
  lineRangeStartOffset?: number;
  lineRangeHardEndOffset?: number;
  sectionId?: string;
  artifactId?: string;
  artifactComponent?: "markdown";
}

function sha256Buffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeSlashPath(value: string): string {
  return value.split(/[\\/]+/u).filter(Boolean).join("/") || ".";
}

function cursorKey(config: AppConfig): Buffer {
  return createHash("sha256")
    .update("champcity-text-projection-cursor-v1")
    .update("\0")
    .update(config.repoRoot)
    .update("\0")
    .update(config.auditLogPath)
    .digest();
}

function signCursorPayload(config: AppConfig, encodedPayload: string): string {
  return createHmac("sha256", cursorKey(config)).update(encodedPayload).digest("base64url");
}

function createCursor(config: AppConfig, payload: Omit<CursorPayload, "v" | "expiresAt">): string {
  const fullPayload: CursorPayload = {
    v: 1,
    ...payload,
    expiresAt: Date.now() + 6 * 60 * 60 * 1000
  };
  const encodedPayload = Buffer.from(JSON.stringify(fullPayload), "utf8").toString("base64url");
  return `tp1.${encodedPayload}.${signCursorPayload(config, encodedPayload)}`;
}

function decodeCursor(config: AppConfig, cursor: string): CursorPayload {
  const parts = cursor.split(".");
  if (parts.length !== 3 || parts[0] !== "tp1") {
    throw new AppError("INVALID_INPUT", "Text projection cursor is malformed.", {
      classification: "contract_rejection"
    });
  }

  const expected = signCursorPayload(config, parts[1]);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(parts[2]);
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    throw new AppError("INVALID_INPUT", "Text projection cursor failed integrity validation.", {
      classification: "contract_rejection"
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as unknown;
  } catch {
    throw new AppError("INVALID_INPUT", "Text projection cursor payload is unreadable.", {
      classification: "contract_rejection"
    });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError("INVALID_INPUT", "Text projection cursor payload is invalid.", {
      classification: "contract_rejection"
    });
  }

  const payload = parsed as Partial<CursorPayload>;
  if (
    payload.v !== 1 ||
    !["full_text", "line_range", "markdown_section", "artifact_text"].includes(String(payload.mode)) ||
    typeof payload.workspaceId !== "string" ||
    typeof payload.relativePath !== "string" ||
    !/^[a-f0-9]{64}$/u.test(String(payload.sourceSha256)) ||
    typeof payload.offset !== "number" ||
    !Number.isInteger(payload.offset) ||
    payload.offset < 0 ||
    typeof payload.hardEndOffset !== "number" ||
    !Number.isInteger(payload.hardEndOffset) ||
    payload.hardEndOffset < payload.offset ||
    typeof payload.chunkIndex !== "number" ||
    !Number.isInteger(payload.chunkIndex) ||
    payload.chunkIndex < 0 ||
    typeof payload.expiresAt !== "number"
  ) {
    throw new AppError("INVALID_INPUT", "Text projection cursor payload failed contract validation.", {
      classification: "contract_rejection"
    });
  }

  if (payload.expiresAt < Date.now()) {
    throw new AppError("INVALID_INPUT", "Text projection cursor expired; inspect the source again.", {
      classification: "contract_rejection"
    });
  }

  if (payload.mode === "markdown_section" && typeof payload.sectionId !== "string") {
    throw new AppError("INVALID_INPUT", "Markdown section cursor is missing its section identity.", {
      classification: "contract_rejection"
    });
  }

  if (
    payload.mode === "line_range" &&
    (typeof payload.lineRangeStartLine !== "number" ||
      !Number.isInteger(payload.lineRangeStartLine) ||
      payload.lineRangeStartLine < 1 ||
      typeof payload.lineRangeMaximumLines !== "number" ||
      !Number.isInteger(payload.lineRangeMaximumLines) ||
      payload.lineRangeMaximumLines < 1 ||
      typeof payload.lineRangeStartOffset !== "number" ||
      !Number.isInteger(payload.lineRangeStartOffset) ||
      payload.lineRangeStartOffset < 0 ||
      typeof payload.lineRangeHardEndOffset !== "number" ||
      !Number.isInteger(payload.lineRangeHardEndOffset) ||
      payload.lineRangeHardEndOffset < payload.lineRangeStartOffset ||
      payload.hardEndOffset !== payload.lineRangeHardEndOffset)
  ) {
    throw new AppError("INVALID_INPUT", "Line range cursor is missing its original range identity.", {
      classification: "contract_rejection"
    });
  }

  if (
    payload.mode === "artifact_text" &&
    (typeof payload.artifactId !== "string" || payload.artifactComponent !== "markdown")
  ) {
    throw new AppError("INVALID_INPUT", "Artifact text cursor is missing its artifact identity.", {
      classification: "contract_rejection"
    });
  }

  return payload as CursorPayload;
}

export function readTextProjectionCursorBinding(config: AppConfig, cursor: string): TextProjectionCursorBinding {
  const payload = decodeCursor(config, cursor);
  return {
    mode: payload.mode,
    workspaceId: payload.workspaceId,
    relativePath: payload.relativePath,
    sourceSha256: payload.sourceSha256,
    offset: payload.offset,
    hardEndOffset: payload.hardEndOffset,
    chunkIndex: payload.chunkIndex,
    ...(payload.lineRangeStartLine ? { lineRangeStartLine: payload.lineRangeStartLine } : {}),
    ...(payload.lineRangeMaximumLines ? { lineRangeMaximumLines: payload.lineRangeMaximumLines } : {}),
    ...(payload.lineRangeStartOffset !== undefined ? { lineRangeStartOffset: payload.lineRangeStartOffset } : {}),
    ...(payload.lineRangeHardEndOffset !== undefined ? { lineRangeHardEndOffset: payload.lineRangeHardEndOffset } : {}),
    ...(payload.sectionId ? { sectionId: payload.sectionId } : {}),
    ...(payload.artifactId ? { artifactId: payload.artifactId } : {}),
    ...(payload.artifactComponent ? { artifactComponent: payload.artifactComponent } : {})
  };
}

function validateUtf8(buffer: Buffer, relativePath: string): void {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new AppError("FILE_DENIED", "Text projection requires valid UTF-8 input.", {
      relativePath
    });
  }
}

function classifyLineEndings(buffer: Buffer): LineEndingClassification {
  let lf = 0;
  let crlf = 0;
  let cr = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    const byte = buffer[index];
    if (byte === 13 && buffer[index + 1] === 10) {
      crlf += 1;
      index += 1;
    } else if (byte === 10) {
      lf += 1;
    } else if (byte === 13) {
      cr += 1;
    }
  }
  const present = [lf > 0, crlf > 0, cr > 0].filter(Boolean).length;
  if (present === 0) {
    return "none";
  }
  if (present > 1 || cr > 0) {
    return "mixed";
  }
  return crlf > 0 ? "crlf" : "lf";
}

function computeLineStarts(buffer: Buffer): number[] {
  if (buffer.length === 0) {
    return [];
  }
  const starts = [0];
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] === 13 && buffer[index + 1] === 10) {
      starts.push(index + 2);
      index += 1;
    } else if (buffer[index] === 10 || buffer[index] === 13) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function lineEndOffset(source: TextProjectionSource, zeroBasedLineIndex: number): number {
  return source.lineStarts[zeroBasedLineIndex + 1] ?? source.buffer.length;
}

function maximumLineByteLength(source: Pick<TextProjectionSource, "buffer" | "lineStarts">): number {
  let max = 0;
  for (let index = 0; index < source.lineStarts.length; index += 1) {
    const end = source.lineStarts[index + 1] ?? source.buffer.length;
    max = Math.max(max, end - source.lineStarts[index]);
  }
  return max;
}

function lineNumberForOffset(source: TextProjectionSource, offset: number): number {
  if (source.lineStarts.length === 0) {
    return 0;
  }
  let low = 0;
  let high = source.lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (source.lineStarts[mid] <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return Math.max(1, high + 1);
}

function endLineNumberForRange(source: TextProjectionSource, startOffset: number, endOffset: number): number {
  if (endOffset <= startOffset) {
    return lineNumberForOffset(source, startOffset);
  }
  return lineNumberForOffset(source, endOffset - 1);
}

function safeUtf8Boundary(buffer: Buffer, requestedEnd: number): number {
  let end = Math.min(Math.max(requestedEnd, 0), buffer.length);
  while (end > 0 && (buffer[end] & 0b1100_0000) === 0b1000_0000) {
    end -= 1;
  }
  if (end > 0 && buffer[end - 1] === 13 && buffer[end] === 10) {
    end -= 1;
  }
  return end;
}

function boundedPositive(value: number | undefined, fallback: number, hardCap: number): number {
  if (value === undefined) {
    return fallback;
  }
  return Math.min(Math.max(1, Math.floor(value)), hardCap);
}

export async function loadTextProjectionSource(
  config: AppConfig,
  input: { workspaceId: string; root: string; relativePath: string; maxBytes?: number }
): Promise<TextProjectionSource> {
  const resolved = resolveProjectPath(input.root, input.relativePath, config.allowedRoots);
  const relativePath = normalizeSlashPath(toRootRelativePath(resolved.rootRealPath, resolved.resolvedPath));
  const maxBytes = Math.min(input.maxBytes ?? TEXT_PROJECTION_MAX_SOURCE_BYTES, TEXT_PROJECTION_MAX_SOURCE_BYTES);
  const stats = assertReadableTextFile(resolved.resolvedPath, relativePath, maxBytes);
  const buffer = await fsp.readFile(resolved.resolvedPath);
  validateUtf8(buffer, relativePath);
  const lineStarts = computeLineStarts(buffer);
  const text = buffer.toString("utf8");
  const markdownDetected = path.extname(relativePath).toLowerCase() === ".md";

  return {
    workspaceId: input.workspaceId,
    root: resolved.rootRealPath,
    relativePath,
    resolvedPath: resolved.resolvedPath,
    sizeBytes: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    sourceSha256: sha256Buffer(buffer),
    hasByteOrderMark: buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf,
    lineEnding: classifyLineEndings(buffer),
    lineCount: lineStarts.length,
    maximumLineByteLength: maximumLineByteLength({ buffer, lineStarts }),
    markdownDetected,
    buffer,
    text,
    lineStarts
  };
}

function lineTextWithoutEnding(source: TextProjectionSource, zeroBasedLineIndex: number): string {
  const start = source.lineStarts[zeroBasedLineIndex];
  let end = lineEndOffset(source, zeroBasedLineIndex);
  if (end > start && source.buffer[end - 1] === 10) {
    end -= 1;
  }
  if (end > start && source.buffer[end - 1] === 13) {
    end -= 1;
  }
  return source.buffer.subarray(start, end).toString("utf8");
}

export function getMarkdownHeadingIndex(source: TextProjectionSource, maximumHeadings = TEXT_PROJECTION_DEFAULT_MAX_HEADINGS): MarkdownHeadingEntry[] {
  if (!source.markdownDetected) {
    return [];
  }
  const headings: Array<Omit<MarkdownHeadingEntry, "endLine" | "approximateSectionBytes"> & { startByteOffset: number }> = [];
  for (let index = 0; index < source.lineStarts.length; index += 1) {
    const line = lineTextWithoutEnding(source, index);
    const match = /^(#{1,6})[ \t]+(.+?)\s*#*\s*$/u.exec(line);
    if (!match) {
      continue;
    }
    const level = match[1].length;
    const startLine = index + 1;
    const startByteOffset = source.lineStarts[index];
    headings.push({
      sectionId: `sec-${source.sourceSha256.slice(0, 16)}-${startLine}-${startByteOffset}-${level}`,
      level,
      text: match[2].trim().slice(0, TEXT_PROJECTION_MAX_HEADING_TEXT_CHARS),
      startLine,
      startByteOffset
    });
  }

  return headings.slice(0, maximumHeadings).map((heading, index) => {
    const nextPeer = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level);
    const endLine = nextPeer ? nextPeer.startLine - 1 : Math.max(source.lineCount, heading.startLine);
    const endOffset = nextPeer ? source.lineStarts[nextPeer.startLine - 1] : source.buffer.length;
    return {
      sectionId: heading.sectionId,
      level: heading.level,
      text: heading.text,
      startLine: heading.startLine,
      endLine,
      approximateSectionBytes: Math.max(0, endOffset - heading.startByteOffset)
    };
  });
}

export function inspectTextProjectionSource(
  config: AppConfig,
  source: TextProjectionSource,
  options: { includeHeadingIndex?: boolean; maximumHeadings?: number } = {}
): TextProjectionInspection {
  const maximumHeadings = boundedPositive(options.maximumHeadings, TEXT_PROJECTION_DEFAULT_MAX_HEADINGS, TEXT_PROJECTION_HARD_MAX_HEADINGS);
  const includeHeadingIndex = options.includeHeadingIndex ?? source.markdownDetected;
  const allHeadings = includeHeadingIndex ? getMarkdownHeadingIndex(source, TEXT_PROJECTION_HARD_MAX_HEADINGS) : [];
  const headingIndex = allHeadings.slice(0, maximumHeadings);
  const recommendedFirstCursor = source.sizeBytes > 0
    ? createCursor(config, {
        mode: "full_text",
        workspaceId: source.workspaceId,
        relativePath: source.relativePath,
        sourceSha256: source.sourceSha256,
        offset: 0,
        hardEndOffset: source.buffer.length,
        chunkIndex: 0
      })
    : null;

  return {
    workspaceId: source.workspaceId,
    relativePath: source.relativePath,
    sizeBytes: source.sizeBytes,
    modifiedAt: source.modifiedAt,
    sourceSha256: source.sourceSha256,
    encoding: "utf-8",
    hasByteOrderMark: source.hasByteOrderMark,
    lineEnding: source.lineEnding,
    lineCount: source.lineCount,
    maximumLineByteLength: source.maximumLineByteLength,
    markdownDetected: source.markdownDetected,
    headingIndex,
    headingIndexTruncated: allHeadings.length > headingIndex.length,
    recommendedChunkBytes: TEXT_PROJECTION_DEFAULT_CHUNK_BYTES,
    recommendedFirstAction: "read_text_chunk",
    recommendedFirstCursor,
    contentOmitted: true
  };
}

function selectBoundedRange(
  source: TextProjectionSource,
  startOffset: number,
  hardEndOffset: number,
  maximumBytes: number,
  maximumLines: number
): { endOffset: number; truncationReason: TruncationReason; oversizedLine?: TextProjectionChunk["oversizedLine"] } {
  if (startOffset >= hardEndOffset) {
    return { endOffset: hardEndOffset, truncationReason: "source_complete" };
  }

  const startLine = lineNumberForOffset(source, startOffset);
  const startIndex = Math.max(0, startLine - 1);
  let endOffset = startOffset;
  let lines = 0;
  let truncationReason: TruncationReason = null;

  for (let index = startIndex; index < source.lineStarts.length && lines < maximumLines; index += 1) {
    const lineStart = Math.max(source.lineStarts[index], startOffset);
    const lineEnd = Math.min(lineEndOffset(source, index), hardEndOffset);
    if (lineStart >= hardEndOffset) {
      break;
    }

    if (lineEnd - startOffset > maximumBytes) {
      truncationReason = "byte_limit";
      if (endOffset === startOffset) {
        const safeEnd = safeUtf8Boundary(source.buffer, startOffset + maximumBytes);
        const boundedEnd = Math.max(startOffset + 1, Math.min(safeEnd, hardEndOffset));
        return {
          endOffset: boundedEnd,
          truncationReason,
          oversizedLine: {
            lineNumber: index + 1,
            lineByteLength: lineEnd - lineStart,
            exactContinuationAvailable: true
          }
        };
      }
      break;
    }

    endOffset = lineEnd;
    lines += 1;
  }

  if (endOffset === startOffset) {
    const safeEnd = safeUtf8Boundary(source.buffer, Math.min(startOffset + maximumBytes, hardEndOffset));
    endOffset = Math.max(startOffset, safeEnd);
    truncationReason = endOffset < hardEndOffset ? "byte_limit" : null;
  } else if (lines >= maximumLines && endOffset < hardEndOffset) {
    truncationReason = "line_limit";
  } else if (endOffset < hardEndOffset && truncationReason === null) {
    truncationReason = "byte_limit";
  }

  return { endOffset, truncationReason };
}

function chunkFromRange(
  config: AppConfig,
  source: TextProjectionSource,
  range: {
    startOffset: number;
    hardEndOffset?: number;
    mode: TextProjectionCursorMode;
    sectionId?: string;
    sectionStartLine?: number;
    sectionEndLine?: number;
    artifactId?: string;
    artifactComponent?: "markdown";
    lineRangeStartLine?: number;
    lineRangeMaximumLines?: number;
    lineRangeStartOffset?: number;
    lineRangeHardEndOffset?: number;
  },
  options: {
    maximumBytes?: number;
    maximumLines?: number;
    chunkIndex?: number;
    priorResultAttemptId?: string;
    retryAction?: TextProjectionRetryAction;
    serializer?: typeof BOUNDED_TEXT_SERIALIZER | typeof BOUNDED_MARKDOWN_SECTION_SERIALIZER;
  }
): TextProjectionChunk {
  const maximumBytes = Math.max(4, boundedPositive(options.maximumBytes, TEXT_PROJECTION_DEFAULT_CHUNK_BYTES, TEXT_PROJECTION_HARD_CONTENT_ITEM_BYTES));
  const maximumLines = boundedPositive(options.maximumLines, TEXT_PROJECTION_DEFAULT_MAX_LINES, TEXT_PROJECTION_HARD_MAX_LINES);
  const hardEndOffset = range.hardEndOffset ?? source.buffer.length;
  const selected = selectBoundedRange(source, range.startOffset, hardEndOffset, maximumBytes, maximumLines);
  const textBuffer = source.buffer.subarray(range.startOffset, selected.endOffset);
  const text = textBuffer.toString("utf8");
  const complete = selected.endOffset >= hardEndOffset;
  const retryAction = complete ? null : options.retryAction ?? "read_text_chunk";
  const chunkIndex = options.chunkIndex ?? 0;
  const nextCursor = complete
    ? null
    : createCursor(config, {
        mode: range.mode,
        workspaceId: source.workspaceId,
        relativePath: source.relativePath,
        sourceSha256: source.sourceSha256,
        offset: selected.endOffset,
        hardEndOffset,
        chunkIndex: chunkIndex + 1,
        ...(range.lineRangeStartLine !== undefined ? { lineRangeStartLine: range.lineRangeStartLine } : {}),
        ...(range.lineRangeMaximumLines !== undefined ? { lineRangeMaximumLines: range.lineRangeMaximumLines } : {}),
        ...(range.lineRangeStartOffset !== undefined ? { lineRangeStartOffset: range.lineRangeStartOffset } : {}),
        ...(range.lineRangeHardEndOffset !== undefined ? { lineRangeHardEndOffset: range.lineRangeHardEndOffset } : {}),
        ...(range.sectionId ? { sectionId: range.sectionId } : {}),
        ...(range.artifactId ? { artifactId: range.artifactId } : {}),
        ...(range.artifactComponent ? { artifactComponent: range.artifactComponent } : {})
      });
  const startLine = lineNumberForOffset(source, range.startOffset);
  const endLine = endLineNumberForRange(source, range.startOffset, selected.endOffset);

  return {
    serializer: {
      name: options.serializer ?? BOUNDED_TEXT_SERIALIZER,
      version: "1"
    },
    workspaceId: source.workspaceId,
    relativePath: source.relativePath,
    sourceSha256: source.sourceSha256,
    chunkSha256: sha256Buffer(textBuffer),
    range: {
      startLine,
      endLine,
      startByteOffset: range.startOffset,
      endByteOffset: selected.endOffset
    },
    returnedByteCount: textBuffer.length,
    returnedLineCount: textBuffer.length > 0 ? endLine - startLine + 1 : 0,
    complete,
    nextCursor,
    staleSource: false,
    truncationReason: complete ? (range.sectionId ? "section_complete" : "source_complete") : selected.truncationReason,
    retryable: Boolean(nextCursor),
    retryAction,
    chunkIndex,
    ...(options.priorResultAttemptId ? { priorResultAttemptId: options.priorResultAttemptId } : {}),
    ...(range.sectionId && range.sectionStartLine && range.sectionEndLine
      ? { section: { sectionId: range.sectionId, startLine: range.sectionStartLine, endLine: range.sectionEndLine } }
      : {}),
    ...(selected.oversizedLine ? { oversizedLine: selected.oversizedLine } : {}),
    text
  };
}

function assertExpectedSource(source: TextProjectionSource, expectedSourceSha256: string | undefined): boolean {
  return Boolean(expectedSourceSha256 && expectedSourceSha256 !== source.sourceSha256);
}

function assertCursorMode(cursorPayload: CursorPayload | undefined, expectedMode: TextProjectionCursorMode, action: string): void {
  if (cursorPayload && cursorPayload.mode !== expectedMode) {
    throw new AppError("INVALID_INPUT", `Text projection cursor cannot be used with ${action}.`, {
      classification: "contract_rejection",
      cursorMode: cursorPayload.mode,
      expectedMode
    });
  }
}

function assertCursorSourceMatchesRequest(cursorPayload: CursorPayload | undefined, source: TextProjectionSource, message: string): void {
  if (!cursorPayload) {
    return;
  }
  if (cursorPayload.relativePath !== source.relativePath) {
    throw new AppError("INVALID_INPUT", message, {
      classification: "contract_rejection",
      cursorRelativePath: cursorPayload.relativePath,
      requestRelativePath: source.relativePath
    });
  }
  if (cursorPayload.sourceSha256 !== source.sourceSha256) {
    throw new AppError("INVALID_INPUT", "Text projection cursor is stale; inspect the source again.", {
      classification: "contract_rejection",
      staleSource: true,
      retryAction: "inspect_text_file"
    });
  }
  if (cursorPayload.hardEndOffset > source.buffer.length || cursorPayload.offset > cursorPayload.hardEndOffset) {
    throw new AppError("INVALID_INPUT", "Text projection cursor range is outside the current source.", {
      classification: "contract_rejection",
      staleSource: true,
      retryAction: "inspect_text_file"
    });
  }
}

export async function readTextChunk(
  config: AppConfig,
  input: {
    workspaceId: string;
    root: string;
    relativePath?: string;
    cursor?: string;
    maximumBytes?: number;
    maximumLines?: number;
    expectedSourceSha256?: string;
    priorResultAttemptId?: string;
    maxBytes?: number;
    operationMode?: "full_text" | "artifact_text";
    artifactId?: string;
    artifactComponent?: "markdown";
  }
): Promise<TextProjectionChunk> {
  const cursorPayload = input.cursor ? decodeCursor(config, input.cursor) : undefined;
  const expectedMode = input.operationMode ?? "full_text";
  const action = expectedMode === "artifact_text" ? "read_artifact_text_chunk" : "read_text_chunk";
  assertCursorMode(cursorPayload, expectedMode, action);
  if (cursorPayload && input.artifactId && cursorPayload.artifactId !== input.artifactId) {
    throw new AppError("INVALID_INPUT", "Artifact text cursor artifactId conflicts with the request.", {
      classification: "contract_rejection",
      cursorArtifactId: cursorPayload.artifactId,
      requestArtifactId: input.artifactId
    });
  }
  if (cursorPayload && input.artifactComponent && cursorPayload.artifactComponent !== input.artifactComponent) {
    throw new AppError("INVALID_INPUT", "Artifact text cursor component conflicts with the request.", {
      classification: "contract_rejection",
      cursorArtifactComponent: cursorPayload.artifactComponent,
      requestArtifactComponent: input.artifactComponent
    });
  }
  if (expectedMode === "artifact_text" && !input.artifactId && !cursorPayload?.artifactId) {
    throw new AppError("INVALID_INPUT", "artifactId is required for artifact text cursors.", {
      classification: "contract_rejection"
    });
  }
  const relativePath = input.relativePath ?? cursorPayload?.relativePath;
  if (!relativePath) {
    throw new AppError("INVALID_INPUT", "relativePath is required for the first text chunk read.", {
      requiredParameters: ["relativePath"]
    });
  }
  if (cursorPayload && cursorPayload.workspaceId !== input.workspaceId) {
    throw new AppError("INVALID_INPUT", "Text projection cursor workspace does not match the request.", {
      classification: "contract_rejection"
    });
  }
  const source = await loadTextProjectionSource(config, {
    workspaceId: input.workspaceId,
    root: input.root,
    relativePath,
    maxBytes: input.maxBytes
  });
  assertCursorSourceMatchesRequest(cursorPayload, source, "Text projection cursor relativePath conflicts with the request.");
  const staleSource = assertExpectedSource(source, input.expectedSourceSha256);
  const artifactId = input.artifactId ?? cursorPayload?.artifactId;
  const artifactComponent = input.artifactComponent ?? cursorPayload?.artifactComponent;
  const chunk = chunkFromRange(
    config,
    source,
    {
      startOffset: cursorPayload?.offset ?? 0,
      hardEndOffset: cursorPayload?.hardEndOffset ?? source.buffer.length,
      mode: expectedMode,
      ...(artifactId ? { artifactId } : {}),
      ...(artifactComponent ? { artifactComponent } : {})
    },
    {
      maximumBytes: input.maximumBytes,
      maximumLines: input.maximumLines,
      chunkIndex: cursorPayload?.chunkIndex ?? 0,
      priorResultAttemptId: input.priorResultAttemptId,
      retryAction: expectedMode === "artifact_text" ? "read_artifact_text_chunk" : "read_text_chunk"
    }
  );
  return { ...chunk, staleSource };
}

export async function readTextLines(
  config: AppConfig,
  input: {
    workspaceId: string;
    root: string;
    relativePath?: string;
    startLine?: number;
    maximumLines?: number;
    cursor?: string;
    maximumBytes?: number;
    expectedSourceSha256?: string;
    priorResultAttemptId?: string;
    maxBytes?: number;
  }
): Promise<TextProjectionChunk> {
  const cursorPayload = input.cursor ? decodeCursor(config, input.cursor) : undefined;
  assertCursorMode(cursorPayload, "line_range", "read_text_lines");
  if (cursorPayload && cursorPayload.workspaceId !== input.workspaceId) {
    throw new AppError("INVALID_INPUT", "Line range cursor workspace does not match the request.", {
      classification: "contract_rejection"
    });
  }
  const relativePath = input.relativePath ?? cursorPayload?.relativePath;
  if (!relativePath) {
    throw new AppError("INVALID_INPUT", "relativePath is required for the first line range read.", {
      requiredParameters: ["relativePath"]
    });
  }
  const source = await loadTextProjectionSource(config, {
    workspaceId: input.workspaceId,
    root: input.root,
    relativePath,
    maxBytes: input.maxBytes
  });
  assertCursorSourceMatchesRequest(cursorPayload, source, "Line range cursor relativePath conflicts with the request.");

  if (!cursorPayload && (!Number.isInteger(input.startLine) || (input.startLine ?? 0) < 1 || (input.startLine ?? 0) > source.lineCount)) {
    throw new AppError("INVALID_INPUT", "startLine is outside the source line range.", {
      lineCount: source.lineCount
    });
  }
  if (!cursorPayload && (!Number.isInteger(input.maximumLines) || (input.maximumLines ?? 0) < 1)) {
    throw new AppError("INVALID_INPUT", "maximumLines must be a positive integer.");
  }

  const requestedStartLine = input.startLine ?? 1;
  const requestedMaximumLines = input.maximumLines ?? TEXT_PROJECTION_DEFAULT_MAX_LINES;
  const startIndex = requestedStartLine - 1;
  const requestedEndIndex = Math.min(source.lineStarts.length, startIndex + requestedMaximumLines);
  const requestedStartOffset = source.lineStarts[startIndex] ?? source.buffer.length;
  const requestedHardEndOffset = requestedEndIndex < source.lineStarts.length ? source.lineStarts[requestedEndIndex] : source.buffer.length;
  if (cursorPayload && input.startLine !== undefined && input.startLine !== cursorPayload.lineRangeStartLine) {
    throw new AppError("INVALID_INPUT", "Line range cursor startLine conflicts with the request.", {
      classification: "contract_rejection",
      cursorStartLine: cursorPayload.lineRangeStartLine,
      requestStartLine: input.startLine
    });
  }
  if (cursorPayload && input.maximumLines !== undefined && input.maximumLines !== cursorPayload.lineRangeMaximumLines) {
    throw new AppError("INVALID_INPUT", "Line range cursor maximumLines conflicts with the original requested range.", {
      classification: "contract_rejection",
      cursorMaximumLines: cursorPayload.lineRangeMaximumLines,
      requestMaximumLines: input.maximumLines
    });
  }
  const startOffset = cursorPayload?.offset ?? requestedStartOffset;
  const hardEndOffset = cursorPayload?.hardEndOffset ?? requestedHardEndOffset;
  const lineRangeStartLine = cursorPayload?.lineRangeStartLine ?? requestedStartLine;
  const lineRangeMaximumLines = cursorPayload?.lineRangeMaximumLines ?? requestedMaximumLines;
  const lineRangeStartOffset = cursorPayload?.lineRangeStartOffset ?? requestedStartOffset;
  const lineRangeHardEndOffset = cursorPayload?.lineRangeHardEndOffset ?? requestedHardEndOffset;
  const chunk = chunkFromRange(
    config,
    source,
    {
      startOffset,
      hardEndOffset,
      mode: "line_range",
      lineRangeStartLine,
      lineRangeMaximumLines,
      lineRangeStartOffset,
      lineRangeHardEndOffset
    },
    {
      maximumBytes: input.maximumBytes,
      maximumLines: input.maximumLines,
      priorResultAttemptId: input.priorResultAttemptId,
      chunkIndex: cursorPayload?.chunkIndex ?? 0,
      retryAction: "read_text_lines"
    }
  );
  return { ...chunk, staleSource: assertExpectedSource(source, input.expectedSourceSha256) };
}

export async function readMarkdownSection(
  config: AppConfig,
  input: {
    workspaceId: string;
    root: string;
    relativePath?: string;
    sectionId?: string;
    cursor?: string;
    maximumBytes?: number;
    maximumLines?: number;
    expectedSourceSha256?: string;
    priorResultAttemptId?: string;
    maxBytes?: number;
  }
): Promise<TextProjectionChunk> {
  const cursorPayload = input.cursor ? decodeCursor(config, input.cursor) : undefined;
  assertCursorMode(cursorPayload, "markdown_section", "read_markdown_section");
  if (cursorPayload && cursorPayload.workspaceId !== input.workspaceId) {
    throw new AppError("INVALID_INPUT", "Markdown section cursor workspace does not match the request.", {
      classification: "contract_rejection"
    });
  }
  const relativePath = input.relativePath ?? cursorPayload?.relativePath;
  if (!relativePath) {
    throw new AppError("INVALID_INPUT", "relativePath is required for markdown section reads.", {
      requiredParameters: ["relativePath"]
    });
  }
  const source = await loadTextProjectionSource(config, {
    workspaceId: input.workspaceId,
    root: input.root,
    relativePath,
    maxBytes: input.maxBytes
  });
  if (!source.markdownDetected) {
    throw new AppError("INVALID_INPUT", "read_markdown_section only supports Markdown sources.");
  }
  assertCursorSourceMatchesRequest(cursorPayload, source, "Markdown section cursor relativePath conflicts with the request.");
  if (cursorPayload && input.sectionId && cursorPayload.sectionId !== input.sectionId) {
    throw new AppError("INVALID_INPUT", "Markdown section cursor sectionId conflicts with the request.", {
      classification: "contract_rejection",
      cursorSectionId: cursorPayload.sectionId,
      requestSectionId: input.sectionId
    });
  }

  const sectionId = cursorPayload?.sectionId ?? input.sectionId;
  if (!sectionId) {
    throw new AppError("INVALID_INPUT", "sectionId is required for markdown section reads.");
  }

  const heading = getMarkdownHeadingIndex(source, TEXT_PROJECTION_HARD_MAX_HEADINGS).find((entry) => entry.sectionId === sectionId);
  if (!heading) {
    throw new AppError("INVALID_INPUT", "Unknown or stale sectionId; inspect the source again.", {
      sectionId,
      retryAction: "inspect_text_file"
    });
  }

  const startOffset = cursorPayload?.offset ?? source.lineStarts[heading.startLine - 1];
  const hardEndOffset = cursorPayload?.hardEndOffset ?? (heading.endLine < source.lineStarts.length ? source.lineStarts[heading.endLine] : source.buffer.length);
  const chunk = chunkFromRange(
    config,
    source,
    {
      startOffset,
      hardEndOffset,
      mode: "markdown_section",
      sectionId,
      sectionStartLine: heading.startLine,
      sectionEndLine: heading.endLine
    },
    {
      maximumBytes: input.maximumBytes,
      maximumLines: input.maximumLines,
      chunkIndex: cursorPayload?.chunkIndex ?? 0,
      priorResultAttemptId: input.priorResultAttemptId,
      retryAction: "read_markdown_section",
      serializer: BOUNDED_MARKDOWN_SECTION_SERIALIZER
    }
  );
  return { ...chunk, staleSource: assertExpectedSource(source, input.expectedSourceSha256) };
}

export function inlineTextReadResult(source: TextProjectionSource): {
  relativePath: string;
  sizeBytes: number;
  modifiedAt: string;
  sha256: string;
  sourceSha256: string;
  content: string;
  contentComplete: true;
  inlineThresholdBytes: number;
} {
  return {
    relativePath: source.relativePath,
    sizeBytes: source.sizeBytes,
    modifiedAt: source.modifiedAt,
    sha256: source.sourceSha256,
    sourceSha256: source.sourceSha256,
    content: source.text,
    contentComplete: true,
    inlineThresholdBytes: TEXT_PROJECTION_INLINE_THRESHOLD_BYTES
  };
}

export function metadataWithoutText(chunk: TextProjectionChunk): Omit<TextProjectionChunk, "text"> {
  const { text: _text, ...metadata } = chunk;
  return metadata;
}

export function boundedTextContentItems(chunk: TextProjectionChunk): CallToolResult["content"] {
  const label = chunk.serializer.name === BOUNDED_MARKDOWN_SECTION_SERIALIZER ? "Markdown section chunk" : "Text chunk";
  return [
    {
      type: "text",
      text: `${label}: ${chunk.relativePath} lines ${chunk.range.startLine}-${chunk.range.endLine}, bytes ${chunk.range.startByteOffset}-${chunk.range.endByteOffset}, sha256 ${chunk.chunkSha256}.`
    },
    {
      type: "text",
      text: chunk.text
    }
  ];
}

export function boundedTextStructuredContent(chunk: TextProjectionChunk): Record<string, unknown> {
  return {
    ...metadataWithoutText(chunk),
    contentOmittedFromStructuredContent: true,
    fullTextDuplicatedInStructuredContent: false
  };
}

export function readSmallFileSyncForCompatibility(root: string, relativePath: string, config: AppConfig, maxBytes: number): TextProjectionSource {
  const resolved = resolveProjectPath(root, relativePath, config.allowedRoots);
  const normalized = normalizeSlashPath(toRootRelativePath(resolved.rootRealPath, resolved.resolvedPath));
  const stats = assertReadableTextFile(resolved.resolvedPath, normalized, maxBytes);
  const buffer = fs.readFileSync(resolved.resolvedPath);
  validateUtf8(buffer, normalized);
  const lineStarts = computeLineStarts(buffer);
  return {
    workspaceId: "default",
    root: resolved.rootRealPath,
    relativePath: normalized,
    resolvedPath: resolved.resolvedPath,
    sizeBytes: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    sourceSha256: sha256Buffer(buffer),
    hasByteOrderMark: buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf,
    lineEnding: classifyLineEndings(buffer),
    lineCount: lineStarts.length,
    maximumLineByteLength: maximumLineByteLength({ buffer, lineStarts }),
    markdownDetected: path.extname(normalized).toLowerCase() === ".md",
    buffer,
    text: buffer.toString("utf8"),
    lineStarts
  };
}

export function projectionIntegritySummary(text: string): { byteCount: number; sha256: string } {
  return {
    byteCount: Buffer.byteLength(text, "utf8"),
    sha256: sha256Text(text)
  };
}
