import fs from "node:fs";
import path from "node:path";

export type RuntimeMode = "development" | "installed" | "portable";

export interface RuntimePathInfo {
  mode: RuntimeMode;
  resourceRoot: string;
  configDir: string;
  logsDir: string;
  generatedDir: string;
  serverEntrypoint: string;
}

export const SERVER_ENTRYPOINT_RELATIVE = path.join("dist", "src", "index.js");

export function getRuntimeConfigDir(root: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.CHAMPCITY_GPT_CONFIG_DIR?.trim() || path.join(root, "config"));
}

export function getRuntimeLogDir(root: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.CHAMPCITY_GPT_LOG_DIR?.trim() || path.join(root, "logs"));
}

export function getRuntimeGeneratedDir(root: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.CHAMPCITY_GPT_GENERATED_DIR?.trim() || path.join(root, "generated"));
}

export function getRuntimeConfigFilePath(root: string, fileName: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(getRuntimeConfigDir(root, env), fileName);
}

export function getRuntimeServerEntrypoint(resourceRoot: string): string {
  return path.join(resourceRoot, SERVER_ENTRYPOINT_RELATIVE);
}

export function hasPortableDataDir(exeDir: string): boolean {
  return fs.existsSync(path.join(exeDir, "data"));
}
