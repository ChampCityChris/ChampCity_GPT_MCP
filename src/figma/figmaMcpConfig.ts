import fs from "node:fs";
import path from "node:path";

import { getRuntimeConfigFilePath } from "../runtimePaths.js";
import { AppError } from "../utils/errors.js";

export type FigmaMcpMode = "desktop" | "remote";
export type FigmaMcpAuthStatus = "unknown" | "not-required" | "required" | "configured";
export type FigmaMcpConfigSource = "env" | "local-file" | "default";

export interface FigmaMcpConfig {
  endpoint: string;
  mode: FigmaMcpMode;
  source: FigmaMcpConfigSource;
}

export interface FigmaMcpStatus {
  endpoint: string;
  mode: FigmaMcpMode;
  source: FigmaMcpConfigSource;
  connectionStatus: "not-tested";
  authStatus: FigmaMcpAuthStatus;
  makeResourceRetrievalAvailable: "unknown";
  configPath: string;
}

export const FIGMA_MCP_CONFIG_FILE = "figma-mcp.local.json";
export const FIGMA_MCP_ENDPOINT_ENV = "CHAMPCITY_GPT_FIGMA_MCP_ENDPOINT";
export const FIGMA_MCP_MODE_ENV = "CHAMPCITY_GPT_FIGMA_MCP_MODE";
export const DEFAULT_DESKTOP_FIGMA_MCP_ENDPOINT = "http://127.0.0.1:3845/mcp";

interface FigmaMcpLocalConfigFile {
  endpoint?: unknown;
  mode?: unknown;
}

function normalizeMode(value: unknown, label: string): FigmaMcpMode {
  if (value === undefined || value === null || String(value).trim() === "") {
    return "desktop";
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === "desktop" || normalized === "remote") {
    return normalized;
  }

  throw new AppError("INVALID_INPUT", `${label} must be "desktop" or "remote".`);
}

export function validateFigmaMcpEndpoint(endpoint: string, mode: FigmaMcpMode): string {
  const trimmed = endpoint.trim();
  if (!trimmed) {
    throw new AppError("INVALID_INPUT", "Figma MCP endpoint is required.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new AppError("INVALID_INPUT", "Figma MCP endpoint must be a valid http(s) URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AppError("INVALID_INPUT", "Figma MCP endpoint must use http or https.");
  }

  if (mode === "desktop") {
    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "::1") {
      throw new AppError("INVALID_INPUT", "Desktop Figma MCP endpoint must point at localhost.");
    }
  }

  if (mode === "remote" && parsed.protocol !== "https:") {
    throw new AppError("INVALID_INPUT", "Remote Figma MCP endpoint must use https.");
  }

  return parsed.toString();
}

export function getFigmaMcpConfigPath(repoRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  return getRuntimeConfigFilePath(repoRoot, FIGMA_MCP_CONFIG_FILE, env);
}

function readLocalFigmaMcpConfig(filePath: string): FigmaMcpLocalConfigFile {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AppError("INVALID_INPUT", `Invalid JSON in ${filePath}: ${detail}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError("INVALID_INPUT", `${filePath} must contain a JSON object.`);
  }

  return parsed as FigmaMcpLocalConfigFile;
}

export function getFigmaMcpConfig(repoRoot: string, env: NodeJS.ProcessEnv = process.env): FigmaMcpConfig {
  const envEndpoint = env[FIGMA_MCP_ENDPOINT_ENV]?.trim();
  const envMode = env[FIGMA_MCP_MODE_ENV]?.trim();
  if (envEndpoint || envMode) {
    const mode = normalizeMode(envMode, FIGMA_MCP_MODE_ENV);
    return {
      endpoint: validateFigmaMcpEndpoint(envEndpoint || DEFAULT_DESKTOP_FIGMA_MCP_ENDPOINT, mode),
      mode,
      source: "env"
    };
  }

  const configPath = getFigmaMcpConfigPath(repoRoot, env);
  const localConfig = readLocalFigmaMcpConfig(configPath);
  if (localConfig.endpoint !== undefined || localConfig.mode !== undefined) {
    if (localConfig.endpoint !== undefined && typeof localConfig.endpoint !== "string") {
      throw new AppError("INVALID_INPUT", `${configPath} endpoint must be a string.`);
    }

    const mode = normalizeMode(localConfig.mode, `${configPath} mode`);
    return {
      endpoint: validateFigmaMcpEndpoint(localConfig.endpoint || DEFAULT_DESKTOP_FIGMA_MCP_ENDPOINT, mode),
      mode,
      source: "local-file"
    };
  }

  return {
    endpoint: DEFAULT_DESKTOP_FIGMA_MCP_ENDPOINT,
    mode: "desktop",
    source: "default"
  };
}

export function getFigmaMcpStatus(repoRoot: string, env: NodeJS.ProcessEnv = process.env): FigmaMcpStatus {
  const config = getFigmaMcpConfig(repoRoot, env);
  return {
    ...config,
    connectionStatus: "not-tested",
    authStatus: "unknown",
    makeResourceRetrievalAvailable: "unknown",
    configPath: getFigmaMcpConfigPath(repoRoot, env)
  };
}

export function saveLocalFigmaMcpConfig(
  repoRoot: string,
  input: { endpoint: string; mode: FigmaMcpMode },
  env: NodeJS.ProcessEnv = process.env
): FigmaMcpStatus {
  const endpoint = validateFigmaMcpEndpoint(input.endpoint, input.mode);
  const configPath = getFigmaMcpConfigPath(repoRoot, env);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify({ endpoint, mode: input.mode }, null, 2)}\n`, "utf8");
  return getFigmaMcpStatus(repoRoot, env);
}
