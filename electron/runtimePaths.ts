import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

import { hasPortableDataDir, resolveRuntimePathInfo, type RuntimePathInfo } from "../src/runtimePaths.js";

export function resolveElectronRuntimePaths(resourceRoot: string): RuntimePathInfo {
  const exeDir = path.dirname(app.getPath("exe"));

  if (!app.isPackaged) {
    return resolveRuntimePathInfo({
      mode: "development",
      appRoot: resourceRoot,
      userDataDir: app.getPath("userData"),
      useUserDataConfigInDevelopment: true
    });
  }

  if (hasPortableDataDir(exeDir)) {
    return resolveRuntimePathInfo({
      mode: "portable",
      appRoot: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      exeDir
    });
  }

  return resolveRuntimePathInfo({
    mode: "installed",
    appRoot: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    exeDir,
    userDataDir: app.getPath("userData")
  });
}

export function ensureRuntimeDirectories(paths: RuntimePathInfo): void {
  fs.mkdirSync(paths.configDir, { recursive: true });
  fs.mkdirSync(paths.logsDir, { recursive: true });
  fs.mkdirSync(paths.generatedDir, { recursive: true });
}

export function migrateLegacyRuntimeConfig(sourceConfigDir: string, targetConfigDir: string): string[] {
  const source = path.resolve(sourceConfigDir);
  const target = path.resolve(targetConfigDir);
  if (source.toLowerCase() === target.toLowerCase() || !fs.existsSync(source)) {
    return [];
  }

  fs.mkdirSync(target, { recursive: true });
  const migrated: string[] = [];
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".local.json")) {
      continue;
    }

    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (fs.existsSync(targetPath)) {
      continue;
    }

    fs.copyFileSync(sourcePath, targetPath);
    migrated.push(targetPath);
  }

  return migrated;
}
