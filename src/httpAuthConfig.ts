import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getRuntimeConfigFilePath } from "./runtimePaths.js";

export type HttpAuthTokenSource = "env" | "local-file" | "none";

export interface HttpAuthStatus {
  configured: boolean;
  source: HttpAuthTokenSource;
}

export interface HttpAuthTokenConfig extends HttpAuthStatus {
  token?: string;
}

const HTTP_AUTH_LOCAL_FILE = "http-auth.local.json";

export function getHttpAuthLocalConfigPath(repoRoot: string): string {
  return getRuntimeConfigFilePath(repoRoot, HTTP_AUTH_LOCAL_FILE);
}

function normalizeToken(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export function readLocalHttpAuthToken(repoRoot: string): string | undefined {
  const configPath = getHttpAuthLocalConfigPath(repoRoot);
  if (!fs.existsSync(configPath)) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${configPath}: ${detail}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${configPath} must contain a JSON object.`);
  }

  return normalizeToken((parsed as { httpAuthToken?: unknown }).httpAuthToken);
}

export function getHttpAuthTokenConfig(repoRoot: string, env: NodeJS.ProcessEnv = process.env): HttpAuthTokenConfig {
  const envToken = normalizeToken(env.CHAMPCITY_GPT_HTTP_AUTH_TOKEN);
  if (envToken) {
    return {
      configured: true,
      source: "env",
      token: envToken
    };
  }

  const localToken = readLocalHttpAuthToken(repoRoot);
  if (localToken) {
    return {
      configured: true,
      source: "local-file",
      token: localToken
    };
  }

  return {
    configured: false,
    source: "none"
  };
}

export function getHttpAuthStatus(repoRoot: string, env: NodeJS.ProcessEnv = process.env): HttpAuthStatus {
  const { configured, source } = getHttpAuthTokenConfig(repoRoot, env);
  return { configured, source };
}

export function saveLocalHttpAuthToken(repoRoot: string, token: string): HttpAuthStatus {
  const normalized = normalizeToken(token);
  if (!normalized) {
    throw new Error("HTTP auth token cannot be empty.");
  }

  const configPath = getHttpAuthLocalConfigPath(repoRoot);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify({ httpAuthToken: normalized }, null, 2)}\n`, "utf8");
  return {
    configured: true,
    source: "local-file"
  };
}

export function clearLocalHttpAuthToken(repoRoot: string): HttpAuthStatus {
  fs.rmSync(getHttpAuthLocalConfigPath(repoRoot), { force: true });
  return {
    configured: false,
    source: "none"
  };
}

export function generateHttpAuthToken(): string {
  return randomBytes(32).toString("base64url");
}
