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

const CANONICAL_BODY_LINE_PATTERN =
  /^(?:---|\+\+\+|Artifact\.Revision\s*=|participationRole\s*=|schemaVersion\s*=|artifactType\s*=|Project\.ArtifactKey\s*=|projectSlug\s*=|workflowData\s*=|Document\.(?:Status|Notes|ReviewedAt)\s*=|disposition\.)/imu;

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

interface EvidenceFile {
  relativePath: string;
  absolutePath: string;
  raw: string;
  sha256: string;
  metadata: Record<string, unknown>;
  artifactRevision: number;
}

interface Identity {
  projectSlug: string;
  projectArtifactKey?: string;
}

interface EvidenceSnapshot {
  workspaceId: string;
  root: string;
  intake: EvidenceFile;
  prompt: EvidenceFile;
  identity: Identity;
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

interface ParsedInterviewDocument {
  artifactRevision: number;
  disposition: "Pending" | "Approved" | string;
  body: string;
  identity: Identity;
  sourceRevisions: SourceRevision[];
}

interface SourceRevision {
  path: string;
  revision: number;
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

function positiveRevision(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new AppError("INVALID_INPUT", `${label} must have a positive artifact revision.`);
  }
  return value;
}

function dispositionStatus(metadata: Record<string, unknown>): string | undefined {
  const disposition = isObject(metadata.documentDisposition) ? metadata.documentDisposition : isObject(metadata.disposition) ? metadata.disposition : undefined;
  return stringValue(disposition?.status);
}

async function sha256File(absolutePath: string): Promise<string> {
  return crypto.createHash("sha256").update(await fs.readFile(absolutePath)).digest("hex");
}

function sha256Text(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

async function readJsonEvidence(root: string, relativePath: string): Promise<EvidenceFile> {
  const absolutePath = path.join(root, ...relativePath.split("/"));
  const raw = await fs.readFile(absolutePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new AppError("INVALID_INPUT", "Canonical evidence JSON is malformed.", {
      relativePath,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (!isObject(parsed)) {
    throw new AppError("INVALID_INPUT", "Canonical evidence JSON must be an object.", { relativePath });
  }
  return {
    relativePath,
    absolutePath,
    raw,
    sha256: sha256Text(raw),
    metadata: parsed,
    artifactRevision: positiveRevision(parsed.artifactRevision, relativePath)
  };
}

async function listJsonEvidence(root: string, relativeDir: string): Promise<string[]> {
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
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => `${relativeDir}/${entry.name}`)
    .sort((left, right) => left.localeCompare(right));
}

function assertCurrentApprovedIntake(evidence: EvidenceFile): void {
  if (evidence.metadata.artifactType !== "project-intake") {
    throw new AppError("INVALID_INPUT", "Project Intake evidence has the wrong artifactType.", { relativePath: evidence.relativePath });
  }
  if (evidence.metadata.participationRole === "historical") {
    throw new AppError("INVALID_INPUT", "Historical Project Intake evidence cannot be used.", { relativePath: evidence.relativePath });
  }
  if (dispositionStatus(evidence.metadata) !== "Approved") {
    throw new AppError("INVALID_INPUT", "Project Intake evidence must be Approved.", { relativePath: evidence.relativePath });
  }
}

function sourceRevisions(metadata: Record<string, unknown>): SourceRevision[] {
  if (!Array.isArray(metadata.sourceRevisions)) {
    return [];
  }
  return metadata.sourceRevisions
    .filter(isObject)
    .map((entry) => ({
      path: normalizeSlashPath(String(entry.path ?? "")),
      revision: Number(entry.revision)
    }))
    .filter((entry) => entry.path && Number.isInteger(entry.revision) && entry.revision > 0);
}

function promptWorkflowData(metadata: Record<string, unknown>): Record<string, unknown> {
  if (!isObject(metadata.workflowData)) {
    throw new AppError("INVALID_INPUT", "Architect Interview Prompt must include workflowData.");
  }
  return metadata.workflowData;
}

function assertCurrentApprovedPrompt(prompt: EvidenceFile, intake: EvidenceFile): void {
  if (prompt.metadata.artifactType !== "project-architect-interview-prompt") {
    throw new AppError("INVALID_INPUT", "Architect Interview Prompt evidence has the wrong artifactType.", { relativePath: prompt.relativePath });
  }
  if (prompt.metadata.participationRole !== "nonReviewHandoff") {
    throw new AppError("INVALID_INPUT", "Architect Interview Prompt must use participationRole nonReviewHandoff.", { relativePath: prompt.relativePath });
  }
  if (dispositionStatus(prompt.metadata) !== "Approved") {
    throw new AppError("INVALID_INPUT", "Architect Interview Prompt evidence must be Approved.", { relativePath: prompt.relativePath });
  }
  const matchedSource = sourceRevisions(prompt.metadata).some(
    (entry) => entry.path === intake.relativePath && entry.revision === intake.artifactRevision
  );
  if (!matchedSource) {
    throw new AppError("INVALID_INPUT", "Architect Interview Prompt does not link to the current Approved Project Intake revision.", {
      promptPath: prompt.relativePath,
      intakePath: intake.relativePath,
      intakeRevision: intake.artifactRevision
    });
  }
  const targets = isObject(promptWorkflowData(prompt.metadata).architectOutputTargets)
    ? promptWorkflowData(prompt.metadata).architectOutputTargets as Record<string, unknown>
    : undefined;
  if (!stringValue(targets?.markdown)) {
    throw new AppError("INVALID_INPUT", "Architect Interview Prompt must define workflowData.architectOutputTargets.markdown.", {
      relativePath: prompt.relativePath
    });
  }
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

function identityFromEvidence(intake: EvidenceFile, prompt: EvidenceFile): Identity {
  const intakeSlug = stringValue(intake.metadata.projectSlug);
  const promptSlug = stringValue(prompt.metadata.projectSlug);
  if (intakeSlug && promptSlug && intakeSlug !== promptSlug) {
    throw new AppError("INVALID_INPUT", "Project slug identity conflicts between Intake and Prompt evidence.");
  }

  const intakeArtifactKey = stringValue(intake.metadata.projectArtifactKey) ?? stringValue(intake.metadata["Project.ArtifactKey"]);
  const promptArtifactKey = stringValue(prompt.metadata.projectArtifactKey) ?? stringValue(prompt.metadata["Project.ArtifactKey"]);
  if (intakeArtifactKey && promptArtifactKey && intakeArtifactKey !== promptArtifactKey) {
    throw new AppError("INVALID_INPUT", "Project ArtifactKey identity conflicts between Intake and Prompt evidence.");
  }

  const projectSlug = promptSlug ?? intakeSlug ?? promptArtifactKey ?? intakeArtifactKey;
  if (!projectSlug) {
    throw new AppError("INVALID_INPUT", "Project identity must include projectSlug or Project.ArtifactKey.");
  }

  return {
    projectSlug,
    ...(promptArtifactKey ?? intakeArtifactKey ? { projectArtifactKey: promptArtifactKey ?? intakeArtifactKey } : {})
  };
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

function normalizeMarkdownBody(value: string): string {
  return `${value.replace(/\r\n/gu, "\n").trim()}\n`;
}

function field(content: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^${escaped}\\s*=\\s*(?<value>.*)$`, "imu").exec(content)?.groups?.value.trim();
}

function parseRevisionLine(line: string): SourceRevision | undefined {
  const match = /^-\s*path:\s*(?<path>\S+)\s+revision:\s*(?<revision>\d+)\s*$/u.exec(line.trim());
  return match?.groups ? { path: normalizeSlashPath(match.groups.path), revision: Number(match.groups.revision) } : undefined;
}

function section(content: string, heading: string): string | undefined {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, "imu").exec(content);
  return match?.[1]?.trim();
}

export function parseArchitectInterviewDocument(content: string): ParsedInterviewDocument {
  const normalized = content.replace(/\r\n/gu, "\n");
  if (field(normalized, "schemaVersion") !== "1" || field(normalized, "artifactType") !== "project-architect-interview") {
    throw new AppError("INVALID_INPUT", "Existing Architect Interview target is not a valid canonical Interview document.");
  }
  const revision = Number(field(normalized, "Artifact.Revision"));
  if (!Number.isInteger(revision) || revision <= 0) {
    throw new AppError("INVALID_INPUT", "Existing Architect Interview target has an invalid revision.");
  }
  if (field(normalized, "participationRole") !== "gatingReview") {
    throw new AppError("INVALID_INPUT", "Existing Architect Interview target has the wrong participationRole.");
  }

  const sourceSection = section(normalized, "Source Revisions");
  const sourceRevisionEntries = sourceSection
    ?.split("\n")
    .map(parseRevisionLine)
    .filter((entry): entry is SourceRevision => Boolean(entry)) ?? [];
  if (sourceRevisionEntries.length !== 2) {
    throw new AppError("INVALID_INPUT", "Existing Architect Interview target has invalid source revisions.");
  }

  const bodyMatch = /^##\s+Source Revisions\s*$[\s\S]*?(?=^##\s+)/imu.exec(normalized);
  const bodyStart = bodyMatch ? bodyMatch.index + bodyMatch[0].length : -1;
  const dispositionIndex = normalized.search(/^##\s+Document Disposition\s*$/imu);
  if (bodyStart < 0 || dispositionIndex < 0 || dispositionIndex <= bodyStart) {
    throw new AppError("INVALID_INPUT", "Existing Architect Interview target has an invalid body envelope.");
  }

  return {
    artifactRevision: revision,
    disposition: field(normalized, "Document.Status") ?? "",
    body: normalizeMarkdownBody(normalized.slice(bodyStart, dispositionIndex)),
    identity: {
      projectSlug: field(normalized, "projectSlug") ?? "",
      ...(field(normalized, "Project.ArtifactKey") ? { projectArtifactKey: field(normalized, "Project.ArtifactKey") } : {})
    },
    sourceRevisions: sourceRevisionEntries
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
  const intakeFiles = await Promise.all((await listJsonEvidence(root, INTAKE_DIR)).map((entry) => readJsonEvidence(root, entry)));
  const intakeCandidates = intakeFiles.filter((entry) => {
    assertCurrentApprovedIntake(entry);
    return true;
  });
  const intake = oneEvidence(intakeCandidates, "Project Intake");

  const promptFiles = await Promise.all((await listJsonEvidence(root, PROMPT_DIR)).map((entry) => readJsonEvidence(root, entry)));
  const promptCandidates = promptFiles.filter((entry) => {
    assertCurrentApprovedPrompt(entry, intake);
    return true;
  });
  const prompt = oneEvidence(promptCandidates, "Architect Interview Prompt");
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
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameIdentity(left: Identity, right: Identity): boolean {
  return left.projectSlug === right.projectSlug && (left.projectArtifactKey ?? "") === (right.projectArtifactKey ?? "");
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

function titleFromEvidence(evidence: EvidenceSnapshot): string {
  return stringValue(evidence.intake.metadata.projectName) ?? evidence.identity.projectSlug;
}

function buildDocument(evidence: EvidenceSnapshot, body: string, artifactRevision: number): string {
  const artifactKey = evidence.identity.projectArtifactKey ? `Project.ArtifactKey=${evidence.identity.projectArtifactKey}\n` : "";
  const sources = expectedSourceRevisions(evidence)
    .map((entry) => `- path: ${entry.path} revision: ${entry.revision}`)
    .join("\n");
  return `# Project Architect Interview - ${titleFromEvidence(evidence)}
schemaVersion=1
artifactType=project-architect-interview
Artifact.Revision=${artifactRevision}
participationRole=gatingReview
projectSlug=${evidence.identity.projectSlug}
${artifactKey}workflowData={}

## Source Revisions
${sources}

${normalizeMarkdownBody(body)}
## Document Disposition

Document.Status=Pending
Document.Notes=
Document.ReviewedAt=null
`;
}

function comparableEvidence(evidence: EvidenceSnapshot): string {
  return JSON.stringify({
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
