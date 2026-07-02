import fs from "node:fs";
import path from "node:path";

import { AppError } from "./utils/errors.js";
import {
  docsWritesAllowed,
  elevatedOperationsAllowed,
  getWriteApprovalTokenConfig,
  getWriteMode,
  patchWritesAllowed,
  type WriteApprovalTokenConfig,
  type WriteMode,
  type WriteModeSource
} from "./writeAccess.js";
import { getRuntimeConfigDir, getRuntimeLogDir } from "./runtimePaths.js";
import {
  assertConfiguredWorkspaceId,
  deriveWorkspaceId,
  type ConfiguredWorkspace,
  type DefaultWorkspaceIdSource
} from "./workspaces.js";

export interface AppConfig {
  repoRoot: string;
  allowedRoots: string[];
  defaultWorkspaceRoot?: string;
  defaultWorkspaceRootSource?: DefaultWorkspaceRootSource;
  workspaces?: ConfiguredWorkspace[];
  defaultWorkspaceId?: string;
  defaultWorkspaceIdSource?: DefaultWorkspaceIdSource;
  auditLogPath: string;
  requireGitRoot: boolean;
  allowedCommands: string[];
  writeToolsEnabled: boolean;
  writeToolsEnabledSource: WriteModeSource;
  writeMode: WriteMode;
  writeModeSource: WriteModeSource;
  docsWritesAllowed: boolean;
  patchWritesAllowed: boolean;
  elevatedOperationsAllowed: boolean;
  writeApprovalToken: WriteApprovalTokenConfig;
}

export const DEFAULT_ALLOWED_COMMANDS = [
  "npm test",
  "npm run lint",
  "npm run typecheck",
  "npm run build",
  "git status",
  "git diff"
];

export type DefaultWorkspaceRootSource = "env" | "local-file" | "repoRoot";

interface LocalConfigFile {
  allowedRoots?: string[];
  workspaces?: LocalWorkspaceConfig[];
  defaultWorkspaceId?: string;
  requireGitRoot?: boolean;
  auditLog?: string;
  allowedCommands?: string[];
}

interface LocalWorkspaceConfig {
  workspaceId: string;
  label?: string;
  root: string;
  remote?: string;
}

export interface LoadConfigOptions {
  defaultWriteMode?: WriteMode;
  defaultWriteToolsEnabled?: boolean;
}

export function splitSemicolonList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  throw new AppError("INVALID_INPUT", `Expected boolean value but received "${value}".`);
}

function assertAbsolutePath(value: string, label: string): string {
  if (!path.isAbsolute(value)) {
    throw new AppError("INVALID_INPUT", `${label} must be an absolute path.`);
  }

  return path.resolve(value);
}

function assertStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new AppError("INVALID_INPUT", `${label} must be an array of strings.`);
  }

  return value;
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError("INVALID_INPUT", `${label} must be a non-empty string.`);
  }

  return value;
}

function assertLocalWorkspaces(value: unknown, label: string): LocalWorkspaceConfig[] {
  if (!Array.isArray(value)) {
    throw new AppError("INVALID_INPUT", `${label} must be an array.`);
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new AppError("INVALID_INPUT", `${label}[${index}] must be an object.`);
    }

    const workspace = entry as Record<string, unknown>;
    const parsed: LocalWorkspaceConfig = {
      workspaceId: assertConfiguredWorkspaceId(assertNonEmptyString(workspace.workspaceId, `${label}[${index}].workspaceId`), `${label}[${index}].workspaceId`),
      root: assertNonEmptyString(workspace.root, `${label}[${index}].root`)
    };

    if (workspace.label !== undefined) {
      parsed.label = assertNonEmptyString(workspace.label, `${label}[${index}].label`);
    }

    if (workspace.remote !== undefined) {
      parsed.remote = assertNonEmptyString(workspace.remote, `${label}[${index}].remote`);
    }

    return parsed;
  });
}

function loadLocalConfig(repoRoot: string, env: NodeJS.ProcessEnv): LocalConfigFile {
  const configPath = path.join(getRuntimeConfigDir(repoRoot, env), "allowed-roots.local.json");
  if (!fs.existsSync(configPath)) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AppError("INVALID_INPUT", `Invalid JSON in ${configPath}: ${detail}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError("INVALID_INPUT", `${configPath} must contain a JSON object.`);
  }

  const rawConfig = parsed as Record<string, unknown>;
  const localConfig: LocalConfigFile = {};

  if (rawConfig.allowedRoots !== undefined) {
    localConfig.allowedRoots = assertStringArray(rawConfig.allowedRoots, "config/allowed-roots.local.json allowedRoots");
  }

  if (rawConfig.workspaces !== undefined) {
    localConfig.workspaces = assertLocalWorkspaces(rawConfig.workspaces, "config/allowed-roots.local.json workspaces");
  }

  if (rawConfig.defaultWorkspaceId !== undefined) {
    localConfig.defaultWorkspaceId = assertConfiguredWorkspaceId(
      assertNonEmptyString(rawConfig.defaultWorkspaceId, "config/allowed-roots.local.json defaultWorkspaceId"),
      "config/allowed-roots.local.json defaultWorkspaceId"
    );
  }

  if (rawConfig.requireGitRoot !== undefined) {
    if (typeof rawConfig.requireGitRoot !== "boolean") {
      throw new AppError("INVALID_INPUT", "config/allowed-roots.local.json requireGitRoot must be a boolean.");
    }
    localConfig.requireGitRoot = rawConfig.requireGitRoot;
  }

  if (rawConfig.auditLog !== undefined) {
    if (typeof rawConfig.auditLog !== "string") {
      throw new AppError("INVALID_INPUT", "config/allowed-roots.local.json auditLog must be a string.");
    }
    localConfig.auditLog = rawConfig.auditLog;
  }

  if (rawConfig.allowedCommands !== undefined) {
    localConfig.allowedCommands = assertStringArray(rawConfig.allowedCommands, "config/allowed-roots.local.json allowedCommands");
  }

  return localConfig;
}

function isPackagedApplicationRoot(value: string): boolean {
  return /(?:^|[\\/])app\.asar(?:$|[\\/])/iu.test(path.resolve(value));
}

function normalizeConfiguredWorkspaces(workspaces: LocalWorkspaceConfig[] | undefined): ConfiguredWorkspace[] {
  if (!workspaces || workspaces.length === 0) {
    return [];
  }

  const seenIds = new Set<string>();
  const seenRoots = new Set<string>();
  return workspaces.map((workspace) => {
    const workspaceId = assertConfiguredWorkspaceId(workspace.workspaceId);
    if (seenIds.has(workspaceId)) {
      throw new AppError("INVALID_INPUT", "Configured workspace IDs must be unique.", {
        workspaceId
      });
    }
    seenIds.add(workspaceId);

    const root = assertAbsolutePath(workspace.root, `workspace ${workspaceId} root`);
    const comparisonRoot = process.platform === "win32" ? root.toLowerCase() : root;
    if (seenRoots.has(comparisonRoot)) {
      throw new AppError("INVALID_INPUT", "Configured workspace roots must be unique.", {
        workspaceId
      });
    }
    seenRoots.add(comparisonRoot);

    return {
      workspaceId,
      label: workspace.label ?? path.basename(root) ?? workspaceId,
      root,
      ...(workspace.remote ? { remote: workspace.remote } : {}),
      source: "configured" as const
    };
  });
}

function isPathInsideOrEqual(childPath: string, parentPath: string): boolean {
  const child = process.platform === "win32" ? path.resolve(childPath).toLowerCase() : path.resolve(childPath);
  const parent = process.platform === "win32" ? path.resolve(parentPath).toLowerCase() : path.resolve(parentPath);
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertWorkspaceRootsAllowed(workspaces: readonly ConfiguredWorkspace[], allowedRoots: readonly string[]): void {
  for (const workspace of workspaces) {
    if (!allowedRoots.some((allowedRoot) => isPathInsideOrEqual(workspace.root, allowedRoot))) {
      throw new AppError("INVALID_INPUT", "Configured workspace root must be inside an allowed root.", {
        workspaceId: workspace.workspaceId
      });
    }
  }
}

function uniqueRoots(roots: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const root of roots) {
    const resolved = path.resolve(root);
    const comparison = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (seen.has(comparison)) {
      continue;
    }
    seen.add(comparison);
    unique.push(resolved);
  }
  return unique;
}

function derivedDefaultWorkspaceIdForRoot(root: string): string {
  return deriveWorkspaceId(path.basename(root), "workspace_1");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd(), options: LoadConfigOptions = {}): AppConfig {
  const repoRoot = path.resolve(cwd);
  const localConfig = loadLocalConfig(repoRoot, env);

  const rawAllowedRoots = splitSemicolonList(env.CHAMPCITY_GPT_ALLOWED_ROOTS);
  const configuredWorkspaces = rawAllowedRoots.length > 0 ? [] : normalizeConfiguredWorkspaces(localConfig.workspaces);
  const localAllowedRoots = localConfig.allowedRoots && localConfig.allowedRoots.length > 0 ? localConfig.allowedRoots : [];
  const defaultWorkspaceRootSource: DefaultWorkspaceRootSource =
    rawAllowedRoots.length > 0 ? "env" : localAllowedRoots.length > 0 || configuredWorkspaces.length > 0 ? "local-file" : "repoRoot";
  if (defaultWorkspaceRootSource === "repoRoot" && isPackagedApplicationRoot(repoRoot)) {
    throw new AppError(
      "INVALID_INPUT",
      "Packaged runtime workspace configuration is missing. Configure at least one allowed workspace root before starting the MCP server."
    );
  }
  const configuredWorkspaceRoots = configuredWorkspaces.map((workspace) => workspace.root);
  const allowedRootSource =
    defaultWorkspaceRootSource === "env"
      ? rawAllowedRoots
      : defaultWorkspaceRootSource === "local-file"
        ? localAllowedRoots.length > 0
          ? localAllowedRoots
          : configuredWorkspaceRoots
        : [repoRoot];
  const resolvedAllowedRootSource = allowedRootSource.map((root) =>
    assertAbsolutePath(root, rawAllowedRoots.length > 0 ? "CHAMPCITY_GPT_ALLOWED_ROOTS entry" : "config allowedRoots entry")
  );
  assertWorkspaceRootsAllowed(configuredWorkspaces, resolvedAllowedRootSource);
  const allowedRoots = uniqueRoots([...resolvedAllowedRootSource, ...configuredWorkspaceRoots]);
  const defaultWorkspaceId =
    localConfig.defaultWorkspaceId ??
    (configuredWorkspaces.length === 1 ? configuredWorkspaces[0].workspaceId : undefined);
  const defaultWorkspaceIdSource: DefaultWorkspaceIdSource | undefined =
    localConfig.defaultWorkspaceId ? "local-file" : configuredWorkspaces.length === 1 ? "single-workspace" : undefined;
  const defaultWorkspaceRoot =
    configuredWorkspaces.find((workspace) => workspace.workspaceId === defaultWorkspaceId)?.root ??
    (allowedRoots.length === 1 ? allowedRoots[0] : undefined) ??
    (allowedRoots.length > 0 && rawAllowedRoots.length === 0 && configuredWorkspaces.length === 0 ? allowedRoots[0] : undefined);

  if (localConfig.defaultWorkspaceId) {
    const availableWorkspaceIds =
      configuredWorkspaces.length > 0
        ? configuredWorkspaces.map((workspace) => workspace.workspaceId)
        : allowedRoots.map(derivedDefaultWorkspaceIdForRoot);
    if (!availableWorkspaceIds.includes(localConfig.defaultWorkspaceId)) {
      throw new AppError("INVALID_INPUT", "Configured defaultWorkspaceId does not match a registered workspace.", {
        defaultWorkspaceId: localConfig.defaultWorkspaceId,
        availableWorkspaceIds
      });
    }
  }

  const auditLogPath = assertAbsolutePath(
    env.CHAMPCITY_GPT_AUDIT_LOG ?? localConfig.auditLog ?? path.join(getRuntimeLogDir(repoRoot, env), "audit.log"),
    env.CHAMPCITY_GPT_AUDIT_LOG ? "CHAMPCITY_GPT_AUDIT_LOG" : "config auditLog"
  );

  const requireGitRoot = parseBoolean(env.CHAMPCITY_GPT_REQUIRE_GIT_ROOT, localConfig.requireGitRoot ?? true);
  const allowedCommands = splitSemicolonList(env.CHAMPCITY_GPT_ALLOWED_COMMANDS);
  const defaultWriteMode = options.defaultWriteMode ?? (options.defaultWriteToolsEnabled === true ? "docs" : "off");
  const writeMode = getWriteMode(repoRoot, env, defaultWriteMode);

  return {
    repoRoot,
    allowedRoots,
    defaultWorkspaceRoot,
    defaultWorkspaceRootSource,
    ...(configuredWorkspaces.length > 0 ? { workspaces: configuredWorkspaces } : {}),
    ...(defaultWorkspaceId ? { defaultWorkspaceId } : {}),
    ...(defaultWorkspaceIdSource ? { defaultWorkspaceIdSource } : {}),
    auditLogPath,
    requireGitRoot,
    allowedCommands: allowedCommands.length > 0 ? allowedCommands : localConfig.allowedCommands && localConfig.allowedCommands.length > 0 ? localConfig.allowedCommands : DEFAULT_ALLOWED_COMMANDS,
    writeToolsEnabled: writeMode.writeMode !== "off",
    writeToolsEnabledSource: writeMode.source,
    writeMode: writeMode.writeMode,
    writeModeSource: writeMode.source,
    docsWritesAllowed: docsWritesAllowed(writeMode.writeMode),
    patchWritesAllowed: patchWritesAllowed(writeMode.writeMode),
    elevatedOperationsAllowed: elevatedOperationsAllowed(writeMode.writeMode),
    writeApprovalToken: getWriteApprovalTokenConfig(repoRoot, env)
  };
}

export function ensureConfiguredRootsExist(config: AppConfig): void {
  for (const root of config.allowedRoots) {
    if (!fs.existsSync(root)) {
      throw new AppError("INVALID_INPUT", `Configured allowed root does not exist: ${root}`);
    }
  }
}
