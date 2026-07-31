import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-build-clean-"));
  tempRoots.push(root);
  return root;
}

function runReleaseCheck(repositoryRoot: string) {
  const scriptPath = path.resolve("scripts", "check-release-clean.ps1");
  return spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-RepositoryRoot", repositoryRoot],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: false,
      windowsHide: true
    }
  );
}

describe("build output cleanliness", () => {
  it("cleans dist through the shared build path used by tests and packaging", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    assert.equal(packageJson.scripts?.["clean:dist"], "node scripts/clean-dist.mjs");
    assert.equal(packageJson.scripts?.["mcp:build"], "npm run clean:dist && tsc -p tsconfig.json && npm run renderer:build");
    assert.equal(packageJson.scripts?.build, "npm run mcp:build");
    assert.equal(packageJson.scripts?.test, "npm run build && node --test dist/tests/*.test.js");
    assert.equal(packageJson.scripts?.["app:build"], "npm run mcp:build");
  });

  it("release safety rejects retired compiled production modules in package input", () => {
    const root = makeTempRoot();
    const retiredModule = path.join(root, "dist", "src", "tools", "saveArchitectInterviewOutput.js");
    fs.mkdirSync(path.dirname(retiredModule), { recursive: true });
    fs.writeFileSync(retiredModule, "export {};\n", "utf8");

    const blocked = runReleaseCheck(root);
    assert.notEqual(blocked.status, 0, blocked.stdout + blocked.stderr);
    assert.match(blocked.stdout, /Retired compiled production module found in package input/u);

    fs.rmSync(path.join(root, "dist"), { recursive: true, force: true });
    fs.mkdirSync(path.join(root, "dist", "src", "tools"), { recursive: true });
    fs.writeFileSync(path.join(root, "dist", "src", "tools", "currentModule.js"), "export {};\n", "utf8");

    const clean = runReleaseCheck(root);
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    assert.match(clean.stdout, /PASS release cleanliness/u);
  });
});
