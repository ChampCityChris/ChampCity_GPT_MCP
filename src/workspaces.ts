import fs from "node:fs";
import path from "node:path";

import { type AppConfig } from "./config.js";
import { resolveAllowedRoot } from "./security/pathPolicy.js";
import { AppError } from "./utils/errors.js";
import { runGit } from "./utils/git.js";

export const DEFAULT_WORKSPACE_ID = "default";
export const ALL_ALLOWED_WORKSPACE_ID = "all_allowed";
export const WORKSPACE_ID_MAX_LENGTH = 64;
export const WORKSPACE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;

export type WorkspaceSource = "configured" | "derived";
export type DefaultWorkspaceIdSource = "local-file" | "single-workspace" | "none";

export interface ConfiguredWorkspace {
  workspaceId: string;
  label: string;
  root: string;
  remote?: string;
  source: WorkspaceSource;
}

export interface WorkspaceRegistry {
  workspaces: ConfiguredWorkspace[];
  defaultWorkspaceId?: string;
  defaultWorkspaceIdSource: DefaultWorkspaceIdSource;
  availableWorkspaceIds: string[];
  multipleWorkspacesRequireExplicitSelection: boolean;
}

export interface ResolvedWorkspace {
  workspaceId: string;
  label: string;
  root: string;
  remote?: string;
  source: WorkspaceSource;
  isDefault: boolean;
}

export interface WorkspaceDiagnostics {
  registeredWorkspaceCount: number;
  availableWorkspaceIds: string[];
  defaultWorkspaceId?: string;
  defaultWorkspaceIdSource: DefaultWorkspaceIdSource;
  defaultWorkspaceIsExplicit: boolean;
  multipleWorkspacesRequireExplicitSelection: boolean;
}

export interface WorkspaceCatalogEntry {
  workspaceId: string;
  label: string;
  repositoryName?: string;
  branch: string | "unknown";
  isDefault: boolean;
  remoteMatchesExpected: boolean | "unknown";
}

function normalizeForComparison(value: string): string {
  const normalized = path.resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function uniqueResolvedPaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const entry of paths) {
    const resolved = path.resolve(entry);
    const comparison = normalizeForComparison(resolved);
    if (seen.has(comparison)) {
      continue;
    }
    seen.add(comparison);
    unique.push(resolved);
  }

  return unique;
}

function isReservedWorkspaceId(value: string): boolean {
  return value === DEFAULT_WORKSPACE_ID || value === ALL_ALLOWED_WORKSPACE_ID;
}

export function assertSafeWorkspaceId(value: string, label = "workspaceId"): string {
  if (!WORKSPACE_ID_PATTERN.test(value) || value.includes("..") || value.includes(":") || /[\\/;$`"'|&<>]/u.test(value)) {
    throw new AppError("INVALID_INPUT", `${label} must be a safe lowercase server-defined alias.`);
  }

  return value;
}

export function assertConfiguredWorkspaceId(value: string, label = "workspaceId"): string {
  const workspaceId = assertSafeWorkspaceId(value, label);
  if (isReservedWorkspaceId(workspaceId)) {
    throw new AppError("INVALID_INPUT", `${label} may not use reserved workspace ID "${workspaceId}".`);
  }

  return workspaceId;
}

export function deriveWorkspaceId(value: string, fallback: string): string {
  const derived = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, WORKSPACE_ID_MAX_LENGTH);

  return derived && WORKSPACE_ID_PATTERN.test(derived) && !isReservedWorkspaceId(derived) ? derived : fallback;
}

function uniqueWorkspaceId(baseId: string, usedIds: Set<string>): string {
  let candidate = baseId;
  let suffix = 2;

  while (usedIds.has(candidate) || isReservedWorkspaceId(candidate)) {
    const suffixText = `_${suffix}`;
    candidate = `${baseId.slice(0, WORKSPACE_ID_MAX_LENGTH - suffixText.length)}${suffixText}`;
    suffix += 1;
  }

  usedIds.add(candidate);
  return candidate;
}

function derivedWorkspacesFromAllowedRoots(config: AppConfig): ConfiguredWorkspace[] {
  const usedIds = new Set<string>();
  return uniqueResolvedPaths(config.allowedRoots).map((root, index) => {
    const fallback = `workspace_${index + 1}`;
    const workspaceId = uniqueWorkspaceId(deriveWorkspaceId(path.basename(root), fallback), usedIds);

    return {
      workspaceId,
      label: path.basename(root) || workspaceId,
      root,
      source: "derived"
    };
  });
}

function configuredWorkspaces(config: AppConfig): ConfiguredWorkspace[] {
  if (config.workspaces && config.workspaces.length > 0) {
    return config.workspaces.map((workspace) => ({
      ...workspace,
      workspaceId: assertConfiguredWorkspaceId(workspace.workspaceId),
      root: path.resolve(workspace.root),
      label: workspace.label || path.basename(workspace.root) || workspace.workspaceId,
      source: workspace.source ?? "configured"
    }));
  }

  return derivedWorkspacesFromAllowedRoots(config);
}

function validateWorkspaceRoots(workspaces: readonly ConfiguredWorkspace[], config: AppConfig): void {
  const seenIds = new Set<string>();
  for (const workspace of workspaces) {
    if (seenIds.has(workspace.workspaceId)) {
      throw new AppError("INVALID_INPUT", "Configured workspace IDs must be unique.", {
        workspaceId: workspace.workspaceId
      });
    }
    seenIds.add(workspace.workspaceId);

    try {
      resolveAllowedRoot(workspace.root, config.allowedRoots);
    } catch (error) {
      if (error instanceof AppError) {
        throw new AppError("PATH_DENIED", "Configured workspace root is not in the allowed root list.", {
          workspaceId: workspace.workspaceId,
          allowedWorkspaceIds: workspaces.map((entry) => entry.workspaceId).sort()
        });
      }
      throw error;
    }
  }
}

export function getWorkspaceRegistry(config: AppConfig): WorkspaceRegistry {
  const workspaces = configuredWorkspaces(config);
  validateWorkspaceRoots(workspaces, config);

  const availableWorkspaceIds = workspaces.map((workspace) => workspace.workspaceId).sort();
  let defaultWorkspaceId = config.defaultWorkspaceId;
  let defaultWorkspaceIdSource: DefaultWorkspaceIdSource = defaultWorkspaceId ? "local-file" : "none";

  if (defaultWorkspaceId) {
    assertConfiguredWorkspaceId(defaultWorkspaceId, "defaultWorkspaceId");
    if (!workspaces.some((workspace) => workspace.workspaceId === defaultWorkspaceId)) {
      throw new AppError("INVALID_INPUT", "Configured defaultWorkspaceId does not match a registered workspace.", {
        defaultWorkspaceId,
        availableWorkspaceIds
      });
    }
  } else if (workspaces.length === 1) {
    defaultWorkspaceId = workspaces[0].workspaceId;
    defaultWorkspaceIdSource = "single-workspace";
  }

  return {
    workspaces,
    defaultWorkspaceId,
    defaultWorkspaceIdSource,
    availableWorkspaceIds,
    multipleWorkspacesRequireExplicitSelection: workspaces.length > 1 && !defaultWorkspaceId
  };
}

export function getAvailableWorkspaceIds(config: AppConfig, includeDefaultAlias = true): string[] {
  const registry = getWorkspaceRegistry(config);
  const ids = new Set(registry.availableWorkspaceIds);
  if (includeDefaultAlias && registry.defaultWorkspaceId) {
    ids.add(DEFAULT_WORKSPACE_ID);
  }
  return [...ids].sort();
}

function workspaceRequiredError(registry: WorkspaceRegistry): AppError {
  return new AppError("WORKSPACE_REQUIRED", "Multiple workspaces are configured. Provide an explicit workspaceId.", {
    availableWorkspaceIds: registry.availableWorkspaceIds
  });
}

export function resolveWorkspace(workspaceId: string | undefined, config: AppConfig): ResolvedWorkspace {
  const requestedWorkspaceId = workspaceId ?? DEFAULT_WORKSPACE_ID;
  assertSafeWorkspaceId(requestedWorkspaceId, "workspaceId");

  if (requestedWorkspaceId === ALL_ALLOWED_WORKSPACE_ID) {
    throw new AppError("INVALID_INPUT", "all_allowed is only supported by actions that explicitly document it.", {
      availableWorkspaceIds: getAvailableWorkspaceIds(config)
    });
  }

  const registry = getWorkspaceRegistry(config);
  const selectedWorkspaceId =
    requestedWorkspaceId === DEFAULT_WORKSPACE_ID
      ? registry.defaultWorkspaceId
      : requestedWorkspaceId;

  if (!selectedWorkspaceId) {
    throw workspaceRequiredError(registry);
  }

  const workspace = registry.workspaces.find((entry) => entry.workspaceId === selectedWorkspaceId);
  if (!workspace) {
    throw new AppError("WORKSPACE_NOT_FOUND", "Unknown workspaceId. Use one of the available safe workspace IDs.", {
      availableWorkspaceIds: registry.availableWorkspaceIds
    });
  }

  const root = resolveAllowedRoot(workspace.root, config.allowedRoots).rootRealPath;
  return {
    workspaceId: workspace.workspaceId,
    label: workspace.label,
    root,
    remote: workspace.remote,
    source: workspace.source,
    isDefault: registry.defaultWorkspaceId === workspace.workspaceId
  };
}

export function resolveWorkspaceRoot(workspaceId: string | undefined, config: AppConfig): string {
  return resolveWorkspace(workspaceId, config).root;
}

export function getWorkspaceDiagnostics(config: AppConfig): WorkspaceDiagnostics {
  const registry = getWorkspaceRegistry(config);
  return {
    registeredWorkspaceCount: registry.workspaces.length,
    availableWorkspaceIds: registry.availableWorkspaceIds,
    defaultWorkspaceId: registry.defaultWorkspaceId,
    defaultWorkspaceIdSource: registry.defaultWorkspaceIdSource,
    defaultWorkspaceIsExplicit: registry.defaultWorkspaceIdSource === "local-file",
    multipleWorkspacesRequireExplicitSelection: registry.multipleWorkspacesRequireExplicitSelection
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

function normalizeRemote(value: string): string {
  return value.trim().replace(/\.git$/iu, "").replace(/\/+$/u, "").toLowerCase();
}

async function gitOutputOptional(root: string, args: string[]): Promise<string | "unknown"> {
  if (!fs.existsSync(path.join(root, ".git"))) {
    return "unknown";
  }

  try {
    const result = await runGit(root, args, { timeoutMs: 30_000, maxBytes: 50_000 });
    if (result.exitCode !== 0 || result.timedOut) {
      return "unknown";
    }
    return result.stdout.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

export async function listWorkspaceCatalog(config: AppConfig): Promise<{
  workspaces: WorkspaceCatalogEntry[];
  diagnostics: WorkspaceDiagnostics;
}> {
  const registry = getWorkspaceRegistry(config);
  const workspaces = await Promise.all(
    registry.workspaces.map(async (workspace): Promise<WorkspaceCatalogEntry> => {
      const root = resolveAllowedRoot(workspace.root, config.allowedRoots).rootRealPath;
      const [branch, remote] = await Promise.all([
        gitOutputOptional(root, ["branch", "--show-current"]),
        gitOutputOptional(root, ["remote", "get-url", "origin"])
      ]);
      const repositoryName = remote === "unknown" ? undefined : parseRepositoryNameFromRemote(remote);
      const remoteMatchesExpected = workspace.remote
        ? remote === "unknown"
          ? "unknown"
          : normalizeRemote(remote) === normalizeRemote(workspace.remote)
        : "unknown";

      return {
        workspaceId: workspace.workspaceId,
        label: workspace.label,
        repositoryName,
        branch,
        isDefault: registry.defaultWorkspaceId === workspace.workspaceId,
        remoteMatchesExpected
      };
    })
  );

  return {
    workspaces,
    diagnostics: getWorkspaceDiagnostics(config)
  };
}
