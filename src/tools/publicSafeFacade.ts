import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { type AppConfig } from "../config.js";
import { resolveAllowedRoot } from "../security/pathPolicy.js";
import { AppError } from "../utils/errors.js";
import { runGit, type ProcessResult } from "../utils/git.js";
import { withAudit } from "./common.js";
import {
  currentBranch,
  normalizeGitPath,
  parseStatusPaths,
  preCommitSafetyScan,
  stagedFiles,
  statusShort,
  uniqueSorted,
  type SafetyFinding
} from "./gitWorkflow/safety.js";

const DEFAULT_WORKSPACE_ID = "default";
const WORKSPACE_ID_MAX_LENGTH = 64;
const RELEASE_VERSION_MAX_LENGTH = 64;
const TAG_NAME_MAX_LENGTH = 128;
const RELEASE_LOOKUP_TIMEOUT_MS = 15_000;

const WorkspaceInputSchema = z.object({
  workspaceId: z.string().min(1).max(WORKSPACE_ID_MAX_LENGTH).default(DEFAULT_WORKSPACE_ID)
});

const ChangeSetReadinessInputSchema = WorkspaceInputSchema.extend({
  targetBranch: z.enum(["main", "dev", "feature"]).default("feature")
});

const ReleaseArtifactInputSchema = WorkspaceInputSchema.extend({
  releaseVersion: z.string().min(1).max(RELEASE_VERSION_MAX_LENGTH).regex(/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u)
});

const ReleasePublicationInputSchema = WorkspaceInputSchema.extend({
  tagName: z.string().min(1).max(TAG_NAME_MAX_LENGTH),
  includeAssets: z.boolean().default(false)
});

interface WorkspaceContext {
  workspaceId: string;
  workspaceLabel: string;
  root: string;
}

interface StatusEntry {
  indexStatus: string;
  workingTreeStatus: string;
  relativePath: string;
  untracked: boolean;
}

interface ReleaseArtifactDefinition {
  expectedArtifactName: string;
  packageVersion?: string;
  warnings: string[];
}

interface GitHubRepositoryCoordinates {
  owner: string;
  repo: string;
}

interface GitHubReleaseAsset {
  name?: unknown;
  size?: unknown;
  digest?: unknown;
  state?: unknown;
}

interface GitHubReleaseResponse {
  html_url?: unknown;
  target_commitish?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  published_at?: unknown;
  assets?: unknown;
}

type ExpectedAssetMatchMethod = "sha256" | "exact_name" | "normalized_name" | "size_only" | "not_matched" | "not_checked";

interface ReleaseAssetMetadata {
  name: string;
  sizeBytes?: number;
  digest?: string;
  state?: string;
}

function assertGitReadSuccess(result: ProcessResult, operation: string): void {
  if (result.exitCode !== 0 || result.timedOut) {
    throw new AppError("PROCESS_FAILED", `${operation} failed.`, {
      exitCode: result.exitCode,
      timedOut: result.timedOut
    });
  }
}

function parseStatusEntries(status: string): StatusEntry[] {
  return status
    .split(/\r?\n/u)
    .map((line) => {
      if (!line.trim() || line.startsWith("!!")) {
        return undefined;
      }

      const statusCode = line.slice(0, 2);
      const rawPath = line.slice(3);
      const renamedPath = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) ?? rawPath : rawPath;
      const relativePath = normalizeGitPath(renamedPath.replace(/^"|"$/gu, ""));

      return {
        indexStatus: statusCode[0] ?? " ",
        workingTreeStatus: statusCode[1] ?? " ",
        relativePath,
        untracked: statusCode === "??"
      };
    })
    .filter((entry): entry is StatusEntry => Boolean(entry?.relativePath));
}

function normalizeReleaseVersion(value: string): string {
  return value.trim().replace(/^v/iu, "");
}

function relativeReleasePath(fileName: string): string {
  return `release/${fileName}`;
}

function resolveWorkspace(workspaceId: string, config: AppConfig): WorkspaceContext {
  if (workspaceId !== DEFAULT_WORKSPACE_ID) {
    throw new AppError("INVALID_INPUT", "Only the default workspace is configured for this read-only summary.");
  }

  let root: string;
  try {
    root = resolveAllowedRoot(config.repoRoot, config.allowedRoots).rootRealPath;
  } catch (error) {
    if (error instanceof AppError) {
      throw new AppError(error.code, "Configured workspace is not in the allowed root list.");
    }
    throw error;
  }

  if (!fs.existsSync(path.join(root, ".git"))) {
    throw new AppError("GIT_REQUIRED", "Configured workspace is not a git repository.");
  }

  return {
    workspaceId,
    workspaceLabel: path.basename(root),
    root
  };
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
  const result = await runGit(root, ["remote", "get-url", "origin"], {
    timeoutMs: 30_000,
    maxBytes: 50_000
  });

  if (result.exitCode !== 0 || result.timedOut) {
    return undefined;
  }

  return parseRepositoryNameFromRemote(result.stdout);
}

async function currentStatusEntries(root: string): Promise<{ branch: string; status: string; entries: StatusEntry[] }> {
  const [branch, status] = await Promise.all([currentBranch(root), statusShort(root)]);
  return {
    branch,
    status,
    entries: parseStatusEntries(status)
  };
}

function safetyNote(): string[] {
  return [
    "Read-only summary; repository files, git state, release state, and configuration were not changed.",
    "Changed paths are repository-relative."
  ];
}

function findingKey(finding: Pick<SafetyFinding, "relativePath" | "rule" | "message">): string {
  return `${finding.relativePath}\0${finding.rule}\0${finding.message}`;
}

function compactFindings(findings: SafetyFinding[]): Array<{ relativePath?: string; rule: string; message: string }> {
  const seen = new Set<string>();
  const compact: Array<{ relativePath?: string; rule: string; message: string }> = [];

  for (const finding of findings) {
    const key = findingKey(finding);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    compact.push({
      relativePath: finding.relativePath,
      rule: finding.rule,
      message: finding.message
    });
  }

  return compact.sort((a, b) => `${a.relativePath ?? ""}:${a.rule}`.localeCompare(`${b.relativePath ?? ""}:${b.rule}`));
}

function warningMessages(findings: SafetyFinding[]): string[] {
  return uniqueSorted(findings.map((finding) => `${finding.relativePath}: ${finding.rule}: ${finding.message}`));
}

async function nameOnly(root: string, args: string[], operation: string): Promise<string[]> {
  const result = await runGit(root, args, { timeoutMs: 30_000, maxBytes: 500_000 });
  assertGitReadSuccess(result, operation);
  return uniqueSorted(result.stdout.split(/\r?\n/u).map(normalizeGitPath).filter(Boolean));
}

function branchTargetWarning(branch: string, targetBranch: "main" | "dev" | "feature"): string | undefined {
  if (targetBranch === "dev" && branch !== "dev") {
    return `Current branch is ${branch}; the selected target branch is dev.`;
  }

  if (targetBranch === "main" && branch !== "main") {
    return `Current branch is ${branch}; the selected target branch is main.`;
  }

  if (targetBranch === "feature" && (branch === "main" || branch === "dev")) {
    return `Current branch is ${branch}; a feature branch target normally expects a non-main, non-dev branch.`;
  }

  return undefined;
}

function readJsonObject(filePath: string): Record<string, unknown> | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
}

function renderArtifactName(template: string, values: { productName: string; name: string; version: string; arch: string; ext: string }): string {
  return template
    .replaceAll("${productName}", values.productName)
    .replaceAll("${name}", values.name)
    .replaceAll("${version}", values.version)
    .replaceAll("${arch}", values.arch)
    .replaceAll("${ext}", values.ext);
}

function releaseArtifactDefinition(root: string, releaseVersion: string): ReleaseArtifactDefinition {
  const warnings: string[] = [];
  const normalizedVersion = normalizeReleaseVersion(releaseVersion);
  let packageJson: Record<string, unknown> | undefined;
  let builderConfig: Record<string, unknown> | undefined;

  try {
    packageJson = readJsonObject(path.join(root, "package.json"));
  } catch {
    warnings.push("package.json could not be read; artifact naming used safe defaults.");
  }

  try {
    builderConfig = readJsonObject(path.join(root, "electron-builder.json"));
  } catch {
    warnings.push("electron-builder.json could not be read; artifact naming used safe defaults.");
  }

  const packageName = typeof packageJson?.name === "string" ? packageJson.name : "champcity-gpt";
  const packageVersion = typeof packageJson?.version === "string" ? packageJson.version : undefined;
  const productName =
    typeof builderConfig?.productName === "string"
      ? builderConfig.productName
      : typeof packageJson?.productName === "string"
        ? packageJson.productName
        : packageName;
  const directories = builderConfig?.directories && typeof builderConfig.directories === "object" ? builderConfig.directories as Record<string, unknown> : {};
  if (directories.output !== undefined && directories.output !== "release") {
    warnings.push("Release output directory is not the default release directory; only the configured repository release output is inspected.");
  }

  const win = builderConfig?.win && typeof builderConfig.win === "object" ? builderConfig.win as Record<string, unknown> : {};
  const artifactNameTemplate = typeof win.artifactName === "string" ? win.artifactName : "${productName}-${version}-${arch}.${ext}";
  const expectedArtifactName = renderArtifactName(artifactNameTemplate, {
    productName,
    name: packageName,
    version: normalizedVersion,
    arch: "x64",
    ext: "exe"
  });

  if (packageVersion && packageVersion !== normalizedVersion) {
    warnings.push(`Requested release version ${normalizedVersion} differs from package.json version ${packageVersion}.`);
  }

  return {
    expectedArtifactName,
    packageVersion,
    warnings
  };
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

function parseGitHubCoordinates(repository: string | undefined): GitHubRepositoryCoordinates | undefined {
  if (!repository) {
    return undefined;
  }

  const [owner, repo] = repository.split("/");
  if (!owner || !repo) {
    return undefined;
  }

  return {
    owner,
    repo
  };
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function booleanField(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeSha256Digest(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase().replace(/^sha256:/u, "");
  return normalized && /^[a-f0-9]{64}$/u.test(normalized) ? normalized : undefined;
}

function normalizeAssetNameForComparison(name: string): string {
  const trimmed = name.trim().toLowerCase();
  const extensionIndex = trimmed.lastIndexOf(".");
  const hasExtension = extensionIndex > 0 && extensionIndex < trimmed.length - 1;
  const stem = hasExtension ? trimmed.slice(0, extensionIndex) : trimmed;
  const extension = hasExtension ? trimmed.slice(extensionIndex + 1) : "";
  const normalizedStem = stem.replace(/[\s._-]+/gu, "-").replace(/^-|-$/gu, "");
  const normalizedExtension = extension.replace(/[\s._-]+/gu, "");
  return hasExtension ? `${normalizedStem}.${normalizedExtension}` : normalizedStem;
}

function classifyExpectedAssetMatch(
  assets: ReleaseAssetMetadata[],
  expectedAssetName: string,
  localArtifact: { sha256?: string; sizeBytes?: number }
): { expectedAssetMatched: boolean; expectedAssetMatchMethod: ExpectedAssetMatchMethod } {
  const localSha256 = normalizeSha256Digest(localArtifact.sha256);
  if (localSha256 && assets.some((asset) => normalizeSha256Digest(asset.digest) === localSha256)) {
    return {
      expectedAssetMatched: true,
      expectedAssetMatchMethod: "sha256"
    };
  }

  if (assets.some((asset) => asset.name === expectedAssetName)) {
    return {
      expectedAssetMatched: true,
      expectedAssetMatchMethod: "exact_name"
    };
  }

  const normalizedExpectedName = normalizeAssetNameForComparison(expectedAssetName);
  if (assets.some((asset) => normalizeAssetNameForComparison(asset.name) === normalizedExpectedName)) {
    return {
      expectedAssetMatched: true,
      expectedAssetMatchMethod: "normalized_name"
    };
  }

  if (localArtifact.sizeBytes !== undefined && assets.some((asset) => asset.sizeBytes === localArtifact.sizeBytes)) {
    return {
      expectedAssetMatched: false,
      expectedAssetMatchMethod: "size_only"
    };
  }

  return {
    expectedAssetMatched: false,
    expectedAssetMatchMethod: "not_matched"
  };
}

function safeFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message.replace(/[A-Z]:\\Users\\[^\\\s]+/giu, "C:\\Users\\<you>") : "unknown error";
}

export async function getWorkspaceStatusSummary(rawInput: unknown, config: AppConfig) {
  return withAudit(config, { toolName: "get_workspace_status_summary" }, async (updateAudit) => {
    const input = WorkspaceInputSchema.parse(rawInput);
    const workspace = resolveWorkspace(input.workspaceId, config);
    const [{ branch, status, entries }, repoName] = await Promise.all([currentStatusEntries(workspace.root), repositoryName(workspace.root)]);
    const relativeChangedPaths = parseStatusPaths(status);

    updateAudit({
      requestedPath: ".",
      resolvedPath: workspace.root,
      branch,
      fileCount: relativeChangedPaths.length
    });

    return {
      workspaceId: workspace.workspaceId,
      workspaceLabel: workspace.workspaceLabel,
      repositoryName: repoName,
      branch,
      isClean: entries.length === 0,
      trackedModifiedCount: entries.filter((entry) => !entry.untracked && (entry.indexStatus === "M" || entry.workingTreeStatus === "M")).length,
      stagedCount: entries.filter((entry) => !entry.untracked && entry.indexStatus !== " ").length,
      untrackedCount: entries.filter((entry) => entry.untracked).length,
      deletedCount: entries.filter((entry) => entry.indexStatus === "D" || entry.workingTreeStatus === "D").length,
      hasUncommittedChanges: entries.length > 0,
      relativeChangedPaths,
      safetyNotes: safetyNote()
    };
  });
}

export async function getChangeSetReadinessSummary(rawInput: unknown, config: AppConfig) {
  return withAudit(config, { toolName: "get_change_set_readiness_summary" }, async (updateAudit) => {
    const input = ChangeSetReadinessInputSchema.parse(rawInput);
    const workspace = resolveWorkspace(input.workspaceId, config);
    const [{ branch, entries }, staged, unstaged, stagedScan, workingTreeScan] = await Promise.all([
      currentStatusEntries(workspace.root),
      stagedFiles(workspace.root),
      nameOnly(workspace.root, ["diff", "--name-only"], "git diff --name-only"),
      preCommitSafetyScan({ root: workspace.root, mode: "staged" }, config),
      preCommitSafetyScan({ root: workspace.root, mode: "working-tree" }, config)
    ]);
    const untrackedFiles = uniqueSorted(entries.filter((entry) => entry.untracked).map((entry) => entry.relativePath));
    const blockingFindings = compactFindings([...stagedScan.blockingFindings, ...workingTreeScan.blockingFindings]);
    const warnings = warningMessages([...stagedScan.warnings, ...workingTreeScan.warnings]);
    const targetWarning = branchTargetWarning(branch, input.targetBranch);
    if (targetWarning) {
      warnings.push(targetWarning);
    }
    if (branch === "main") {
      warnings.push("Current branch is main; later source-control mutation workflows refuse main by default.");
    }

    const recommendedNextSteps: string[] = [];
    if (blockingFindings.length > 0) {
      recommendedNextSteps.push("Address blocking findings before any later source-control workflow.");
    }
    if (staged.length === 0 && (unstaged.length > 0 || untrackedFiles.length > 0)) {
      recommendedNextSteps.push("Review unstaged and untracked files before preparing a change set.");
    }
    if (entries.length === 0) {
      recommendedNextSteps.push("No repository changes are currently present.");
    }
    if (staged.length > 0 && blockingFindings.length === 0) {
      recommendedNextSteps.push("Staged files have no public-safety blockers from this read-only check.");
    }

    updateAudit({
      requestedPath: ".",
      resolvedPath: workspace.root,
      branch,
      fileCount: uniqueSorted([...staged, ...unstaged, ...untrackedFiles]).length
    });

    return {
      workspaceId: workspace.workspaceId,
      branch,
      targetBranch: input.targetBranch,
      isClean: entries.length === 0,
      stagedFiles: staged,
      unstagedFiles: unstaged,
      untrackedFiles,
      blockingFindings,
      warnings: uniqueSorted(warnings),
      recommendedNextSteps
    };
  });
}

export async function getReleaseArtifactSummary(rawInput: unknown, config: AppConfig) {
  return withAudit(config, { toolName: "get_release_artifact_summary" }, async (updateAudit) => {
    const input = ReleaseArtifactInputSchema.parse(rawInput);
    const workspace = resolveWorkspace(input.workspaceId, config);
    const releaseVersion = normalizeReleaseVersion(input.releaseVersion);
    const definition = releaseArtifactDefinition(workspace.root, releaseVersion);
    const artifactPath = path.join(workspace.root, "release", definition.expectedArtifactName);
    const exists = fs.existsSync(artifactPath);
    const artifact = {
      relativePath: relativeReleasePath(definition.expectedArtifactName),
      exists,
      ...(exists
        ? {
            sizeBytes: fs.statSync(artifactPath).size,
            lastWriteTime: fs.statSync(artifactPath).mtime.toISOString(),
            sha256: await sha256File(artifactPath)
          }
        : {})
    };
    const warnings = [...definition.warnings];
    if (!exists) {
      warnings.push("Expected final release artifact was not found.");
    }
    warnings.push("Intermediate release builder output is not accepted as a final release artifact.");

    updateAudit({
      requestedPath: "release",
      resolvedPath: path.join(workspace.root, "release"),
      fileCount: exists ? 1 : 0
    });

    return {
      releaseVersion,
      expectedArtifactNames: [definition.expectedArtifactName],
      localArtifacts: [artifact],
      releaseOutputPolicy: {
        commitReleaseBinaries: false,
        finalArtifactRequired: true,
        intermediateArtifactsAccepted: false
      },
      warnings: uniqueSorted(warnings)
    };
  });
}

export async function getReleasePublicationSummary(rawInput: unknown, config: AppConfig) {
  return withAudit(config, { toolName: "get_release_publication_summary" }, async (updateAudit) => {
    const input = ReleasePublicationInputSchema.parse(rawInput);
    const workspace = resolveWorkspace(input.workspaceId, config);
    const repo = parseGitHubCoordinates(await repositoryName(workspace.root));
    const warnings: string[] = [];
    const blockers: string[] = [];

    updateAudit({
      requestedPath: input.tagName,
      resolvedPath: workspace.root
    });

    if (!repo) {
      return {
        tagName: input.tagName,
        releaseExists: false,
        publicationState: "unknown",
        expectedAssetMatched: false,
        expectedAssetMatchMethod: "not_checked" as ExpectedAssetMatchMethod,
        warnings,
        blockers: ["Could not identify a GitHub owner and repository from the origin remote."]
      };
    }

    const definition = releaseArtifactDefinition(workspace.root, input.tagName);
    const expectedAssetName = definition.expectedArtifactName;
    warnings.push(...definition.warnings);
    const expectedArtifactPath = path.join(workspace.root, "release", expectedAssetName);
    const localArtifact: { exists: boolean; sha256?: string; sizeBytes?: number } = {
      exists: fs.existsSync(expectedArtifactPath)
    };
    if (localArtifact.exists) {
      try {
        localArtifact.sizeBytes = fs.statSync(expectedArtifactPath).size;
        localArtifact.sha256 = await sha256File(expectedArtifactPath);
      } catch {
        warnings.push("Expected local release artifact could not be read; digest and size comparison were not checked.");
      }
    }
    const apiUrl = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/releases/tags/${encodeURIComponent(input.tagName)}`;

    try {
      const response = await fetch(apiUrl, {
        headers: {
          "accept": "application/vnd.github+json",
          "user-agent": "ChampCity-GPT-MCP"
        },
        signal: AbortSignal.timeout(RELEASE_LOOKUP_TIMEOUT_MS)
      });

      if (response.status === 404) {
        warnings.push("GitHub release was not found for the requested tag.");
        return {
          tagName: input.tagName,
          releaseExists: false,
          publicationState: "not_found",
          expectedAssetMatched: false,
          expectedAssetMatchMethod: "not_checked" as ExpectedAssetMatchMethod,
          warnings,
          blockers
        };
      }

      if (!response.ok) {
        blockers.push(`GitHub release lookup failed with HTTP ${response.status}.`);
        return {
          tagName: input.tagName,
          releaseExists: false,
          publicationState: "unknown",
          expectedAssetMatched: false,
          expectedAssetMatchMethod: "not_checked" as ExpectedAssetMatchMethod,
          warnings,
          blockers
        };
      }

      const release = await response.json() as GitHubReleaseResponse;
      const assets = Array.isArray(release.assets) ? release.assets as GitHubReleaseAsset[] : [];
      const normalizedAssets = assets
        .map((asset) => ({
          name: stringField(asset.name) ?? "",
          sizeBytes: numberField(asset.size),
          digest: stringField(asset.digest),
          state: stringField(asset.state)
        }))
        .filter((asset) => asset.name);
      const { expectedAssetMatched, expectedAssetMatchMethod } = classifyExpectedAssetMatch(normalizedAssets, expectedAssetName, localArtifact);

      if (expectedAssetMatchMethod === "size_only") {
        warnings.push("A release asset has the expected local artifact size, but size-only evidence is weak and is not treated as an expected asset match.");
      } else if (!expectedAssetMatched) {
        warnings.push("Expected release asset was not found in the GitHub release metadata.");
        if (!localArtifact.exists) {
          warnings.push("Expected local release artifact was not found, so digest and size comparison could not be checked.");
        }
      }

      return {
        tagName: input.tagName,
        releaseExists: true,
        publicationState: "checked",
        releaseUrl: stringField(release.html_url),
        targetCommitish: stringField(release.target_commitish),
        isDraft: booleanField(release.draft),
        isPrerelease: booleanField(release.prerelease),
        publishedAt: stringField(release.published_at),
        ...(input.includeAssets ? { assets: normalizedAssets } : {}),
        expectedAssetMatched,
        expectedAssetMatchMethod,
        warnings,
        blockers
      };
    } catch (error) {
      blockers.push(`GitHub release lookup was blocked or failed: ${safeFailureMessage(error)}`);
      return {
        tagName: input.tagName,
        releaseExists: false,
        publicationState: "unknown",
        expectedAssetMatched: false,
        expectedAssetMatchMethod: "not_checked" as ExpectedAssetMatchMethod,
        warnings,
        blockers
      };
    }
  });
}
