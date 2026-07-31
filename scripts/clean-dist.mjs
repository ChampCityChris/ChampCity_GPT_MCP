import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const distRoot = path.join(repoRoot, "dist");

try {
  await fs.rm(distRoot, { recursive: true, force: true });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to remove generated dist directory: ${message}`);
  process.exit(1);
}
