import fs from "node:fs";
import path from "node:path";

import { type AppConfig } from "../config.js";
import { scopeIncludes } from "../oauth.js";
import { runGit } from "../utils/git.js";
import { buildWorkspaceCapabilitySummary, legacyWorkspaceCapabilityConfig, type WorkspaceCapability } from "../workspaceCapabilities.js";
import { resolveWorkspace } from "../workspaces.js";
import { withAudit } from "./common.js";

export interface WorkspaceStatusRuntimeContext {
  callerScope?: string;
  writeToolsHiddenByLocalMode?: string[];
}

async function gitOutputOptional(root: string, args: string[]): Promise<string | "unknown"> {
  if (!fs.existsSync(path.join(root, ".git"))) {
    return "unknown";
  }
  try {
    const result = await runGit(root, args, { timeoutMs: 30_000, maxBytes: 100_000 });
    if (result.exitCode !== 0 || result.timedOut) {
      return "unknown";
    }
    return result.stdout.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

async function optionalGitSummary(root: string) {
  if (!fs.existsSync(path.join(root, ".git"))) {
    return {
      available: false,
      status: "not_git_repository",
      reasonCode: "NOT_GIT_REPOSITORY",
      reason: "No Git repository was detected for this workspace."
    };
  }

  const [branch, status] = await Promise.all([
    gitOutputOptional(root, ["branch", "--show-current"]),
    gitOutputOptional(root, ["status", "--short", "--untracked-files=all"])
  ]);
  const changedPaths = status === "unknown" ? [] : status.split(/\r?\n/u).filter((line) => line.trim() && !line.startsWith("!!"));
  return {
    available: true,
    status: "git_repository",
    reasonCode: "GIT_INSPECTION_AVAILABLE",
    branch,
    changedPathCount: changedPaths.length
  };
}

function boundedGitStatus(capability: WorkspaceCapability) {
  const status =
    capability.reasonCode === "GIT_OPERATIONS_DISABLED"
      ? "git_inspection_disabled"
      : capability.reasonCode === "NOT_GIT_REPOSITORY"
        ? "not_git_repository"
        : "git_inspection_unavailable";
  return {
    available: false,
    status,
    reasonCode: capability.reasonCode,
    reason: capability.reason
  };
}

function auditLogHealth(config: AppConfig) {
  const parent = path.dirname(config.auditLogPath);
  return {
    configured: Boolean(config.auditLogPath),
    parentDirectoryExists: fs.existsSync(parent),
    writable: fs.existsSync(parent)
  };
}

export async function getGeneralWorkspaceStatus(rawInput: { workspaceId?: string }, config: AppConfig, context: WorkspaceStatusRuntimeContext = {}) {
  return withAudit(config, { toolName: "get_general_workspace_status", workspaceId: rawInput.workspaceId }, async (updateAudit) => {
    const workspace = resolveWorkspace(rawInput.workspaceId, config);
    const filesWriteGranted = context.callerScope ? scopeIncludes(context.callerScope, "files.write") : "unknown";
    const capabilities = buildWorkspaceCapabilitySummary(workspace, config, {
      oauthFilesWriteGranted: filesWriteGranted
    });
    updateAudit({
      requestedPath: ".",
      resolvedPath: workspace.root,
      workspaceId: workspace.workspaceId
    });

    return {
      workspaceId: workspace.workspaceId,
      label: workspace.label,
      root: {
        available: capabilities.filesystemAccess.available,
        exposed: false,
        reasonCode: capabilities.filesystemAccess.reasonCode
      },
      filesystemAccess: capabilities.filesystemAccess,
      readCapability: capabilities.filesystemAccess,
      artifactPersistence: capabilities.artifactPersistence,
      patchCapability: capabilities.patchWorkflow,
      git: {
        inspection: capabilities.gitInspection,
        mutation: capabilities.gitMutation,
        status: capabilities.gitInspection.available
          ? await optionalGitSummary(workspace.root)
          : boundedGitStatus(capabilities.gitInspection)
      },
      release: {
        inspection: capabilities.releaseInspection,
        publication: capabilities.releasePublication
      },
      configuredArtifactRoots: workspace.artifactWriteRoots,
      writeMode: {
        mode: config.writeMode,
        source: config.writeModeSource,
        docsWritesAllowed: config.docsWritesAllowed,
        patchWritesAllowed: config.patchWritesAllowed,
        elevatedOperationsAllowed: config.elevatedOperationsAllowed,
        writeToolsHiddenByLocalMode: context.writeToolsHiddenByLocalMode ?? []
      },
      auditLog: auditLogHealth(config),
      warnings: [
        ...new Set([
          ...capabilities.filesystemAccess.warnings,
          ...capabilities.artifactPersistence.warnings,
          ...workspace.artifactRootWarnings
        ])
      ],
      legacyCompatibility: legacyWorkspaceCapabilityConfig(workspace)
    };
  });
}

export async function getWorkspaceSafetyStatus(rawInput: { workspaceId?: string; deprecatedAlias?: string }, config: AppConfig, context: WorkspaceStatusRuntimeContext = {}) {
  const status = await getGeneralWorkspaceStatus(rawInput, config, context);
  return {
    ...status,
    safetyStatus: status.filesystemAccess.available ? "available" : "unavailable",
    checks: {
      workspaceRegistration: true,
      allowedRootContainment: status.filesystemAccess.detectedPrerequisites.allowedRootContained,
      rootExistenceAndType: status.filesystemAccess.detectedPrerequisites.rootDirectoryExists,
      pathPolicyReady: status.filesystemAccess.detectedPrerequisites.pathPolicyEnforceable,
      filePolicyReady: true,
      writeModeReady: status.writeMode.docsWritesAllowed || status.writeMode.patchWritesAllowed || status.writeMode.elevatedOperationsAllowed,
      oauthFilesWriteGranted: status.artifactPersistence.detectedPrerequisites.filesWriteScopeGranted,
      artifactRootsConfigured: status.configuredArtifactRoots.length > 0 || status.legacyCompatibility.legacyWritePolicy === "git_required",
      auditTraceStorageConfigured: status.auditLog.configured,
      filesystemReadCapability: status.filesystemAccess.available,
      artifactPersistenceCapability: status.artifactPersistence.available,
      patchCapability: status.patchCapability.available,
      gitCapabilitiesAreOptional: true
    },
    ...(rawInput.deprecatedAlias
      ? {
          deprecation: {
            alias: rawInput.deprecatedAlias,
            replacementAction: "workspace_safety_status",
            message: "public_safety_status is a deprecated alias for workspace_safety_status and no longer reports Git change-set readiness."
          }
        }
      : {})
  };
}
