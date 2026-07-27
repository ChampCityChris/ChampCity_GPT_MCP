import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const packageJsonPath = path.join(repoRoot, "package.json");
const builderConfigPath = path.join(repoRoot, "electron-builder.json");

const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const builderConfig = JSON.parse(await readFile(builderConfigPath, "utf8"));

const version = packageJson.version;
const productName = builderConfig.productName ?? packageJson.productName ?? packageJson.name;
const outputDir = path.resolve(repoRoot, builderConfig.directories?.output ?? "dist");
const arch = "x64";
const ext = "exe";
const artifactNameTemplate = builderConfig.win?.artifactName ?? "${productName}-${version}-${arch}.${ext}";
const artifactName = artifactNameTemplate
  .replaceAll("${productName}", productName)
  .replaceAll("${name}", packageJson.name)
  .replaceAll("${version}", version)
  .replaceAll("${arch}", arch)
  .replaceAll("${ext}", ext);
const sourcePath = path.join(outputDir, artifactName);
const userHomeFromRepo = path.resolve(repoRoot, "..", "..");
const runtimeDir = path.join(userHomeFromRepo, "Apps", "ChampCity_GPT_MCP_Runtime");
const runtimeExePath = path.join(runtimeDir, "ChampCity GPT MCP Launcher-live.exe");
const runtimeManifestPath = path.join(runtimeDir, "runtime-manifest.json");

function assertInside(parent, child, label) {
  const relative = path.relative(parent, child);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return relative;
  }

  throw new Error(`${label} is outside ${parent}: ${child}`);
}

function assertFinalPortableSource(filePath, fileStat, metadataStats) {
  const relativeToOutput = assertInside(outputDir, filePath, "Portable artifact source");
  const normalizedRelative = relativeToOutput.replaceAll("\\", "/");
  const normalizedPath = filePath.replaceAll("\\", "/");

  if (normalizedRelative.startsWith("win-unpacked/") || normalizedPath.includes("/release/win-unpacked/")) {
    throw new Error(`Refusing to promote win-unpacked executable: ${filePath}`);
  }

  if (filePath.toLowerCase().endsWith(".nsis.7z")) {
    throw new Error(`Refusing to promote Electron Builder .nsis.7z intermediate artifact: ${filePath}`);
  }

  if (path.extname(filePath).toLowerCase() !== ".exe") {
    throw new Error(`Portable artifact source is not an executable: ${filePath}`);
  }

  if (path.basename(filePath) !== artifactName) {
    throw new Error(`Portable artifact name does not match expected current-version name ${artifactName}: ${filePath}`);
  }

  if (!filePath.endsWith(`-${version}-${arch}.${ext}`)) {
    throw new Error(`Portable artifact does not include expected version ${version}: ${filePath}`);
  }

  if (fileStat.size <= 0) {
    throw new Error(`Portable artifact has zero size: ${filePath}`);
  }

  const newestMetadata = Math.max(metadataStats.packageJson.mtimeMs, metadataStats.builderConfig.mtimeMs);
  if (fileStat.mtimeMs < newestMetadata) {
    throw new Error(
      `Portable artifact is stale. LastWriteTime ${fileStat.mtime.toISOString()} is older than package metadata: ${filePath}`,
    );
  }
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

async function gitOutputOptional(args) {
  try {
    return await new Promise((resolve) => {
      const child = spawn("git", args, {
        cwd: repoRoot,
        shell: false,
        windowsHide: true,
      });
      let stdout = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
      child.on("error", () => resolve("unknown"));
      child.on("close", (code) => {
        resolve(code === 0 ? stdout.trim() || "unknown" : "unknown");
      });
    });
  } catch {
    return "unknown";
  }
}

export function createRuntimeManifest({
  packageVersion,
  sourceCommit,
  sourceArtifactSha256,
  runtimeCopySha256,
  promotedAt,
}) {
  return {
    packageVersion,
    sourceCommit: sourceCommit || "unknown",
    sourceArtifactSha256,
    runtimeCopySha256,
    promotedAt,
  };
}

export async function writeRuntimeManifestAtomic(filePath, manifest) {
  const manifestDir = path.dirname(filePath);
  await mkdir(manifestDir, { recursive: true });
  const tempPath = path.join(manifestDir, `.runtime-manifest-${process.pid}-${Date.now()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

function reportArtifact(label, filePath, fileStat, hash) {
  console.log(`${label}: ${filePath}`);
  console.log(`${label} LastWriteTime: ${fileStat.mtime.toISOString()}`);
  console.log(`${label} Size: ${fileStat.size}`);
  console.log(`${label} SHA-256: ${hash}`);
}

export async function promoteRuntimeExecutable() {
  const [sourceStat, packageJsonStat, builderConfigStat] = await Promise.all([
    stat(sourcePath),
    stat(packageJsonPath),
    stat(builderConfigPath),
  ]);

  assertFinalPortableSource(sourcePath, sourceStat, {
    packageJson: packageJsonStat,
    builderConfig: builderConfigStat,
  });

  await mkdir(runtimeDir, { recursive: true });
  await copyFile(sourcePath, runtimeExePath);

  const [runtimeStat, sourceHash, runtimeHash] = await Promise.all([
    stat(runtimeExePath),
    sha256(sourcePath),
    sha256(runtimeExePath),
  ]);

  if (sourceHash !== runtimeHash) {
    throw new Error(`Runtime copy hash mismatch after copy: ${runtimeExePath}`);
  }

  const manifest = createRuntimeManifest({
    packageVersion: version,
    sourceCommit: await gitOutputOptional(["rev-parse", "--short", "HEAD"]),
    sourceArtifactSha256: sourceHash,
    runtimeCopySha256: runtimeHash,
    promotedAt: new Date().toISOString(),
  });
  await writeRuntimeManifestAtomic(runtimeManifestPath, manifest);

  console.log(`Package version: ${version}`);
  reportArtifact("Source portable executable", sourcePath, sourceStat, sourceHash);
  reportArtifact("Runtime copy executable", runtimeExePath, runtimeStat, runtimeHash);
  console.log(`Runtime manifest: ${runtimeManifestPath}`);
  console.log(`Runtime manifest contents: ${JSON.stringify(manifest)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await promoteRuntimeExecutable();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error(`Expected current-version portable executable: ${sourcePath}`);
    console.error(`Runtime copy destination: ${runtimeExePath}`);
    console.error(`Runtime manifest destination: ${runtimeManifestPath}`);
    process.exitCode = 1;
  }
}
