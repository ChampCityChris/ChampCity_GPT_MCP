import fs from "node:fs";

import { type AppConfig } from "./config.js";
import { type ResolvedWorkspace } from "./workspaces.js";

export const WORKSPACE_CAPABILITY_NAMES = [
  "filesystemAccess",
  "artifactPersistence",
  "patchWorkflow",
  "gitInspection",
  "gitMutation",
  "releaseInspection",
  "releasePublication"
] as const;

export type WorkspaceCapabilityName = (typeof WORKSPACE_CAPABILITY_NAMES)[number];
export type WorkspaceCapabilityConfigSource = "configured" | "legacy_write_policy" | "derived" | "runtime";

export interface WorkspaceCapability {
  available: boolean;
  reasonCode: string;
  reason: string;
  configurationSource: WorkspaceCapabilityConfigSource;
  detectedPrerequisites: Record<string, boolean | string | number>;
  warnings: string[];
}

export type WorkspaceCapabilitySummary = Record<WorkspaceCapabilityName, WorkspaceCapability>;

export interface WorkspaceCapabilityConfig {
  artifactPersistence?: "enabled" | "disabled";
  patchWorkflow?: "enabled" | "disabled";
  gitOperations?: "auto" | "disabled";
  releaseOperations?: "auto" | "disabled";
}

export interface WorkspaceCapabilityOptions {
  oauthFilesWriteGranted?: boolean | "unknown";
}

function reason(available: boolean, reasonCode: string, text: string, configurationSource: WorkspaceCapabilityConfigSource, detectedPrerequisites: Record<string, boolean | string | number>, warnings: string[] = []): WorkspaceCapability {
  return {
    available,
    reasonCode,
    reason: text,
    configurationSource,
    detectedPrerequisites,
    warnings
  };
}

function rootDirectoryAvailable(root: string): boolean {
  try {
    return fs.statSync(root).isDirectory();
  } catch {
    return false;
  }
}

function legacyWarnings(workspace: ResolvedWorkspace): string[] {
  const warnings = [...workspace.artifactRootWarnings];
  if (workspace.writePolicy === "git_required") {
    warnings.push("Legacy writePolicy git_required is accepted for compatibility; Git is not required for reads, searches, artifact persistence, or general diagnostics.");
  }
  if (workspace.writePolicy === "artifact_only") {
    warnings.push("Legacy writePolicy artifact_only is accepted for compatibility and continues to disable Git mutation and limit configured artifact roots.");
  }
  if (!workspace.gitDetected) {
    warnings.push("Git is not detected; this is informational unless a Git or release action is requested.");
  }
  return warnings;
}

function writeScopeGranted(value: boolean | "unknown" | undefined): boolean {
  return value === true;
}

export function buildWorkspaceCapabilitySummary(
  workspace: ResolvedWorkspace,
  config: AppConfig,
  options: WorkspaceCapabilityOptions = {}
): WorkspaceCapabilitySummary {
  const rootExists = rootDirectoryAvailable(workspace.root);
  const commonPrerequisites = {
    registered: true,
    allowedRootContained: true,
    rootDirectoryExists: rootExists,
    pathPolicyEnforceable: true
  };
  const configSource: WorkspaceCapabilityConfigSource = workspace.source === "derived" ? "derived" : "configured";
  const warnings = legacyWarnings(workspace);
  const filesystemAccess = rootExists
    ? reason(true, "FILESYSTEM_ACCESS_AVAILABLE", "Workspace root is registered, allowed, and available for filesystem operations.", configSource, commonPrerequisites, warnings)
    : reason(false, "WORKSPACE_ROOT_UNAVAILABLE", "Workspace root is registered but is not an available directory.", configSource, commonPrerequisites, warnings);

  const oauthWrite = options.oauthFilesWriteGranted ?? "unknown";
  const artifactPrerequisites = {
    ...commonPrerequisites,
    filesWriteScopeGranted: oauthWrite,
    docsWriteModeEnabled: config.docsWritesAllowed,
    artifactRootPolicyConfigured: true
  };
  const artifactPersistence =
    workspace.workspaceCapabilities?.artifactPersistence === "disabled"
      ? reason(false, "ARTIFACT_PERSISTENCE_DISABLED", "Artifact persistence is disabled by workspace capability configuration.", configSource, artifactPrerequisites, workspace.artifactRootWarnings)
      : filesystemAccess.available && config.docsWritesAllowed && writeScopeGranted(oauthWrite)
      ? reason(true, "ARTIFACT_PERSISTENCE_AVAILABLE", "Artifact persistence is available through OAuth files.write, local write mode, allowed-root, file-policy, artifact-root, overwrite, and evidence controls.", configSource, artifactPrerequisites, workspace.artifactRootWarnings)
      : reason(false, "ARTIFACT_PERSISTENCE_PREREQUISITE_UNMET", "Artifact persistence needs filesystem access plus OAuth files.write and docs, patch, or elevated local write mode for this call.", configSource, artifactPrerequisites, workspace.artifactRootWarnings);

  const patchPrerequisites = {
    ...commonPrerequisites,
    filesWriteScopeGranted: oauthWrite,
    patchWriteModeEnabled: config.patchWritesAllowed,
    gitDetected: workspace.gitDetected,
    legacyArtifactOnly: workspace.writePolicy === "artifact_only"
  };
  const patchWorkflow =
    workspace.workspaceCapabilities?.patchWorkflow === "disabled"
      ? reason(false, "PATCH_WORKFLOW_DISABLED", "Patch workflow is disabled by workspace capability configuration.", configSource, patchPrerequisites)
      : filesystemAccess.available && config.patchWritesAllowed && writeScopeGranted(oauthWrite) && workspace.gitDetected && workspace.writePolicy !== "artifact_only"
      ? reason(true, "PATCH_WORKFLOW_AVAILABLE", "Patch workflow is available through explicit patch mode, write authorization, and Git-backed source-code safeguards.", configSource, patchPrerequisites)
      : reason(false, "PATCH_WORKFLOW_UNAVAILABLE", "Patch workflow is unavailable unless patch/elevated write mode, OAuth files.write, Git detection, and patch policy all pass.", configSource, patchPrerequisites);

  const gitPrerequisites = {
    ...commonPrerequisites,
    gitDetected: workspace.gitDetected
  };
  const gitInspection =
    workspace.workspaceCapabilities?.gitOperations === "disabled"
      ? reason(false, "GIT_OPERATIONS_DISABLED", "Git operations are disabled by workspace capability configuration.", configSource, gitPrerequisites)
      : filesystemAccess.available && workspace.gitDetected
      ? reason(true, "GIT_INSPECTION_AVAILABLE", "Git inspection is available for this Git-backed workspace.", configSource, gitPrerequisites)
      : reason(false, "NOT_GIT_REPOSITORY", "No Git repository was detected for this workspace. Reads, searches, artifacts, and general diagnostics are unaffected.", configSource, gitPrerequisites);

  const gitMutationPrerequisites = {
    ...gitPrerequisites,
    filesWriteScopeGranted: oauthWrite,
    elevatedWriteModeEnabled: config.elevatedOperationsAllowed,
    legacyArtifactOnly: workspace.writePolicy === "artifact_only"
  };
  const gitMutation =
    workspace.workspaceCapabilities?.gitOperations === "disabled"
      ? reason(false, "GIT_OPERATIONS_DISABLED", "Git mutation is disabled by workspace capability configuration.", configSource, gitMutationPrerequisites)
      : !gitInspection.available
      ? reason(false, "GIT_CAPABILITY_UNAVAILABLE", "Git mutation is unavailable because Git inspection is unavailable for this workspace.", configSource, gitMutationPrerequisites)
      : gitInspection.available && config.elevatedOperationsAllowed && writeScopeGranted(oauthWrite) && workspace.writePolicy !== "artifact_only"
      ? reason(true, "GIT_MUTATION_AVAILABLE", "Git mutation is available through Git detection, OAuth files.write, elevated write mode, and mutation safeguards.", configSource, gitMutationPrerequisites)
      : reason(false, "GIT_MUTATION_UNAVAILABLE", "Git mutation is unavailable unless Git is detected, artifact-only restrictions are absent, OAuth files.write is granted, elevated write mode is enabled, and branch safeguards pass.", configSource, gitMutationPrerequisites);

  const releasePrerequisites = {
    ...gitPrerequisites,
    releaseCapableWorkspace: workspace.workspaceId === "champcity_gpt" || Boolean(workspace.remote)
  };
  const releaseInspection =
    workspace.workspaceCapabilities?.releaseOperations === "disabled"
      ? reason(false, "RELEASE_OPERATIONS_DISABLED", "Release operations are disabled by workspace capability configuration.", configSource, releasePrerequisites)
      : gitInspection.available && releasePrerequisites.releaseCapableWorkspace
      ? reason(true, "RELEASE_INSPECTION_AVAILABLE", "Release inspection is available for an explicitly release-capable Git workspace.", configSource, releasePrerequisites)
      : reason(false, "RELEASE_INSPECTION_UNAVAILABLE", "Release inspection is local to release-capable Git workspaces and is not part of general workspace validity.", configSource, releasePrerequisites);

  const releasePublication =
    workspace.workspaceCapabilities?.releaseOperations === "disabled"
      ? reason(false, "RELEASE_OPERATIONS_DISABLED", "Release publication checks are disabled by workspace capability configuration.", configSource, { ...releasePrerequisites, gitMutationAvailable: gitMutation.available })
      : releaseInspection.available && gitMutation.available
      ? reason(true, "RELEASE_PUBLICATION_AVAILABLE", "Release publication checks are available only when release and Git mutation prerequisites pass.", configSource, { ...releasePrerequisites, gitMutationAvailable: true })
      : reason(false, "RELEASE_PUBLICATION_UNAVAILABLE", "Release publication is unavailable unless release inspection and Git mutation prerequisites pass.", configSource, { ...releasePrerequisites, gitMutationAvailable: gitMutation.available });

  return {
    filesystemAccess,
    artifactPersistence,
    patchWorkflow,
    gitInspection,
    gitMutation,
    releaseInspection,
    releasePublication
  };
}

export function legacyWorkspaceCapabilityConfig(workspace: ResolvedWorkspace) {
  const configured = workspace.workspaceCapabilities ?? {};
  return {
    legacyWritePolicy: workspace.writePolicy,
    workspaceCapabilities: {
      artifactPersistence: configured.artifactPersistence ?? "enabled",
      patchWorkflow: configured.patchWorkflow ?? (workspace.writePolicy === "artifact_only" ? "disabled" : "enabled"),
      gitOperations: configured.gitOperations ?? (workspace.writePolicy === "artifact_only" ? "disabled" : "auto"),
      releaseOperations: configured.releaseOperations ?? "auto"
    },
    migration: {
      configurationRewrittenAutomatically: false,
      compatibilityBehavior: workspace.writePolicy === "artifact_only"
        ? "artifact_only preserves configured artifact roots and disables Git mutation; it does not disable reads or artifact persistence."
        : "git_required remains accepted as a legacy profile name; it does not require Git for reads, searches, artifact persistence, or general diagnostics."
    }
  };
}
