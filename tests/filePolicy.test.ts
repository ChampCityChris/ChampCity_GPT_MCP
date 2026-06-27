import path from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertFilePolicyAllowsPath, assertMarkdownArtifactPath } from "../src/security/filePolicy.js";

describe("file policy", () => {
  it("blocks .env files", () => {
    assert.throws(() => assertFilePolicyAllowsPath(path.resolve(".env"), ".env"), /environment/i);
  });

  it("blocks local env files while allowing .env.example", () => {
    assert.throws(() => assertFilePolicyAllowsPath(path.resolve(".env.local"), ".env.local"), /environment/i);
    assert.doesNotThrow(() => assertFilePolicyAllowsPath(path.resolve(".env.example"), ".env.example"));
  });

  it("blocks .pem files", () => {
    assert.throws(() => assertFilePolicyAllowsPath(path.resolve("private.pem"), "private.pem"), /extension/i);
  });

  it("blocks node_modules paths", () => {
    assert.throws(() => assertFilePolicyAllowsPath(path.resolve("node_modules/pkg/index.js"), "node_modules/pkg/index.js"), /node_modules/i);
  });

  it("allows Markdown artifact writes only for .md files", () => {
    assert.throws(() => assertMarkdownArtifactPath(path.resolve("docs/NOTE.txt"), "docs/NOTE.txt"), /\.md/i);
    assert.doesNotThrow(() => assertMarkdownArtifactPath(path.resolve("docs/NOTE.md"), "docs/NOTE.md"));
  });
});
