import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { assertCommandAllowed } from "../src/tools/runAllowedScript.js";
import { assertChangedPathsAreNotSymlinks, validatePatchTargets } from "../src/utils/patch.js";

let tempRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-patch-"));
  fs.writeFileSync(path.join(tempRoot, "safe.txt"), "safe\n", "utf8");
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("patch safety", () => {
  it("rejects patch targets outside the allowed root", () => {
    const patch = [
      "diff --git a/../outside.txt b/../outside.txt",
      "--- a/../outside.txt",
      "+++ b/../outside.txt",
      "@@ -1 +1 @@",
      "-old",
      "+new"
    ].join("\n");

    assert.throws(() => validatePatchTargets(tempRoot, patch, [tempRoot]), /traversal|relative path/i);
  });

  it("rejects patches that create symlink file modes", () => {
    const patch = [
      "diff --git a/link.txt b/link.txt",
      "new file mode 120000",
      "index 0000000..d95f3ad 120000",
      "--- /dev/null",
      "+++ b/link.txt",
      "@@ -0,0 +1 @@",
      "+target.txt"
    ].join("\n");

    assert.throws(() => validatePatchTargets(tempRoot, patch, [tempRoot]), /symlink|special file mode/i);
  });

  it("rejects patches that contain submodule file modes", () => {
    const patch = [
      "diff --git a/vendor/lib b/vendor/lib",
      "mode 160000",
      "--- a/vendor/lib",
      "+++ b/vendor/lib",
      "@@ -1 +1 @@",
      "-Subproject commit 1111111111111111111111111111111111111111",
      "+Subproject commit 2222222222222222222222222222222222222222"
    ].join("\n");

    assert.throws(() => validatePatchTargets(tempRoot, patch, [tempRoot]), /submodule|special file mode/i);
  });

  it("allows normal text-file patches through validation", () => {
    const patch = [
      "diff --git a/safe.txt b/safe.txt",
      "--- a/safe.txt",
      "+++ b/safe.txt",
      "@@ -1 +1 @@",
      "-safe",
      "+safer"
    ].join("\n");

    assert.deepEqual(validatePatchTargets(tempRoot, patch, [tempRoot]), ["safe.txt"]);
  });

  it("post-apply symlink verification rejects changed symlink paths when available", () => {
    const linkPath = path.join(tempRoot, "safe-link.txt");

    try {
      fs.symlinkSync(path.join(tempRoot, "safe.txt"), linkPath, "file");
    } catch {
      return;
    }

    assert.throws(() => assertChangedPathsAreNotSymlinks(tempRoot, ["safe-link.txt"]), /symbolic link/i);
  });

  it("runs npm test without the non-portable test isolation flag", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    assert.equal(packageJson.scripts?.test, "npm run build && node --test dist/tests/*.test.js");
    assert.doesNotMatch(packageJson.scripts?.test ?? "", /--test-isolation=none/);
  });

  it("rejects non-allowlisted commands", () => {
    assert.throws(() => assertCommandAllowed("npm install left-pad", ["npm test"]), /allow/i);
  });
});
