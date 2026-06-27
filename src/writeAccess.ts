import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getRuntimeConfigFilePath } from "./runtimePaths.js";
import { AppError } from "./utils/errors.js";

export type WriteApprovalTokenSource = "env" | "local-file" | "none";
export type WriteMode = "off" | "docs" | "patch" | "elevated";
export type WriteModeSource = "env" | "local-file" | "legacy-env" | "default";

const WRITE_MODES = new Set<WriteMode>(["off", "docs", "patch", "elevated"]);

export interface WriteAccessLocalConfig {
  writeMode?: WriteMode;
  legacyApprovalTokenHash?: string;
  legacyApprovalTokenCreatedAt?: string;
  legacyApprovalTokenUpdatedAt?: string;
  elevatedApprovalRequired?: boolean;
  createdAt?: string;
  updatedAt?: string;
  httpWriteToolsEnabled?: boolean;
  writeApprovalTokenHash?: string;
  writeApprovalTokenCreatedAt?: string;
  writeApprovalTokenUpdatedAt?: string;
}

export interface WriteApprovalTokenConfig {
  source: WriteApprovalTokenSource;
  token?: string;
  tokenHash?: string;
}

export interface WriteAccessStatus {
  writeMode: WriteMode;
  writeModeSource: WriteModeSource;
  docsWritesAllowed: boolean;
  patchWritesAllowed: boolean;
  elevatedOperationsAllowed: boolean;
  elevatedApprovalRequired: boolean;
  legacyApprovalTokenConfigured: boolean;
  legacyApprovalTokenSource: WriteApprovalTokenSource;
  legacyApprovalTokenCreatedAt?: string;
  legacyApprovalTokenUpdatedAt?: string;
}

export const WRITE_ACCESS_FILE = "write-access.local.json";

function nowIso(): string {
  return new Date().toISOString();
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

function parseWriteMode(value: unknown, label: string): WriteMode {
  if (typeof value !== "string" || !WRITE_MODES.has(value as WriteMode)) {
    throw new AppError("INVALID_INPUT", `${label} must be one of off, docs, patch, or elevated.`);
  }

  return value as WriteMode;
}

function writeJsonFile(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function getWriteAccessConfigPath(repoRoot: string): string {
  return getRuntimeConfigFilePath(repoRoot, WRITE_ACCESS_FILE);
}

export function readWriteAccessLocalConfig(repoRoot: string): WriteAccessLocalConfig {
  const configPath = getWriteAccessConfigPath(repoRoot);
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
  const config: WriteAccessLocalConfig = {};

  if (rawConfig.writeMode !== undefined) {
    config.writeMode = parseWriteMode(rawConfig.writeMode, `${WRITE_ACCESS_FILE} writeMode`);
  }

  if (rawConfig.httpWriteToolsEnabled !== undefined) {
    if (typeof rawConfig.httpWriteToolsEnabled !== "boolean") {
      throw new AppError("INVALID_INPUT", `${WRITE_ACCESS_FILE} httpWriteToolsEnabled must be a boolean.`);
    }
    config.httpWriteToolsEnabled = rawConfig.httpWriteToolsEnabled;
  }

  if (rawConfig.elevatedApprovalRequired !== undefined) {
    if (typeof rawConfig.elevatedApprovalRequired !== "boolean") {
      throw new AppError("INVALID_INPUT", `${WRITE_ACCESS_FILE} elevatedApprovalRequired must be a boolean.`);
    }
    config.elevatedApprovalRequired = rawConfig.elevatedApprovalRequired;
  }

  for (const key of [
    "legacyApprovalTokenHash",
    "legacyApprovalTokenCreatedAt",
    "legacyApprovalTokenUpdatedAt",
    "createdAt",
    "updatedAt",
    "writeApprovalTokenHash",
    "writeApprovalTokenCreatedAt",
    "writeApprovalTokenUpdatedAt"
  ] as const) {
    if (rawConfig[key] !== undefined) {
      if (typeof rawConfig[key] !== "string" || rawConfig[key].trim() === "") {
        throw new AppError("INVALID_INPUT", `${WRITE_ACCESS_FILE} ${key} must be a non-empty string.`);
      }
      config[key] = rawConfig[key];
    }
  }

  return config;
}

export function migrateWriteAccessLocalConfig(config: WriteAccessLocalConfig): WriteAccessLocalConfig {
  const timestamp = nowIso();
  const next: WriteAccessLocalConfig = { ...config };
  let changed = false;

  if (!next.writeMode && next.httpWriteToolsEnabled !== undefined) {
    next.writeMode = next.httpWriteToolsEnabled ? "docs" : "off";
    changed = true;
  }

  if (!next.legacyApprovalTokenHash && next.writeApprovalTokenHash) {
    next.legacyApprovalTokenHash = next.writeApprovalTokenHash;
    next.legacyApprovalTokenCreatedAt = next.writeApprovalTokenCreatedAt;
    next.legacyApprovalTokenUpdatedAt = next.writeApprovalTokenUpdatedAt;
    changed = true;
  }

  if (next.elevatedApprovalRequired === undefined) {
    next.elevatedApprovalRequired = true;
    changed = true;
  }

  if (changed) {
    next.createdAt = next.createdAt ?? timestamp;
    next.updatedAt = timestamp;
  }

  return next;
}

export function writeWriteAccessLocalConfig(repoRoot: string, config: WriteAccessLocalConfig): void {
  const { httpWriteToolsEnabled, writeApprovalTokenHash, writeApprovalTokenCreatedAt, writeApprovalTokenUpdatedAt, ...persisted } =
    migrateWriteAccessLocalConfig(config);
  void httpWriteToolsEnabled;
  void writeApprovalTokenHash;
  void writeApprovalTokenCreatedAt;
  void writeApprovalTokenUpdatedAt;
  writeJsonFile(getWriteAccessConfigPath(repoRoot), persisted);
}

function getLocalWriteAccessConfig(repoRoot: string): WriteAccessLocalConfig {
  const config = readWriteAccessLocalConfig(repoRoot);
  const migrated = migrateWriteAccessLocalConfig(config);
  if (JSON.stringify(config) !== JSON.stringify(migrated)) {
    writeWriteAccessLocalConfig(repoRoot, migrated);
  }
  return migrated;
}

export function getWriteMode(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  defaultWriteMode: WriteMode = "off"
): { writeMode: WriteMode; source: WriteModeSource } {
  const envWriteMode = env.CHAMPCITY_GPT_WRITE_MODE?.trim();
  if (envWriteMode) {
    return {
      writeMode: parseWriteMode(envWriteMode, "CHAMPCITY_GPT_WRITE_MODE"),
      source: "env"
    };
  }

  const localConfig = getLocalWriteAccessConfig(repoRoot);
  if (localConfig.writeMode) {
    return {
      writeMode: localConfig.writeMode,
      source: "local-file"
    };
  }

  if (env.CHAMPCITY_GPT_ENABLE_WRITE_TOOLS !== undefined && env.CHAMPCITY_GPT_ENABLE_WRITE_TOOLS.trim() !== "") {
    return {
      writeMode: parseBoolean(env.CHAMPCITY_GPT_ENABLE_WRITE_TOOLS, false) ? "docs" : "off",
      source: "legacy-env"
    };
  }

  return {
    writeMode: defaultWriteMode,
    source: "default"
  };
}

export function hashWriteApprovalToken(token: string): string {
  const normalized = token.trim();
  if (normalized.length < 16) {
    throw new AppError("INVALID_INPUT", "Write approval token must be at least 16 characters.");
  }

  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(normalized, salt, 32).toString("base64url");
  return `scrypt:${salt}:${hash}`;
}

export function verifyWriteApprovalTokenHash(token: string, tokenHash: string): boolean {
  const [scheme, salt, expectedHash] = tokenHash.split(":");
  if (scheme !== "scrypt" || !salt || !expectedHash) {
    return false;
  }

  const candidate = scryptSync(token.trim(), salt, 32);
  const expected = Buffer.from(expectedHash, "base64url");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function getWriteApprovalTokenConfig(repoRoot: string, env: NodeJS.ProcessEnv = process.env): WriteApprovalTokenConfig {
  const envToken = env.CHAMPCITY_GPT_WRITE_APPROVAL_TOKEN?.trim();
  if (envToken) {
    return {
      source: "env",
      token: envToken
    };
  }

  const localConfig = getLocalWriteAccessConfig(repoRoot);
  const tokenHash = localConfig.legacyApprovalTokenHash ?? localConfig.writeApprovalTokenHash;
  if (tokenHash) {
    return {
      source: "local-file",
      tokenHash
    };
  }

  return {
    source: "none"
  };
}

export function docsWritesAllowed(writeMode: WriteMode): boolean {
  return writeMode === "docs" || writeMode === "patch" || writeMode === "elevated";
}

export function patchWritesAllowed(writeMode: WriteMode): boolean {
  return writeMode === "patch" || writeMode === "elevated";
}

export function elevatedOperationsAllowed(writeMode: WriteMode): boolean {
  return writeMode === "elevated";
}

export function getWriteAccessStatus(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  defaultWriteMode: WriteMode = "off"
): WriteAccessStatus {
  const localConfig = getLocalWriteAccessConfig(repoRoot);
  const mode = getWriteMode(repoRoot, env, defaultWriteMode);
  const tokenConfig = getWriteApprovalTokenConfig(repoRoot, env);

  return {
    writeMode: mode.writeMode,
    writeModeSource: mode.source,
    docsWritesAllowed: docsWritesAllowed(mode.writeMode),
    patchWritesAllowed: patchWritesAllowed(mode.writeMode),
    elevatedOperationsAllowed: elevatedOperationsAllowed(mode.writeMode),
    elevatedApprovalRequired: localConfig.elevatedApprovalRequired ?? true,
    legacyApprovalTokenConfigured: tokenConfig.source !== "none",
    legacyApprovalTokenSource: tokenConfig.source,
    legacyApprovalTokenCreatedAt: tokenConfig.source === "local-file" ? localConfig.legacyApprovalTokenCreatedAt : undefined,
    legacyApprovalTokenUpdatedAt: tokenConfig.source === "local-file" ? localConfig.legacyApprovalTokenUpdatedAt : undefined
  };
}

export function setWriteMode(repoRoot: string, writeMode: WriteMode): WriteAccessStatus {
  const localConfig = getLocalWriteAccessConfig(repoRoot);
  const timestamp = nowIso();
  writeWriteAccessLocalConfig(repoRoot, {
    ...localConfig,
    writeMode,
    elevatedApprovalRequired: localConfig.elevatedApprovalRequired ?? true,
    createdAt: localConfig.createdAt ?? timestamp,
    updatedAt: timestamp
  });
  return getWriteAccessStatus(repoRoot);
}

export function setHttpWriteToolsEnabled(repoRoot: string, enabled: boolean): WriteAccessStatus {
  return setWriteMode(repoRoot, enabled ? "docs" : "off");
}

export function saveWriteApprovalToken(repoRoot: string, token: string): WriteAccessStatus {
  const localConfig = getLocalWriteAccessConfig(repoRoot);
  const timestamp = nowIso();
  writeWriteAccessLocalConfig(repoRoot, {
    ...localConfig,
    legacyApprovalTokenHash: hashWriteApprovalToken(token),
    legacyApprovalTokenCreatedAt: localConfig.legacyApprovalTokenCreatedAt ?? timestamp,
    legacyApprovalTokenUpdatedAt: timestamp,
    elevatedApprovalRequired: localConfig.elevatedApprovalRequired ?? true,
    createdAt: localConfig.createdAt ?? timestamp,
    updatedAt: timestamp
  });
  return getWriteAccessStatus(repoRoot);
}

export function clearWriteApprovalToken(repoRoot: string): WriteAccessStatus {
  const localConfig = getLocalWriteAccessConfig(repoRoot);
  const timestamp = nowIso();
  const nextConfig: WriteAccessLocalConfig = {
    writeMode: localConfig.writeMode,
    elevatedApprovalRequired: localConfig.elevatedApprovalRequired ?? true,
    createdAt: localConfig.createdAt ?? timestamp,
    updatedAt: timestamp
  };
  writeWriteAccessLocalConfig(repoRoot, nextConfig);
  return getWriteAccessStatus(repoRoot);
}

export function generateWriteApprovalToken(): string {
  return randomBytes(32).toString("base64url");
}

export function assertValidWriteApprovalToken(toolName: string, approvalToken: string | undefined, config: WriteApprovalTokenConfig): void {
  if (config.source === "none") {
    throw new AppError("APPROVAL_REQUIRED", `Local elevated approval token is not configured for ${toolName}.`);
  }

  const candidate = approvalToken?.trim();
  if (!candidate) {
    throw new AppError("APPROVAL_REQUIRED", `Local elevated approval token is required for ${toolName}.`);
  }

  if (config.source === "env") {
    if (!config.token || candidate !== config.token) {
      throw new AppError("APPROVAL_REQUIRED", "Local elevated approval token is invalid.");
    }
    return;
  }

  if (!config.tokenHash || !verifyWriteApprovalTokenHash(candidate, config.tokenHash)) {
    throw new AppError("APPROVAL_REQUIRED", "Local elevated approval token is invalid.");
  }
}
