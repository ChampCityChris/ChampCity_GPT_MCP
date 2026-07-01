import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { type AppConfig } from "../../config.js";
import { resolveAllowedRoot } from "../../security/pathPolicy.js";
import { AppError } from "../../utils/errors.js";
import { runGit, type ProcessResult } from "../../utils/git.js";
import { resolveDefaultWorkspaceRoot } from "../../workspaceRoot.js";
import { MAX_RELATIVE_PATH_LENGTH } from "../inputLimits.js";
import { auditGitWorkflow, auditGitWorkflowError } from "./audit.js";
import { currentBranch, parseStatusPaths, sanitizeProcessText, statusShort, uniqueSorted } from "./safety.js";

const DEFAULT_WORKSPACE_ID = "default";
const WORKSPACE_ID_MAX_LENGTH = 64;
const SLUG_MAX_LENGTH = 80;
const WORK_CARD_ID_MAX_LENGTH = 32;
const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9_-]+$/u;
const WORK_CARD_ID_PATTERN = /^WC-V1-(?:\d{4}|FIX\d{2})$/u;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const FEATURE_BRANCH_PATTERN = /^feature\/WC-V1-(?:\d{4}|FIX\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const SAFE_DEFAULT_SLUG = "work-branch";

export const PrepareGitWorkBranchInputSchema = z
  .object({
    workspaceId: z.string().min(1).max(WORKSPACE_ID_MAX_LENGTH).regex(WORKSPACE_ID_PATTERN).default(DEFAULT_WORKSPACE_ID),
    branchKind: z.enum(["dev", "feature"]),
    workCardId: z.string().min(1).max(WORK_CARD_ID_MAX_LENGTH).optional(),
    slug: z.string().min(1).max(SLUG_MAX_LENGTH).optional(),
    baseBranch: z.enum(["main", "dev"]).optional(),
    createIfMissing: z.boolean().default(true)
  })
  .strict();

export type PrepareGitWorkBranchInput = z.infer<typeof PrepareGitWorkBranchInputSchema>;

export interface PrepareGitWorkBranchOutput {
  branchBefore: string;
  branchAfter: string;
  created: boolean;
  switched: boolean;
  baseBranch: "main" | "dev";
  targetBranch: string;
  statusBefore: string;
  statusAfter: string;
  warnings: string[];
  recommendedNextSteps: string[];
}

interface WorkspaceOption {
  workspaceId: string;
  workspaceLabel: string;
  root: string;
  aliases: string[];
}

function normalizeAlias(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, WORKSPACE_ID_MAX_LENGTH);
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

async function repositoryAlias(root: string): Promise<string | undefined> {
  if (!fs.existsSync(path.join(root, ".git"))) {
    return undefined;
  }

  const result = await runGit(root, ["remote", "get-url", "origin"], {
    timeoutMs: 30_000,
    maxBytes: 50_000
  });

  if (result.exitCode !== 0 || result.timedOut) {
    return undefined;
  }

  const repoName = parseRepositoryNameFromRemote(result.stdout);
  return repoName ? normalizeAlias(repoName.split("/").at(-1) ?? repoName) : undefined;
}

function publicWorkspaceIds(workspaces: WorkspaceOption[]): string[] {
  const ids = new Set<string>([DEFAULT_WORKSPACE_ID]);
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
      const comparisonRoot = process.platform === "win32" ? root.toLowerCase() : root;
      if (!roots.some((entry) => (process.platform === "win32" ? entry.toLowerCase() : entry) === comparisonRoot)) {
        roots.push(root);
      }
    } catch {
      // Startup config validation owns malformed non-default allowed roots.
    }
  }

  return Promise.all(
    roots.map(async (root, index): Promise<WorkspaceOption> => {
      const folderAlias = normalizeAlias(path.basename(root));
      const repoAlias = await repositoryAlias(root);
      const aliases = [...new Set([folderAlias, repoAlias].filter((entry): entry is string => Boolean(entry)))];
      const isDefault = (process.platform === "win32" ? root.toLowerCase() : root) === (process.platform === "win32" ? defaultRoot.toLowerCase() : defaultRoot);

      return {
        workspaceId: isDefault ? DEFAULT_WORKSPACE_ID : aliases[0] ?? `workspace_${index + 1}`,
        workspaceLabel: path.basename(root),
        root,
        aliases: isDefault ? [...new Set([DEFAULT_WORKSPACE_ID, ...aliases])] : aliases
      };
    })
  );
}

async function resolveWorkspace(workspaceId: string, config: AppConfig): Promise<WorkspaceOption> {
  const options = await workspaceOptions(config);
  const normalized = normalizeAlias(workspaceId);
  const selected = options.filter((option) => option.workspaceId === workspaceId || option.aliases.includes(normalized));

  if (selected.length === 0) {
    throw new AppError("INVALID_INPUT", "Unknown workspaceId. Use one of the available safe workspace IDs.", {
      availableWorkspaceIds: publicWorkspaceIds(options)
    });
  }

  if (selected.length > 1) {
    throw new AppError("INVALID_INPUT", "workspaceId matches more than one configured allowed workspace.", {
      availableWorkspaceIds: publicWorkspaceIds(options)
    });
  }

  if (!fs.existsSync(path.join(selected[0].root, ".git"))) {
    throw new AppError("GIT_REQUIRED", "Selected workspace is not a git repository.");
  }

  return selected[0];
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

function assertGitSuccess(root: string, result: ProcessResult, operation: string): void {
  if (result.exitCode !== 0 || result.timedOut) {
    throw new AppError("PROCESS_FAILED", `${operation} failed.`, {
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      stderr: sanitizeGitText(root, result.stderr)
    });
  }
}

function assertCleanWorkingTree(status: string): void {
  const changedPaths = parseStatusPaths(status);
  if (changedPaths.length > 0) {
    throw new AppError("COMMAND_DENIED", "prepare_git_work_branch requires a clean working tree before switching or creating branches.", {
      changedPaths
    });
  }
}

function normalizeWorkCardId(value: string | undefined): string | undefined {
  return value?.trim().toUpperCase();
}

function assertSafeTargetBranch(targetBranch: string): void {
  const disallowed =
    targetBranch === "main" ||
    targetBranch.startsWith("origin/") ||
    targetBranch.startsWith("refs/") ||
    targetBranch.startsWith("-") ||
    targetBranch.includes("..") ||
    targetBranch.includes("@{") ||
    targetBranch.includes("\\") ||
    targetBranch.includes(" ") ||
    targetBranch.includes(";") ||
    targetBranch.endsWith(".lock") ||
    CONTROL_CHARACTER_PATTERN.test(targetBranch);

  if (disallowed) {
    throw new AppError("INVALID_INPUT", "Target branch is not an approved dev or Work Card feature branch.", {
      targetBranch
    });
  }

  if (targetBranch !== "dev" && !FEATURE_BRANCH_PATTERN.test(targetBranch)) {
    throw new AppError("INVALID_INPUT", "Target branch is not an approved dev or Work Card feature branch.", {
      targetBranch
    });
  }

  if (targetBranch.length > MAX_RELATIVE_PATH_LENGTH) {
    throw new AppError("INVALID_INPUT", "Target branch is too long.");
  }
}

async function assertGitRefFormat(root: string, targetBranch: string): Promise<void> {
  const result = await runGit(root, ["check-ref-format", "--branch", targetBranch], {
    timeoutMs: 30_000,
    maxBytes: 50_000
  });
  assertGitSuccess(root, result, "git check-ref-format --branch");
}

async function branchExists(root: string, branchName: string): Promise<boolean> {
  const result = await runGit(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], {
    timeoutMs: 30_000,
    maxBytes: 50_000
  });

  if (result.timedOut) {
    throw new AppError("PROCESS_FAILED", "git show-ref timed out.", {
      branch: branchName
    });
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

async function assertBaseBranchExists(root: string, baseBranch: "main" | "dev"): Promise<void> {
  if (!(await branchExists(root, baseBranch))) {
    throw new AppError("COMMAND_DENIED", "Base branch is missing; refusing to create or verify a work branch.", {
      baseBranch
    });
  }
}

async function assertBaseIsAncestor(root: string, baseBranch: "main" | "dev", targetBranch: string): Promise<void> {
  await assertBaseBranchExists(root, baseBranch);

  const result = await runGit(root, ["merge-base", "--is-ancestor", baseBranch, targetBranch], {
    timeoutMs: 30_000,
    maxBytes: 50_000
  });

  if (result.exitCode === 0 && !result.timedOut) {
    return;
  }

  if (result.exitCode === 1 && !result.timedOut) {
    throw new AppError("COMMAND_DENIED", "Existing target branch is not based on the selected base branch; a human merge decision is required.", {
      baseBranch,
      targetBranch
    });
  }

  assertGitSuccess(root, result, "git merge-base --is-ancestor");
}

function targetFromInput(input: PrepareGitWorkBranchInput): { targetBranch: string; baseBranch: "main" | "dev" } {
  if (input.branchKind === "dev") {
    if (input.workCardId || input.slug) {
      throw new AppError("INVALID_INPUT", "workCardId and slug are only accepted for feature branch preparation.");
    }

    return {
      targetBranch: "dev",
      baseBranch: input.baseBranch ?? "main"
    };
  }

  const workCardId = normalizeWorkCardId(input.workCardId);
  if (!workCardId) {
    throw new AppError("INVALID_INPUT", "workCardId is required for feature branch preparation.");
  }

  if (!WORK_CARD_ID_PATTERN.test(workCardId)) {
    throw new AppError("INVALID_INPUT", "workCardId must match WC-V1-0000 or WC-V1-FIX00 format.");
  }

  const slug = input.slug ?? SAFE_DEFAULT_SLUG;
  if (!SLUG_PATTERN.test(slug)) {
    throw new AppError("INVALID_INPUT", "slug must be lowercase kebab-case.");
  }

  return {
    targetBranch: `feature/${workCardId}-${slug}`,
    baseBranch: input.baseBranch ?? "dev"
  };
}

function recommendedNextSteps(branchAfter: string): string[] {
  return [
    `Run validation on ${branchAfter} before staging changes.`,
    "Review changed files, then use safe_stage_changes for approved paths.",
    "Use commit_validated_changes and push_current_branch after validation passes.",
    "Merge to main only at a stable release or baseline checkpoint."
  ];
}

export async function prepareGitWorkBranch(rawInput: unknown, config: AppConfig): Promise<PrepareGitWorkBranchOutput> {
  const input = PrepareGitWorkBranchInputSchema.parse(rawInput);
  const auditMeta = {
    toolName: "prepare_git_work_branch",
    action: "prepare-branch",
    root: input.workspaceId,
    fileCount: 0
  };

  try {
    const workspace = await resolveWorkspace(input.workspaceId, config);
    const root = workspace.root;
    const branchBefore = await currentBranch(root);
    const statusBefore = await statusShort(root);
    const { targetBranch, baseBranch } = targetFromInput(input);
    const warnings: string[] = [];

    auditMeta.root = root;
    assertCleanWorkingTree(statusBefore);
    assertSafeTargetBranch(targetBranch);
    await assertGitRefFormat(root, targetBranch);

    const targetExists = await branchExists(root, targetBranch);
    let created = false;
    let switched = false;

    if (targetExists) {
      await assertBaseIsAncestor(root, baseBranch, targetBranch);

      if (branchBefore === targetBranch) {
        warnings.push("Already on the requested work branch.");
      } else {
        const switchResult = await runGit(root, ["switch", targetBranch], {
          timeoutMs: 60_000,
          maxBytes: 100_000
        });
        assertGitSuccess(root, switchResult, "git switch");
        switched = true;
      }
    } else {
      if (!input.createIfMissing) {
        throw new AppError("COMMAND_DENIED", "Target branch is missing and createIfMissing is false.", {
          targetBranch
        });
      }

      await assertBaseBranchExists(root, baseBranch);
      const createResult = await runGit(root, ["switch", "-c", targetBranch, baseBranch], {
        timeoutMs: 60_000,
        maxBytes: 100_000
      });
      assertGitSuccess(root, createResult, "git switch -c");
      created = true;
      switched = branchBefore !== targetBranch;
    }

    const branchAfter = await currentBranch(root);
    const statusAfter = await statusShort(root);
    if (branchAfter !== targetBranch) {
      throw new AppError("PROCESS_FAILED", "Branch preparation did not end on the requested target branch.", {
        branchAfter,
        targetBranch
      });
    }

    assertCleanWorkingTree(statusAfter);
    await auditGitWorkflow(config, { ...auditMeta, root, branch: branchAfter }, "allow");

    return {
      branchBefore,
      branchAfter,
      created,
      switched,
      baseBranch,
      targetBranch,
      statusBefore,
      statusAfter,
      warnings: uniqueSorted(warnings),
      recommendedNextSteps: recommendedNextSteps(branchAfter)
    };
  } catch (error) {
    await auditGitWorkflowError(config, auditMeta, error);
    throw error;
  }
}
