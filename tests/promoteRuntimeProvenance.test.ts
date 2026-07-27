import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, it } from "node:test";

let tempRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-runtime-manifest-"));
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

async function promotionHelpers() {
  const moduleUrl = pathToFileURL(path.join(process.cwd(), "scripts", "promote-runtime-exe.mjs")).href;
  return await import(moduleUrl) as {
    createRuntimeManifest: (input: {
      packageVersion: string;
      sourceCommit: string;
      sourceArtifactSha256: string;
      runtimeCopySha256: string;
      promotedAt: string;
    }) => Record<string, unknown>;
    writeRuntimeManifestAtomic: (filePath: string, manifest: Record<string, unknown>) => Promise<void>;
  };
}

describe("runtime promotion provenance manifest", () => {
  it("creates non-secret promotion provenance without paths", async () => {
    const { createRuntimeManifest } = await promotionHelpers();
    const manifest = createRuntimeManifest({
      packageVersion: "0.3.0",
      sourceCommit: "780217a",
      sourceArtifactSha256: "a".repeat(64),
      runtimeCopySha256: "a".repeat(64),
      promotedAt: "2026-07-24T12:00:00.000Z"
    });
    const serialized = JSON.stringify(manifest);

    assert.deepEqual(Object.keys(manifest).sort(), [
      "packageVersion",
      "promotedAt",
      "runtimeCopySha256",
      "sourceArtifactSha256",
      "sourceCommit"
    ]);
    assert.equal(manifest.packageVersion, "0.3.0");
    assert.equal(manifest.sourceCommit, "780217a");
    assert.equal(manifest.sourceArtifactSha256, "a".repeat(64));
    assert.equal(manifest.runtimeCopySha256, "a".repeat(64));
    assert.equal(manifest.promotedAt, "2026-07-24T12:00:00.000Z");
    assert.doesNotMatch(serialized, /access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization[_-]?code|password|credential/iu);
    assert.doesNotMatch(serialized, /[A-Za-z]:[\\/]|%USERPROFILE%|CHAMPCITY_GPT_/u);
  });

  it("writes the runtime manifest with a replace-safe local write", async () => {
    const { writeRuntimeManifestAtomic } = await promotionHelpers();
    const manifestPath = path.join(tempRoot, "Apps", "ChampCity_GPT_MCP_Runtime", "runtime-manifest.json");
    const firstManifest = { packageVersion: "0.2.1", sourceCommit: "old" };
    const secondManifest = { packageVersion: "0.3.0", sourceCommit: "780217a" };

    await writeRuntimeManifestAtomic(manifestPath, firstManifest);
    await writeRuntimeManifestAtomic(manifestPath, secondManifest);

    assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath, "utf8")), secondManifest);
    assert.deepEqual(fs.readdirSync(path.dirname(manifestPath)), ["runtime-manifest.json"]);
  });
});
