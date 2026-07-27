import path from "node:path";

import { type AppConfig } from "./config.js";
import { isPathInside, resolveAllowedRoot } from "./security/pathPolicy.js";
import { AppError } from "./utils/errors.js";
import {
  getWorkspaceRegistry,
  resolveWorkspace,
  type ResolvedWorkspace
} from "./workspaces.js";
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

function authorityFor(workspace: ResolvedWorkspace, operation: WorkspaceOperationClass, relativePath?: string): WorkspaceAuthority {
  let allowed = true;
  let denialReason: WorkspaceAuthority["denialReason"];

  if (operation === "artifact_persistence") {
    if (workspace.writePolicy === "git_required" && !workspace.gitDetected) {
      allowed = false;
      denialReason = "GIT_REQUIRED";
    }

    if (
      workspace.writePolicy === "artifact_only" &&
      relativePath !== undefined &&
      !isRelativePathInsideArtifactRoots(relativePath, workspace.artifactWriteRoots)
    ) {
      allowed = false;
      denialReason = "TARGET_OUTSIDE_ARTIFACT_ROOTS";
    }
  } else if (workspace.writePolicy === "artifact_only") {
    allowed = false;
    denialReason = "WORKSPACE_POLICY_DENIED";
  } else if (!workspace.gitDetected) {
    allowed = false;
    denialReason = "GIT_REQUIRED";
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
  return authorityFor(workspace, operation, relativePath);
}

export function resolveWorkspaceAuthority(
  workspaceId: string | undefined,
  config: AppConfig,
  operation: WorkspaceOperationClass,
  relativePath?: string
): WorkspaceAuthority {
  return authorityFor(resolveWorkspace(workspaceId, config), operation, relativePath);
}

export function assertWorkspaceAuthorityAllowed(authority: WorkspaceAuthority): void {
  if (authority.allowed) {
    return;
  }

  if (authority.denialReason === "WORKSPACE_POLICY_DENIED") {
    throw new AppError("WORKSPACE_POLICY_DENIED", "Selected workspace policy does not allow this Git-backed operation.", {
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

  throw new AppError("GIT_REQUIRED", "Selected workspace must be a confirmed Git repository for this operation.", {
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
