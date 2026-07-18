import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { type AppConfig } from "../config.js";
import { getFilePolicyDenial, isLikelyTextBuffer } from "../security/filePolicy.js";
import { assertSafeRelativePath, isPathInside, toRootRelativePath } from "../security/pathPolicy.js";
import { AppError } from "../utils/errors.js";
import { resolveWorkspace } from "../workspaces.js";
import { resolveRepoPath, walkRepoFiles } from "./repoTraversal.js";

const MAX_SCAN_FILES = 3000;
const MAX_SCAN_DEPTH = 12;
const MAX_METADATA_BYTES = 1_000_000;
const MAX_MARKDOWN_CONTENT_BYTES = 250_000;
const MAX_JSON_CONTENT_BYTES = 500_000;
const MARKDOWN_TRUNCATE_BYTES = 200_000;
const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const FILTER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const EXCLUDED_DIRS = new Set([
  ".git",
  ".vscode",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "release",
  "generated",
  "logs"
]);
const ROOT_SCAN_DIRS = ["planning", "docs", "artifacts", "evidence", "reports", "validation", ".champcity"];
const REGISTRY_PATHS = [
  ".champcity/artifact-registry.json",
  "planning/artifact-registry.json",
  "planning/artifacts/artifact-registry.json"
];
const CURRENT_ACTION_PATHS = [
  ".champcity/current-action.json",
  "planning/current-action.json",
  "planning/workflow/current-action.json"
];
const AWAITING_ARCHITECT_REVIEW = new Set([
  "awaiting_architect_review",
  "pending_architect_review",
  "submitted_for_architect_review",
  "architect_review_required"
]);

type MetadataSource = "registry" | "json_sidecar" | "structured_header" | "derived_path";
type IdSource = "registry" | "sidecar" | "structured_metadata" | "derived";
type ArtifactRecordKind = "source" | "sidecar" | "derived";

export interface ArtifactCatalogRecord {
  artifactId: string;
  pairId?: string;
  idSource: IdSource;
  workspaceId: string;
  phaseId?: string;
  artifactType: string;
  workCardId?: string;
  title?: string;
  status?: string;
  reviewStatus?: string;
  submittedAt?: string;
  markdownPath?: string;
  jsonPath?: string;
  registryId?: string;
  registryPath?: string;
  registryEntry?: Record<string, unknown>;
  revision?: string | number;
  modifiedAt: string;
  markdownSha256?: string;
  jsonSha256?: string;
  payloadHash?: string;
  sourceBundleId?: string;
  currentActionId?: string;
  metadataSource: MetadataSource;
  warnings: string[];
}

export interface ArtifactFilters {
  phaseId?: string;
  artifactType?: string;
  artifactTypes?: string[];
  workCardId?: string;
  status?: string;
  statuses?: string[];
  pathPrefix?: string;
  recordKind?: ArtifactRecordKind;
  includeDerived?: boolean;
  includeSidecars?: boolean;
  sourceOnly?: boolean;
}

export interface ListArtifactsInput extends ArtifactFilters {
  workspaceId: string;
  limit?: number;
  cursor?: string;
}

export interface ReadArtifactInput {
  workspaceId: string;
  artifactId: string;
  component?: "preferred" | "markdown" | "json" | "both";
}

export interface LatestArtifactInput extends ArtifactFilters {
  workspaceId: string;
  includeContent?: boolean;
}

export interface ArtifactPairStatusInput {
  workspaceId: string;
  artifactId: string;
}

export interface CurrentActionContextInput {
  workspaceId: string;
  phaseId?: string;
}

export interface ReviewQueueInput extends ArtifactFilters {
  workspaceId: string;
  limit?: number;
  cursor?: string;
}

export interface ExportPlanningCorpusInput {
  workspaceId: string;
  pathPrefix?: string;
  includeFullText?: boolean;
  includeDerived?: boolean;
  includeSidecars?: boolean;
  artifactTypes?: string[];
  statuses?: string[];
  cursor?: string;
  limit?: number;
  maxBundleBytes?: number;
}

interface Catalog {
  workspaceId: string;
  root: string;
  records: ArtifactCatalogRecord[];
  registryConfigured: boolean;
  registryPaths: string[];
  warnings: string[];
}

interface PartialRecord {
  artifactId?: string;
  pairId?: string;
  idSource?: IdSource;
  workspaceId: string;
  phaseId?: string;
  artifactType?: string;
  workCardId?: string;
  title?: string;
  status?: string;
  reviewStatus?: string;
  submittedAt?: string;
  markdownPath?: string;
  jsonPath?: string;
  registryId?: string;
  registryPath?: string;
  registryEntry?: Record<string, unknown>;
  revision?: string | number;
  modifiedAt?: string;
  markdownSha256?: string;
  jsonSha256?: string;
  payloadHash?: string;
  sourceBundleId?: string;
  currentActionId?: string;
  metadataSource: MetadataSource;
  warnings: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function scalarValue(value: unknown): string | number | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeSlashPath(value: string): string {
  return value.split(/[\\/]+/u).filter(Boolean).join("/");
}

function deterministicId(workspaceId: string, identity: string): string {
  const digest = createHash("sha256").update(`${workspaceId}:${normalizeSlashPath(identity)}`).digest("hex");
  return `derived-${digest.slice(0, 20)}`;
}

function validateArtifactId(artifactId: string): void {
  if (!ARTIFACT_ID_PATTERN.test(artifactId)) {
    throw new AppError("INVALID_INPUT", "artifactId must be a stable artifact identifier, not a path.");
  }
}

export function validateArtifactFilter(value: string | undefined, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value.trim() || !FILTER_ID_PATTERN.test(value)) {
    throw new AppError("INVALID_INPUT", `${label} must be a non-empty structured identifier.`);
  }
  return value.trim();
}

function metadataString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const direct = stringValue(source[key]);
    if (direct) {
      return direct;
    }
  }

  const metadata = isObject(source.metadata) ? source.metadata : undefined;
  if (metadata) {
    for (const key of keys) {
      const nested = stringValue(metadata[key]);
      if (nested) {
        return nested;
      }
    }
  }

  return undefined;
}

function metadataScalar(source: Record<string, unknown>, keys: string[]): string | number | undefined {
  for (const key of keys) {
    const direct = scalarValue(source[key]);
    if (direct !== undefined) {
      return direct;
    }
  }

  const metadata = isObject(source.metadata) ? source.metadata : undefined;
  if (metadata) {
    for (const key of keys) {
      const nested = scalarValue(metadata[key]);
      if (nested !== undefined) {
        return nested;
      }
    }
  }

  return undefined;
}

function nestedPath(source: Record<string, unknown>, component: "markdown" | "json"): string | undefined {
  const direct = metadataString(source, component === "markdown" ? ["markdownPath", "markdownFile"] : ["jsonPath", "jsonFile"]);
  if (direct) {
    return direct;
  }

  const paths = isObject(source.paths) ? source.paths : undefined;
  const nested = paths ? stringValue(paths[component]) : undefined;
  if (nested) {
    return nested;
  }

  const componentObject = isObject(source[component]) ? source[component] as Record<string, unknown> : undefined;
  return componentObject ? stringValue(componentObject.path) : undefined;
}

function hashFromMetadata(source: Record<string, unknown>, component: "markdown" | "json"): string | undefined {
  const key = component === "markdown" ? "markdownSha256" : "jsonSha256";
  const direct = metadataString(source, [key]);
  if (direct) {
    return direct;
  }

  const hashes = isObject(source.hashes) ? source.hashes : undefined;
  const nested = hashes ? stringValue(hashes[key]) ?? stringValue(hashes[component]) : undefined;
  if (nested) {
    return nested.replace(/^sha256:/iu, "");
  }

  const componentObject = isObject(source[component]) ? source[component] as Record<string, unknown> : undefined;
  return componentObject ? stringValue(componentObject.sha256)?.replace(/^sha256:/iu, "") : undefined;
}

function pathFromMetadata(root: string, relativePath: string, warnings: string[]): string | undefined {
  let safePath: string;
  try {
    safePath = assertSafeRelativePath(relativePath);
  } catch {
    warnings.push(`Rejected unsafe artifact metadata path: ${relativePath}`);
    return undefined;
  }

  const absolutePath = path.join(root, ...normalizeSlashPath(safePath).split("/"));
  try {
    const realPath = fsSync.existsSync(absolutePath) ? fsSync.realpathSync.native(absolutePath) : path.resolve(absolutePath);
    const rootRealPath = fsSync.realpathSync.native(root);
    if (!isPathInside(realPath, rootRealPath)) {
      warnings.push(`Rejected artifact metadata path outside workspace: ${relativePath}`);
      return undefined;
    }
  } catch {
    const resolved = path.resolve(absolutePath);
    if (!isPathInside(resolved, path.resolve(root))) {
      warnings.push(`Rejected artifact metadata path outside workspace: ${relativePath}`);
      return undefined;
    }
  }

  return normalizeSlashPath(safePath);
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function statExistingFile(root: string, relativePath: string): Promise<fsSync.Stats | undefined> {
  try {
    const absolutePath = path.join(root, ...relativePath.split("/"));
    const lstat = await fs.lstat(absolutePath);
    if (lstat.isSymbolicLink() || !lstat.isFile()) {
      return undefined;
    }
    const realPath = await fs.realpath(absolutePath);
    if (!isPathInside(realPath, root)) {
      return undefined;
    }
    return await fs.stat(realPath);
  } catch {
    return undefined;
  }
}

async function safeJsonParse(filePath: string, maxBytes = MAX_METADATA_BYTES): Promise<{ parsed?: unknown; raw?: string; validJson: boolean; bytes: number }> {
  const stats = await fs.stat(filePath);
  if (stats.size > maxBytes) {
    return { validJson: false, bytes: stats.size };
  }
  const raw = await fs.readFile(filePath, "utf8");
  try {
    return { parsed: JSON.parse(raw) as unknown, raw, validJson: true, bytes: Buffer.byteLength(raw) };
  } catch {
    return { raw, validJson: false, bytes: Buffer.byteLength(raw) };
  }
}

function extractRegistryEntries(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) {
    return parsed.filter(isObject);
  }
  if (!isObject(parsed)) {
    return [];
  }
  if (Array.isArray(parsed.artifacts)) {
    return parsed.artifacts.filter(isObject);
  }
  if (Array.isArray(parsed.records)) {
    return parsed.records.filter(isObject);
  }
  if (isObject(parsed.artifacts)) {
    return Object.entries(parsed.artifacts).flatMap(([key, value]) =>
      isObject(value) ? [{ registryId: key, ...value }] : []
    );
  }
  return [];
}

function frontMatterMetadata(content: string): Record<string, string> {
  const normalized = content.replace(/\r\n/gu, "\n");
  if (!normalized.startsWith("---\n")) {
    return {};
  }
  const end = normalized.indexOf("\n---", 4);
  if (end < 0 || end > 16_000) {
    return {};
  }
  const metadata: Record<string, string> = {};
  for (const line of normalized.slice(4, end).split("\n")) {
    const match = /^(?<key>[A-Za-z][A-Za-z0-9_-]{0,80})\s*:\s*(?<value>.+?)\s*$/u.exec(line);
    if (match?.groups?.key && match.groups.value) {
      metadata[match.groups.key] = match.groups.value.replace(/^["']|["']$/gu, "").trim();
    }
  }
  return metadata;
}

function looseJsonIdentityMetadata(raw: string | undefined): Record<string, string> {
  if (!raw) {
    return {};
  }
  const metadata: Record<string, string> = {};
  for (const key of ["artifactId", "id", "pairId", "artifactType", "phaseId", "workCardId", "reviewStatus", "title"]) {
    const match = new RegExp(`"${key}"\\s*:\\s*"(?<value>[^"]{1,200})"`, "u").exec(raw);
    if (match?.groups?.value) {
      metadata[key] = match.groups.value;
    }
  }
  return metadata;
}

function deriveArtifactType(relativePath: string, metadata?: Record<string, unknown>): string {
  const explicit = metadata ? metadataString(metadata, ["artifactType", "type"]) : undefined;
  if (explicit) {
    return explicit;
  }
  const normalized = normalizeSlashPath(relativePath);
  if (/\/Builder_Reports\/BUILDER_REPORT[^/]*\.md$/u.test(normalized)) {
    return "builder_report";
  }
  if (normalized.endsWith(".json")) {
    return "json_artifact";
  }
  return "markdown_artifact";
}

function phaseFromPath(relativePath: string): string | undefined {
  const match = /^planning\/phases\/(?<phase>[^/]+)/u.exec(relativePath);
  return match?.groups?.phase;
}

function workCardFromPath(relativePath: string): string | undefined {
  const fileName = path.basename(relativePath);
  return /(?<id>WC-[A-Za-z0-9-]+|FIX\d{2,4}|WC\d{2,4})/u.exec(fileName)?.groups?.id;
}

async function recordFromJson(root: string, workspaceId: string, relativePath: string, warnings: string[]): Promise<PartialRecord> {
  const absolutePath = path.join(root, ...relativePath.split("/"));
  const stats = await fs.stat(absolutePath);
  const parsed = await safeJsonParse(absolutePath);
  const metadata = isObject(parsed.parsed) ? parsed.parsed : looseJsonIdentityMetadata(parsed.raw);
  const recordWarnings: string[] = [];
  const markdownPath = nestedPath(metadata, "markdown");
  const safeMarkdownPath = markdownPath ? pathFromMetadata(root, markdownPath, recordWarnings) : undefined;
  const pairBase = relativePath.replace(/\.json$/iu, "");
  const siblingMarkdown = `${pairBase}.md`;
  const siblingMarkdownPath = safeMarkdownPath ?? (fsSync.existsSync(path.join(root, ...siblingMarkdown.split("/"))) ? siblingMarkdown : undefined);
  warnings.push(...recordWarnings);

  return {
    artifactId: metadataString(metadata, ["artifactId", "id"]),
    pairId: metadataString(metadata, ["pairId"]),
    idSource: metadataString(metadata, ["artifactId", "id"]) ? "sidecar" : undefined,
    workspaceId,
    phaseId: metadataString(metadata, ["phaseId"]) ?? phaseFromPath(relativePath),
    artifactType: deriveArtifactType(relativePath, metadata),
    workCardId: metadataString(metadata, ["workCardId"]) ?? workCardFromPath(relativePath),
    title: metadataString(metadata, ["title", "name"]),
    status: metadataString(metadata, ["status", "artifactStatus"]),
    reviewStatus: metadataString(metadata, ["reviewStatus", "architectReview", "architectReviewStatus"]),
    submittedAt: metadataString(metadata, ["submittedAt", "reviewSubmittedAt"]),
    markdownPath: siblingMarkdownPath,
    jsonPath: relativePath,
    revision: metadataScalar(metadata, ["revision"]),
    modifiedAt: stats.mtime.toISOString(),
    markdownSha256: hashFromMetadata(metadata, "markdown"),
    jsonSha256: hashFromMetadata(metadata, "json"),
    payloadHash: metadataString(metadata, ["payloadHash"]),
    sourceBundleId: metadataString(metadata, ["sourceBundleId"]),
    currentActionId: metadataString(metadata, ["currentActionId"]),
    metadataSource: "json_sidecar",
    warnings: parsed.validJson ? [] : [`Invalid JSON sidecar: ${relativePath}`]
  };
}

async function recordFromMarkdown(root: string, workspaceId: string, relativePath: string, warnings: string[]): Promise<PartialRecord> {
  const absolutePath = path.join(root, ...relativePath.split("/"));
  const stats = await fs.stat(absolutePath);
  const sample = await fs.readFile(absolutePath, "utf8").catch(() => "");
  const metadata = frontMatterMetadata(sample.slice(0, 16_000));
  const pairBase = relativePath.replace(/\.md$/iu, "");
  const siblingJson = `${pairBase}.json`;
  const siblingJsonPath = fsSync.existsSync(path.join(root, ...siblingJson.split("/"))) ? siblingJson : undefined;
  const metadataRecord = metadata as Record<string, unknown>;
  const source: MetadataSource = Object.keys(metadata).length > 0 ? "structured_header" : "derived_path";

  return {
    artifactId: metadataString(metadataRecord, ["artifactId", "id"]),
    pairId: metadataString(metadataRecord, ["pairId"]),
    idSource: metadataString(metadataRecord, ["artifactId", "id"]) ? "structured_metadata" : undefined,
    workspaceId,
    phaseId: metadataString(metadataRecord, ["phaseId"]) ?? phaseFromPath(relativePath),
    artifactType: deriveArtifactType(relativePath, metadataRecord),
    workCardId: metadataString(metadataRecord, ["workCardId"]) ?? workCardFromPath(relativePath),
    title: metadataString(metadataRecord, ["title"]) ?? sample.split(/\r?\n/u).find((line) => /^#\s+\S/u.test(line))?.replace(/^#\s+/u, "").trim().slice(0, 200),
    status: metadataString(metadataRecord, ["status", "artifactStatus"]),
    reviewStatus: metadataString(metadataRecord, ["reviewStatus", "architectReview", "architectReviewStatus"]),
    submittedAt: metadataString(metadataRecord, ["submittedAt", "reviewSubmittedAt"]),
    markdownPath: relativePath,
    jsonPath: siblingJsonPath,
    revision: metadataScalar(metadataRecord, ["revision"]),
    modifiedAt: stats.mtime.toISOString(),
    markdownSha256: hashFromMetadata(metadataRecord, "markdown"),
    jsonSha256: hashFromMetadata(metadataRecord, "json"),
    payloadHash: metadataString(metadataRecord, ["payloadHash"]),
    sourceBundleId: metadataString(metadataRecord, ["sourceBundleId"]),
    currentActionId: metadataString(metadataRecord, ["currentActionId"]),
    metadataSource: source,
    warnings
  };
}

function registryRecord(root: string, workspaceId: string, registryPath: string, entry: Record<string, unknown>, warnings: string[]): PartialRecord {
  const recordWarnings: string[] = [];
  const rawMarkdownPath = nestedPath(entry, "markdown");
  const rawJsonPath = nestedPath(entry, "json");
  const markdownPath = rawMarkdownPath ? pathFromMetadata(root, rawMarkdownPath, recordWarnings) : undefined;
  const jsonPath = rawJsonPath ? pathFromMetadata(root, rawJsonPath, recordWarnings) : undefined;
  warnings.push(...recordWarnings);

  return {
    artifactId: metadataString(entry, ["artifactId", "id"]) ?? metadataString(entry, ["registryId"]),
    pairId: metadataString(entry, ["pairId"]),
    idSource: "registry",
    workspaceId,
    phaseId: metadataString(entry, ["phaseId"]),
    artifactType: metadataString(entry, ["artifactType", "type"]) ?? deriveArtifactType(markdownPath ?? jsonPath ?? registryPath, entry),
    workCardId: metadataString(entry, ["workCardId"]),
    title: metadataString(entry, ["title", "name"]),
    status: metadataString(entry, ["status", "artifactStatus"]),
    reviewStatus: metadataString(entry, ["reviewStatus", "architectReview", "architectReviewStatus"]),
    submittedAt: metadataString(entry, ["submittedAt", "reviewSubmittedAt"]),
    markdownPath,
    jsonPath,
    registryId: metadataString(entry, ["registryId", "id"]),
    registryPath,
    registryEntry: entry,
    revision: metadataScalar(entry, ["revision"]),
    modifiedAt: metadataString(entry, ["modifiedAt", "updatedAt"]) ?? new Date(0).toISOString(),
    markdownSha256: hashFromMetadata(entry, "markdown"),
    jsonSha256: hashFromMetadata(entry, "json"),
    payloadHash: metadataString(entry, ["payloadHash"]),
    sourceBundleId: metadataString(entry, ["sourceBundleId"]),
    currentActionId: metadataString(entry, ["currentActionId"]),
    metadataSource: "registry",
    warnings: recordWarnings
  };
}

async function discoverRegistryRecords(root: string, workspaceId: string, warnings: string[]): Promise<{ records: PartialRecord[]; paths: string[] }> {
  const records: PartialRecord[] = [];
  const registryPaths = new Set<string>();
  const candidatePaths = [...REGISTRY_PATHS];
  const phasesDir = path.join(root, "planning", "phases");
  if (fsSync.existsSync(phasesDir)) {
    for (const phaseEntry of await fs.readdir(phasesDir, { withFileTypes: true }).catch(() => [])) {
      if (phaseEntry.isDirectory() && !phaseEntry.isSymbolicLink()) {
        candidatePaths.push(`planning/phases/${phaseEntry.name}/artifact-registry.json`);
      }
    }
  }

  for (const relativePath of candidatePaths) {
    const absolutePath = path.join(root, ...relativePath.split("/"));
    if (!fsSync.existsSync(absolutePath)) {
      continue;
    }
    const parsed = await safeJsonParse(absolutePath);
    registryPaths.add(relativePath);
    if (!parsed.validJson) {
      warnings.push(`Artifact registry is invalid JSON: ${relativePath}`);
      continue;
    }
    for (const entry of extractRegistryEntries(parsed.parsed)) {
      records.push(registryRecord(root, workspaceId, relativePath, entry, warnings));
    }
  }

  return {
    records,
    paths: [...registryPaths].sort()
  };
}

async function walkArtifactFiles(root: string, startRelativePath: string, output: string[], warnings: string[], depth = 0): Promise<void> {
  if (output.length >= MAX_SCAN_FILES || depth > MAX_SCAN_DEPTH) {
    return;
  }
  const absolutePath = path.join(root, ...startRelativePath.split("/").filter(Boolean));
  let entries: fsSync.Dirent[];
  try {
    const lstat = await fs.lstat(absolutePath);
    if (!lstat.isDirectory() || lstat.isSymbolicLink()) {
      return;
    }
    entries = await fs.readdir(absolutePath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      warnings.push(`Could not scan artifact directory: ${startRelativePath || "."}`);
    }
    return;
  }

  for (const entry of entries) {
    if (output.length >= MAX_SCAN_FILES) {
      warnings.push("Artifact catalog scan limit reached; results may be incomplete.");
      return;
    }
    const relativePath = normalizeSlashPath(path.posix.join(startRelativePath, entry.name));
    if (entry.isDirectory()) {
      if (!entry.isSymbolicLink() && !EXCLUDED_DIRS.has(entry.name.toLowerCase())) {
        await walkArtifactFiles(root, relativePath, output, warnings, depth + 1);
      }
      continue;
    }
    if (!entry.isFile() || entry.isSymbolicLink() || !/\.(md|json)$/iu.test(entry.name)) {
      continue;
    }
    if (/^(artifact-registry|current-action)\.json$/iu.test(entry.name)) {
      continue;
    }
    const denial = getFilePolicyDenial(path.join(root, ...relativePath.split("/")), relativePath);
    if (denial) {
      warnings.push(`Skipped ${relativePath}: ${denial}`);
      continue;
    }
    output.push(relativePath);
  }
}

async function discoverFileRecords(root: string, workspaceId: string, warnings: string[]): Promise<PartialRecord[]> {
  const files: string[] = [];
  for (const rootDir of ROOT_SCAN_DIRS) {
    await walkArtifactFiles(root, rootDir, files, warnings);
  }

  const records: PartialRecord[] = [];
  for (const relativePath of [...new Set(files)].sort()) {
    try {
      const absolutePath = path.join(root, ...relativePath.split("/"));
      const stats = await fs.stat(absolutePath);
      if (stats.size > MAX_METADATA_BYTES) {
        warnings.push(`Skipped metadata extraction for large artifact: ${relativePath}`);
        continue;
      }
      if (relativePath.endsWith(".json")) {
        records.push(await recordFromJson(root, workspaceId, relativePath, warnings));
      } else if (relativePath.endsWith(".md")) {
        records.push(await recordFromMarkdown(root, workspaceId, relativePath, warnings));
      }
    } catch {
      warnings.push(`Skipped unreadable artifact: ${relativePath}`);
    }
  }
  return records;
}

function mergeRecord(target: PartialRecord, source: PartialRecord): PartialRecord {
  const registryWins = source.metadataSource === "registry";
  return {
    ...target,
    ...(registryWins || !target.artifactId ? { artifactId: source.artifactId ?? target.artifactId } : {}),
    pairId: target.pairId ?? source.pairId,
    idSource: target.idSource ?? source.idSource,
    phaseId: target.phaseId ?? source.phaseId,
    artifactType: registryWins ? source.artifactType ?? target.artifactType : target.artifactType ?? source.artifactType,
    workCardId: target.workCardId ?? source.workCardId,
    title: target.title ?? source.title,
    status: target.status ?? source.status,
    reviewStatus: target.reviewStatus ?? source.reviewStatus,
    submittedAt: target.submittedAt ?? source.submittedAt,
    markdownPath: target.markdownPath ?? source.markdownPath,
    jsonPath: target.jsonPath ?? source.jsonPath,
    registryId: target.registryId ?? source.registryId,
    registryPath: target.registryPath ?? source.registryPath,
    registryEntry: target.registryEntry ?? source.registryEntry,
    revision: target.revision ?? source.revision,
    modifiedAt: newestIso(target.modifiedAt, source.modifiedAt),
    markdownSha256: target.markdownSha256 ?? source.markdownSha256,
    jsonSha256: target.jsonSha256 ?? source.jsonSha256,
    payloadHash: target.payloadHash ?? source.payloadHash,
    sourceBundleId: target.sourceBundleId ?? source.sourceBundleId,
    currentActionId: target.currentActionId ?? source.currentActionId,
    metadataSource: registryWins ? "registry" : target.metadataSource,
    warnings: [...target.warnings, ...source.warnings]
  };
}

function newestIso(left?: string, right?: string): string | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

function mergeKey(record: PartialRecord): string {
  if (record.pairId) {
    return `pair:${record.pairId}`;
  }
  if (record.artifactId) {
    return `artifact:${record.artifactId}`;
  }
  const logicalPath = record.markdownPath?.replace(/\.md$/iu, "") ?? record.jsonPath?.replace(/\.json$/iu, "") ?? "unknown";
  return `path:${logicalPath}`;
}

async function finalizeRecord(root: string, record: PartialRecord): Promise<ArtifactCatalogRecord> {
  const stats = await Promise.all([
    record.markdownPath ? statExistingFile(root, record.markdownPath) : undefined,
    record.jsonPath ? statExistingFile(root, record.jsonPath) : undefined
  ]);
  const modifiedAt = newestIso(newestIso(stats[0]?.mtime.toISOString(), stats[1]?.mtime.toISOString()), record.modifiedAt) ?? new Date(0).toISOString();
  const identity = record.markdownPath ?? record.jsonPath ?? record.registryId ?? record.pairId ?? "unknown";
  const artifactId = record.artifactId ?? deterministicId(record.workspaceId, identity);

  return {
    artifactId,
    idSource: record.idSource ?? "derived",
    workspaceId: record.workspaceId,
    artifactType: record.artifactType ?? deriveArtifactType(identity),
    metadataSource: record.metadataSource,
    modifiedAt,
    warnings: record.warnings,
    ...(record.pairId ? { pairId: record.pairId } : {}),
    ...(record.phaseId ? { phaseId: record.phaseId } : {}),
    ...(record.workCardId ? { workCardId: record.workCardId } : {}),
    ...(record.title ? { title: record.title } : {}),
    ...(record.status ? { status: record.status } : {}),
    ...(record.reviewStatus ? { reviewStatus: record.reviewStatus } : {}),
    ...(record.submittedAt ? { submittedAt: record.submittedAt } : {}),
    ...(record.markdownPath ? { markdownPath: record.markdownPath } : {}),
    ...(record.jsonPath ? { jsonPath: record.jsonPath } : {}),
    ...(record.registryId ? { registryId: record.registryId } : {}),
    ...(record.registryPath ? { registryPath: record.registryPath } : {}),
    ...(record.registryEntry ? { registryEntry: record.registryEntry } : {}),
    ...(record.revision !== undefined ? { revision: record.revision } : {}),
    ...(record.markdownSha256 ? { markdownSha256: record.markdownSha256 } : {}),
    ...(record.jsonSha256 ? { jsonSha256: record.jsonSha256 } : {}),
    ...(record.payloadHash ? { payloadHash: record.payloadHash } : {}),
    ...(record.sourceBundleId ? { sourceBundleId: record.sourceBundleId } : {}),
    ...(record.currentActionId ? { currentActionId: record.currentActionId } : {})
  };
}

async function buildCatalog(workspaceId: string, config: AppConfig): Promise<Catalog> {
  const workspace = resolveWorkspace(workspaceId, config);
  const warnings: string[] = [];
  const [registry, files] = await Promise.all([
    discoverRegistryRecords(workspace.root, workspace.workspaceId, warnings),
    discoverFileRecords(workspace.root, workspace.workspaceId, warnings)
  ]);
  const merged = new Map<string, PartialRecord>();
  for (const record of [...registry.records, ...files]) {
    const key = mergeKey(record);
    merged.set(key, merged.has(key) ? mergeRecord(merged.get(key)!, record) : record);
  }
  const records = await Promise.all([...merged.values()].map((record) => finalizeRecord(workspace.root, record)));
  records.sort(sortArtifacts);

  return {
    workspaceId: workspace.workspaceId,
    root: workspace.root,
    records,
    registryConfigured: registry.paths.length > 0,
    registryPaths: registry.paths,
    warnings
  };
}

function sortArtifacts(left: ArtifactCatalogRecord, right: ArtifactCatalogRecord): number {
  const modifiedDelta = new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime();
  return modifiedDelta || left.artifactId.localeCompare(right.artifactId);
}

function filtersObject(filters: ArtifactFilters): ArtifactFilters {
  return {
    ...(filters.phaseId ? { phaseId: filters.phaseId } : {}),
    ...(filters.artifactType ? { artifactType: filters.artifactType } : {}),
    ...(filters.artifactTypes?.length ? { artifactTypes: filters.artifactTypes } : {}),
    ...(filters.workCardId ? { workCardId: filters.workCardId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.statuses?.length ? { statuses: filters.statuses } : {}),
    ...(filters.pathPrefix ? { pathPrefix: filters.pathPrefix } : {}),
    ...(filters.recordKind ? { recordKind: filters.recordKind } : {}),
    ...(filters.includeDerived !== undefined ? { includeDerived: filters.includeDerived } : {}),
    ...(filters.includeSidecars !== undefined ? { includeSidecars: filters.includeSidecars } : {}),
    ...(filters.sourceOnly ? { sourceOnly: filters.sourceOnly } : {})
  };
}

function artifactRecordKind(record: ArtifactCatalogRecord): ArtifactRecordKind {
  if (record.metadataSource === "json_sidecar") {
    return "sidecar";
  }
  if (record.metadataSource === "derived_path" || record.idSource === "derived") {
    return "derived";
  }
  return "source";
}

function recordPaths(record: ArtifactCatalogRecord): string[] {
  return [record.markdownPath, record.jsonPath, record.registryPath].filter((value): value is string => Boolean(value));
}

function normalizeOptionalPathPrefix(pathPrefix: string | undefined): string | undefined {
  if (!pathPrefix) {
    return undefined;
  }
  const safe = assertSafeRelativePath(pathPrefix);
  const normalized = normalizeSlashPath(safe);
  return normalized === "." ? undefined : normalized.replace(/\/$/u, "");
}

function matchesFilters(record: ArtifactCatalogRecord, filters: ArtifactFilters): boolean {
  const kind = artifactRecordKind(record);
  const artifactTypes = filters.artifactTypes?.length ? filters.artifactTypes : filters.artifactType ? [filters.artifactType] : undefined;
  const statuses = filters.statuses?.length ? filters.statuses : filters.status ? [filters.status] : undefined;
  const pathPrefix = normalizeOptionalPathPrefix(filters.pathPrefix);

  return (
    (!filters.phaseId || record.phaseId === filters.phaseId) &&
    (!artifactTypes || artifactTypes.includes(record.artifactType)) &&
    (!filters.workCardId || record.workCardId === filters.workCardId) &&
    (!statuses || statuses.includes(record.status ?? record.reviewStatus ?? "")) &&
    (!pathPrefix || recordPaths(record).some((recordPath) => recordPath === pathPrefix || recordPath.startsWith(`${pathPrefix}/`))) &&
    (!filters.recordKind || kind === filters.recordKind) &&
    (!filters.sourceOnly || kind === "source") &&
    (filters.includeDerived !== false || kind !== "derived") &&
    (filters.includeSidecars !== false || kind !== "sidecar")
  );
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0;
  }
  if (!/^\d{1,8}$/u.test(cursor)) {
    throw new AppError("INVALID_INPUT", "cursor must be a server-returned pagination cursor.");
  }
  return Number.parseInt(cursor, 10);
}

function pageRecords<T>(records: T[], limit: number, cursor: string | undefined): { page: T[]; nextCursor?: string; truncated: boolean } {
  const offset = decodeCursor(cursor);
  const page = records.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  return {
    page,
    nextCursor: nextOffset < records.length ? String(nextOffset) : undefined,
    truncated: nextOffset < records.length
  };
}

function publicArtifact(record: ArtifactCatalogRecord) {
  const recordKind = artifactRecordKind(record);
  return {
    artifactId: record.artifactId,
    ...(record.pairId ? { pairId: record.pairId } : {}),
    idSource: record.idSource,
    recordKind,
    metadataSource: record.metadataSource,
    ...(record.phaseId ? { phaseId: record.phaseId } : {}),
    artifactType: record.artifactType,
    ...(record.workCardId ? { workCardId: record.workCardId } : {}),
    ...(record.title ? { title: record.title } : {}),
    ...(record.status ? { status: record.status } : {}),
    ...(record.reviewStatus ? { reviewStatus: record.reviewStatus } : {}),
    ...(record.markdownPath ? { markdownPath: record.markdownPath } : {}),
    ...(record.jsonPath ? { jsonPath: record.jsonPath } : {}),
    ...(record.registryPath ? { registryPath: record.registryPath } : {}),
    sourceOrParent: record.sourceBundleId ?? record.pairId ?? record.registryId,
    modifiedAt: record.modifiedAt,
    synchronization: synchronizationLabel(record)
  };
}

function artifactDetails(record: ArtifactCatalogRecord) {
  return {
    artifactId: record.artifactId,
    ...(record.pairId ? { pairId: record.pairId } : {}),
    idSource: record.idSource,
    ...(record.phaseId ? { phaseId: record.phaseId } : {}),
    artifactType: record.artifactType,
    ...(record.workCardId ? { workCardId: record.workCardId } : {}),
    ...(record.title ? { title: record.title } : {}),
    ...(record.status ? { artifactStatus: record.status } : {}),
    ...(record.reviewStatus ? { reviewStatus: record.reviewStatus } : {}),
    ...(record.revision !== undefined ? { revision: record.revision } : {}),
    ...(record.markdownPath ? { markdownPath: record.markdownPath } : {}),
    ...(record.jsonPath ? { jsonPath: record.jsonPath } : {}),
    modifiedAt: record.modifiedAt
  };
}

function synchronizationLabel(record: ArtifactCatalogRecord): string {
  if (record.markdownPath && record.jsonPath) {
    return "paired";
  }
  return record.registryPath ? "registered_single_component" : "single_component";
}

async function fileBytesAndHash(root: string, relativePath: string): Promise<{ absolutePath: string; bytes: number; sha256: string }> {
  const absolutePath = path.join(root, ...relativePath.split("/"));
  const stats = await fs.stat(absolutePath);
  return {
    absolutePath,
    bytes: stats.size,
    sha256: await sha256File(absolutePath)
  };
}

async function readMarkdown(root: string, relativePath: string) {
  const file = await fileBytesAndHash(root, relativePath);
  const maxBytes = Math.min(file.bytes, MARKDOWN_TRUNCATE_BYTES);
  const handle = await fs.open(file.absolutePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return {
      path: relativePath,
      content: buffer.subarray(0, bytesRead).toString("utf8"),
      bytes: file.bytes,
      sha256: file.sha256,
      truncated: file.bytes > maxBytes
    };
  } finally {
    await handle.close();
  }
}

async function readJson(root: string, relativePath: string) {
  const file = await fileBytesAndHash(root, relativePath);
  if (file.bytes > MAX_JSON_CONTENT_BYTES) {
    return {
      path: relativePath,
      bytes: file.bytes,
      sha256: file.sha256,
      validJson: false,
      truncated: true,
      tooLarge: true
    };
  }
  const rawContent = await fs.readFile(file.absolutePath, "utf8");
  try {
    return {
      path: relativePath,
      value: JSON.parse(rawContent) as unknown,
      rawContent,
      bytes: file.bytes,
      sha256: file.sha256,
      validJson: true,
      truncated: false
    };
  } catch {
    return {
      path: relativePath,
      rawContent,
      bytes: file.bytes,
      sha256: file.sha256,
      validJson: false,
      truncated: false
    };
  }
}

async function ensureReadableText(root: string, relativePath: string, maxBytes: number): Promise<boolean> {
  const absolutePath = path.join(root, ...relativePath.split("/"));
  const stats = await fs.stat(absolutePath);
  if (!stats.isFile() || stats.size > maxBytes) {
    return false;
  }
  const sampleSize = Math.min(stats.size, 8192);
  const handle = await fs.open(absolutePath, "r");
  try {
    const sample = Buffer.alloc(sampleSize);
    const { bytesRead } = await handle.read(sample, 0, sampleSize, 0);
    return isLikelyTextBuffer(sample.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

function findByArtifactId(records: ArtifactCatalogRecord[], artifactId: string): ArtifactCatalogRecord | undefined {
  return records.find((record) => record.artifactId === artifactId || record.registryId === artifactId || record.pairId === artifactId);
}

function planningPathPrefix(pathPrefix: string | undefined): string {
  const normalized = normalizeSlashPath(assertSafeRelativePath(pathPrefix ?? "planning"));
  const trimmed = normalized.replace(/\/$/u, "");
  if (trimmed !== "planning" && !trimmed.startsWith("planning/")) {
    throw new AppError("PATH_DENIED", "export_planning_corpus pathPrefix must stay under planning/.");
  }
  return trimmed || "planning";
}

function fileRecordKind(relativePath: string, artifact?: ArtifactCatalogRecord): ArtifactRecordKind {
  if (artifact) {
    const kind = artifactRecordKind(artifact);
    if (kind !== "derived") {
      return kind;
    }
  }
  if (/\.json$/iu.test(relativePath)) {
    return "sidecar";
  }
  return "source";
}

function artifactForFile(records: ArtifactCatalogRecord[], relativePath: string): ArtifactCatalogRecord | undefined {
  return records.find((record) => record.markdownPath === relativePath || record.jsonPath === relativePath || record.registryPath === relativePath);
}

function hashRequestId(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

async function fileManifestEntry(root: string, relativePath: string, artifact: ArtifactCatalogRecord | undefined, recordKind: ArtifactRecordKind) {
  try {
    const file = await fileBytesAndHash(root, relativePath);
    return {
      path: relativePath,
      ...(artifact ? { artifactId: artifact.artifactId, artifactType: artifact.artifactType, artifactStatus: artifact.status } : {}),
      recordKind,
      sizeBytes: file.bytes,
      sha256: file.sha256,
      readStatus: "hashed"
    };
  } catch (error) {
    return {
      path: relativePath,
      ...(artifact ? { artifactId: artifact.artifactId, artifactType: artifact.artifactType, artifactStatus: artifact.status } : {}),
      recordKind,
      sizeBytes: null,
      sha256: null,
      readStatus: "failed",
      failureReason: error instanceof Error ? error.message : String(error)
    };
  }
}

async function readFullTextEntry(root: string, relativePath: string, sizeBytes: number, maxBundleBytes: number) {
  const absolutePath = path.join(root, ...relativePath.split("/"));
  if (sizeBytes > maxBundleBytes) {
    return {
      path: relativePath,
      readStatus: "excluded",
      contentComplete: false,
      exclusionReason: "file_exceeds_remaining_bundle_limit",
      sizeBytes
    };
  }

  const readable = await ensureReadableText(root, relativePath, maxBundleBytes);
  if (!readable) {
    return {
      path: relativePath,
      readStatus: "unsupported",
      contentComplete: false,
      exclusionReason: "binary_unsupported_or_oversized",
      sizeBytes
    };
  }

  return {
    path: relativePath,
    readStatus: "read",
    contentComplete: true,
    sizeBytes,
    boundary: `----- BEGIN ${relativePath} -----`,
    content: await fs.readFile(absolutePath, "utf8"),
    endBoundary: `----- END ${relativePath} -----`
  };
}

export async function exportPlanningCorpus(input: ExportPlanningCorpusInput, config: AppConfig) {
  const workspace = resolveWorkspace(input.workspaceId, config);
  const pathPrefix = planningPathPrefix(input.pathPrefix);
  const limit = input.limit ?? 50;
  const maxBundleBytes = input.maxBundleBytes ?? 200_000;
  const cursor = input.cursor;
  const offset = decodeCursor(cursor);
  const artifactFilters = filtersObject({
    artifactTypes: input.artifactTypes?.map((value) => validateArtifactFilter(value, "artifactTypes")).filter((value): value is string => Boolean(value)),
    statuses: input.statuses?.map((value) => validateArtifactFilter(value, "statuses")).filter((value): value is string => Boolean(value)),
    pathPrefix,
    includeDerived: input.includeDerived,
    includeSidecars: input.includeSidecars
  });

  const [catalog, resolved] = await Promise.all([
    buildCatalog(input.workspaceId, config),
    resolveRepoPath(workspace.root, pathPrefix, config.allowedRoots)
  ]);
  const walked = await walkRepoFiles(resolved, { glob: "**/*", maxResults: 5000, recursive: true });
  const matchingArtifactRecords = catalog.records.filter((record) => matchesFilters(record, artifactFilters));
  const matchingArtifactPaths = new Set(matchingArtifactRecords.flatMap(recordPaths));
  const manifestCandidates = walked.files
    .map((file) => {
      const artifact = artifactForFile(matchingArtifactRecords, file.rootRelativePath);
      const recordKind = fileRecordKind(file.rootRelativePath, artifact);
      const excluded =
        input.includeSidecars !== true && recordKind === "sidecar" ||
        input.includeDerived !== true && recordKind === "derived" ||
        input.artifactTypes?.length && (!artifact || !input.artifactTypes.includes(artifact.artifactType)) ||
        input.statuses?.length && (!artifact || !input.statuses.includes(artifact.status ?? artifact.reviewStatus ?? ""));
      return {
        file,
        artifact,
        recordKind,
        excluded: Boolean(excluded),
        exclusionReason: excluded ? "filtered_by_request" : undefined
      };
    });
  const includedCandidates = manifestCandidates.filter((entry) => !entry.excluded);
  const pageItems = includedCandidates.slice(offset, offset + limit);
  const allManifestEntries = await Promise.all(
    includedCandidates.map((entry) => fileManifestEntry(catalog.root, entry.file.rootRelativePath, entry.artifact, entry.recordKind))
  );
  const manifest = allManifestEntries.slice(offset, offset + limit);
  const successfullyHashed = allManifestEntries.filter((entry) => entry.readStatus === "hashed").length;

  const fullText: unknown[] = [];
  let fullTextBytes = 0;
  let successfullyRead = 0;
  if (input.includeFullText) {
    for (const entry of pageItems) {
      const nextBytes = entry.file.sizeBytes;
      const textEntry = await readFullTextEntry(catalog.root, entry.file.rootRelativePath, nextBytes, maxBundleBytes - fullTextBytes);
      fullText.push(textEntry);
      if ((textEntry as { readStatus?: string }).readStatus === "read") {
        successfullyRead += 1;
        fullTextBytes += nextBytes;
      }
    }
  }

  const nextOffset = offset + pageItems.length;
  const hasMore = nextOffset < includedCandidates.length;
  const totalSidecarCount = manifestCandidates.filter((entry) => entry.recordKind === "sidecar").length;
  const totalDerivedRecordCount = matchingArtifactRecords.filter((record) => artifactRecordKind(record) === "derived").length;
  const totalSourceFileCount = manifestCandidates.filter((entry) => entry.recordKind === "source").length;
  const request = {
    workspaceId: workspace.workspaceId,
    pathPrefix,
    includeFullText: Boolean(input.includeFullText),
    includeDerived: Boolean(input.includeDerived),
    includeSidecars: Boolean(input.includeSidecars),
    artifactTypes: input.artifactTypes ?? [],
    statuses: input.statuses ?? [],
    limit,
    maxBundleBytes
  };

  return {
    status: "ok",
    request,
    manifestId: hashRequestId({ ...request, discovered: walked.files.map((file) => file.rootRelativePath) }),
    page: {
      cursor: cursor ?? null,
      offset,
      limit,
      nextCursor: hasMore ? String(nextOffset) : null,
      hasMore
    },
    counts: {
      totalDiscoveredFilesystemFileCount: walked.files.length,
      totalMatchingArtifactRecordCount: matchingArtifactRecords.length,
      totalIncludedSourceFileCount: totalSourceFileCount,
      totalSidecarCount,
      totalDerivedRecordCount,
      totalSuccessfullyHashedCount: successfullyHashed,
      pageSuccessfullyReadCount: input.includeFullText ? successfullyRead : null,
      totalSuccessfullyReadCount: input.includeFullText && !cursor && !hasMore ? successfullyRead : null,
      totalExcludedCount: manifestCandidates.filter((entry) => entry.excluded).length,
      totalFailedCount: allManifestEntries.filter((entry) => entry.readStatus === "failed").length,
      fullTextCoverageComplete: input.includeFullText && !cursor && !hasMore ? successfullyRead === includedCandidates.length : false
    },
    diagnostics: {
      requestedScope: input.pathPrefix ?? "planning/",
      normalizedScope: pathPrefix,
      traversal: walked.diagnostics,
      matchingArtifactPaths: [...matchingArtifactPaths].sort()
    },
    manifest,
    ...(input.includeFullText ? { fullText, fullTextBytes } : {}),
    warnings: catalog.warnings
  };
}

export async function listArtifacts(input: ListArtifactsInput, config: AppConfig) {
  const filters = filtersObject({
    phaseId: validateArtifactFilter(input.phaseId, "phaseId"),
    artifactType: validateArtifactFilter(input.artifactType, "artifactType"),
    artifactTypes: input.artifactTypes?.map((value) => validateArtifactFilter(value, "artifactTypes")).filter((value): value is string => Boolean(value)),
    workCardId: validateArtifactFilter(input.workCardId, "workCardId"),
    status: validateArtifactFilter(input.status, "status"),
    statuses: input.statuses?.map((value) => validateArtifactFilter(value, "statuses")).filter((value): value is string => Boolean(value)),
    pathPrefix: normalizeOptionalPathPrefix(input.pathPrefix),
    recordKind: input.recordKind,
    includeDerived: input.includeDerived,
    includeSidecars: input.includeSidecars,
    sourceOnly: input.sourceOnly
  });
  const catalog = await buildCatalog(input.workspaceId, config);
  const records = catalog.records.filter((record) => matchesFilters(record, filters));
  const limit = input.limit ?? 50;
  const page = pageRecords(records, limit, input.cursor);
  const offset = decodeCursor(input.cursor);

  return {
    status: "ok",
    filters,
    sort: { fields: ["modifiedAt desc", "artifactId asc"], stable: true },
    artifacts: page.page.map(publicArtifact),
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    page: { cursor: input.cursor ?? null, offset, limit, hasMore: Boolean(page.nextCursor) },
    totalMatchingRecords: records.length,
    totalReturned: page.page.length,
    truncated: page.truncated,
    warnings: catalog.warnings
  };
}

export async function readArtifactById(input: ReadArtifactInput, config: AppConfig) {
  validateArtifactId(input.artifactId);
  const component = input.component ?? "preferred";
  const catalog = await buildCatalog(input.workspaceId, config);
  const record = findByArtifactId(catalog.records, input.artifactId);
  const warnings = [...catalog.warnings];
  if (!record) {
    return { status: "artifact_not_found", warnings };
  }

  const response: Record<string, unknown> = {
    status: "ok",
    artifact: artifactDetails(record),
    warnings
  };

  const includeMarkdown = component === "markdown" || component === "both" || (component === "preferred" && Boolean(record.markdownPath));
  const includeJson = component === "json" || component === "both" || (component === "preferred" && !record.markdownPath && Boolean(record.jsonPath));

  if (includeMarkdown) {
    if (!record.markdownPath) {
      return { status: "component_not_found", artifact: artifactDetails(record), warnings };
    }
    const readable = await ensureReadableText(catalog.root, record.markdownPath, MAX_MARKDOWN_CONTENT_BYTES);
    if (!readable) {
      return { status: "content_too_large", artifact: artifactDetails(record), warnings };
    }
    response.markdown = await readMarkdown(catalog.root, record.markdownPath);
  }

  if (includeJson) {
    if (!record.jsonPath) {
      return { status: "component_not_found", artifact: artifactDetails(record), warnings };
    }
    const json = await readJson(catalog.root, record.jsonPath);
    if ("tooLarge" in json) {
      return {
        status: "content_too_large",
        artifact: artifactDetails(record),
        json: {
          path: json.path,
          bytes: json.bytes,
          sha256: json.sha256,
          validJson: false,
          truncated: true
        },
        warnings
      };
    }
    response.json = json;
  }

  return response;
}

export async function latestArtifact(input: LatestArtifactInput, config: AppConfig) {
  const filters = filtersObject({
    phaseId: validateArtifactFilter(input.phaseId, "phaseId"),
    artifactType: validateArtifactFilter(input.artifactType, "artifactType"),
    workCardId: validateArtifactFilter(input.workCardId, "workCardId")
  });
  const catalog = await buildCatalog(input.workspaceId, config);
  const record = catalog.records.filter((entry) => matchesFilters(entry, filters))[0];
  if (!record) {
    return {
      status: "no_matching_artifact",
      filters,
      warnings: catalog.warnings
    };
  }

  const response: Record<string, unknown> = {
    status: "ok",
    filters,
    artifact: artifactDetails(record),
    warnings: catalog.warnings
  };
  if (input.includeContent) {
    const read = await readArtifactById({ workspaceId: input.workspaceId, artifactId: record.artifactId, component: "preferred" }, config);
    if ("markdown" in read && read.markdown) {
      const markdown = read.markdown as { content: string; truncated: boolean };
      response.content = { component: "markdown", value: markdown.content, truncated: markdown.truncated };
    } else if ("json" in read && read.json) {
      const json = read.json as { value?: unknown; rawContent?: string; truncated: boolean };
      response.content = { component: "json", value: json.value ?? json.rawContent, truncated: json.truncated };
    }
  }
  return response;
}

function hashStatus(current: string | undefined, stored: string | undefined): "match" | "mismatch" | "not_stored" | "not_applicable" {
  if (!current) {
    return "not_applicable";
  }
  if (!stored) {
    return "not_stored";
  }
  return current.toLowerCase() === stored.toLowerCase().replace(/^sha256:/u, "") ? "match" : "mismatch";
}

function mismatch(field: string, expected: unknown, actual: unknown, source: string) {
  return { field, expected, actual, source };
}

export async function artifactPairStatus(input: ArtifactPairStatusInput, config: AppConfig) {
  validateArtifactId(input.artifactId);
  const catalog = await buildCatalog(input.workspaceId, config);
  const record = findByArtifactId(catalog.records, input.artifactId);
  if (!record) {
    return {
      status: "artifact_not_found",
      synchronized: false,
      artifactId: input.artifactId,
      markdown: { required: false, exists: false, hashStatus: "not_applicable" },
      json: { required: false, exists: false, hashStatus: "not_applicable" },
      registry: { configured: catalog.registryConfigured, entryExists: false },
      identity: {},
      payloadHash: { configured: false, status: "not_configured" },
      mismatches: [],
      warnings: catalog.warnings
    };
  }

  const mismatches: Array<{ field: string; expected?: unknown; actual?: unknown; source: string }> = [];
  const warnings = [...catalog.warnings, ...record.warnings];
  const markdownRequired = Boolean(record.markdownPath || record.registryEntry && nestedPath(record.registryEntry, "markdown"));
  const jsonRequired = Boolean(record.jsonPath || record.registryEntry && nestedPath(record.registryEntry, "json"));
  const markdownExists = Boolean(record.markdownPath && await statExistingFile(catalog.root, record.markdownPath));
  const jsonExists = Boolean(record.jsonPath && await statExistingFile(catalog.root, record.jsonPath));
  const markdownCurrentSha = markdownExists && record.markdownPath ? await sha256File(path.join(catalog.root, ...record.markdownPath.split("/"))) : undefined;
  const jsonCurrentSha = jsonExists && record.jsonPath ? await sha256File(path.join(catalog.root, ...record.jsonPath.split("/"))) : undefined;
  let validJson: boolean | undefined;
  if (jsonExists && record.jsonPath) {
    validJson = (await safeJsonParse(path.join(catalog.root, ...record.jsonPath.split("/")))).validJson;
    if (!validJson) {
      mismatches.push(mismatch("json.validJson", true, false, "json"));
    }
  }

  const markdownHashStatus = hashStatus(markdownCurrentSha, record.markdownSha256);
  const jsonHashStatus = hashStatus(jsonCurrentSha, record.jsonSha256);
  if (markdownHashStatus === "mismatch") {
    mismatches.push(mismatch("markdown.sha256", record.markdownSha256, markdownCurrentSha, "markdown"));
  }
  if (jsonHashStatus === "mismatch") {
    mismatches.push(mismatch("json.sha256", record.jsonSha256, jsonCurrentSha, "json"));
  }
  if (markdownRequired && !markdownExists) {
    mismatches.push(mismatch("markdown.exists", true, false, "catalog"));
  }
  if (jsonRequired && !jsonExists) {
    mismatches.push(mismatch("json.exists", true, false, "catalog"));
  }

  const registryEntryExists = Boolean(record.registryPath);
  const rawRegisteredMarkdownPath = record.registryEntry ? nestedPath(record.registryEntry, "markdown") : undefined;
  const rawRegisteredJsonPath = record.registryEntry ? nestedPath(record.registryEntry, "json") : undefined;
  const registeredMarkdownPath = rawRegisteredMarkdownPath ? pathFromMetadata(catalog.root, rawRegisteredMarkdownPath, []) : undefined;
  const registeredJsonPath = rawRegisteredJsonPath ? pathFromMetadata(catalog.root, rawRegisteredJsonPath, []) : undefined;
  const pathsMatch = registryEntryExists
    ? (!registeredMarkdownPath || registeredMarkdownPath === record.markdownPath) && (!registeredJsonPath || registeredJsonPath === record.jsonPath)
    : undefined;
  if (pathsMatch === false) {
    mismatches.push(mismatch("registry.paths", { markdownPath: record.markdownPath, jsonPath: record.jsonPath }, { registeredMarkdownPath, registeredJsonPath }, "registry"));
  }

  const registryArtifactId = record.registryEntry ? metadataString(record.registryEntry, ["artifactId", "id"]) : undefined;
  const registryPairId = record.registryEntry ? metadataString(record.registryEntry, ["pairId"]) : undefined;
  const artifactIdMatches = registryArtifactId ? registryArtifactId === record.artifactId : undefined;
  const pairIdMatches = registryPairId && record.pairId ? registryPairId === record.pairId : registryPairId || record.pairId ? false : undefined;
  if (artifactIdMatches === false) {
    mismatches.push(mismatch("artifactId", registryArtifactId, record.artifactId, "registry"));
  }
  if (pairIdMatches === false) {
    mismatches.push(mismatch("pairId", registryPairId, record.pairId, "registry"));
  }

  const registryHashesMatch = registryEntryExists
    ? (markdownHashStatus === "match" || markdownHashStatus === "not_stored" || markdownHashStatus === "not_applicable") &&
      (jsonHashStatus === "match" || jsonHashStatus === "not_stored" || jsonHashStatus === "not_applicable")
    : undefined;
  const registryRevision = record.registryEntry ? metadataScalar(record.registryEntry, ["revision"]) : undefined;
  const revisionMatches = registryRevision !== undefined && record.revision !== undefined ? registryRevision === record.revision : undefined;
  if (revisionMatches === false) {
    mismatches.push(mismatch("revision", registryRevision, record.revision, "registry"));
  }

  const status = !validJson && validJson !== undefined
    ? "invalid_json"
    : markdownHashStatus === "mismatch" || jsonHashStatus === "mismatch"
      ? "hash_mismatch"
      : markdownRequired && !markdownExists || jsonRequired && !jsonExists
        ? "incomplete_pair"
        : artifactIdMatches === false || pairIdMatches === false || pathsMatch === false || revisionMatches === false
          ? "identity_mismatch"
          : catalog.registryConfigured && !registryEntryExists
            ? "unregistered"
            : "synchronized";

  return {
    status,
    synchronized: status === "synchronized",
    artifactId: record.artifactId,
    ...(record.pairId ? { pairId: record.pairId } : {}),
    markdown: {
      required: markdownRequired,
      exists: markdownExists,
      ...(record.markdownPath ? { path: record.markdownPath } : {}),
      ...(record.revision !== undefined ? { revision: record.revision } : {}),
      ...(markdownCurrentSha ? { currentSha256: markdownCurrentSha } : {}),
      ...(record.markdownSha256 ? { storedSha256: record.markdownSha256 } : {}),
      hashStatus: markdownHashStatus
    },
    json: {
      required: jsonRequired,
      exists: jsonExists,
      ...(validJson !== undefined ? { validJson } : {}),
      ...(record.jsonPath ? { path: record.jsonPath } : {}),
      ...(record.revision !== undefined ? { revision: record.revision } : {}),
      ...(jsonCurrentSha ? { currentSha256: jsonCurrentSha } : {}),
      ...(record.jsonSha256 ? { storedSha256: record.jsonSha256 } : {}),
      hashStatus: jsonHashStatus
    },
    registry: {
      configured: catalog.registryConfigured,
      entryExists: registryEntryExists,
      ...(record.registryPath ? { path: record.registryPath } : {}),
      ...(pathsMatch !== undefined ? { pathsMatch } : {}),
      ...(artifactIdMatches !== undefined ? { artifactIdMatches } : {}),
      ...(pairIdMatches !== undefined ? { pairIdMatches } : {}),
      ...(revisionMatches !== undefined ? { revisionMatches } : {}),
      ...(registryHashesMatch !== undefined ? { hashesMatch: registryHashesMatch } : {})
    },
    identity: {
      ...(artifactIdMatches !== undefined ? { artifactIdMatches } : {}),
      ...(pairIdMatches !== undefined ? { pairIdMatches } : {}),
      phaseIdMatches: true,
      artifactTypeMatches: true,
      workCardIdMatches: true,
      ...(revisionMatches !== undefined ? { revisionMatches } : {})
    },
    payloadHash: {
      configured: false,
      ...(record.payloadHash ? { stored: record.payloadHash } : {}),
      status: "not_configured"
    },
    mismatches,
    warnings
  };
}

function normalizeReviewStatus(value: string | undefined): "awaiting_architect_review" | undefined {
  return value && AWAITING_ARCHITECT_REVIEW.has(value.toLowerCase()) ? "awaiting_architect_review" : undefined;
}

export async function reviewQueue(input: ReviewQueueInput, config: AppConfig) {
  const filters = filtersObject({
    phaseId: validateArtifactFilter(input.phaseId, "phaseId"),
    artifactType: validateArtifactFilter(input.artifactType, "artifactType"),
    workCardId: validateArtifactFilter(input.workCardId, "workCardId")
  });
  const catalog = await buildCatalog(input.workspaceId, config);
  const records = catalog.records
    .filter((record) => matchesFilters(record, filters))
    .filter((record) => normalizeReviewStatus(record.reviewStatus))
    .sort((left, right) => {
      const submittedDelta = new Date(right.submittedAt ?? 0).getTime() - new Date(left.submittedAt ?? 0).getTime();
      return submittedDelta || sortArtifacts(left, right);
    });

  if (!records.length && !catalog.records.some((record) => record.reviewStatus)) {
    return {
      status: "review_authority_not_configured",
      filters,
      queue: [],
      totalReturned: 0,
      truncated: false,
      warnings: ["No structured review status authority was found in artifact registry or JSON sidecars.", ...catalog.warnings]
    };
  }

  const page = pageRecords(records, input.limit ?? 50, input.cursor);
  return {
    status: "ok",
    filters,
    queue: page.page.map((record) => ({
      artifactId: record.artifactId,
      ...(record.pairId ? { pairId: record.pairId } : {}),
      ...(record.phaseId ? { phaseId: record.phaseId } : {}),
      artifactType: record.artifactType,
      ...(record.workCardId ? { workCardId: record.workCardId } : {}),
      ...(record.title ? { title: record.title } : {}),
      normalizedReviewStatus: "awaiting_architect_review",
      sourceReviewStatus: record.reviewStatus,
      ...(record.submittedAt ? { submittedAt: record.submittedAt } : {}),
      modifiedAt: record.modifiedAt,
      ...(record.markdownPath ? { markdownPath: record.markdownPath } : {}),
      ...(record.jsonPath ? { jsonPath: record.jsonPath } : {}),
      pairStatus: synchronizationLabel(record),
      ...(record.sourceBundleId ? { sourceBundleId: record.sourceBundleId } : {}),
      ...(record.currentActionId ? { currentActionId: record.currentActionId } : {}),
      reviewNotices: record.warnings.map((message) => ({ code: "artifact_warning", message }))
    })),
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    totalReturned: page.page.length,
    truncated: page.truncated,
    warnings: catalog.warnings
  };
}

function safeControlFile(root: string, candidate: unknown): { relativePath?: string; exists?: boolean; modifiedAt?: string; reason?: string } | undefined {
  const relativePath = stringValue(candidate);
  if (!relativePath) {
    return undefined;
  }
  try {
    const safePath = assertSafeRelativePath(relativePath);
    const normalized = normalizeSlashPath(safePath);
    const absolutePath = path.join(root, ...normalized.split("/"));
    const exists = fsSync.existsSync(absolutePath);
    const stats = exists ? fsSync.statSync(absolutePath) : undefined;
    return {
      relativePath: normalized,
      exists,
      ...(stats ? { modifiedAt: stats.mtime.toISOString() } : {}),
      ...(exists ? {} : { reason: "missing" })
    };
  } catch {
    return { reason: "path_rejected" };
  }
}

export async function currentActionContext(input: CurrentActionContextInput, config: AppConfig) {
  const workspace = resolveWorkspace(input.workspaceId, config);
  const phaseId = validateArtifactFilter(input.phaseId, "phaseId");
  const candidates = [
    ...(phaseId ? [`planning/phases/${phaseId}/current-action.json`, `planning/phases/${phaseId}/workflow/current-action.json`] : []),
    ...CURRENT_ACTION_PATHS
  ];
  const checkedLocations: Array<{ relativePath: string; exists: boolean; valid?: boolean; reasonCode?: string }> = [];

  for (const relativePath of candidates) {
    const absolutePath = path.join(workspace.root, ...relativePath.split("/"));
    if (!fsSync.existsSync(absolutePath)) {
      checkedLocations.push({ relativePath, exists: false, reasonCode: "missing" });
      continue;
    }
    const parsed = await safeJsonParse(absolutePath);
    if (!parsed.validJson || !isObject(parsed.parsed)) {
      checkedLocations.push({ relativePath, exists: true, valid: false, reasonCode: "invalid_json" });
      return {
        status: "invalid_state",
        reasonCode: "current_action_authority_invalid_json",
        workspaceId: workspace.workspaceId,
        workspaceRoot: workspace.root,
        configurationSource: "structured_current_action_file",
        checkedLocations,
        invalidCandidatePresent: true,
        authoritySource: { path: relativePath },
        currentAction: null,
        expectedOutput: null,
        sourceBundle: null,
        controllingFiles: [{ relativePath, exists: true, reason: "invalid_json" }],
        remediation: "Fix or remove the invalid structured current-action JSON file.",
        warnings: [`Current-action authority is invalid JSON: ${relativePath}`]
      };
    }
    checkedLocations.push({ relativePath, exists: true, valid: true, reasonCode: "selected" });
    const state = parsed.parsed;
    const controllingFiles = Array.isArray(state.controllingFiles)
      ? state.controllingFiles.map((entry) => safeControlFile(workspace.root, isObject(entry) ? entry.relativePath ?? entry.path : entry)).filter(Boolean)
      : [];
    const sourceBundle = isObject(state.sourceBundle)
      ? {
          ...(stringValue(state.sourceBundle.id) ? { sourceBundleId: stringValue(state.sourceBundle.id) } : {}),
          artifacts: Array.isArray(state.sourceBundle.artifacts)
            ? state.sourceBundle.artifacts.filter(isObject).map((entry) => ({
                ...(stringValue(entry.artifactId) ? { artifactId: stringValue(entry.artifactId) } : {}),
                ...(stringValue(entry.relativePath) ? { relativePath: normalizeSlashPath(assertSafeRelativePath(String(entry.relativePath))) } : {})
              }))
            : []
        }
      : null;

    return {
      status: stringValue(state.currentAction) || stringValue(state.currentActionId) ? "ok" : "no_current_action",
      reasonCode: stringValue(state.currentAction) || stringValue(state.currentActionId) ? "configured" : "configured_without_current_action",
      workspaceId: workspace.workspaceId,
      workspaceRoot: workspace.root,
      ...(phaseId ? { phaseId } : {}),
      authority: { path: relativePath },
      authoritySource: { type: "structured_current_action_file", path: relativePath },
      configurationSource: "structured_current_action_file",
      checkedLocations,
      invalidCandidatePresent: false,
      currentAction: stringValue(state.currentAction) ?? null,
      currentActionId: stringValue(state.currentActionId),
      expectedOutput: state.expectedOutput ?? null,
      sourceBundle,
      controllingFiles,
      blockers: controllingFiles
        .filter((entry): entry is { relativePath?: string; reason?: string } => Boolean(entry && (entry as { exists?: boolean }).exists === false || (entry as { reason?: string }).reason === "path_rejected"))
        .map((entry) => ({
          code: entry.reason === "path_rejected" ? "path_rejected" : "missing_controlling_file",
          message: entry.reason === "path_rejected" ? "A controlling file path was rejected." : "A controlling file is missing.",
          ...(entry.relativePath ? { relativePath: entry.relativePath } : {})
        })),
      warnings: []
    };
  }

  return {
    status: "not_configured",
    reasonCode: "current_action_authority_not_configured",
    workspaceId: workspace.workspaceId,
    workspaceRoot: workspace.root,
    ...(phaseId ? { phaseId } : {}),
    configurationSource: "structured_current_action_file",
    checkedLocations,
    invalidCandidatePresent: false,
    currentAction: null,
    expectedOutput: null,
    sourceBundle: null,
    controllingFiles: [],
    remediation: "Create an approved structured current-action authority file in one of the checked locations, or leave this unset when no current action is configured.",
    warnings: ["No structured current-action authority is configured for this workspace."]
  };
}
