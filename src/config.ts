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

export interface AppConfig {
  repoRoot: string;
  allowedRoots: string[];
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

interface LocalConfigFile {
  allowedRoots?: string[];
  requireGitRoot?: boolean;
  auditLog?: string;
  allowedCommands?: string[];
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd(), options: LoadConfigOptions = {}): AppConfig {
  const repoRoot = path.resolve(cwd);
  const localConfig = loadLocalConfig(repoRoot, env);

  const rawAllowedRoots = splitSemicolonList(env.CHAMPCITY_GPT_ALLOWED_ROOTS);
  const allowedRootSource =
    rawAllowedRoots.length > 0 ? rawAllowedRoots : localConfig.allowedRoots && localConfig.allowedRoots.length > 0 ? localConfig.allowedRoots : [repoRoot];
  const allowedRoots = allowedRootSource.map((root) =>
    assertAbsolutePath(root, rawAllowedRoots.length > 0 ? "CHAMPCITY_GPT_ALLOWED_ROOTS entry" : "config allowedRoots entry")
  );

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
