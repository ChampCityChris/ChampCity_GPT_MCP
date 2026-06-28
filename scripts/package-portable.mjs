import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const packageJsonPath = path.join(repoRoot, "package.json");
const builderConfigPath = path.join(repoRoot, "electron-builder.json");

const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const builderConfig = JSON.parse(await readFile(builderConfigPath, "utf8"));

const version = packageJson.version;
const productName = builderConfig.productName ?? packageJson.productName ?? packageJson.name;
const outputDir = path.resolve(repoRoot, builderConfig.directories?.output ?? "dist");
const packageLogDir = path.join(repoRoot, "logs", "package");
const arch = "x64";
const ext = "exe";
const artifactNameTemplate = builderConfig.win?.artifactName ?? "${productName}-${version}-${arch}.${ext}";
const artifactName = artifactNameTemplate
  .replaceAll("${productName}", productName)
  .replaceAll("${name}", packageJson.name)
  .replaceAll("${version}", version)
  .replaceAll("${arch}", arch)
  .replaceAll("${ext}", ext);
const expectedArtifactPath = path.join(outputDir, artifactName);
const logPath = path.join(packageLogDir, `package-portable-${version}.log`);
const runStartedAt = new Date();

await mkdir(outputDir, { recursive: true });
await mkdir(packageLogDir, { recursive: true });

const logStream = createWriteStream(logPath, { flags: "w" });

function writeLog(message) {
  logStream.write(message);
}

function logLine(message) {
  writeLog(`${message}\n`);
}

function finishLog() {
  return new Promise((resolve) => {
    logStream.end(resolve);
  });
}

function commandLabel(command, args) {
  return [command, ...args].join(" ");
}

function shouldUseWindowsCommandShell(command) {
  return process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command);
}

function commandForSpawn(command, args) {
  if (shouldUseWindowsCommandShell(command)) {
    return {
      command: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", command, ...args],
    };
  }

  return { command, args };
}

async function run(command, args) {
  logLine(`\n> ${commandLabel(command, args)}`);
  const spawnCommand = commandForSpawn(command, args);

  await new Promise((resolve, reject) => {
    const child = spawn(spawnCommand.command, spawnCommand.args, {
      cwd: repoRoot,
      env: process.env,
      shell: false,
      windowsHide: true,
    });

    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      writeLog(chunk);
    });

    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      writeLog(chunk);
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const detail = signal ? `signal ${signal}` : `exit code ${code}`;
      reject(new Error(`${commandLabel(command, args)} failed with ${detail}`));
    });
  });
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function assertFreshFinalArtifact(filePath, fileStat) {
  const normalized = filePath.replaceAll("\\", "/");

  if (normalized.includes("/release/win-unpacked/")) {
    throw new Error(`Portable artifact resolved inside win-unpacked: ${filePath}`);
  }

  if (!filePath.endsWith(`-${version}-${arch}.${ext}`)) {
    throw new Error(`Portable artifact does not include expected version ${version}: ${filePath}`);
  }

  if (fileStat.size <= 0) {
    throw new Error(`Portable artifact has zero size: ${filePath}`);
  }

  if (fileStat.mtimeMs < runStartedAt.getTime()) {
    throw new Error(
      `Portable artifact is stale. LastWriteTime ${fileStat.mtime.toISOString()} is before run start ${runStartedAt.toISOString()}: ${filePath}`,
    );
  }
}

logLine(`ChampCity GPT portable packaging started: ${runStartedAt.toISOString()}`);
logLine(`Package version: ${version}`);
logLine(`Expected final portable executable: ${expectedArtifactPath}`);

try {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  await run(npmCommand, ["run", "app:build"]);

  const electronBuilderCli = path.join(repoRoot, "node_modules", "electron-builder", "cli.js");
  await run(process.execPath, [
    electronBuilderCli,
    "--win",
    "portable",
    "--config",
    builderConfigPath,
  ]);

  const artifactStat = await stat(expectedArtifactPath);
  assertFreshFinalArtifact(expectedArtifactPath, artifactStat);
  const artifactHash = await sha256(expectedArtifactPath);

  logLine("\nPackaging completed successfully.");
  logLine(`Final portable executable: ${expectedArtifactPath}`);
  logLine(`LastWriteTime: ${artifactStat.mtime.toISOString()}`);
  logLine(`Size: ${artifactStat.size}`);
  logLine(`SHA-256: ${artifactHash}`);

  console.log(`Final portable executable: ${expectedArtifactPath}`);
  console.log(`LastWriteTime: ${artifactStat.mtime.toISOString()}`);
  console.log(`Size: ${artifactStat.size}`);
  console.log(`SHA-256: ${artifactHash}`);
} catch (error) {
  logLine(`\nPackaging failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  logLine(`Log file: ${logPath}`);
  await finishLog();
}
