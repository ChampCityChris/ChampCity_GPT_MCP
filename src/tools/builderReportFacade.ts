import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { type AppConfig } from "../config.js";
import { assertReadableTextFile, getFilePolicyDenial } from "../security/filePolicy.js";
import { assertSafeRelativePath, isPathInside, resolveAllowedRoot, toRootRelativePath } from "../security/pathPolicy.js";
import { AppError } from "../utils/errors.js";
import { runGit } from "../utils/git.js";
import { resolveDefaultWorkspaceRoot } from "../workspaceRoot.js";
import { withAudit } from "./common.js";
import { MAX_RELATIVE_PATH_LENGTH } from "./inputLimits.js";

const DEFAULT_WORKSPACE_ID = "default";
const ALL_ALLOWED_WORKSPACE_ID = "all_allowed";
const DEFAULT_INDEX_MAX_RESULTS = 25;
const INDEX_MAX_RESULTS_CAP = 50;
const DEFAULT_SUMMARY_MAX_CHARS = 6000;
const SUMMARY_MAX_CHARS_CAP = 12_000;
const MAX_WORKSPACE_ID_LENGTH = 64;
const MAX_PHASE_FOLDER_LENGTH = 128;
const MAX_WORK_CARD_ID_LENGTH = 128;
const MAX_BUILDER_REPORT_BYTES = 1_000_000;
const MAX_TITLE_SCAN_BYTES = 64_000;

const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9_-]+$/u;
const PHASE_FOLDER_PATTERN = /^phase-[a-z0-9]+(?:[.-][a-z0-9]+)*$/iu;
const WORK_CARD_ID_PATTERN = /^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*$/u;
const REPORT_FILE_PATTERN = /^BUILDER_REPORT[^/\\]*\.md$/u;
const REPORT_RELATIVE_PATH_PATTERN = /^planning\/phases\/(?<phaseFolder>[^/]+)\/Builder_Reports\/(?<fileName>BUILDER_REPORT[^/]*\.md)$/u;

const BuilderReportIndexInputSchema = z.object({
  workspaceId: z.string().min(1).max(MAX_WORKSPACE_ID_LENGTH).regex(WORKSPACE_ID_PATTERN).default(DEFAULT_WORKSPACE_ID),
  phaseFolder: z.string().min(1).max(MAX_PHASE_FOLDER_LENGTH).regex(PHASE_FOLDER_PATTERN).optional(),
  workCardId: z.string().min(1).max(MAX_WORK_CARD_ID_LENGTH).regex(WORK_CARD_ID_PATTERN).optional(),
  maxResults: z.number().int().positive().optional()
});

const BuilderReportSummaryInputSchema = z.object({
  workspaceId: z.string().min(1).max(MAX_WORKSPACE_ID_LENGTH).regex(WORKSPACE_ID_PATTERN).default(DEFAULT_WORKSPACE_ID),
  reportPath: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH).optional(),
  phaseFolder: z.string().min(1).max(MAX_PHASE_FOLDER_LENGTH).regex(PHASE_FOLDER_PATTERN).optional(),
  workCardId: z.string().min(1).max(MAX_WORK_CARD_ID_LENGTH).regex(WORK_CARD_ID_PATTERN).optional(),
  maxChars: z.number().int().positive().optional()
});

interface WorkspaceOption {
  workspaceId: string;
  workspaceLabel: string;
  repositoryName?: string;
  root: string;
  aliases: string[];
}

interface BuilderReportRecord {
  workspaceId: string;
  workspaceLabel: string;
  repositoryName?: string;
  absolutePath: string;
  relativePath: string;
  fileName: string;
  phaseFolder: string;
  workCardId?: string;
  title?: string;
  sizeBytes: number;
  lastModified: string;
  sha256: string;
}

interface BuilderReportCandidate {
  workspaceId?: string;
  workspaceLabel?: string;
  repositoryName?: string;
  relativePath: string;
  fileName: string;
  phaseFolder: string;
  workCardId?: string;
}

function normalizeAlias(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, MAX_WORKSPACE_ID_LENGTH);
}

function normalizeWorkCardId(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeResultPath(value: string): string {
  return value.split(/[\\/]+/u).filter(Boolean).join("/");
}

function capPositiveInteger(value: number | undefined, fallback: number, maximum: number): number {
  return Math.min(value ?? fallback, maximum);
}

function parseRepositoryNameFromRemote(remoteUrl: string): string | undefined {
  const trimmed = remoteUrl.trim().replace(/\.git$/iu, "");
  if (!trimmed) {
    return undefined;
  }

  const sshMatch = /^[^@]+@[^:]+:(?<owner>[^/]+)\/(?<repo>[^/]+)$/u.exec(trimmed);
  if (sshMatch?.groups?.owner && sshMatch.groups.repo) {
    return `${sshMatch.groups.owner}/${sshMatch.groups.repo}`;
  }

  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) {
      return `${parts.at(-2)}/${parts.at(-1)}`;
    }
  } catch {
    const parts = trimmed.split(/[/:\\]+/u).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts.at(-2)}/${parts.at(-1)}`;
    }
  }

  return undefined;
}

async function repositoryName(root: string): Promise<string | undefined> {
  if (!fsSync.existsSync(path.join(root, ".git"))) {
    return undefined;
  }

  const result = await runGit(root, ["remote", "get-url", "origin"], {
    timeoutMs: 30_000,
    maxBytes: 50_000
  });

  if (result.exitCode !== 0 || result.timedOut) {
    return undefined;
  }

  return parseRepositoryNameFromRemote(result.stdout);
}

function publicWorkspaceIds(workspaces: WorkspaceOption[], includeAllAllowed: boolean): string[] {
  const ids = new Set<string>([DEFAULT_WORKSPACE_ID]);
  if (includeAllAllowed) {
    ids.add(ALL_ALLOWED_WORKSPACE_ID);
  }

  for (const workspace of workspaces) {
    for (const alias of workspace.aliases) {
      ids.add(alias);
    }
  }

  return [...ids].sort();
}

async function workspaceOptions(config: AppConfig): Promise<WorkspaceOption[]> {
  let defaultRoot: string;
  try {
    defaultRoot = resolveDefaultWorkspaceRoot(config);
  } catch (error) {
    if (error instanceof AppError) {
      throw new AppError(error.code, error.message);
    }
    throw error;
  }

  const roots: string[] = [];
  for (const candidate of [defaultRoot, ...config.allowedRoots]) {
    try {
      const root = resolveAllowedRoot(candidate, config.allowedRoots).rootRealPath;
      if (!roots.some((entry) => entry.toLowerCase() === root.toLowerCase())) {
        roots.push(root);
      }
    } catch {
      // Ignore invalid non-default allowed roots here; config startup validation owns that failure mode.
    }
  }

  const options = await Promise.all(
    roots.map(async (root, index): Promise<WorkspaceOption> => {
      const repoName = await repositoryName(root);
      const folderAlias = normalizeAlias(path.basename(root));
      const repoAlias = repoName ? normalizeAlias(repoName.split("/").at(-1) ?? repoName) : "";
      const aliases = [...new Set([folderAlias, repoAlias].filter(Boolean))];
      const isDefault = root.toLowerCase() === defaultRoot.toLowerCase();
      const workspaceId = isDefault ? DEFAULT_WORKSPACE_ID : aliases[0] ?? `workspace_${index + 1}`;

      return {
        workspaceId,
        workspaceLabel: path.basename(root),
        repositoryName: repoName,
        root,
        aliases: isDefault ? [...new Set([DEFAULT_WORKSPACE_ID, ...aliases])] : aliases
      };
    })
  );

  return options;
}

async function resolveIndexWorkspaces(workspaceId: string, config: AppConfig): Promise<{
  selected: WorkspaceOption[];
  availableWorkspaceIds: string[];
}> {
  const options = await workspaceOptions(config);
  const availableWorkspaceIds = publicWorkspaceIds(options, true);

  if (workspaceId === ALL_ALLOWED_WORKSPACE_ID) {
    return {
      selected: options,
      availableWorkspaceIds
    };
  }

  const normalized = normalizeAlias(workspaceId);
  const selected = options.filter((option) => option.aliases.includes(normalized) || option.workspaceId === workspaceId);
  if (selected.length === 0) {
    throw new AppError("INVALID_INPUT", "Unknown workspaceId. Use one of the available safe workspace IDs.", {
      availableWorkspaceIds
    });
  }

  if (selected.length > 1) {
    throw new AppError("INVALID_INPUT", "workspaceId matches more than one configured allowed workspace.", {
      availableWorkspaceIds
    });
  }

  return {
    selected,
    availableWorkspaceIds
  };
}

async function resolveSummaryWorkspace(workspaceId: string, config: AppConfig): Promise<{
  workspace: WorkspaceOption;
  availableWorkspaceIds: string[];
}> {
  const options = await workspaceOptions(config);
  const availableWorkspaceIds = publicWorkspaceIds(options, false);

  if (workspaceId === ALL_ALLOWED_WORKSPACE_ID) {
    throw new AppError("INVALID_INPUT", "all_allowed is only supported by get_builder_report_index.", {
      availableWorkspaceIds
    });
  }

  const normalized = normalizeAlias(workspaceId);
  const selected = options.filter((option) => option.aliases.includes(normalized) || option.workspaceId === workspaceId);
  if (selected.length === 0) {
    throw new AppError("INVALID_INPUT", "Unknown workspaceId. Use one of the available safe workspace IDs.", {
      availableWorkspaceIds
    });
  }

  if (selected.length > 1) {
    throw new AppError("INVALID_INPUT", "workspaceId matches more than one configured allowed workspace.", {
      availableWorkspaceIds
    });
  }

  return {
    workspace: selected[0],
    availableWorkspaceIds
  };
}

function extractWorkCardId(fileName: string): string | undefined {
  const stem = fileName.replace(/\.md$/iu, "");
  const raw = stem.replace(/^BUILDER_REPORT_?/iu, "");
  const parts = raw.split("_").filter(Boolean);
  const first = parts[0]?.toUpperCase();
  const second = parts[1]?.toUpperCase();

  if (first === "REPAIR" && second && /^WC[A-Z0-9-]*$/u.test(second)) {
    return `REPAIR_${second}`;
  }

  if (first && (/^WC[A-Z0-9-]*$/u.test(first) || /^FIX\d+$/u.test(first))) {
    return first;
  }

  return undefined;
}

function reportMatchesWorkCard(fileName: string, extractedWorkCardId: string | undefined, workCardId: string | undefined): boolean {
  if (!workCardId) {
    return true;
  }

  const needle = normalizeWorkCardId(workCardId);
  return extractedWorkCardId?.toUpperCase() === needle || fileName.toUpperCase().includes(needle);
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

function sanitizePrivateLocalPaths(value: string): string {
  return value
    .replace(/[A-Z]:[\\/]+Users[\\/]+[^\\/ \r\n"'`]+[\\/]+AppData[\\/]+Local[\\/]+Temp/giu, "%TEMP%")
    .replace(/[A-Z]:[\\/]+Windows[\\/]+Temp/giu, "%TEMP%")
    .replace(/[A-Z]:[\\/]+Temp\b/giu, "%TEMP%")
    .replace(/[A-Z]:[\\/]+Users[\\/]+[^\\/ \r\n"'`]+/giu, "%USERPROFILE%")
    .replace(/\/Users\/[^/ \r\n"'`]+/gu, "%USERPROFILE%")
    .replace(/\/home\/[^/ \r\n"'`]+/gu, "%USERPROFILE%");
}

function sanitizePreviewContent(value: string): string {
  return sanitizePrivateLocalPaths(value)
    .replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|figd_[A-Za-z0-9_-]{20,})\b/gu, "<REDACTED_SECRET>")
    .replace(
      /\b(?<key>access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|client[_-]?secret|figmaAccessToken|password|secret)\b\s*[:=]\s*["']?[^"'\s\r\n]+["']?/giu,
      "$<key>=<REDACTED_SECRET>"
    );
}

async function readTitle(filePath: string, sizeBytes: number): Promise<string | undefined> {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(Math.min(sizeBytes, MAX_TITLE_SCAN_BYTES));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const snippet = buffer.subarray(0, bytesRead).toString("utf8");
    const heading = snippet.split(/\r?\n/u).find((line) => /^#\s+\S/u.test(line));
    return heading ? sanitizePrivateLocalPaths(heading.replace(/^#\s+/u, "").trim()).slice(0, 200) : undefined;
  } finally {
    await handle.close();
  }
}

async function metadataForReport(workspace: WorkspaceOption, absolutePath: string, phaseFolder: string, warnings: string[]): Promise<BuilderReportRecord | undefined> {
  const realPath = await fs.realpath(absolutePath);
  if (!isPathInside(realPath, workspace.root)) {
    warnings.push("Skipped a Builder Report path that resolved outside its configured allowed root.");
    return undefined;
  }

  const relativePath = toRootRelativePath(workspace.root, realPath);
  const fileName = path.basename(realPath);
  const policyDenial = getFilePolicyDenial(realPath, relativePath);
  if (policyDenial) {
    warnings.push(`Skipped ${normalizeResultPath(relativePath)} because file policy denied it.`);
    return undefined;
  }

  const stats = await fs.stat(realPath);
  if (!stats.isFile()) {
    return undefined;
  }

  if (stats.size > MAX_BUILDER_REPORT_BYTES) {
    warnings.push(`Skipped ${normalizeResultPath(relativePath)} because it exceeds the Builder Report size limit.`);
    return undefined;
  }

  const workCardId = extractWorkCardId(fileName);
  const title = await readTitle(realPath, stats.size);
  return {
    workspaceId: workspace.workspaceId,
    workspaceLabel: workspace.workspaceLabel,
    repositoryName: workspace.repositoryName,
    absolutePath: realPath,
    relativePath: normalizeResultPath(relativePath),
    fileName,
    phaseFolder,
    workCardId,
    title,
    sizeBytes: stats.size,
    lastModified: stats.mtime.toISOString(),
    sha256: await sha256File(realPath)
  };
}

function publicReport(record: BuilderReportRecord): Omit<BuilderReportRecord, "absolutePath"> {
  const { absolutePath: _absolutePath, ...safeRecord } = record;
  return safeRecord;
}

function candidateReport(record: BuilderReportRecord): BuilderReportCandidate {
  return {
    workspaceId: record.workspaceId,
    workspaceLabel: record.workspaceLabel,
    repositoryName: record.repositoryName,
    relativePath: record.relativePath,
    fileName: record.fileName,
    phaseFolder: record.phaseFolder,
    workCardId: record.workCardId
  };
}

function sortReports(left: BuilderReportRecord, right: BuilderReportRecord): number {
  return (
    left.workspaceLabel.localeCompare(right.workspaceLabel) ||
    left.phaseFolder.localeCompare(right.phaseFolder) ||
    left.fileName.localeCompare(right.fileName)
  );
}

async function discoverReports(
  workspaces: WorkspaceOption[],
  query: { phaseFolder?: string; workCardId?: string }
): Promise<{ reports: BuilderReportRecord[]; warnings: string[] }> {
  const reports: BuilderReportRecord[] = [];
  const warnings: string[] = [];

  for (const workspace of workspaces) {
    const phasesDir = path.join(workspace.root, "planning", "phases");
    let phaseEntries: fsSync.Dirent[];

    try {
      const phasesStats = await fs.lstat(phasesDir);
      if (!phasesStats.isDirectory() || phasesStats.isSymbolicLink()) {
        continue;
      }
      phaseEntries = await fs.readdir(phasesDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }

    for (const phaseEntry of phaseEntries) {
      if (!phaseEntry.isDirectory() || phaseEntry.isSymbolicLink()) {
        continue;
      }

      const phaseFolder = phaseEntry.name;
      if (!PHASE_FOLDER_PATTERN.test(phaseFolder) || (query.phaseFolder && phaseFolder !== query.phaseFolder)) {
        continue;
      }

      const reportsDir = path.join(phasesDir, phaseFolder, "Builder_Reports");
      let reportEntries: fsSync.Dirent[];
      try {
        const reportsDirStats = await fs.lstat(reportsDir);
        if (!reportsDirStats.isDirectory() || reportsDirStats.isSymbolicLink()) {
          continue;
        }
        reportEntries = await fs.readdir(reportsDir, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          continue;
        }
        throw error;
      }

      for (const reportEntry of reportEntries) {
        if (!reportEntry.isFile() || reportEntry.isSymbolicLink() || !REPORT_FILE_PATTERN.test(reportEntry.name)) {
          continue;
        }

        const report = await metadataForReport(workspace, path.join(reportsDir, reportEntry.name), phaseFolder, warnings);
        if (report && reportMatchesWorkCard(report.fileName, report.workCardId, query.workCardId)) {
          reports.push(report);
        }
      }
    }
  }

  reports.sort(sortReports);
  return {
    reports,
    warnings
  };
}

function parseSafeReportPath(reportPath: string): { relativePath: string; phaseFolder: string; fileName: string } {
  const safePath = assertSafeRelativePath(reportPath);
  const normalizedPath = normalizeResultPath(safePath);
  const match = REPORT_RELATIVE_PATH_PATTERN.exec(normalizedPath);
  const phaseFolder = match?.groups?.phaseFolder;
  const fileName = match?.groups?.fileName;

  if (!match || !phaseFolder || !fileName || !PHASE_FOLDER_PATTERN.test(phaseFolder) || !REPORT_FILE_PATTERN.test(fileName)) {
    throw new AppError("PATH_DENIED", "reportPath must be a repository-relative Builder Report path under planning/phases/<phaseFolder>/Builder_Reports/.");
  }

  return {
    relativePath: normalizedPath,
    phaseFolder,
    fileName
  };
}

async function findReportByPath(workspace: WorkspaceOption, reportPath: string, warnings: string[]): Promise<BuilderReportRecord | null> {
  const parsed = parseSafeReportPath(reportPath);
  const absolutePath = path.join(workspace.root, ...parsed.relativePath.split("/"));

  try {
    const lstat = await fs.lstat(absolutePath);
    if (lstat.isSymbolicLink() || !lstat.isFile()) {
      return null;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }

  const report = await metadataForReport(workspace, absolutePath, parsed.phaseFolder, warnings);
  return report ?? null;
}

function safetyNotes(): string[] {
  return [
    "Read-only Builder Report facade; repository files, git state, release state, and configuration were not changed.",
    "The scanner only inspects planning/phases/<phaseFolder>/Builder_Reports/BUILDER_REPORT*.md under configured allowed roots.",
    "Tool output uses repository-relative paths and bounded metadata."
  ];
}

export async function getBuilderReportIndex(rawInput: unknown, config: AppConfig) {
  return withAudit(config, { toolName: "get_builder_report_index" }, async (updateAudit) => {
    const input = BuilderReportIndexInputSchema.parse(rawInput);
    const maxResults = capPositiveInteger(input.maxResults, DEFAULT_INDEX_MAX_RESULTS, INDEX_MAX_RESULTS_CAP);
    const { selected } = await resolveIndexWorkspaces(input.workspaceId, config);
    const { reports, warnings } = await discoverReports(selected, {
      phaseFolder: input.phaseFolder,
      workCardId: input.workCardId
    });
    const limitedReports = reports.slice(0, maxResults);
    const allAllowed = input.workspaceId === ALL_ALLOWED_WORKSPACE_ID;
    const primaryWorkspace = allAllowed ? undefined : selected[0];

    updateAudit({
      requestedPath: input.phaseFolder ? `planning/phases/${input.phaseFolder}/Builder_Reports` : "planning/phases",
      resolvedPath: primaryWorkspace?.root ?? "<configured allowed roots>",
      fileCount: limitedReports.length
    });

    return {
      workspaceId: allAllowed ? ALL_ALLOWED_WORKSPACE_ID : primaryWorkspace?.workspaceId ?? DEFAULT_WORKSPACE_ID,
      workspaceLabel: allAllowed ? "All allowed workspaces" : primaryWorkspace?.workspaceLabel ?? "default",
      repositoryName: allAllowed ? undefined : primaryWorkspace?.repositoryName,
      phaseFolder: input.phaseFolder,
      query: {
        phaseFolder: input.phaseFolder,
        workCardId: input.workCardId,
        maxResults
      },
      reports: limitedReports.map(publicReport),
      resultCount: limitedReports.length,
      truncated: reports.length > limitedReports.length,
      warnings,
      safetyNotes: safetyNotes()
    };
  });
}

export async function getBuilderReportSummary(rawInput: unknown, config: AppConfig) {
  return withAudit(config, { toolName: "get_builder_report_summary" }, async (updateAudit) => {
    const input = BuilderReportSummaryInputSchema.parse(rawInput);
    const maxChars = capPositiveInteger(input.maxChars, DEFAULT_SUMMARY_MAX_CHARS, SUMMARY_MAX_CHARS_CAP);

    if (!input.reportPath && !(input.phaseFolder && input.workCardId)) {
      throw new AppError("INVALID_INPUT", "Provide reportPath, or provide both phaseFolder and workCardId.");
    }

    const { workspace } = await resolveSummaryWorkspace(input.workspaceId, config);
    const warnings: string[] = [];
    let report: BuilderReportRecord | null = null;
    let candidates: BuilderReportRecord[] = [];

    if (input.reportPath) {
      report = await findReportByPath(workspace, input.reportPath, warnings);
    } else if (input.phaseFolder && input.workCardId) {
      const discovery = await discoverReports([workspace], {
        phaseFolder: input.phaseFolder,
        workCardId: input.workCardId
      });
      warnings.push(...discovery.warnings);
      candidates = discovery.reports;
      if (candidates.length === 1) {
        report = candidates[0];
      }
    }

    if (candidates.length > 1) {
      updateAudit({
        requestedPath: `${input.phaseFolder ?? ""}/${input.workCardId ?? ""}`,
        resolvedPath: workspace.root,
        fileCount: candidates.length
      });

      return {
        workspaceId: workspace.workspaceId,
        workspaceLabel: workspace.workspaceLabel,
        repositoryName: workspace.repositoryName,
        report: null,
        matched: false,
        ambiguous: true,
        candidates: candidates.map(candidateReport),
        truncated: false,
        warnings,
        safetyNotes: safetyNotes()
      };
    }

    if (!report) {
      updateAudit({
        requestedPath: input.reportPath ?? `${input.phaseFolder ?? ""}/${input.workCardId ?? ""}`,
        resolvedPath: workspace.root,
        fileCount: 0
      });

      return {
        workspaceId: workspace.workspaceId,
        workspaceLabel: workspace.workspaceLabel,
        repositoryName: workspace.repositoryName,
        report: null,
        matched: false,
        ambiguous: false,
        truncated: false,
        warnings,
        safetyNotes: safetyNotes()
      };
    }

    assertReadableTextFile(report.absolutePath, report.relativePath, MAX_BUILDER_REPORT_BYTES);
    const content = await fs.readFile(report.absolutePath, "utf8");
    const sanitizedPreview = sanitizePreviewContent(content);
    const contentPreview = sanitizedPreview.slice(0, maxChars);
    if (sanitizedPreview !== content) {
      warnings.push("Private local path-like or token-like content was redacted from contentPreview.");
    }

    updateAudit({
      requestedPath: report.relativePath,
      resolvedPath: report.absolutePath,
      byteCount: report.sizeBytes,
      fileCount: 1
    });

    return {
      workspaceId: workspace.workspaceId,
      workspaceLabel: workspace.workspaceLabel,
      repositoryName: workspace.repositoryName,
      report: publicReport(report),
      matched: true,
      ambiguous: false,
      contentPreview,
      truncated: sanitizedPreview.length > maxChars,
      warnings,
      safetyNotes: safetyNotes()
    };
  });
}
