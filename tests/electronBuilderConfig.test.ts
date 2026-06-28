import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("electron builder config", () => {
  it("includes and unpacks the MCP server runtime files", () => {
    const configPath = path.resolve("electron-builder.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      files?: string[];
      asarUnpack?: string[];
    };

    assert.ok(config.files?.includes("dist/**/*"));
    assert.ok(config.asarUnpack?.includes("dist/src/**/*"));
  });

  it("excludes runtime-local config, logs, generated output, and release artifacts", () => {
    const configPath = path.resolve("electron-builder.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      files?: string[];
    };

    assert.ok(config.files?.includes("!config/*.local.json"));
    assert.ok(config.files?.includes("!logs/**/*"));
    assert.ok(config.files?.includes("!generated/**/*"));
    assert.ok(config.files?.includes("!release/**/*"));
  });
});
