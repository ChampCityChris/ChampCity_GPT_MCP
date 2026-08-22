import path from "node:path";

import { type AppConfig } from "./config.js";
import { isPathInside, resolveAllowedRoot } from "./security/pathPolicy.js";
import { AppError } from "./utils/errors.js";
import {
  getWorkspaceRegistry,
  resolveWorkspace,
  type ResolvedWorkspace
} from "./workspaces.js";
import { buildWorkspaceCapabilitySummary, type WorkspaceCapabilitySummary } from "./workspaceCapabilities.js";
import {
  detectGitRepository,
  isRelativePathInsideArtifactRoots,
  type WorkspaceAuthority,
  type WorkspaceOperationClass
} from "./workspaceWritePolicy.js";

function samePath(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === "win32" ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase() : resolvedLeft === resolvedRight;
}

function resolveWorkspaceByRoot(root: string, config: AppConfig): ResolvedWorkspace {
  const resolvedRoot = resolveAllowedRoot(root, config.allowedRoots).rootRealPath;
  const registry = getWorkspaceRegistry(config);
  const match = registry.workspaces.find((workspace) => {
    const workspaceRoot = resolveAllowedRoot(workspace.root, config.allowedRoots).rootRealPath;
    return samePath(workspaceRoot, resolvedRoot);
  });

  if (!match) {
    throw new AppError("WORKSPACE_NOT_FOUND", "Requested root does not match an exact configured workspace.", {
      availableWorkspaceIds: registry.availableWorkspaceIds
    });
  }

  return resolveWorkspace(match.workspaceId, config);
}

function releaseInspectionDenialReason(workspace: ResolvedWorkspace, capabilities: WorkspaceCapabilitySummary): WorkspaceAuthority["denialReason"] | undefined {
  if (workspace.writePolicy === "artifact_only") {
    return "WORKSPACE_POLICY_DENIED";
  }

  if (capabilities.releaseInspection.available) {
    return undefined;
  }

  return capabilities.gitInspection.reasonCode === "NOT_GIT_REPOSITORY"
    ? "GIT_CAPABILITY_UNAVAILABLE"
    : "WORKSPACE_POLICY_DENIED";
}

function authorityFor(workspace: ResolvedWorkspace, config: AppConfig, operation: WorkspaceOperationClass, relativePath?: string): WorkspaceAuthority {
  let allowed = true;
  let denialReason: WorkspaceAuthority["denialReason"];

  if (operation === "filesystem_read" || operation === "workspace_diagnostics" || operation === "artifact_persistence") {
    if (
      operation === "artifact_persistence" &&
      workspace.workspaceCapabilities?.artifactPersistence === "disabled"
    ) {
      allowed = false;
      denialReason = "WORKSPACE_POLICY_DENIED";
    } else if (
      operation === "artifact_persistence" &&
      workspace.writePolicy === "artifact_only" &&
      relativePath !== undefined &&
      !isRelativePathInsideArtifactRoots(relativePath, workspace.artifactWriteRoots)
    ) {
      allowed = false;
      denialReason = "TARGET_OUTSIDE_ARTIFACT_ROOTS";
    }
  } else if (operation === "patch_workflow") {
    if (workspace.workspaceCapabilities?.patchWorkflow === "disabled" || workspace.writePolicy === "artifact_only") {
      allowed = false;
      denialReason = "WORKSPACE_POLICY_DENIED";
    } else if (!workspace.gitDetected) {
      allowed = false;
      denialReason = "GIT_CAPABILITY_UNAVAILABLE";
    }
  } else if (operation === "git_inspection") {
    if (workspace.workspaceCapabilities?.gitOperations === "disabled") {
      allowed = false;
      denialReason = "WORKSPACE_POLICY_DENIED";
    } else if (!workspace.gitDetected) {
      allowed = false;
      denialReason = "GIT_CAPABILITY_UNAVAILABLE";
    }
  } else if (operation === "release_inspection") {
    denialReason = releaseInspectionDenialReason(workspace, buildWorkspaceCapabilitySummary(workspace, config));
    allowed = denialReason === undefined;
  } else if (
    (operation === "git_mutation" && workspace.workspaceCapabilities?.gitOperations === "disabled") ||
    (operation === "release_publication" && workspace.workspaceCapabilities?.releaseOperations === "disabled") ||
    workspace.writePolicy === "artifact_only"
  ) {
    allowed = false;
    denialReason = "WORKSPACE_POLICY_DENIED";
  } else if (!workspace.gitDetected) {
    allowed = false;
    denialReason = "GIT_CAPABILITY_UNAVAILABLE";
  }

  return {
    workspaceId: workspace.workspaceId,
    policy: workspace.writePolicy,
    gitDetected: workspace.gitDetected,
    artifactWriteRoots: workspace.artifactWriteRoots,
    artifactRootWarnings: workspace.artifactRootWarnings,
    legacyRequireGitRootDeprecated: workspace.legacyRequireGitRootDeprecated,
    operation,
    allowed,
    ...(denialReason ? { denialReason } : {})
  };
}

export function resolveWorkspaceAuthorityForRoot(
  root: string,
  config: AppConfig,
  operation: WorkspaceOperationClass,
  relativePath?: string
): WorkspaceAuthority {
  const workspace = resolveWorkspaceByRoot(root, config);
  return authorityFor(workspace, config, operation, relativePath);
}

export function resolveWorkspaceAuthority(
  workspaceId: string | undefined,
  config: AppConfig,
  operation: WorkspaceOperationClass,
  relativePath?: string
): WorkspaceAuthority {
  return authorityFor(resolveWorkspace(workspaceId, config), config, operation, relativePath);
}

export function assertWorkspaceAuthorityAllowed(authority: WorkspaceAuthority): void {
  if (authority.allowed) {
    return;
  }

  if (authority.denialReason === "WORKSPACE_POLICY_DENIED") {
    throw new AppError("WORKSPACE_POLICY_DENIED", "Selected workspace policy does not allow the requested capability.", {
      workspaceId: authority.workspaceId,
      writePolicy: authority.policy,
      operation: authority.operation
    });
  }

  if (authority.denialReason === "TARGET_OUTSIDE_ARTIFACT_ROOTS") {
    throw new AppError("TARGET_OUTSIDE_ARTIFACT_ROOTS", "Artifact target must stay inside a configured artifact write root.", {
      workspaceId: authority.workspaceId,
      writePolicy: authority.policy,
      artifactWriteRoots: authority.artifactWriteRoots
    });
  }

  throw new AppError("GIT_CAPABILITY_UNAVAILABLE", "The requested capability is unavailable because the selected workspace is not a Git repository.", {
    workspaceId: authority.workspaceId,
    writePolicy: authority.policy,
    operation: authority.operation
  });
}

export function assertPathInsideArtifactRoots(authority: WorkspaceAuthority, root: string, resolvedPath: string): void {
  if (authority.policy !== "artifact_only") {
    return;
  }

  const rootRealPath = resolveAllowedRoot(root, [root]).rootRealPath;
  const matchingRoot = authority.artifactWriteRoots.some((artifactRoot) => {
    if (artifactRoot === ".") {
      return true;
    }
    return isPathInside(resolvedPath, path.resolve(rootRealPath, artifactRoot));
  });

  if (!matchingRoot) {
    throw new AppError("TARGET_OUTSIDE_ARTIFACT_ROOTS", "Artifact target must stay inside a configured artifact write root.", {
      workspaceId: authority.workspaceId,
      writePolicy: authority.policy,
      artifactWriteRoots: authority.artifactWriteRoots
    });
  }
}

export function gitDetectedForRoot(root: string): boolean {
  return detectGitRepository(root);
}
