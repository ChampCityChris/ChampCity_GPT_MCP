import { type AppConfig } from "./config.js";
import { resolveAllowedRoot } from "./security/pathPolicy.js";
import { AppError } from "./utils/errors.js";

export function resolveDefaultWorkspaceRoot(config: AppConfig): string {
  const defaultWorkspaceRoot = config.defaultWorkspaceRoot ?? config.repoRoot;

  try {
    return resolveAllowedRoot(defaultWorkspaceRoot, config.allowedRoots).rootRealPath;
  } catch (error) {
    if (error instanceof AppError) {
      throw new AppError(error.code, "Configured default workspace root is not in the allowed root list.", {
        allowedRootCount: config.allowedRoots.length,
        defaultWorkspaceRootSource: config.defaultWorkspaceRootSource ?? "repoRoot"
      });
    }
    throw error;
  }
}
