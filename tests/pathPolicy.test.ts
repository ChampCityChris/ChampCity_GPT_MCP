import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { resolveProjectPath } from "../src/security/pathPolicy.js";

let tempRoot: string;
let outsideRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-root-"));
  outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-outside-"));
  fs.mkdirSync(path.join(tempRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "src", "example.ts"), "export const ok = true;\n", "utf8");
  fs.writeFileSync(path.join(outsideRoot, "secret.txt"), "nope\n", "utf8");
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.rmSync(outsideRoot, { recursive: true, force: true });
});

describe("path policy", () => {
  it("allows a path inside the configured root", () => {
    const resolved = resolveProjectPath(tempRoot, "src/example.ts", [tempRoot]);
    assert.equal(resolved.resolvedPath, fs.realpathSync.native(path.join(tempRoot, "src", "example.ts")));
  });

  it("blocks path traversal", () => {
    assert.throws(() => resolveProjectPath(tempRoot, "../secret.txt", [tempRoot]), /traversal|relative path/i);
  });

  it("blocks absolute paths outside the root", () => {
    assert.throws(() => resolveProjectPath(tempRoot, path.join(outsideRoot, "secret.txt"), [tempRoot]), /relative path/i);
  });

  it("blocks symlink escapes when symlinks are available", () => {
    const linkPath = path.join(tempRoot, "linked-secret.txt");

    try {
      fs.symlinkSync(path.join(outsideRoot, "secret.txt"), linkPath, "file");
    } catch {
      return;
    }

    assert.throws(() => resolveProjectPath(tempRoot, "linked-secret.txt", [tempRoot]), /escapes/i);
  });
});
