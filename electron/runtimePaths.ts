import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

import { getRuntimeServerEntrypoint, hasPortableDataDir, type RuntimePathInfo } from "../src/runtimePaths.js";

export function resolveElectronRuntimePaths(resourceRoot: string): RuntimePathInfo {
  const exeDir = path.dirname(app.getPath("exe"));
  const portableDataDir = path.join(exeDir, "data");

  if (!app.isPackaged) {
    return {
      mode: "development",
      resourceRoot,
      configDir: path.join(resourceRoot, "config"),
      logsDir: path.join(resourceRoot, "logs"),
      generatedDir: path.join(resourceRoot, "generated"),
      serverEntrypoint: getRuntimeServerEntrypoint(resourceRoot)
    };
  }

  if (hasPortableDataDir(exeDir)) {
    return {
      mode: "portable",
      resourceRoot,
      configDir: path.join(portableDataDir, "config"),
      logsDir: path.join(portableDataDir, "logs"),
      generatedDir: path.join(portableDataDir, "generated"),
      serverEntrypoint: getRuntimeServerEntrypoint(resourceRoot)
    };
  }

  const userData = app.getPath("userData");
  return {
    mode: "installed",
    resourceRoot,
    configDir: path.join(userData, "config"),
    logsDir: path.join(userData, "logs"),
    generatedDir: path.join(userData, "generated"),
    serverEntrypoint: getRuntimeServerEntrypoint(resourceRoot)
  };
}

export function ensureRuntimeDirectories(paths: RuntimePathInfo): void {
  fs.mkdirSync(paths.configDir, { recursive: true });
  fs.mkdirSync(paths.logsDir, { recursive: true });
  fs.mkdirSync(paths.generatedDir, { recursive: true });
}
