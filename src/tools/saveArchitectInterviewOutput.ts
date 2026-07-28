import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

import { z } from "zod";

import { type AppConfig } from "../config.js";
import { assertMarkdownArtifactPath } from "../security/filePolicy.js";
import { assertSafeRelativePath, isPathInside, toRootRelativePath } from "../security/pathPolicy.js";
import { AppError } from "../utils/errors.js";
import { assertWorkspaceAuthorityAllowed, resolveWorkspaceAuthority } from "../workspaceAuthority.js";
import { resolveWorkspace } from "../workspaces.js";
import { withAudit } from "./common.js";
import { MAX_MARKDOWN_ARTIFACT_CONTENT_LENGTH } from "./inputLimits.js";

const INTAKE_DIR = "planning/project/Project_Intake";
const PROMPT_DIR = "planning/project/Project_Architect_Interview_Prompts";
const INTERVIEW_DIR = "planning/project/Project_Architect_Interviews";
const TARGET_PREFIX = `${INTERVIEW_DIR}/`;
const METADATA_OPEN_DELIMITER = "<!-- CHAMPCITY-METADATA";
const METADATA_CLOSE_DELIMITER = "CHAMPCITY-METADATA -->";
const PARTICIPATION_ROLES = ["gatingReview", "compoundGatingReview", "nonReviewHandoff", "contextOnly", "historical"] as const;
const DOCUMENT_DISPOSITION_STATUSES = ["Pending", "Approved", "Rejected", "RevisionRequested"] as const;

const CANONICAL_BODY_LINE_PATTERN =
  /^(?:<!--\s*CHAMPCITY-METADATA|CHAMPCITY-METADATA\s*-->|---|\+\+\+|Artifact\.Revision\s*=|participationRole\s*=|schemaVersion\s*=|artifactType\s*=|Project\.ArtifactKey\s*=|projectSlug\s*=|workflowData\s*=|Document\.(?:Status|Notes|ReviewedAt)\s*=|disposition\.)/imu;

export const SaveArchitectInterviewOutputParamsSchema = z
  .object({
    markdownBody: z
      .string()
      .max(MAX_MARKDOWN_ARTIFACT_CONTENT_LENGTH)
      .refine((value) => value.trim().length > 0, "markdownBody must not be empty.")
      .refine((value) => !CANONICAL_BODY_LINE_PATTERN.test(value), "markdownBody must not include canonical metadata delimiters or fields.")
  })
  .strict();

export type SaveArchitectInterviewOutputParams = z.infer<typeof SaveArchitectInterviewOutputParamsSchema>;

export interface SaveArchitectInterviewOutputInput extends SaveArchitectInterviewOutputParams {
  workspaceId: string;
}

export interface SaveArchitectInterviewOutputResult {
  status: "saved" | "already_saved";
  workspaceId: string;
  relativePath: string;
  artifactRevision: number;
  disposition: "Pending";
  sizeBytes: number;
  sha256: string;
}

interface SourceRevision {
  path: string;
  revision: number;
}

interface CanonicalDocumentMetadata {
  schemaVersion: 1;
  artifactType: string;
  artifactRevision: number;
  participationRole: (typeof PARTICIPATION_ROLES)[number];
  identity: Record<string, unknown>;
  sourceRevisions: SourceRevision[];
  workflowData: Record<string, unknown>;
  documentDisposition: {
    status: (typeof DOCUMENT_DISPOSITION_STATUSES)[number];
    notes: string;
    reviewedAt: string | null;
  };
}

interface ParsedCanonicalMarkdownDocument {
  metadata: CanonicalDocumentMetadata;
  bodyMarkdown: string;
}

interface EvidenceFile extends ParsedCanonicalMarkdownDocument {
  relativePath: string;
  absolutePath: string;
  raw: string;
  sha256: string;
  artifactRevision: number;
}

interface EvidenceSnapshot {
  workspaceId: string;
  root: string;
  intake: EvidenceFile;
  prompt: EvidenceFile;
  identity: Record<string, unknown>;
  targetRelativePath: string;
  targetAbsolutePath: string;
  targetState: TargetState;
}

interface TargetState {
  exists: boolean;
  sha256?: string;
  raw?: string;
  parsed?: ParsedInterviewDocument;
}

export interface ParsedInterviewDocument {
  artifactRevision: number;
  disposition: "Pending" | "Approved" | string;
  body: string;
  identity: Record<string, unknown>;
  sourceRevisions: SourceRevision[];
  metadata: CanonicalDocumentMetadata;
}

export interface SaveArchitectInterviewOutputTestHooks {
  beforeEvidenceRecheck?: () => void | Promise<void>;
  afterInstall?: (targetPath: string) => void | Promise<void>;
}

function normalizeSlashPath(value: string): string {
  return value.split(/[\\/]+/u).filter(Boolean).join("/");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError("INVALID_INPUT", `Canonical metadata requires ${field}.`);
  }
  return value;
}

function requiredPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new AppError("INVALID_INPUT", `Canonical metadata requires positive integer ${field}.`);
  }
  return value;
}

function requiredRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isObject(value)) {
    throw new AppError("INVALID_INPUT", `Canonical metadata requires object ${field}.`);
  }
  return value;
}

function requiredParticipationRole(value: unknown): CanonicalDocumentMetadata["participationRole"] {
  if (PARTICIPATION_ROLES.includes(value as CanonicalDocumentMetadata["participationRole"])) {
    return value as CanonicalDocumentMetadata["participationRole"];
  }
  throw new AppError("INVALID_INPUT", "Canonical metadata participationRole is not supported.");
}

function sourceRevisionArray(value: unknown): SourceRevision[] {
  if (!Array.isArray(value)) {
    throw new AppError("INVALID_INPUT", "Canonical metadata sourceRevisions must be an array.");
  }
  return value.map((entry) => {
    const record = requiredRecord(entry, "sourceRevisions entry");
    return {
      path: normalizeSlashPath(requiredString(record.path, "sourceRevisions.path")),
      revision: requiredPositiveInteger(record.revision, "sourceRevisions.revision")
    };
  });
}

function dispositionValue(value: unknown): CanonicalDocumentMetadata["documentDisposition"] {
  const record = requiredRecord(value, "documentDisposition");
  const status = record.status;
  if (!DOCUMENT_DISPOSITION_STATUSES.includes(status as CanonicalDocumentMetadata["documentDisposition"]["status"])) {
    throw new AppError("INVALID_INPUT", "Canonical metadata documentDisposition.status is not supported.");
  }
  const notes = typeof record.notes === "string" ? record.notes : "";
  const reviewedAt = record.reviewedAt === null || typeof record.reviewedAt === "string" ? record.reviewedAt : null;
  return { status: status as CanonicalDocumentMetadata["documentDisposition"]["status"], notes, reviewedAt };
}

function validateCanonicalMetadata(input: unknown): CanonicalDocumentMetadata {
  const value = requiredRecord(input, "metadata");
  if (value.schemaVersion !== 1) {
    throw new AppError("INVALID_INPUT", "Canonical metadata schemaVersion must be 1.");
  }

  return {
    schemaVersion: 1,
    artifactType: requiredString(value.artifactType, "artifactType"),
    artifactRevision: requiredPositiveInteger(value.artifactRevision, "artifactRevision"),
    participationRole: requiredParticipationRole(value.participationRole),
    identity: requiredRecord(value.identity, "identity"),
    sourceRevisions: sourceRevisionArray(value.sourceRevisions),
    workflowData: requiredRecord(value.workflowData, "workflowData"),
    documentDisposition: dispositionValue(value.documentDisposition)
  };
}

function parseCanonicalMarkdownDocument(content: string, relativePath = "document"): ParsedCanonicalMarkdownDocument {
  const withoutBom = content.startsWith("\uFEFF") ? content.slice(1) : content;
  if (!withoutBom.startsWith(METADATA_OPEN_DELIMITER)) {
    throw new AppError("INVALID_INPUT", "Canonical document must begin with CHAMPCITY metadata.", { relativePath });
  }

  const closeIndex = withoutBom.indexOf(METADATA_CLOSE_DELIMITER);
  if (closeIndex < 0) {
    throw new AppError("INVALID_INPUT", "Canonical document metadata block is missing its closing delimiter.", { relativePath });
  }
  if (withoutBom.indexOf(METADATA_OPEN_DELIMITER, METADATA_OPEN_DELIMITER.length) >= 0) {
    throw new AppError("INVALID_INPUT", "Canonical document contains a duplicate metadata block.", { relativePath });
  }
  if (withoutBom.indexOf(METADATA_CLOSE_DELIMITER, closeIndex + METADATA_CLOSE_DELIMITER.length) >= 0) {
    throw new AppError("INVALID_INPUT", "Canonical document contains more than one metadata closing delimiter.", { relativePath });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutBom.slice(METADATA_OPEN_DELIMITER.length, closeIndex).trim());
  } catch (error) {
    throw new AppError("INVALID_INPUT", "Canonical document metadata is malformed JSON.", {
      relativePath,
      cause: error instanceof Error ? error.message : String(error)
    });
  }

  return {
    metadata: validateCanonicalMetadata(parsed),
    bodyMarkdown: withoutBom.slice(closeIndex + METADATA_CLOSE_DELIMITER.length).replace(/^(?:\r?\n){1,2}/u, "")
  };
}

function normalizeMarkdownBody(value: string): string {
  return `${value.replace(/\r\n?/gu, "\n").replace(/\n*$/u, "")}\n`;
}

function serializeCanonicalMarkdownDocument(metadata: CanonicalDocumentMetadata, bodyMarkdown: string): string {
  const normalized = validateCanonicalMetadata(metadata);
  return [
    METADATA_OPEN_DELIMITER,
    JSON.stringify(normalized, null, 2),
    METADATA_CLOSE_DELIMITER,
    "",
    normalizeMarkdownBody(bodyMarkdown)
  ].join("\n");
}

function sha256Text(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

async function readMarkdownEvidence(root: string, relativePath: string): Promise<EvidenceFile | undefined> {
  const absolutePath = path.join(root, ...relativePath.split("/"));
  const raw = await fs.readFile(absolutePath, "utf8");
  if (!raw.startsWith(METADATA_OPEN_DELIMITER)) {
    return undefined;
  }

  const parsed = parseCanonicalMarkdownDocument(raw, relativePath);
  return {
    ...parsed,
    relativePath,
    absolutePath,
    raw,
    sha256: sha256Text(raw),
    artifactRevision: parsed.metadata.artifactRevision
  };
}

async function listMarkdownEvidence(root: string, relativeDir: string): Promise<string[]> {
  const absoluteDir = path.join(root, ...relativeDir.split("/"));
  let entries: fsSync.Dirent[];
  try {
    entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  } catch (error) {
    throw new AppError("INVALID_INPUT", "Canonical evidence directory is missing.", {
      relativePath: relativeDir,
      cause: error instanceof Error ? error.message : String(error)
    });
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => `${relativeDir}/${entry.name}`)
    .sort((left, right) => left.localeCompare(right));
}

function isCurrentApprovedIntake(evidence: EvidenceFile): boolean {
  return (
    evidence.metadata.artifactType === "project-intake" &&
    evidence.metadata.participationRole !== "historical" &&
    evidence.metadata.artifactRevision > 0 &&
    evidence.metadata.documentDisposition.status === "Approved"
  );
}

function sourceRevisions(metadata: CanonicalDocumentMetadata): SourceRevision[] {
  return metadata.sourceRevisions.map((entry) => ({
    path: normalizeSlashPath(entry.path),
    revision: entry.revision
  }));
}

function promptWorkflowData(metadata: CanonicalDocumentMetadata): Record<string, unknown> {
  return metadata.workflowData;
}

function isCurrentApprovedPrompt(prompt: EvidenceFile, intake: EvidenceFile): boolean {
  if (
    prompt.metadata.artifactType !== "project-architect-interview-prompt" ||
    prompt.metadata.participationRole !== "nonReviewHandoff" ||
    prompt.metadata.documentDisposition.status !== "Approved"
  ) {
    return false;
  }

  const matchedSource = sourceRevisions(prompt.metadata).some(
    (entry) => entry.path === intake.relativePath && entry.revision === intake.artifactRevision
  );
  if (!matchedSource) {
    return false;
  }

  const targets = isObject(promptWorkflowData(prompt.metadata).architectOutputTargets)
    ? (promptWorkflowData(prompt.metadata).architectOutputTargets as Record<string, unknown>)
    : undefined;
  return Boolean(stringValue(targets?.markdown));
}

async function currentCanonicalEvidence(root: string, relativeDir: string): Promise<EvidenceFile[]> {
  const candidates = await Promise.all((await listMarkdownEvidence(root, relativeDir)).map((entry) => readMarkdownEvidence(root, entry)));
  return candidates.filter((entry): entry is EvidenceFile => Boolean(entry));
}

function oneEvidence(candidates: EvidenceFile[], label: string): EvidenceFile {
  if (candidates.length !== 1) {
    throw new AppError("INVALID_INPUT", `Expected exactly one current Approved ${label}.`, {
      count: candidates.length,
      relativePaths: candidates.map((candidate) => candidate.relativePath)
    });
  }
  return candidates[0];
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function identityFromEvidence(intake: EvidenceFile, prompt: EvidenceFile): Record<string, unknown> {
  const identity: Record<string, unknown> = {};
  for (const source of [intake.metadata.identity, prompt.metadata.identity]) {
    for (const [key, value] of Object.entries(source)) {
      if (key in identity && stableJson(identity[key]) !== stableJson(value)) {
        throw new AppError("INVALID_INPUT", `Project identity conflicts between Intake and Prompt evidence for ${key}.`);
      }
      identity[key] = value;
    }
  }

  if (Object.keys(identity).length === 0) {
    throw new AppError("INVALID_INPUT", "Project identity must include at least one canonical identity value.");
  }

  return identity;
}

function targetFromPrompt(root: string, prompt: EvidenceFile): { relativePath: string; absolutePath: string } {
  const targets = promptWorkflowData(prompt.metadata).architectOutputTargets as Record<string, unknown>;
  const rawTarget = stringValue(targets.markdown);
  if (!rawTarget) {
    throw new AppError("INVALID_INPUT", "Architect Interview Prompt target is missing.");
  }

  const safeRelativePath = normalizeSlashPath(assertSafeRelativePath(rawTarget));
  if (!safeRelativePath.startsWith(TARGET_PREFIX) || !safeRelativePath.endsWith(".md")) {
    throw new AppError("PATH_DENIED", "Architect Interview target must stay under planning/project/Project_Architect_Interviews/ and end in .md.", {
      relativePath: safeRelativePath
    });
  }

  const absolutePath = path.resolve(root, ...safeRelativePath.split("/"));
  if (!isPathInside(absolutePath, root)) {
    throw new AppError("PATH_DENIED", "Architect Interview target escapes the selected workspace.", { relativePath: safeRelativePath });
  }

  return { relativePath: safeRelativePath, absolutePath };
}

async function assertNoSymlinkSegments(root: string, absolutePath: string, relativePath: string): Promise<void> {
  const segments = path.relative(root, absolutePath).split(path.sep).filter(Boolean);
  let cursor = root;
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    try {
      const stats = await fs.lstat(cursor);
      if (stats.isSymbolicLink()) {
        throw new AppError("REPARSE_POINT_REJECTED", "Architect Interview target must not traverse symlinks or reparse points.", {
          relativePath
        });
      }
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
}

async function assertTargetSafe(root: string, absolutePath: string, relativePath: string): Promise<void> {
  assertMarkdownArtifactPath(absolutePath, relativePath);
  await assertNoSymlinkSegments(root, absolutePath, relativePath);
  const parent = path.dirname(absolutePath);
  await fs.mkdir(parent, { recursive: true });
  const parentRealPath = await fs.realpath(parent);
  if (!isPathInside(parentRealPath, root)) {
    throw new AppError("PATH_DENIED", "Architect Interview target parent escapes the selected workspace.", { relativePath });
  }

  try {
    const stats = await fs.lstat(absolutePath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new AppError("FILE_DENIED", "Existing Architect Interview target must be a regular file.", { relativePath });
    }
    const realTarget = await fs.realpath(absolutePath);
    if (!isPathInside(realTarget, root)) {
      throw new AppError("PATH_DENIED", "Architect Interview target escapes the selected workspace.", { relativePath });
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

export function parseArchitectInterviewDocument(content: string): ParsedInterviewDocument {
  const parsed = parseCanonicalMarkdownDocument(content);
  if (parsed.metadata.artifactType !== "project-architect-interview") {
    throw new AppError("INVALID_INPUT", "Existing Architect Interview target is not a valid canonical Interview document.");
  }
  if (parsed.metadata.participationRole !== "gatingReview") {
    throw new AppError("INVALID_INPUT", "Existing Architect Interview target has the wrong participationRole.");
  }
  if (parsed.metadata.sourceRevisions.length !== 2) {
    throw new AppError("INVALID_INPUT", "Existing Architect Interview target has invalid source revisions.");
  }

  return {
    artifactRevision: parsed.metadata.artifactRevision,
    disposition: parsed.metadata.documentDisposition.status,
    body: normalizeMarkdownBody(parsed.bodyMarkdown),
    identity: parsed.metadata.identity,
    sourceRevisions: sourceRevisions(parsed.metadata),
    metadata: parsed.metadata
  };
}

async function readTargetState(absolutePath: string): Promise<TargetState> {
  try {
    const stats = await fs.lstat(absolutePath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new AppError("FILE_DENIED", "Existing Architect Interview target must be a regular file.");
    }
    const raw = await fs.readFile(absolutePath, "utf8");
    return {
      exists: true,
      raw,
      sha256: sha256Text(raw),
      parsed: parseArchitectInterviewDocument(raw)
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { exists: false };
    }
    throw error;
  }
}

async function resolveEvidence(workspaceId: string, config: AppConfig): Promise<EvidenceSnapshot> {
  const workspace = resolveWorkspace(workspaceId, config);
  const root = workspace.root;
  const intake = oneEvidence((await currentCanonicalEvidence(root, INTAKE_DIR)).filter(isCurrentApprovedIntake), "Project Intake");
  const prompt = oneEvidence((await currentCanonicalEvidence(root, PROMPT_DIR)).filter((entry) => isCurrentApprovedPrompt(entry, intake)), "Architect Interview Prompt");
  const target = targetFromPrompt(root, prompt);
  await assertTargetSafe(root, target.absolutePath, target.relativePath);

  return {
    workspaceId: workspace.workspaceId,
    root,
    intake,
    prompt,
    identity: identityFromEvidence(intake, prompt),
    targetRelativePath: target.relativePath,
    targetAbsolutePath: target.absolutePath,
    targetState: await readTargetState(target.absolutePath)
  };
}

function expectedSourceRevisions(evidence: EvidenceSnapshot): SourceRevision[] {
  return [
    { path: evidence.intake.relativePath, revision: evidence.intake.artifactRevision },
    { path: evidence.prompt.relativePath, revision: evidence.prompt.artifactRevision }
  ];
}

function sameSourceRevisions(left: SourceRevision[], right: SourceRevision[]): boolean {
  return stableJson(left) === stableJson(right);
}

function sameIdentity(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return stableJson(left) === stableJson(right);
}

function assertExistingTargetCompatible(existing: ParsedInterviewDocument, evidence: EvidenceSnapshot): void {
  if (existing.disposition === "Approved") {
    throw new AppError("APPROVAL_REQUIRED", "Approved Architect Interview target cannot be overwritten.", {
      relativePath: evidence.targetRelativePath
    });
  }
  if (!sameIdentity(existing.identity, evidence.identity)) {
    throw new AppError("INVALID_INPUT", "Existing Architect Interview target identity does not match current evidence.", {
      relativePath: evidence.targetRelativePath
    });
  }
  if (!sameSourceRevisions(existing.sourceRevisions, expectedSourceRevisions(evidence))) {
    throw new AppError("INVALID_INPUT", "Existing Architect Interview target source revisions do not match current evidence.", {
      relativePath: evidence.targetRelativePath
    });
  }
}

function buildMetadata(evidence: EvidenceSnapshot, artifactRevision: number): CanonicalDocumentMetadata {
  return validateCanonicalMetadata({
    schemaVersion: 1,
    artifactType: "project-architect-interview",
    artifactRevision,
    participationRole: "gatingReview",
    identity: evidence.identity,
    sourceRevisions: expectedSourceRevisions(evidence),
    workflowData: {},
    documentDisposition: {
      status: "Pending",
      notes: "",
      reviewedAt: null
    }
  });
}

function buildDocument(evidence: EvidenceSnapshot, body: string, artifactRevision: number): string {
  return serializeCanonicalMarkdownDocument(buildMetadata(evidence, artifactRevision), body);
}

function comparableEvidence(evidence: EvidenceSnapshot): string {
  return stableJson({
    workspaceId: evidence.workspaceId,
    root: evidence.root,
    intakePath: evidence.intake.relativePath,
    intakeRevision: evidence.intake.artifactRevision,
    intakeSha256: evidence.intake.sha256,
    promptPath: evidence.prompt.relativePath,
    promptRevision: evidence.prompt.artifactRevision,
    promptSha256: evidence.prompt.sha256,
    targetRelativePath: evidence.targetRelativePath,
    targetExists: evidence.targetState.exists,
    targetSha256: evidence.targetState.sha256
  });
}

async function installAndVerify(
  evidence: EvidenceSnapshot,
  content: string,
  hooks: SaveArchitectInterviewOutputTestHooks | undefined
): Promise<{ sizeBytes: number; sha256: string }> {
  const original = evidence.targetState.raw;
  const targetPath = evidence.targetAbsolutePath;
  const temporaryPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
  let installed = false;

  try {
    await fs.writeFile(temporaryPath, content, "utf8");
    await fs.rename(temporaryPath, targetPath);
    installed = true;
    await hooks?.afterInstall?.(targetPath);

    const reread = await fs.readFile(targetPath, "utf8");
    const parsed = parseArchitectInterviewDocument(reread);
    if (
      reread !== content ||
      !reread.startsWith(METADATA_OPEN_DELIMITER) ||
      !sameIdentity(parsed.identity, evidence.identity) ||
      !sameSourceRevisions(parsed.sourceRevisions, expectedSourceRevisions(evidence)) ||
      parsed.disposition !== "Pending"
    ) {
      throw new AppError("VERIFICATION_FAILED", "Installed Architect Interview failed canonical verification.");
    }

    return {
      sizeBytes: Buffer.byteLength(reread, "utf8"),
      sha256: sha256Text(reread)
    };
  } catch (error) {
    if (installed) {
      if (original !== undefined) {
        await fs.writeFile(targetPath, original, "utf8");
      } else {
        await fs.unlink(targetPath).catch(() => undefined);
      }
    }
    throw error;
  } finally {
    await fs.unlink(temporaryPath).catch(() => undefined);
  }
}

export async function saveArchitectInterviewOutput(
  rawInput: unknown,
  config: AppConfig,
  hooks?: SaveArchitectInterviewOutputTestHooks
): Promise<SaveArchitectInterviewOutputResult> {
  return withAudit(config, { toolName: "artifact_toolbox.save_architect_interview_output" }, async (updateAudit) => {
    const input = z.object({ workspaceId: z.string().min(1).max(64), ...SaveArchitectInterviewOutputParamsSchema.shape }).strict().parse(rawInput);
    if (!config.docsWritesAllowed) {
      throw new AppError("APPROVAL_REQUIRED", "save_architect_interview_output requires writeMode docs, patch, or elevated.");
    }

    const evidence = await resolveEvidence(input.workspaceId, config);
    const authority = resolveWorkspaceAuthority(evidence.workspaceId, config, "artifact_persistence", evidence.targetRelativePath);
    assertWorkspaceAuthorityAllowed(authority);

    const relativePath = toRootRelativePath(evidence.root, evidence.targetAbsolutePath);
    if (relativePath !== evidence.targetRelativePath) {
      throw new AppError("PATH_DENIED", "Architect Interview target path did not remain workspace-relative.", { relativePath });
    }

    const body = normalizeMarkdownBody(input.markdownBody);
    const existing = evidence.targetState.parsed;
    let artifactRevision = 1;
    if (existing) {
      assertExistingTargetCompatible(existing, evidence);
      if (existing.body === body) {
        const raw = evidence.targetState.raw ?? "";
        updateAudit({
          workspaceId: evidence.workspaceId,
          requestedPath: evidence.targetRelativePath,
          normalizedRelativePath: evidence.targetRelativePath,
          byteCount: Buffer.byteLength(raw, "utf8"),
          sha256: sha256Text(raw),
          status: "already_saved"
        });
        return {
          status: "already_saved",
          workspaceId: evidence.workspaceId,
          relativePath: evidence.targetRelativePath,
          artifactRevision: existing.artifactRevision,
          disposition: "Pending",
          sizeBytes: Buffer.byteLength(raw, "utf8"),
          sha256: sha256Text(raw)
        };
      }
      artifactRevision = existing.artifactRevision + 1;
    }

    await hooks?.beforeEvidenceRecheck?.();
    const rechecked = await resolveEvidence(input.workspaceId, config);
    if (comparableEvidence(rechecked) !== comparableEvidence(evidence)) {
      throw new AppError("VERIFICATION_FAILED", "Canonical evidence changed before Architect Interview save could be installed.", {
        relativePath: evidence.targetRelativePath
      });
    }

    const content = buildDocument(evidence, body, artifactRevision);
    const installed = await installAndVerify(evidence, content, hooks);
    updateAudit({
      workspaceId: evidence.workspaceId,
      requestedPath: evidence.targetRelativePath,
      normalizedRelativePath: evidence.targetRelativePath,
      byteCount: installed.sizeBytes,
      sha256: installed.sha256,
      status: "saved"
    });

    return {
      status: "saved",
      workspaceId: evidence.workspaceId,
      relativePath: evidence.targetRelativePath,
      artifactRevision,
      disposition: "Pending",
      sizeBytes: installed.sizeBytes,
      sha256: installed.sha256
    };
  });
}
