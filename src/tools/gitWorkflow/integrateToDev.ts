import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { type AppConfig } from "../../config.js";
import { AppError } from "../../utils/errors.js";
import { runGit, runProcess, type ProcessResult } from "../../utils/git.js";
import {
  DEFAULT_WORKSPACE_ID,
  WORKSPACE_ID_MAX_LENGTH,
  WORKSPACE_ID_PATTERN,
  resolveWorkspace,
  type ResolvedWorkspace
} from "../../workspaces.js";
import { MAX_RELATIVE_PATH_LENGTH } from "../inputLimits.js";
import { auditGitWorkflow, auditGitWorkflowError } from "./audit.js";
import { currentBranch, parseStatusPaths, redactRemoteUrl, sanitizeProcessText, statusShort, validateRootGitRepo } from "./safety.js";

const BUILDER_REPORT_DIR = "planning/phases/phase-v1.0/Builder_Reports";
const WORK_CARD_ID_PATTERN = /WC-V1-(?:\d{4}|FIX\d{2})/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const SAFE_NPM_ARG_PATTERN = /^[A-Za-z0-9:._/@=-]+$/u;
const MAX_BRANCH_NAME_LENGTH = 200;
const CHECK_OUTPUT_MAX_LENGTH = 12_000;

const BranchNameSchema = z.string().min(1).max(MAX_BRANCH_NAME_LENGTH);

export const IntegrateToDevInputSchema = z
  .object({
    workspaceId: z.string().min(1).max(WORKSPACE_ID_MAX_LENGTH).regex(WORKSPACE_ID_PATTERN).default(DEFAULT_WORKSPACE_ID),
    sourceBranch: BranchNameSchema.optional(),
    targetBranch: z.literal("dev").default("dev"),
    push: z.boolean().default(false),
    requireCleanWorkingTree: z.boolean().default(true),
    requireSourceBranchPushed: z.boolean().default(true),
    requireValidationReport: z.boolean().default(true),
    validationReportPath: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH).optional(),
    mergeMode: z.enum(["no-ff", "ff-only"]).default("no-ff"),
    dryRun: z.boolean().default(true)
  })
  .strict();

export type IntegrateToDevInput = z.infer<typeof IntegrateToDevInputSchema>;

interface ValidationReportCheck {
  required: boolean;
  provided: boolean;
  inferred: boolean;
  exists: boolean;
  path?: string;
  sizeBytes?: number;
  modifiedTime?: string;
  blockers: string[];
  warnings: string[];
}

interface PostMergeCheck {
  name: "git diff --check" | "npm run check:public" | "npm run mcp:self-test -- --json";
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export interface IntegrateToDevOutput {
  ok: boolean;
  mode: "dryRun" | "execute";
  workspaceId: string;
  workspaceLabel: string;
  repositoryName: string;
  currentBranch: string;
  sourceBranch: string;
  targetBranch: "dev";
  originalBranch: string;
  sourceCommit: string | null;
  targetCommitBefore: string | null;
  targetCommitAfter: string | null;
  mergeCommit: string | null;
  pushed: boolean;
  remote: string | null;
  validationReportPath: string | null;
  checks: {
    repositoryIdentity: {
      packageJsonPresent: boolean;
      packageName: string | null;
      gitRootMatchesWorkspace: boolean;
      remoteMatchesConfiguredWorkspace: boolean | "not_configured" | "unknown";
    };
    workingTreeClean: boolean;
    sourceBranchExists: boolean;
    targetBranchExists: boolean;
    sourceBranchPushed: boolean;
    sourceBranchUpstream: string | null;
    sourceBranchAheadOfUpstream: number | null;
    sourceBranchBehindUpstream: number | null;
    validationReport: ValidationReportCheck;
    postMerge: PostMergeCheck[];
  };
  commitsToIntegrate: string[];
  blockers: string[];
  warnings: string[];
  operationsPlanned: string[];
  operationsPerformed: string[];
  gitStatusAfter: string;
  safetyNotes: string[];
  recommendedNextSteps: string[];
}

function normalizeRemote(value: string): string {
  return value.trim().replace(/\.git$/iu, "").replace(/\/+$/u, "").toLowerCase();
}

function parseRepositoryNameFromRemote(remoteUrl: string | null): string | undefined {
  const trimmed = remoteUrl?.trim().replace(/\.git$/iu, "") ?? "";
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

function sanitizeGitText(root: string, value: string): string {
  const normalizedRoot = path.resolve(root);
  const variants = new Set([normalizedRoot, normalizedRoot.split(path.sep).join("/"), normalizedRoot.split(path.sep).join("\\")]);
  let sanitized = sanitizeProcessText(value);

  for (const variant of variants) {
    sanitized = sanitized.split(variant).join("<workspace>");
  }

  return sanitized;
}

function sanitizeOutput(root: string, value: string): string {
  const sanitized = sanitizeGitText(root, value);
  return sanitized.length > CHECK_OUTPUT_MAX_LENGTH ? `${sanitized.slice(0, CHECK_OUTPUT_MAX_LENGTH)}\n[truncated]` : sanitized;
}

function assertGitSuccess(root: string, result: ProcessResult, operation: string): void {
  if (result.exitCode !== 0 || result.timedOut) {
    throw new AppError("PROCESS_FAILED", `${operation} failed.`, {
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      stderr: sanitizeGitText(root, result.stderr)
    });
  }
}

async function gitOutputOptional(root: string, args: string[]): Promise<string | null> {
  const result = await runGit(root, args, { timeoutMs: 30_000, maxBytes: 100_000 });
  if (result.exitCode !== 0 || result.timedOut) {
    return null;
  }

  return result.stdout.trim() || null;
}

async function gitOutputRequired(root: string, args: string[], operation: string): Promise<string> {
  const result = await runGit(root, args, { timeoutMs: 30_000, maxBytes: 200_000 });
  assertGitSuccess(root, result, operation);
  return result.stdout.trim();
}

async function localBranchExists(root: string, branchName: string): Promise<boolean> {
  const result = await runGit(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], {
    timeoutMs: 30_000,
    maxBytes: 50_000
  });

  if (result.timedOut) {
    throw new AppError("PROCESS_FAILED", "git show-ref timed out.", { branch: branchName });
  }

  if (result.exitCode === 0) {
    return true;
  }

  if (result.exitCode === 1) {
    return false;
  }

  throw new AppError("PROCESS_FAILED", "git show-ref failed.", {
    branch: branchName,
    exitCode: result.exitCode,
    stderr: sanitizeGitText(root, result.stderr)
  });
}

async function remoteTrackingBranchExists(root: string, branchName: string): Promise<boolean> {
  const result = await runGit(root, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branchName}`], {
    timeoutMs: 30_000,
    maxBytes: 50_000
  });

  if (result.timedOut) {
    throw new AppError("PROCESS_FAILED", "git show-ref timed out.", { branch: `origin/${branchName}` });
  }

  return result.exitCode === 0;
}

async function commitOfRef(root: string, ref: string): Promise<string | null> {
  return gitOutputOptional(root, ["rev-parse", "--verify", `${ref}^{commit}`]);
}

async function revCount(root: string, range: string): Promise<number> {
  const output = await gitOutputRequired(root, ["rev-list", "--count", range], "git rev-list --count");
  return Number.parseInt(output, 10);
}

async function commitsToIntegrate(root: string, targetRef: string | null, sourceBranch: string): Promise<string[]> {
  if (!targetRef) {
    return [];
  }

  const result = await runGit(root, ["log", "--format=%H %s", "--max-count=100", `${targetRef}..${sourceBranch}`], {
    timeoutMs: 30_000,
    maxBytes: 200_000
  });
  if (result.exitCode !== 0 || result.timedOut) {
    return [];
  }

  return result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

async function upstreamForBranch(root: string, branchName: string): Promise<string | null> {
  return gitOutputOptional(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", `${branchName}@{u}`]);
}

function assertSafeBranchName(root: string, branchName: string, label: string): void {
  const unsafe =
    branchName.startsWith("-") ||
    branchName.startsWith("refs/") ||
    branchName.startsWith("origin/") ||
    branchName.includes("..") ||
    branchName.includes("@{") ||
    branchName.includes("\\") ||
    branchName.includes(";") ||
    branchName.endsWith(".lock") ||
    /\s/u.test(branchName) ||
    CONTROL_CHARACTER_PATTERN.test(branchName);

  if (unsafe) {
    throw new AppError("INVALID_INPUT", `${label} is not a safe local branch name.`, { [label]: branchName });
  }

  const check = fs.existsSync(path.join(root, ".git"))
    ? undefined
    : new AppError("GIT_REQUIRED", "Selected workspace is not a git repository.");
  if (check) {
    throw check;
  }
}

async function assertGitBranchFormat(root: string, branchName: string, label: string): Promise<void> {
  assertSafeBranchName(root, branchName, label);
  const result = await runGit(root, ["check-ref-format", "--branch", branchName], {
    timeoutMs: 30_000,
    maxBytes: 50_000
  });
  assertGitSuccess(root, result, "git check-ref-format --branch");
}

function normalizeReportPath(rawPath: string): string {
  const normalized = rawPath.replace(/\\/gu, "/").replace(/^\.\//u, "");
  const hasTraversal = normalized.split("/").some((part) => part === "..");
  if (
    path.isAbsolute(rawPath) ||
    path.win32.isAbsolute(rawPath) ||
    path.posix.isAbsolute(rawPath) ||
    normalized.includes(":") ||
    hasTraversal
  ) {
    throw new AppError("PATH_DENIED", "validationReportPath must be a repository-relative Builder Report path.");
  }

  if (!normalized.startsWith(`${BUILDER_REPORT_DIR}/`) || !normalized.endsWith(".md")) {
    throw new AppError("PATH_DENIED", `validationReportPath must stay under ${BUILDER_REPORT_DIR}/.`);
  }

  return normalized;
}

function candidateReportPathFromBranch(sourceBranch: string): string | undefined {
  const basename = sourceBranch.split("/").at(-1) ?? sourceBranch;
  const idMatch = WORK_CARD_ID_PATTERN.exec(basename);
  if (!idMatch) {
    return undefined;
  }

  const id = idMatch[0];
  const slug = basename.slice(id.length).replace(/^-+/u, "");
  if (!slug) {
    return undefined;
  }

  return `${BUILDER_REPORT_DIR}/BUILDER_REPORT_${id}_${slug.replace(/-/gu, "_")}.md`;
}

function findReportByWorkCardId(root: string, sourceBranch: string): string | undefined {
  const basename = sourceBranch.split("/").at(-1) ?? sourceBranch;
  const id = WORK_CARD_ID_PATTERN.exec(basename)?.[0];
  if (!id) {
    return undefined;
  }

  const absoluteDir = path.join(root, ...BUILDER_REPORT_DIR.split("/"));
  if (!fs.existsSync(absoluteDir)) {
    return undefined;
  }

  const matches = fs
    .readdirSync(absoluteDir)
    .filter((entry) => entry.startsWith(`BUILDER_REPORT_${id}_`) && entry.endsWith(".md"))
    .sort();
  return matches.length === 1 ? `${BUILDER_REPORT_DIR}/${matches[0]}` : undefined;
}

function validationReportCheck(root: string, sourceBranch: string, input: IntegrateToDevInput): ValidationReportCheck {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!input.requireValidationReport && !input.validationReportPath) {
    return {
      required: false,
      provided: false,
      inferred: false,
      exists: false,
      blockers,
      warnings: ["Validation report requirement was explicitly disabled for this call."]
    };
  }

  let reportPath: string | undefined;
  let inferred = false;
  if (input.validationReportPath) {
    reportPath = normalizeReportPath(input.validationReportPath);
  } else {
    const deterministicPath = candidateReportPathFromBranch(sourceBranch);
    if (deterministicPath && fs.existsSync(path.join(root, ...deterministicPath.split("/")))) {
      reportPath = deterministicPath;
      inferred = true;
    } else {
      reportPath = findReportByWorkCardId(root, sourceBranch);
      inferred = Boolean(reportPath);
    }
  }

  if (!reportPath) {
    blockers.push("Validation report could not be inferred deterministically; provide validationReportPath.");
    return {
      required: input.requireValidationReport,
      provided: Boolean(input.validationReportPath),
      inferred,
      exists: false,
      blockers,
      warnings
    };
  }

  const absolutePath = path.join(root, ...reportPath.split("/"));
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    if (input.requireValidationReport) {
      blockers.push("Validation report is required but was not found.");
    } else {
      warnings.push("Validation report path was provided but does not exist.");
    }

    return {
      required: input.requireValidationReport,
      provided: Boolean(input.validationReportPath),
      inferred,
      exists: false,
      path: reportPath,
      blockers,
      warnings
    };
  }

  const stats = fs.statSync(absolutePath);
  return {
    required: input.requireValidationReport,
    provided: Boolean(input.validationReportPath),
    inferred,
    exists: true,
    path: reportPath,
    sizeBytes: stats.size,
    modifiedTime: stats.mtime.toISOString(),
    blockers,
    warnings
  };
}

function readPackageName(root: string): { present: boolean; name: string | null } {
  const packagePath = path.join(root, "package.json");
  if (!fs.existsSync(packagePath)) {
    return { present: false, name: null };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(packagePath, "utf8")) as { name?: unknown };
    return {
      present: true,
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : null
    };
  } catch {
    return { present: true, name: null };
  }
}

async function originRemote(root: string): Promise<string | null> {
  return gitOutputOptional(root, ["config", "--get", "remote.origin.url"]);
}

function repositoryIdentityCheck(root: string, workspace: ResolvedWorkspace, remote: string | null) {
  const packageInfo = readPackageName(root);
  const remoteMatchesConfiguredWorkspace = workspace.remote
    ? remote
      ? normalizeRemote(remote) === normalizeRemote(workspace.remote)
      : "unknown"
    : "not_configured";

  return {
    packageJsonPresent: packageInfo.present,
    packageName: packageInfo.name,
    gitRootMatchesWorkspace: path.resolve(root) === path.resolve(workspace.root),
    remoteMatchesConfiguredWorkspace
  } as const;
}

function addRepositoryIdentityBlockers(
  blockers: string[],
  check: ReturnType<typeof repositoryIdentityCheck>
): void {
  if (!check.packageJsonPresent) {
    blockers.push("package.json is required for repository identity verification.");
  }

  if (!check.gitRootMatchesWorkspace) {
    blockers.push("Resolved git root does not match the configured workspace root.");
  }

  if (check.remoteMatchesConfiguredWorkspace === false || check.remoteMatchesConfiguredWorkspace === "unknown") {
    blockers.push("origin remote does not match the configured workspace remote.");
  }
}

function sourceBranchBlockers(sourceBranch: string, targetBranch: "dev"): string[] {
  const blockers: string[] = [];
  if (sourceBranch === "main") {
    blockers.push("Source branch must not be main.");
  }
  if (sourceBranch === targetBranch) {
    blockers.push("Source branch must not be dev.");
  }
  return blockers;
}

function plannedOperations(input: IntegrateToDevInput, sourceBranch: string, targetLocalExists: boolean): string[] {
  const operations = [
    "Resolve workspaceId to the configured workspace root.",
    "Verify repository identity, clean working tree, source branch, target branch, upstream, and Builder Report guardrails.",
    targetLocalExists ? "Switch to local dev." : "Create local dev from origin/dev, then switch to dev.",
    input.mergeMode === "ff-only"
      ? `Run git merge --ff-only ${sourceBranch}.`
      : `Run git merge --no-ff -m "Integrate ${sourceBranch} into dev" ${sourceBranch}.`,
    "Run git diff --check.",
    "Run npm run check:public.",
    "Run npm run mcp:self-test -- --json."
  ];

  if (input.push) {
    operations.push("Push dev to origin/dev with normal git push.");
  } else {
    operations.push("Leave the local dev merge unpushed.");
  }

  return operations;
}

function recommendedNextSteps(ok: boolean, input: IntegrateToDevInput): string[] {
  if (!ok) {
    return [
      "Resolve the listed blockers, then rerun git_toolbox.integrate_to_dev in dry-run mode.",
      "Provide validationReportPath when Builder Report inference is ambiguous.",
      "Push the reviewed source branch before attempting execution."
    ];
  }

  if (input.dryRun) {
    return [
      "Review the dry-run operations and blockers.",
      "Call git_toolbox.integrate_to_dev with dryRun=false only after Architect/Operator review approves the integration."
    ];
  }

  if (!input.push) {
    return ["Review local dev, then push dev only after post-merge validation is accepted."];
  }

  return ["Use dev for package/promote work only when the operator requests it."];
}

function safetyNotes(): string[] {
  return [
    "Workspace root is resolved only from workspaceId.",
    "Target branch is fixed to dev.",
    "The action never invokes force push, rebase, reset, stash, branch deletion, tags, packaging, or release publication.",
    "Push, when requested, is only git push origin dev after post-merge checks pass.",
    "Merge conflicts trigger git merge --abort before returning a blocker."
  ];
}

async function runPostMergeChecks(root: string): Promise<PostMergeCheck[]> {
  const diffCheck = await runGit(root, ["diff", "--check"], { timeoutMs: 60_000, maxBytes: 500_000 });
  const publicCheck = await runFixedNpm(root, ["run", "check:public"], { timeoutMs: 180_000, maxBytes: 1_000_000 });
  const selfTest = await runFixedNpm(root, ["run", "mcp:self-test", "--", "--json"], {
    timeoutMs: 180_000,
    maxBytes: 1_000_000
  });

  return [
    {
      name: "git diff --check",
      ok: diffCheck.exitCode === 0 && !diffCheck.timedOut,
      exitCode: diffCheck.exitCode,
      timedOut: diffCheck.timedOut,
      stdout: sanitizeOutput(root, diffCheck.stdout),
      stderr: sanitizeOutput(root, diffCheck.stderr)
    },
    {
      name: "npm run check:public",
      ok: publicCheck.exitCode === 0 && !publicCheck.timedOut,
      exitCode: publicCheck.exitCode,
      timedOut: publicCheck.timedOut,
      stdout: sanitizeOutput(root, publicCheck.stdout),
      stderr: sanitizeOutput(root, publicCheck.stderr)
    },
    {
      name: "npm run mcp:self-test -- --json",
      ok: selfTest.exitCode === 0 && !selfTest.timedOut,
      exitCode: selfTest.exitCode,
      timedOut: selfTest.timedOut,
      stdout: sanitizeOutput(root, selfTest.stdout),
      stderr: sanitizeOutput(root, selfTest.stderr)
    }
  ];
}

async function runFixedNpm(
  root: string,
  args: string[],
  options: { timeoutMs: number; maxBytes: number }
): Promise<ProcessResult> {
  for (const arg of args) {
    if (!SAFE_NPM_ARG_PATTERN.test(arg)) {
      throw new AppError("INVALID_INPUT", "Internal npm validation argument failed fixed-command safety validation.");
    }
  }

  if (process.platform === "win32") {
    return runProcess("cmd.exe", ["/d", "/s", "/c", ["npm.cmd", ...args].join(" ")], root, options);
  }

  return runProcess("npm", args, root, options);
}

async function switchBranch(root: string, branchName: string, operationsPerformed: string[]): Promise<void> {
  const result = await runGit(root, ["switch", branchName], { timeoutMs: 60_000, maxBytes: 200_000 });
  assertGitSuccess(root, result, "git switch");
  operationsPerformed.push(`git switch ${branchName}`);
}

async function createDevFromOrigin(root: string, operationsPerformed: string[]): Promise<void> {
  const result = await runGit(root, ["switch", "-c", "dev", "--track", "origin/dev"], {
    timeoutMs: 60_000,
    maxBytes: 200_000
  });
  assertGitSuccess(root, result, "git switch -c dev --track origin/dev");
  operationsPerformed.push("git switch -c dev --track origin/dev");
}

async function abortMergeIfNeeded(root: string, operationsPerformed: string[]): Promise<void> {
  if (!fs.existsSync(path.join(root, ".git", "MERGE_HEAD"))) {
    return;
  }

  const abortResult = await runGit(root, ["merge", "--abort"], { timeoutMs: 60_000, maxBytes: 200_000 });
  assertGitSuccess(root, abortResult, "git merge --abort");
  operationsPerformed.push("git merge --abort");
}

async function runMerge(
  root: string,
  input: IntegrateToDevInput,
  sourceBranch: string,
  originalBranch: string,
  operationsPerformed: string[],
  blockers: string[]
): Promise<string | null> {
  const args =
    input.mergeMode === "ff-only"
      ? ["merge", "--ff-only", sourceBranch]
      : ["merge", "--no-ff", "-m", `Integrate ${sourceBranch} into dev`, sourceBranch];
  const mergeResult = await runGit(root, args, { timeoutMs: 120_000, maxBytes: 500_000 });
  operationsPerformed.push(input.mergeMode === "ff-only" ? `git merge --ff-only ${sourceBranch}` : `git merge --no-ff ${sourceBranch}`);

  if (mergeResult.exitCode !== 0 || mergeResult.timedOut) {
    blockers.push(`Merge failed: ${sanitizeOutput(root, mergeResult.stderr || mergeResult.stdout)}`);
    await abortMergeIfNeeded(root, operationsPerformed);
    if ((await currentBranch(root)) !== originalBranch) {
      await switchBranch(root, originalBranch, operationsPerformed);
    }
    return null;
  }

  return gitOutputRequired(root, ["rev-parse", "HEAD"], "git rev-parse HEAD");
}

async function pushDev(root: string, operationsPerformed: string[]): Promise<ProcessResult> {
  const result = await runGit(root, ["push", "origin", "dev"], { timeoutMs: 120_000, maxBytes: 500_000 });
  operationsPerformed.push("git push origin dev");
  return result;
}

export async function integrateToDev(rawInput: unknown, config: AppConfig): Promise<IntegrateToDevOutput> {
  const input = IntegrateToDevInputSchema.parse(rawInput);
  const auditMeta = {
    toolName: "git_toolbox.integrate_to_dev",
    action: input.dryRun ? "dry-run" : "execute",
    root: input.workspaceId,
    fileCount: 0
  };

  try {
    const workspace = resolveWorkspace(input.workspaceId, config);
    const root = validateRootGitRepo(workspace.root, config);
    const originalBranch = await currentBranch(root);
    const sourceBranch = input.sourceBranch ?? originalBranch;
    const targetBranch = input.targetBranch;
    const blockers: string[] = [];
    const warnings: string[] = [];
    const operationsPerformed: string[] = [];

    auditMeta.root = root;
    await assertGitBranchFormat(root, sourceBranch, "sourceBranch");
    await assertGitBranchFormat(root, targetBranch, "targetBranch");
    blockers.push(...sourceBranchBlockers(sourceBranch, targetBranch));

    const statusBefore = await statusShort(root);
    const workingTreeClean = parseStatusPaths(statusBefore).length === 0;
    if (!workingTreeClean) {
      blockers.push("Current working tree must be clean before integrating to dev.");
    }
    if (!input.requireCleanWorkingTree) {
      warnings.push("requireCleanWorkingTree=false was supplied, but this action still requires a clean working tree.");
    }

    const remote = await originRemote(root);
    const remoteRedacted = remote ? redactRemoteUrl(remote) : null;
    const identity = repositoryIdentityCheck(root, workspace, remote);
    addRepositoryIdentityBlockers(blockers, identity);

    const sourceExists = await localBranchExists(root, sourceBranch);
    const targetLocalExists = await localBranchExists(root, targetBranch);
    const targetRemoteExists = await remoteTrackingBranchExists(root, targetBranch);
    const targetExists = targetLocalExists || targetRemoteExists;
    if (!sourceExists) {
      blockers.push("Source branch does not exist locally.");
    }
    if (!targetExists) {
      blockers.push("dev does not exist locally and no origin/dev tracking branch is available.");
    }

    const sourceUpstream = sourceExists ? await upstreamForBranch(root, sourceBranch) : null;
    const fallbackOriginUpstream = sourceExists && !sourceUpstream && (await remoteTrackingBranchExists(root, sourceBranch))
      ? `origin/${sourceBranch}`
      : null;
    const effectiveUpstream = sourceUpstream ?? fallbackOriginUpstream;
    const sourceAhead = effectiveUpstream && sourceExists ? await revCount(root, `${effectiveUpstream}..${sourceBranch}`) : null;
    const sourceBehind = effectiveUpstream && sourceExists ? await revCount(root, `${sourceBranch}..${effectiveUpstream}`) : null;
    const sourcePushed = Boolean(effectiveUpstream && sourceAhead === 0);
    if (!effectiveUpstream) {
      blockers.push("Source branch must have an upstream or origin tracking branch.");
    }
    if (!sourcePushed) {
      blockers.push("Source branch must be pushed before integration.");
    }
    if (!input.requireSourceBranchPushed) {
      warnings.push("requireSourceBranchPushed=false was supplied, but this action still requires the source branch to be pushed.");
    }

    const validationReport = validationReportCheck(root, sourceBranch, input);
    blockers.push(...validationReport.blockers);
    warnings.push(...validationReport.warnings);

    const targetRef = targetLocalExists ? targetBranch : targetRemoteExists ? `origin/${targetBranch}` : null;
    const sourceCommit = sourceExists ? await commitOfRef(root, sourceBranch) : null;
    const targetCommitBefore = targetRef ? await commitOfRef(root, targetRef) : null;
    const commitList = sourceExists ? await commitsToIntegrate(root, targetRef, sourceBranch) : [];
    const operationsPlanned = plannedOperations(input, sourceBranch, targetLocalExists);
    const postMergeChecks: PostMergeCheck[] = [];
    let mergeCommit: string | null = null;
    let pushed = false;
    let targetCommitAfter: string | null = null;

    if (input.dryRun || blockers.length > 0) {
      const gitStatusAfter = await statusShort(root);
      const ok = blockers.length === 0;
      await auditGitWorkflow(config, { ...auditMeta, root, branch: originalBranch }, ok ? "allow" : "deny", ok ? "dry-run ok" : "preflight blockers");
      return {
        ok,
        mode: input.dryRun ? "dryRun" : "execute",
        workspaceId: workspace.workspaceId,
        workspaceLabel: workspace.label,
        repositoryName: parseRepositoryNameFromRemote(remote) ?? identity.packageName ?? "unknown",
        currentBranch: originalBranch,
        sourceBranch,
        targetBranch,
        originalBranch,
        sourceCommit,
        targetCommitBefore,
        targetCommitAfter,
        mergeCommit,
        pushed,
        remote: remoteRedacted,
        validationReportPath: validationReport.path ?? null,
        checks: {
          repositoryIdentity: identity,
          workingTreeClean,
          sourceBranchExists: sourceExists,
          targetBranchExists: targetExists,
          sourceBranchPushed: sourcePushed,
          sourceBranchUpstream: effectiveUpstream,
          sourceBranchAheadOfUpstream: sourceAhead,
          sourceBranchBehindUpstream: sourceBehind,
          validationReport,
          postMerge: postMergeChecks
        },
        commitsToIntegrate: commitList,
        blockers,
        warnings,
        operationsPlanned,
        operationsPerformed,
        gitStatusAfter,
        safetyNotes: safetyNotes(),
        recommendedNextSteps: recommendedNextSteps(ok, input)
      };
    }

    if (targetLocalExists) {
      await switchBranch(root, targetBranch, operationsPerformed);
    } else {
      await createDevFromOrigin(root, operationsPerformed);
    }

    mergeCommit = await runMerge(root, input, sourceBranch, originalBranch, operationsPerformed, blockers);
    if (mergeCommit) {
      postMergeChecks.push(...(await runPostMergeChecks(root)));
      const failedChecks = postMergeChecks.filter((check) => !check.ok);
      if (failedChecks.length > 0) {
        blockers.push("Post-merge validation failed; dev was not pushed.");
      }
    }

    targetCommitAfter = await commitOfRef(root, targetBranch);
    if (input.push && mergeCommit && blockers.length === 0) {
      const pushResult = await pushDev(root, operationsPerformed);
      if (pushResult.exitCode !== 0 || pushResult.timedOut) {
        blockers.push(`git push origin dev failed: ${sanitizeOutput(root, pushResult.stderr || pushResult.stdout)}`);
      } else {
        pushed = true;
      }
    }

    if (!input.push && mergeCommit && blockers.length === 0) {
      warnings.push("dev was merged locally and not pushed because push=false.");
    }

    const ok = blockers.length === 0;
    const gitStatusAfter = await statusShort(root);
    await auditGitWorkflow(config, { ...auditMeta, root, branch: await currentBranch(root) }, ok ? "allow" : "deny", ok ? "integrated" : "integration blocked");
    return {
      ok,
      mode: "execute",
      workspaceId: workspace.workspaceId,
      workspaceLabel: workspace.label,
      repositoryName: parseRepositoryNameFromRemote(remote) ?? identity.packageName ?? "unknown",
      currentBranch: await currentBranch(root),
      sourceBranch,
      targetBranch,
      originalBranch,
      sourceCommit,
      targetCommitBefore,
      targetCommitAfter,
      mergeCommit,
      pushed,
      remote: remoteRedacted,
      validationReportPath: validationReport.path ?? null,
      checks: {
        repositoryIdentity: identity,
        workingTreeClean,
        sourceBranchExists: sourceExists,
        targetBranchExists: targetExists,
        sourceBranchPushed: sourcePushed,
        sourceBranchUpstream: effectiveUpstream,
        sourceBranchAheadOfUpstream: sourceAhead,
        sourceBranchBehindUpstream: sourceBehind,
        validationReport,
        postMerge: postMergeChecks
      },
      commitsToIntegrate: commitList,
      blockers,
      warnings,
      operationsPlanned,
      operationsPerformed,
      gitStatusAfter,
      safetyNotes: safetyNotes(),
      recommendedNextSteps: recommendedNextSteps(ok, input)
    };
  } catch (error) {
    await auditGitWorkflowError(config, auditMeta, error);
    throw error;
  }
}
