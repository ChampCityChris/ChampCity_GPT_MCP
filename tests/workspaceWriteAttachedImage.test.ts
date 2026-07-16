import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { type AppConfig } from "../src/config.js";
import {
  MAX_ATTACHED_IMAGE_BYTES,
  WORKSPACE_WRITE_ATTACHED_IMAGE_TOOL_NAME,
  workspaceWriteAttachedImage
} from "../src/tools/workspaceWriteAttachedImage.js";
import { tools } from "../src/server/registerTools.js";

let tempRoot: string;
let auditRoot: string;
let outsideRoot: string;

const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);
const jpegBytes = Buffer.from([
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xd9
]);
const webpBytes = (() => {
  const data = Buffer.alloc(30);
  data.write("RIFF", 0, "ascii");
  data.writeUInt32LE(22, 4);
  data.write("WEBP", 8, "ascii");
  data.write("VP8X", 12, "ascii");
  data.writeUInt32LE(10, 16);
  return data;
})();

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-image-write-"));
  auditRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-image-write-audit-"));
  outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-image-write-outside-"));
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.rmSync(auditRoot, { recursive: true, force: true });
  fs.rmSync(outsideRoot, { recursive: true, force: true });
});

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const writeMode = overrides.writeMode ?? "docs";
  return {
    repoRoot: tempRoot,
    allowedRoots: [tempRoot],
    workspaces: [{ workspaceId: "fixture_repo", label: "Fixture Repo", root: tempRoot, source: "configured" }],
    defaultWorkspaceId: "fixture_repo",
    auditLogPath: path.join(auditRoot, "audit.log"),
    requireGitRoot: false,
    allowedCommands: [],
    writeToolsEnabled: writeMode !== "off",
    writeToolsEnabledSource: "default",
    writeMode,
    writeModeSource: "default",
    docsWritesAllowed: writeMode === "docs" || writeMode === "patch" || writeMode === "elevated",
    patchWritesAllowed: writeMode === "patch" || writeMode === "elevated",
    elevatedOperationsAllowed: writeMode === "elevated",
    writeApprovalToken: { source: "none" },
    ...overrides
  };
}

function input(relativePath: string, mime_type = "image/png") {
  return {
    workspaceId: "fixture_repo",
    relativePath,
    image: {
      download_url: "https://chatgpt.example.test/temporary-download?token=secret",
      file_id: "file_fixture",
      mime_type,
      file_name: "attached-image"
    }
  };
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

describe("workspace_write_attached_image", () => {
  it("registers top-level ChatGPT file parameter metadata and non-destructive write annotations", () => {
    const tool = tools.find((entry) => entry.name === WORKSPACE_WRITE_ATTACHED_IMAGE_TOOL_NAME) as {
      inputSchema: { properties: Record<string, { properties?: Record<string, unknown>; required?: string[] }> };
      annotations?: Record<string, unknown>;
      _meta?: Record<string, unknown>;
    };

    assert.ok(tool);
    assert.deepEqual(tool._meta?.["openai/fileParams"], ["image"]);
    assert.deepEqual(tool.annotations, {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false
    });
    assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ["image", "relativePath", "workspaceId"]);
    assert.deepEqual(Object.keys(tool.inputSchema.properties.image.properties ?? {}).sort(), [
      "download_url",
      "file_id",
      "file_name",
      "mime_type"
    ]);
    assert.deepEqual(tool.inputSchema.properties.image.required, ["download_url", "file_id"]);
  });

  it("creates PNG, JPEG, and WebP files without altering approved bytes", async () => {
    for (const [relativePath, mimeType, bytes, format] of [
      ["assets/logo.png", "image/png", pngBytes, "png"],
      ["assets/photo.jpg", "image/jpeg", jpegBytes, "jpeg"],
      ["assets/screen.webp", "image/webp", webpBytes, "webp"]
    ] as const) {
      const result = await workspaceWriteAttachedImage(input(relativePath, mimeType), testConfig(), async () => bytes);
      const written = fs.readFileSync(path.join(tempRoot, ...relativePath.split("/")));

      assert.equal(result.status, "created");
      assert.equal(result.relativePath, relativePath);
      assert.equal(result.detectedFormat, format);
      assert.equal(result.bytesWritten, bytes.length);
      assert.equal(result.sha256, sha256(bytes));
      assert.deepEqual(written, bytes);
    }
  });

  it("creates missing parent directories and reports only directories created by the operation", async () => {
    fs.mkdirSync(path.join(tempRoot, "assets"), { recursive: true });

    const result = await workspaceWriteAttachedImage(input("assets/imports/logo.png"), testConfig(), async () => pngBytes);

    assert.equal(result.status, "created");
    assert.deepEqual(result.createdDirectories, ["assets/imports"]);
    assert.equal(fs.existsSync(path.join(tempRoot, "assets", "imports", "logo.png")), true);
  });

  it("rejects extension spoofing, MIME mismatch, non-images, and oversized images", async () => {
    assert.equal((await workspaceWriteAttachedImage(input("bad/photo.jpg", "image/png"), testConfig(), async () => pngBytes)).status, "extension_mismatch");
    assert.equal((await workspaceWriteAttachedImage(input("bad/logo.png", "image/jpeg"), testConfig(), async () => pngBytes)).status, "mime_mismatch");
    assert.equal((await workspaceWriteAttachedImage(input("bad/logo.png"), testConfig(), async () => Buffer.from("<svg></svg>"))).status, "unsupported_image");
    assert.equal((await workspaceWriteAttachedImage(input("bad/huge.png"), testConfig(), async () => Buffer.alloc(MAX_ATTACHED_IMAGE_BYTES + 1))).status, "file_too_large");
  });

  it("rejects excessive dimensions from image headers", async () => {
    const hugePngHeader = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(hugePngHeader, 0);
    hugePngHeader.writeUInt32BE(13, 8);
    hugePngHeader.write("IHDR", 12, "ascii");
    hugePngHeader.writeUInt32BE(20_000, 16);
    hugePngHeader.writeUInt32BE(1, 20);

    const result = await workspaceWriteAttachedImage(input("bad/huge.png"), testConfig(), async () => hugePngHeader);

    assert.equal(result.status, "image_dimensions_rejected");
  });

  it("rejects unsafe destination paths before downloading", async () => {
    for (const relativePath of [
      "../outside.png",
      "src/../../outside.png",
      "C:\\image.png",
      "C:/image.png",
      "\\\\server\\share\\image.png",
      "/image.png",
      "file:///image.png",
      "image.png:ads",
      "CON.png",
      "src/trailing /name.png",
      "src/name.png ",
      "src/\0name.png"
    ]) {
      let downloaded = false;
      const result = await workspaceWriteAttachedImage(input(relativePath), testConfig(), async () => {
        downloaded = true;
        return pngBytes;
      });

      assert.equal(result.status === "invalid_path" || result.status === "path_outside_workspace", true, relativePath);
      assert.equal(downloaded, false, relativePath);
    }
  });

  it("refuses to overwrite an existing destination and leaves existing bytes unchanged", async () => {
    const destination = path.join(tempRoot, "assets", "logo.png");
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, "original", "utf8");

    const result = await workspaceWriteAttachedImage(input("assets/logo.png"), testConfig(), async () => pngBytes);

    assert.equal(result.status, "destination_exists");
    assert.equal(fs.readFileSync(destination, "utf8"), "original");
  });

  it("handles concurrent create attempts as one create and one safe destination_exists conflict", async () => {
    const [first, second] = await Promise.all([
      workspaceWriteAttachedImage(input("assets/race.png"), testConfig(), async () => pngBytes),
      workspaceWriteAttachedImage(input("assets/race.png"), testConfig(), async () => pngBytes)
    ]);

    assert.deepEqual([first.status, second.status].sort(), ["created", "destination_exists"]);
    assert.deepEqual(fs.readFileSync(path.join(tempRoot, "assets", "race.png")), pngBytes);
  });

  it("rejects parent symlinks that escape the workspace when symlink fixtures are supported", async () => {
    const linkPath = path.join(tempRoot, "outside-link");
    try {
      fs.symlinkSync(outsideRoot, linkPath, "dir");
    } catch {
      return;
    }

    const result = await workspaceWriteAttachedImage(input("outside-link/image.png"), testConfig(), async () => pngBytes);

    assert.equal(result.status, "reparse_point_rejected");
    assert.equal(fs.existsSync(path.join(outsideRoot, "image.png")), false);
  });

  it("rejects non-HTTPS ChatGPT download URLs without writing a partial file", async () => {
    const result = await workspaceWriteAttachedImage(
      {
        ...input("assets/logo.png"),
        image: {
          download_url: "http://chatgpt.example.test/file",
          file_id: "file_fixture"
        }
      },
      testConfig()
    );

    assert.equal(result.status, "download_failed");
    assert.equal(fs.existsSync(path.join(tempRoot, "assets", "logo.png")), false);
  });

  it("does not expose the temporary download URL in output or audit logs", async () => {
    const result = await workspaceWriteAttachedImage(input("assets/logo.png"), testConfig(), async () => pngBytes);
    const audit = fs.readFileSync(path.join(auditRoot, "audit.log"), "utf8");

    assert.equal(result.status, "created");
    assert.doesNotMatch(JSON.stringify(result), /temporary-download|secret/u);
    assert.doesNotMatch(audit, /temporary-download|secret/u);
  });

  it("reports workspace_not_writable when local write mode is off", async () => {
    const result = await workspaceWriteAttachedImage(
      input("assets/logo.png"),
      testConfig({ writeMode: "off", writeToolsEnabled: false, docsWritesAllowed: false }),
      async () => pngBytes
    );

    assert.equal(result.status, "workspace_not_writable");
    assert.equal(fs.existsSync(path.join(tempRoot, "assets", "logo.png")), false);
  });
});
