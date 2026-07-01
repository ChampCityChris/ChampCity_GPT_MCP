import { type AppConfig } from "./config.js";
import { DEFAULT_WORKSPACE_ID, resolveWorkspaceRoot } from "./workspaces.js";

export function resolveDefaultWorkspaceRoot(config: AppConfig): string {
  return resolveWorkspaceRoot(DEFAULT_WORKSPACE_ID, config);
}
