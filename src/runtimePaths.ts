import fs from "node:fs";
import path from "node:path";

export type RuntimeMode = "development" | "installed" | "portable";
export type ServerRuntimeMode = "in-process" | "cli-child-process";

export interface RuntimePathInfo {
  mode: RuntimeMode;
  serverRuntime: ServerRuntimeMode;
  appRoot: string;
  resourceRoot: string;
  configDir: string;
  logsDir: string;
  generatedDir: string;
  serverEntrypoint: string;
  nodeExecutable: string;
}

export const SERVER_ENTRYPOINT_RELATIVE = path.join("dist", "src", "index.js");
export const PACKAGED_ASAR_UNPACKED_ROOT = "app.asar.unpacked";

export interface RuntimePathResolutionOptions {
  mode: RuntimeMode;
  appRoot: string;
  resourcesPath?: string;
  exeDir?: string;
  userDataDir?: string;
  useUserDataConfigInDevelopment?: boolean;
  nodeExecutable?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  pathExists?: (filePath: string) => boolean;
}

export interface RuntimePathValidationResult {
  ok: boolean;
  errors: string[];
  diagnostics: RuntimePathInfo;
}

export interface ServerStartCommand {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

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

export function getRuntimeServerEntrypoint(resourceRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CHAMPCITY_GPT_SERVER_ENTRYPOINT?.trim();
  return override ? path.resolve(override) : path.join(resourceRoot, SERVER_ENTRYPOINT_RELATIVE);
}

export function hasPortableDataDir(exeDir: string): boolean {
  return fs.existsSync(path.join(exeDir, "data"));
}

function splitPathList(value: string | undefined): string[] {
  return (value ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function nodeFileNames(platform: NodeJS.Platform): string[] {
  return platform === "win32" ? ["node.exe", "node.cmd", "node.bat", "node"] : ["node"];
}

function commonNodePaths(platform: NodeJS.Platform): string[] {
  if (platform === "win32") {
    return [
      "C:\\Program Files\\nodejs\\node.exe",
      "C:\\Program Files (x86)\\nodejs\\node.exe"
    ];
  }

  return ["/usr/local/bin/node", "/opt/homebrew/bin/node", "/usr/bin/node"];
}

export function resolveNodeExecutable(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  pathExists: (filePath: string) => boolean = fs.existsSync
): string {
  const explicit = env.CHAMPCITY_GPT_NODE_EXECUTABLE?.trim();
  if (explicit) {
    return path.resolve(explicit);
  }

  const candidates: string[] = [];
  for (const dir of splitPathList(env.PATH ?? env.Path)) {
    for (const fileName of nodeFileNames(platform)) {
      candidates.push(path.join(dir, fileName));
    }
  }
  candidates.push(...commonNodePaths(platform));

  const found = candidates.find((candidate) => pathExists(candidate));
  return found ? path.resolve(found) : (platform === "win32" ? "node.exe" : "node");
}

export function getPackagedServerEntrypoint(
  resourcesPath: string,
  pathExists: (filePath: string) => boolean = fs.existsSync
): string {
  const candidates = [
    path.join(resourcesPath, PACKAGED_ASAR_UNPACKED_ROOT, SERVER_ENTRYPOINT_RELATIVE),
    path.join(resourcesPath, SERVER_ENTRYPOINT_RELATIVE),
    path.join(resourcesPath, "app", SERVER_ENTRYPOINT_RELATIVE)
  ];
  return candidates.find((candidate) => pathExists(candidate)) ?? candidates[0];
}

export function resolveRuntimePathInfo(options: RuntimePathResolutionOptions): RuntimePathInfo {
  const env = options.env ?? process.env;
  const pathExists = options.pathExists ?? fs.existsSync;
  const platform = options.platform ?? process.platform;
  const appRoot = path.resolve(options.appRoot);
  const resourceRoot = options.mode === "development"
    ? appRoot
    : path.resolve(options.resourcesPath ?? appRoot);
  const exeDir = path.resolve(options.exeDir ?? appRoot);
  const portableDataDir = path.join(exeDir, "data");
  const configRoot = options.mode === "portable" ? portableDataDir : options.userDataDir ?? appRoot;
  const developmentUserDataRoot = typeof options.userDataDir === "string" ? path.resolve(options.userDataDir) : undefined;
  const useUserDataDevelopmentConfig =
    options.mode === "development" && options.useUserDataConfigInDevelopment === true && developmentUserDataRoot !== undefined;
  const writableRoot = useUserDataDevelopmentConfig ? developmentUserDataRoot : options.mode === "development" ? appRoot : configRoot;

  return {
    mode: options.mode,
    serverRuntime: "in-process",
    appRoot,
    resourceRoot,
    configDir: path.join(writableRoot, "config"),
    logsDir: path.join(writableRoot, "logs"),
    generatedDir: path.join(writableRoot, "generated"),
    serverEntrypoint: options.mode === "development"
      ? getRuntimeServerEntrypoint(appRoot, env)
      : getPackagedServerEntrypoint(resourceRoot, pathExists),
    nodeExecutable: options.nodeExecutable ?? resolveNodeExecutable(env, platform, pathExists)
  };
}

export function validateRuntimePaths(
  paths: RuntimePathInfo,
  options: {
    launcherExecutable?: string;
    pathExists?: (filePath: string) => boolean;
    requireNodeExecutable?: boolean;
    requireServerEntrypoint?: boolean;
  } = {}
): RuntimePathValidationResult {
  const pathExists = options.pathExists ?? fs.existsSync;
  const requireNodeExecutable = options.requireNodeExecutable ?? paths.mode === "development";
  const requireServerEntrypoint = options.requireServerEntrypoint ?? paths.mode === "development";
  const errors: string[] = [];

  if (requireNodeExecutable && !pathExists(paths.nodeExecutable)) {
    errors.push(`Node.js executable was not found at ${paths.nodeExecutable}. Install Node.js LTS and restart the launcher.`);
  }

  if (requireServerEntrypoint && !pathExists(paths.serverEntrypoint)) {
    errors.push(`Packaged MCP server entrypoint was not found at ${paths.serverEntrypoint}.`);
  }

  if (requireServerEntrypoint && options.launcherExecutable && path.resolve(paths.serverEntrypoint) === path.resolve(options.launcherExecutable)) {
    errors.push(`MCP server entrypoint resolved to the launcher executable instead of server JavaScript: ${paths.serverEntrypoint}`);
  }

  if (requireNodeExecutable && options.launcherExecutable && path.resolve(paths.nodeExecutable) === path.resolve(options.launcherExecutable)) {
    errors.push(`Node.js executable resolved to the launcher executable instead of node.exe: ${paths.nodeExecutable}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    diagnostics: paths
  };
}

export function createServerStartCommand(
  paths: RuntimePathInfo,
  options: {
    host: string;
    port: number;
    env?: NodeJS.ProcessEnv;
    extraEnv?: NodeJS.ProcessEnv;
  }
): ServerStartCommand {
  return {
    command: paths.nodeExecutable,
    args: [
      paths.serverEntrypoint,
      "--transport",
      "http",
      "--host",
      options.host,
      "--port",
      String(options.port)
    ],
    cwd: paths.mode === "development" ? paths.appRoot : paths.generatedDir,
    env: {
      ...(options.env ?? process.env),
      ...(options.extraEnv ?? {}),
      CHAMPCITY_GPT_CONFIG_DIR: paths.configDir,
      CHAMPCITY_GPT_LOG_DIR: paths.logsDir,
      CHAMPCITY_GPT_GENERATED_DIR: paths.generatedDir
    }
  };
}
