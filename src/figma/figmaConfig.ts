import fs from "node:fs";
import path from "node:path";

import { getRuntimeConfigFilePath } from "../runtimePaths.js";
import { AppError } from "../utils/errors.js";

export const FIGMA_CONFIG_FILE = "figma.local.json";
export const FIGMA_ENV_TOKEN = "CHAMPCITY_GPT_" + "FIGMA_ACCESS_TOKEN";

export type FigmaConfigSource = "env" | "local-file" | "dev-local-file" | "none";

export interface FigmaAccessTokenConfig {
  configured: boolean;
  source: FigmaConfigSource;
  token?: string;
}

export interface FigmaConfigStatus {
  configured: boolean;
  source: FigmaConfigSource;
}

function readTokenFile(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
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

  const token = (parsed as { figmaAccessToken?: unknown }).figmaAccessToken;
  if (token === undefined || token === null || String(token).trim() === "") {
    return undefined;
  }

  if (typeof token !== "string") {
    throw new AppError("INVALID_INPUT", `${filePath} figmaAccessToken must be a string.`);
  }

  return token.trim();
}

export function getFigmaConfigPath(repoRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  return getRuntimeConfigFilePath(repoRoot, FIGMA_CONFIG_FILE, env);
}

export function getFigmaAccessTokenConfig(repoRoot: string, env: NodeJS.ProcessEnv = process.env): FigmaAccessTokenConfig {
  const envToken = env[FIGMA_ENV_TOKEN]?.trim();
  if (envToken) {
    return {
      configured: true,
      source: "env",
      token: envToken
    };
  }

  const runtimeConfigPath = getFigmaConfigPath(repoRoot, env);
  const runtimeToken = readTokenFile(runtimeConfigPath);
  if (runtimeToken) {
    return {
      configured: true,
      source: env.CHAMPCITY_GPT_CONFIG_DIR ? "local-file" : "dev-local-file",
      token: runtimeToken
    };
  }

  if (env.CHAMPCITY_GPT_CONFIG_DIR) {
    const devConfigPath = path.join(repoRoot, "config", FIGMA_CONFIG_FILE);
    if (path.resolve(devConfigPath) !== path.resolve(runtimeConfigPath)) {
      const devToken = readTokenFile(devConfigPath);
      if (devToken && (env.NODE_ENV !== "production" || env.CHAMPCITY_GPT_DEV_CONFIG_FALLBACK === "true")) {
        return {
          configured: true,
          source: "dev-local-file",
          token: devToken
        };
      }
    }
  }

  return {
    configured: false,
    source: "none"
  };
}

export function getFigmaStatus(repoRoot: string, env: NodeJS.ProcessEnv = process.env): FigmaConfigStatus {
  const { configured, source } = getFigmaAccessTokenConfig(repoRoot, env);
  return { configured, source };
}

export function requireFigmaAccessToken(repoRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  const config = getFigmaAccessTokenConfig(repoRoot, env);
  if (!config.token) {
    throw new AppError("APPROVAL_REQUIRED", "Figma token is not configured. Set CHAMPCITY_GPT_FIGMA_ACCESS_TOKEN or save config/figma.local.json locally.");
  }

  return config.token;
}

export function saveLocalFigmaAccessToken(repoRoot: string, token: string, env: NodeJS.ProcessEnv = process.env): FigmaConfigStatus {
  const normalized = token.trim();
  if (!normalized) {
    throw new AppError("INVALID_INPUT", "Figma access token is required.");
  }

  const configPath = getFigmaConfigPath(repoRoot, env);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify({ figmaAccessToken: normalized }, null, 2)}\n`, "utf8");
  return getFigmaStatus(repoRoot, env);
}

export function clearLocalFigmaAccessToken(repoRoot: string, env: NodeJS.ProcessEnv = process.env): FigmaConfigStatus {
  fs.rmSync(getFigmaConfigPath(repoRoot, env), { force: true });
  return getFigmaStatus(repoRoot, env);
}
