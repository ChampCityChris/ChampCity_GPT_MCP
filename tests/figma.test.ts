import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { type AppConfig } from "../src/config.js";
import { createCodexUiHandoffPrompt } from "../src/figma/codexUiPrompt.js";
import { fetchFigmaFile } from "../src/figma/figmaClient.js";
import { getFigmaAccessTokenConfig, getFigmaStatus } from "../src/figma/figmaConfig.js";
import { createFigmaHandoffPackage } from "../src/figma/figmaHandoff.js";
import { runFigmaMakeFileHandoff } from "../src/figma/figmaMakeFileHandoff.js";
import { runFigmaMakeHandoff } from "../src/figma/figmaMakeHandoff.js";
import { normalizeFigmaMcpInventory, type FigmaMcpClientLike } from "../src/figma/figmaMcpClient.js";
import { getFigmaMcpConfig, validateFigmaMcpEndpoint } from "../src/figma/figmaMcpConfig.js";
import { classifyFigmaUrl, parseFigmaMakeUrl, parseFigmaUrl } from "../src/figma/figmaUrl.js";
import { scanFiles } from "../src/tools/gitWorkflow/safety.js";
import { fetchFigmaFrameImage } from "../src/tools/figma/index.js";

let tempRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-figma-"));
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    repoRoot: tempRoot,
    allowedRoots: [tempRoot],
    auditLogPath: path.join(tempRoot, "logs", "audit.log"),
    requireGitRoot: false,
    allowedCommands: [],
    writeToolsEnabled: true,
    writeToolsEnabledSource: "local-file",
    writeMode: "docs",
    writeModeSource: "local-file",
    docsWritesAllowed: true,
    patchWritesAllowed: false,
    elevatedOperationsAllowed: false,
    writeApprovalToken: { source: "none" },
    ...overrides
  };
}

function mockFigmaFile() {
  return {
    name: "Dashboard Redesign",
    document: {
      children: [
        {
          name: "Page 1",
          children: [
            {
              id: "1:23",
              name: "Launcher Home",
              type: "FRAME",
              absoluteBoundingBox: { width: 1440, height: 900 },
              fills: [{ type: "SOLID", color: { r: 0.1, g: 0.2, b: 0.3 } }],
              children: [
                {
                  id: "1:24",
                  name: "Heading",
                  type: "TEXT",
                  style: { fontFamily: "Inter", fontSize: 32, fontWeight: 700 }
                }
              ]
            }
          ]
        }
      ]
    },
    components: {
      abc: { name: "Button" }
    },
    componentSets: {
      def: { name: "Input" }
    },
    styles: {
      ghi: { name: "Heading/Large", styleType: "TEXT" }
    }
  };
}

function readAllTextFiles(root: string): string {
  const chunks: string[] = [];
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (/\.(md|txt|json)$/u.test(entry.name)) {
        chunks.push(fs.readFileSync(absolute, "utf8"));
      }
    }
  }
  walk(root);
  return chunks.join("\n");
}

function makeZip(entries: Record<string, string | Buffer>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const [entryPath, rawData] of Object.entries(entries)) {
    const name = Buffer.from(entryPath, "utf8");
    const data = typeof rawData === "string" ? Buffer.from(rawData, "utf8") : rawData;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const centralDirectoryOffset = offset;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(centralDirectoryOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function writeMakeFixture(relativePath = "fixtures/sample.make", extraEntries: Record<string, string | Buffer> = {}): string {
  const makePath = path.join(tempRoot, relativePath);
  fs.mkdirSync(path.dirname(makePath), { recursive: true });
  fs.writeFileSync(
    makePath,
    makeZip({
      "meta.json": JSON.stringify({ name: "Sample Make export", version: 1 }),
      "ai_chat.json": JSON.stringify({
        messages: [
          { id: "m1", role: "user", content: "Create a compact ChampCity GPT UI panel." },
          {
            id: "m2",
            toolName: "write_file",
            filePath: "src/app/App.tsx",
            content: "export function App() { return <main>Make export</main>; }"
          },
          {
            id: "m3",
            toolName: "write_file",
            filePath: "src/styles/fonts.css",
            content: "@font-face { font-family: Inter; src: url('/fonts/inter.woff2'); }"
          },
          {
            id: "m4",
            toolName: "edit_file",
            filePath: "src/theme.ts",
            oldString: "color: old",
            newString: "color: new",
            codeSnapshotKey: "snapshot-missing"
          }
        ],
        versions: [{ key: "v1" }]
      }),
      "make_binary_files.json": JSON.stringify({ files: [{ key: "hero", path: "images/hero.png" }] }),
      "thumbnail.png": Buffer.from("png-thumbnail"),
      "images/hero.png": Buffer.from("png-hero"),
      "make_binary_files/data.bin": Buffer.from([1, 2, 3]),
      "blob_store/blob-1": Buffer.from([4, 5, 6]),
      "canvas.fig": Buffer.from("fig-bytes"),
      ...extraEntries
    })
  );
  return makePath;
}

function testConfigWithRepoRootOutsideAllowedRoot(): { config: AppConfig; cleanup: () => void } {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-figma-runtime-"));
  return {
    config: testConfig({
      repoRoot: runtimeRoot,
      allowedRoots: [tempRoot]
    }),
    cleanup: () => fs.rmSync(runtimeRoot, { recursive: true, force: true })
  };
}

describe("Figma URL parsing", () => {
  it("supports design, file, and proto URLs and normalizes node ids", () => {
    assert.deepEqual(parseFigmaUrl("https://www.figma.com/design/abc123/My-File?node-id=1-23"), {
      fileKey: "abc123",
      nodeId: "1:23",
      urlType: "design"
    });
    assert.equal(parseFigmaUrl("https://www.figma.com/file/fileKey/name?node-id=1%3A23").nodeId, "1:23");
    assert.equal(parseFigmaUrl("https://www.figma.com/proto/protoKey/name").fileKey, "protoKey");
  });

  it("classifies Figma URL families and parses Make project ids without using the design parser", () => {
    const makeUrl = "https://www.figma.com/make/pM2hChX2N0Xge4qhHQ8lzp/Review-attached-code?p=f&t=h5aPXEDXAS8BVU6G-0";

    assert.equal(classifyFigmaUrl("https://www.figma.com/design/abc/name"), "figmaDesign");
    assert.equal(classifyFigmaUrl("https://www.figma.com/file/abc/name"), "figmaFile");
    assert.equal(classifyFigmaUrl("https://www.figma.com/proto/abc/name"), "figmaProto");
    assert.equal(classifyFigmaUrl(makeUrl), "figmaMake");
    assert.equal(classifyFigmaUrl("https://example.com/make/abc/name"), "unsupported");
    assert.deepEqual(parseFigmaMakeUrl(makeUrl), {
      makeProjectId: "pM2hChX2N0Xge4qhHQ8lzp",
      makeUrl,
      slug: "Review-attached-code",
      urlType: "make"
    });
  });

  it("rejects invalid and non-Figma URLs", () => {
    assert.throws(() => parseFigmaUrl("not a url"), /Invalid Figma URL/i);
    assert.throws(() => parseFigmaUrl("https://example.com/design/abc/name"), /figma\.com/i);
  });
});

describe("Figma Make handoff generation", () => {
  const makeUrl = "https://www.figma.com/make/pM2hChX2N0Xge4qhHQ8lzp/Review-attached-code?p=f&t=h5aPXEDXAS8BVU6G-0";

  function mockMcpClient(options: {
    resources?: Array<{ uri: string; name: string; description?: string; mimeType?: string }>;
    resourceText?: Record<string, string>;
    failReads?: string[];
    connectError?: string;
  }): FigmaMcpClientLike {
    return {
      async connect() {
        if (options.connectError) {
          throw new Error(options.connectError);
        }
      },
      async close() {},
      getServerVersion() {
        return { name: "figma", version: "test" };
      },
      getServerCapabilities() {
        return { resources: {} };
      },
      async listResources() {
        return { resources: options.resources ?? [] };
      },
      async listResourceTemplates() {
        return { resourceTemplates: [] };
      },
      async listTools() {
        return { tools: [] };
      },
      async listPrompts() {
        return { prompts: [] };
      },
      async readResource(uri: string) {
        if (options.failReads?.includes(uri)) {
          throw new Error("read failed");
        }

        const text = options.resourceText?.[uri];
        if (text === undefined) {
          throw new Error("missing resource");
        }

        return { contents: [{ uri, mimeType: "text/plain", text }] };
      },
      async callTool() {
        return { content: [] };
      }
    };
  }

  it("fails clearly when the upstream Figma MCP server cannot be reached", async () => {
    const output = await runFigmaMakeHandoff(
      { makeUrl },
      testConfig(),
      { createClient: () => mockMcpClient({ connectError: "ECONNREFUSED" }) }
    );

    assert.equal(output.status, "failed");
    assert.equal(output.urlType, "make");
    assert.equal(output.makeProjectId, "pM2hChX2N0Xge4qhHQ8lzp");
    assert.deepEqual(output.screenshots, []);
    assert.deepEqual(output.resourceFiles, []);
    assert.ok(output.errors.some((error) => /Could not connect to upstream Figma MCP server/i.test(error)));
    assert.ok(fs.existsSync(path.join(tempRoot, "design", "figma-handoff", "make", "extraction-summary.md")));
  });

  it("creates a successful Make handoff package from official Figma MCP resources", async () => {
    const output = await runFigmaMakeHandoff(
      {
        makeUrl,
        targetUiArea: "ChampCity GPT UI",
        implementationScope: "Refresh the launcher Figma handoff panel.",
        notes: "Prefer existing components."
      },
      testConfig(),
      {
        createClient: () =>
          mockMcpClient({
            resources: [
              {
                uri: "figma-make://pM2hChX2N0Xge4qhHQ8lzp/src/App.tsx",
                name: "src/App.tsx",
                description: "Figma Make source file"
              },
              {
                uri: "figma-make://pM2hChX2N0Xge4qhHQ8lzp/src/styles.css",
                name: "src/styles.css",
                description: "Figma Make source file"
              }
            ],
            resourceText: {
              "figma-make://pM2hChX2N0Xge4qhHQ8lzp/src/App.tsx": "export function App() { return <main>Review attached code</main>; }",
              "figma-make://pM2hChX2N0Xge4qhHQ8lzp/src/styles.css": ".app { color: #123456; }"
            }
          })
      }
    );

    assert.equal(output.status, "success");
    assert.equal(output.urlType, "make");
    assert.equal(output.makeProjectId, "pM2hChX2N0Xge4qhHQ8lzp");
    assert.equal(output.handoffDirectory, "design/figma-handoff/make");
    assert.equal(output.codexPromptFile, "docs/handoffs/CODEX_FIGMA_MAKE_UI_HANDOFF.md");
    assert.deepEqual(output.screenshots, []);
    assert.deepEqual(output.resourceFiles, [
      "design/figma-handoff/make/source/src/App.tsx",
      "design/figma-handoff/make/source/src/styles.css"
    ]);
    assert.ok(output.createdFiles.includes("design/figma-handoff/make/source-url.json"));
    assert.ok(output.createdFiles.includes("design/figma-handoff/make/make-project.json"));
    assert.ok(output.createdFiles.includes("design/figma-handoff/make/figma-mcp-connection.json"));
    assert.ok(output.createdFiles.includes("design/figma-handoff/make/figma-mcp-resource-inventory.json"));
    assert.ok(output.createdFiles.includes("design/figma-handoff/make/extracted-resource-inventory.md"));
    assert.ok(output.createdFiles.includes("design/figma-handoff/make/extraction-summary.md"));
    assert.ok(output.createdFiles.includes("design/figma-handoff/make/CODEX_FIGMA_MAKE_UI_HANDOFF.md"));
    assert.ok(output.createdFiles.includes("docs/handoffs/CODEX_FIGMA_MAKE_UI_HANDOFF.md"));

    const source = JSON.parse(fs.readFileSync(path.join(tempRoot, "design", "figma-handoff", "make", "source-url.json"), "utf8")) as {
      makeUrl: string;
    };
    const prompt = fs.readFileSync(path.join(tempRoot, "docs", "handoffs", "CODEX_FIGMA_MAKE_UI_HANDOFF.md"), "utf8");
    const inventory = fs.readFileSync(path.join(tempRoot, "design", "figma-handoff", "make", "extracted-resource-inventory.md"), "utf8");

    assert.equal(source.makeUrl, makeUrl);
    assert.match(prompt, /Figma Make via official Figma MCP resources/i);
    assert.match(prompt, /Inspect the extracted Make files before coding/i);
    assert.match(prompt, /Screenshots are not part of this workflow/i);
    assert.doesNotMatch(prompt, /screenshots\/default-preview\.png/i);
    assert.match(prompt, /Do not modify OAuth, Cloudflare tunnel configuration, MCP authentication, Figma token storage, or server lifecycle/i);
    assert.match(inventory, /src\/App\.tsx/i);
    assert.doesNotMatch(readAllTextFiles(tempRoot), /placeholder-figma-token/u);
  });

  it("creates a partial Make handoff when some official Figma MCP resource reads fail", async () => {
    const output = await runFigmaMakeHandoff(
      {
        makeUrl,
        targetUiArea: "ChampCity GPT UI",
        implementationScope: "Refresh the launcher Figma handoff panel."
      },
      testConfig(),
      {
        createClient: () =>
          mockMcpClient({
            resources: [
              { uri: "figma-make://pM2hChX2N0Xge4qhHQ8lzp/src/App.tsx", name: "src/App.tsx", description: "Figma Make source" },
              { uri: "figma-make://pM2hChX2N0Xge4qhHQ8lzp/src/Missing.tsx", name: "src/Missing.tsx", description: "Figma Make source" }
            ],
            resourceText: {
              "figma-make://pM2hChX2N0Xge4qhHQ8lzp/src/App.tsx": "export const ok = true;"
            },
            failReads: ["figma-make://pM2hChX2N0Xge4qhHQ8lzp/src/Missing.tsx"]
          })
      }
    );

    assert.equal(output.status, "partial");
    assert.deepEqual(output.screenshots, []);
    assert.deepEqual(output.resourceFiles, ["design/figma-handoff/make/source/src/App.tsx"]);
    assert.ok(output.errors.some((error) => /Missing\.tsx/i.test(error)));
  });

  it("does not return success or partial for metadata-only or screenshot-only Make output", async () => {
    const output = await runFigmaMakeHandoff(
      { makeUrl },
      testConfig(),
      {
        createClient: () =>
          mockMcpClient({
            resources: []
          })
      }
    );

    assert.equal(output.status, "failed");
    assert.deepEqual(output.screenshots, []);
    assert.deepEqual(output.resourceFiles, []);
    assert.doesNotMatch(readAllTextFiles(tempRoot), /capture-report|visible-text-inventory|screen-inventory/u);
  });

  it("returns invalid Make URL errors without the old design parser message", async () => {
    const output = await runFigmaMakeHandoff({ makeUrl: "https://www.figma.com/design/fileKey/Dashboard" }, testConfig(), {
      createClient: () => mockMcpClient({})
    });

    assert.equal(output.status, "failed");
    assert.match(output.errors.join("\n"), /Expected a Figma \/make URL/i);
    assert.doesNotMatch(output.errors.join("\n"), /Expected a Figma \/design, \/file, or \/proto URL with a file key/i);
  });

  it("redacts token-looking values from generated Make resources and output", async () => {
    const figmaTokenLike = `figd_${"super_secret_token"}_${"1234567890"}`;
    const output = await runFigmaMakeHandoff(
      { makeUrl, notes: `token ${figmaTokenLike}` },
      testConfig(),
      {
        createClient: () =>
          mockMcpClient({
            resources: [{ uri: "figma-make://pM2hChX2N0Xge4qhHQ8lzp/src/App.tsx", name: "src/App.tsx", description: "Figma Make source" }],
            resourceText: {
              "figma-make://pM2hChX2N0Xge4qhHQ8lzp/src/App.tsx": `const token = '${figmaTokenLike}';`
            }
          })
      }
    );

    assert.equal(output.status, "success");
    assert.doesNotMatch(readAllTextFiles(tempRoot), new RegExp(figmaTokenLike, "u"));
    assert.match(readAllTextFiles(tempRoot), /\[REDACTED_SECRET\]/u);
  });
});

describe("Figma Make file handoff generation", () => {
  it("accepts an absolute .make file path inside the allowed root when repoRoot differs", async () => {
    const makePath = writeMakeFixture();
    const { config, cleanup } = testConfigWithRepoRootOutsideAllowedRoot();
    try {
      const output = await runFigmaMakeFileHandoff({ makeFilePath: makePath }, config);

      assert.equal(output.status, "partial");
      assert.equal(output.makeFilePath, "fixtures/sample.make");
      assert.equal(output.handoffDirectory, "design/figma-handoff/make-file");
      assert.equal(output.codexPromptFile, "docs/handoffs/CODEX_FIGMA_MAKE_FILE_HANDOFF.md");
    } finally {
      cleanup();
    }
  });

  it("accepts a root-relative .make file path inside the allowed root when repoRoot differs", async () => {
    writeMakeFixture();
    const { config, cleanup } = testConfigWithRepoRootOutsideAllowedRoot();
    try {
      const output = await runFigmaMakeFileHandoff({ makeFilePath: "fixtures/sample.make" }, config);

      assert.equal(output.status, "partial");
      assert.equal(output.makeFilePath, "fixtures/sample.make");
      assert.equal(output.handoffDirectory, "design/figma-handoff/make-file");
    } finally {
      cleanup();
    }
  });

  it("accepts .make filenames with spaces", async () => {
    writeMakeFixture("fixtures/Review attached code.make");

    const output = await runFigmaMakeFileHandoff({ makeFilePath: "fixtures/Review attached code.make" }, testConfig());

    assert.equal(output.status, "partial");
    assert.equal(output.makeFilePath, "fixtures/Review attached code.make");
  });

  it("rejects .make file paths outside the allowed root", async () => {
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-make-outside-"));
    try {
      const outsideMake = path.join(outsideRoot, "outside.make");
      fs.writeFileSync(outsideMake, makeZip({ "meta.json": "{}" }));
      const output = await runFigmaMakeFileHandoff({ makeFilePath: outsideMake }, testConfig());

      assert.equal(output.status, "failed");
      assert.match(output.errors.join("\n"), /outside the configured allowed roots/i);
    } finally {
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it("rejects .make file path traversal", async () => {
    const output = await runFigmaMakeFileHandoff({ makeFilePath: "../sample.make" }, testConfig());

    assert.equal(output.status, "failed");
    assert.match(output.errors.join("\n"), /traversal/i);
  });

  it("rejects missing .make files clearly", async () => {
    const output = await runFigmaMakeFileHandoff({ makeFilePath: "missing.make" }, testConfig());

    assert.equal(output.status, "failed");
    assert.match(output.errors.join("\n"), /file not found|cannot be resolved/i);
  });

  it("rejects non-.make file paths clearly", async () => {
    fs.writeFileSync(path.join(tempRoot, "not-make.zip"), "zip", "utf8");

    const output = await runFigmaMakeFileHandoff({ makeFilePath: "not-make.zip" }, testConfig());

    assert.equal(output.status, "failed");
    assert.match(output.errors.join("\n"), /invalid extension|\.make file/i);
  });

  it("rejects absolute outputDirectory", async () => {
    const makePath = writeMakeFixture();

    const output = await runFigmaMakeFileHandoff(
      {
        makeFilePath: makePath,
        outputDirectory: path.join(tempRoot, "design", "figma-handoff", "make-file")
      },
      testConfig()
    );

    assert.equal(output.status, "failed");
    assert.match(output.errors.join("\n"), /outputDirectory must be a relative path/i);
  });

  it("rejects absolute codexPromptFile", async () => {
    const makePath = writeMakeFixture();

    const output = await runFigmaMakeFileHandoff(
      {
        makeFilePath: makePath,
        codexPromptFile: path.join(tempRoot, "docs", "handoffs", "CODEX_FIGMA_MAKE_FILE_HANDOFF.md")
      },
      testConfig()
    );

    assert.equal(output.status, "failed");
    assert.match(output.errors.join("\n"), /codexPromptFile must be a relative path/i);
  });

  it("keeps outputDirectory and codexPromptFile as relative paths", async () => {
    const makePath = writeMakeFixture();

    const output = await runFigmaMakeFileHandoff(
      {
        makeFilePath: makePath,
        outputDirectory: "design\\figma-handoff\\custom make-file",
        codexPromptFile: "docs\\handoffs\\CUSTOM_FIGMA_MAKE_FILE_HANDOFF.md"
      },
      testConfig()
    );

    assert.equal(output.status, "partial");
    assert.equal(output.handoffDirectory, "design/figma-handoff/custom make-file");
    assert.equal(output.codexPromptFile, "docs/handoffs/CUSTOM_FIGMA_MAKE_FILE_HANDOFF.md");
    assert.equal(path.isAbsolute(output.handoffDirectory), false);
    assert.equal(path.isAbsolute(output.codexPromptFile), false);
  });

  it("rejects invalid package inputs clearly", async () => {
    fs.writeFileSync(path.join(tempRoot, "bad.make"), "not a zip", "utf8");
    const invalidZip = await runFigmaMakeFileHandoff({ makeFilePath: "bad.make" }, testConfig());
    assert.equal(invalidZip.status, "failed");
    assert.match(invalidZip.errors.join("\n"), /ZIP-compatible/i);
  });

  it("creates a handoff package, inventories resources, copies assets, parses chat, and reconstructs source", async () => {
    const makePath = writeMakeFixture();
    const output = await runFigmaMakeFileHandoff(
      {
        makeFilePath: makePath,
        targetUiArea: "ChampCity GPT UI",
        implementationScope: "Refresh the local Make handoff panel.",
        notes: "Authorization: Bearer redacted-test-token"
      },
      testConfig()
    );

    assert.equal(output.status, "partial");
    assert.equal(output.sourceType, "figma_make_file");
    assert.equal(output.makeFilePath, "fixtures/sample.make");
    assert.equal(output.handoffDirectory, "design/figma-handoff/make-file");
    assert.equal(output.codexPromptFile, "docs/handoffs/CODEX_FIGMA_MAKE_FILE_HANDOFF.md");
    assert.ok(output.createdFiles.includes("design/figma-handoff/make-file/source-package/original-file-info.json"));
    assert.ok(output.createdFiles.includes("design/figma-handoff/make-file/source-package/package-inventory.json"));
    assert.ok(output.metadataFiles.includes("design/figma-handoff/make-file/reports/extraction-summary.md"));
    assert.ok(output.resourceFiles.includes("design/figma-handoff/make-file/raw/ai_chat.json"));
    assert.ok(output.resourceFiles.includes("design/figma-handoff/make-file/raw/canvas.fig"));
    assert.ok(output.assetFiles.includes("design/figma-handoff/make-file/assets/thumbnail.png"));
    assert.ok(output.assetFiles.includes("design/figma-handoff/make-file/assets/images/hero.png"));
    assert.ok(output.assetFiles.includes("design/figma-handoff/make-file/assets/make_binary_files/data.bin"));
    assert.ok(output.assetFiles.includes("design/figma-handoff/make-file/assets/blob_store/blob-1"));
    assert.deepEqual(output.reconstructedSourceFiles.sort(), [
      "design/figma-handoff/make-file/source/src/app/App.tsx",
      "design/figma-handoff/make-file/source/src/styles/fonts.css"
    ]);

    const appSource = fs.readFileSync(path.join(tempRoot, "design", "figma-handoff", "make-file", "source", "src", "app", "App.tsx"), "utf8");
    const inventory = fs.readFileSync(path.join(tempRoot, "design", "figma-handoff", "make-file", "source-package", "package-inventory.json"), "utf8");
    const reconstructionReport = fs.readFileSync(path.join(tempRoot, "design", "figma-handoff", "make-file", "reports", "reconstruction-report.md"), "utf8");
    const chatSummary = fs.readFileSync(path.join(tempRoot, "design", "figma-handoff", "make-file", "reports", "chat-history-summary.md"), "utf8");
    const assetInventory = fs.readFileSync(path.join(tempRoot, "design", "figma-handoff", "make-file", "reports", "asset-inventory.md"), "utf8");
    const prompt = fs.readFileSync(path.join(tempRoot, "docs", "handoffs", "CODEX_FIGMA_MAKE_FILE_HANDOFF.md"), "utf8");

    assert.match(appSource, /Make export/i);
    assert.match(inventory, /ai_chat\.json/i);
    assert.match(reconstructionReport, /src\/theme\.ts/i);
    assert.match(reconstructionReport, /snapshot-missing/i);
    assert.match(chatSummary, /Messages detected: 4/i);
    assert.match(chatSummary, /write_file/i);
    assert.match(assetInventory, /images\/hero\.png/i);
    assert.match(prompt, /Figma Make \.make export package/i);
    assert.match(prompt, /not a screenshot-based handoff/i);
    assert.match(prompt, /reconstruction-report\.md/i);
    assert.match(prompt, /source\/src\/app\/App\.tsx/i);
    assert.match(prompt, /raw\/ai_chat\.json/i);
    assert.doesNotMatch(prompt, /screenshots\/default-preview\.png/i);
    assert.doesNotMatch(readAllTextFiles(tempRoot), /redacted-test-token/u);
    assert.match(readAllTextFiles(tempRoot), /\[REDACTED_SECRET\]/u);
  });

  it("fails metadata-only packages instead of reporting a useful handoff", async () => {
    const makePath = path.join(tempRoot, "metadata-only.make");
    fs.writeFileSync(makePath, makeZip({ "meta.json": JSON.stringify({ name: "metadata only" }) }));

    const output = await runFigmaMakeFileHandoff({ makeFilePath: makePath }, testConfig());

    assert.equal(output.status, "failed");
    assert.match(output.errors.join("\n") + output.warnings.join("\n") + readAllTextFiles(tempRoot), /no useful non-metadata implementation evidence/i);
  });
});

describe("Figma MCP config and inventory", () => {
  it("validates desktop and remote endpoint configuration", () => {
    assert.equal(validateFigmaMcpEndpoint("http://127.0.0.1:3845/mcp", "desktop"), "http://127.0.0.1:3845/mcp");
    assert.equal(validateFigmaMcpEndpoint("https://mcp.figma.example/mcp", "remote"), "https://mcp.figma.example/mcp");
    assert.throws(() => validateFigmaMcpEndpoint("http://figma.example/mcp", "remote"), /https/i);
    assert.throws(() => validateFigmaMcpEndpoint("https://figma.example/mcp", "desktop"), /localhost/i);
  });

  it("loads default Figma MCP desktop config without using the Figma REST token", () => {
    const config = getFigmaMcpConfig(tempRoot, {});

    assert.equal(config.mode, "desktop");
    assert.equal(config.endpoint, "http://127.0.0.1:3845/mcp");
    assert.equal(config.source, "default");
  });

  it("normalizes Figma MCP inventories and detects Make-capable upstream surfaces", () => {
    const inventory = normalizeFigmaMcpInventory({
      config: { endpoint: "http://127.0.0.1:3845/mcp", mode: "desktop", source: "default" },
      resources: [{ uri: "figma-make://project/src/App.tsx", name: "src/App.tsx", description: "Make file" }],
      resourceTemplates: [],
      tools: [],
      prompts: []
    });

    assert.equal(inventory.resources.length, 1);
    assert.equal(inventory.makeResourceRetrievalAvailable, true);
  });
});

describe("Figma token config", () => {
  it("loads from env before local file and never exposes token in status", () => {
    fs.mkdirSync(path.join(tempRoot, "runtime-config"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "runtime-config", "figma.local.json"), JSON.stringify({ figmaAccessToken: "local-token" }), "utf8");

    const config = getFigmaAccessTokenConfig(tempRoot, {
      CHAMPCITY_GPT_CONFIG_DIR: path.join(tempRoot, "runtime-config"),
      CHAMPCITY_GPT_FIGMA_ACCESS_TOKEN: "env-token"
    });
    const status = getFigmaStatus(tempRoot, {
      CHAMPCITY_GPT_CONFIG_DIR: path.join(tempRoot, "runtime-config"),
      CHAMPCITY_GPT_FIGMA_ACCESS_TOKEN: "env-token"
    });

    assert.equal(config.source, "env");
    assert.equal(config.token, "env-token");
    assert.deepEqual(status, { configured: true, source: "env" });
    assert.equal("token" in status, false);
  });

  it("loads from runtime local file", () => {
    const configDir = path.join(tempRoot, "runtime-config");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "figma.local.json"), JSON.stringify({ figmaAccessToken: "local-token" }), "utf8");

    const config = getFigmaAccessTokenConfig(tempRoot, { CHAMPCITY_GPT_CONFIG_DIR: configDir });

    assert.equal(config.configured, true);
    assert.equal(config.source, "local-file");
    assert.equal(config.token, "local-token");
  });

  it("keeps config/figma.local.json gitignored", () => {
    const ignore = fs.readFileSync(path.join(process.cwd(), ".gitignore"), "utf8");

    assert.match(ignore, /config\/figma\.local\.json/u);
  });
});

describe("Figma API safety", () => {
  it("redacts token text from Figma API errors", async () => {
    const token = `figd_${"super_secret_token"}_${"123456789"}`;
    const fetchImpl = async () => new Response(`bad ${token}`, { status: 500 });

    await assert.rejects(
      () => fetchFigmaFile("fileKey", { token, fetchImpl }),
      (error: unknown) => {
        const serialized = JSON.stringify(error);
        assert.doesNotMatch(serialized, new RegExp(token, "u"));
        assert.match(serialized, /\[REDACTED_FIGMA_TOKEN\]/u);
        return true;
      }
    );
  });
});

describe("Figma handoff generation", () => {
  it("creates expected handoff structure with mocked Figma data and excludes token", async () => {
    const output = await createFigmaHandoffPackage(
      {
        root: tempRoot,
        figmaUrl: "https://www.figma.com/design/fileKey/Dashboard?node-id=1-23",
        targetArea: "launcher dashboard"
      },
      testConfig(),
      {
        token: "placeholder-figma-token",
        fetchFile: async () => mockFigmaFile(),
        fetchImages: async () => ({ images: { "1:23": "https://figma.example/image.png" } }),
        downloadImage: async () => Buffer.from("png-bytes")
      }
    );

    assert.equal(output.handoffDir, "design/figma-handoff");
    assert.ok(output.filesCreated.includes("design/figma-handoff/README_DESIGN_HANDOFF.md"));
    assert.ok(output.filesCreated.includes("design/figma-handoff/specs/screen-map.md"));
    assert.ok(output.filesCreated.includes("design/figma-handoff/tokens/design-tokens.json"));
    assert.deepEqual(output.screenshotsCreated, ["design/figma-handoff/screenshots/launcher-home-1-23.png"]);
    assert.equal(fs.existsSync(path.join(tempRoot, "design", "figma-handoff", "assets")), true);
    assert.doesNotMatch(readAllTextFiles(path.join(tempRoot, "design", "figma-handoff")), /placeholder-figma-token/u);
  });

  it("rejects output paths outside the allowed root", async () => {
    await assert.rejects(
      () =>
        createFigmaHandoffPackage(
          {
            root: tempRoot,
            figmaUrl: "https://www.figma.com/design/fileKey/Dashboard",
            targetArea: "launcher dashboard",
            relativeOutputDir: "../outside"
          },
          testConfig(),
          { token: "secret", fetchFile: async () => mockFigmaFile() }
        ),
      /Path traversal|relative path/i
    );
  });

  it("requires docs, patch, or elevated write mode", async () => {
    await assert.rejects(
      () =>
        createFigmaHandoffPackage(
          {
            root: tempRoot,
            figmaUrl: "https://www.figma.com/design/fileKey/Dashboard",
            targetArea: "launcher dashboard"
          },
          testConfig({ docsWritesAllowed: false, writeMode: "off", writeToolsEnabled: false }),
          { token: "secret", fetchFile: async () => mockFigmaFile() }
        ),
      /writeMode docs, patch, or elevated/i
    );
  });
});

describe("Codex UI handoff prompt", () => {
  it("creates expected Codex implementation prompt", async () => {
    fs.mkdirSync(path.join(tempRoot, "design", "figma-handoff"), { recursive: true });

    const output = await createCodexUiHandoffPrompt(
      {
        root: tempRoot,
        handoffPath: "design/figma-handoff",
        targetFile: "docs/handoffs/CODEX_UI_REDESIGN_HANDOFF.md",
        targetArea: "launcher dashboard"
      },
      testConfig()
    );
    const content = fs.readFileSync(path.join(tempRoot, output.targetFile), "utf8");

    assert.match(content, /use the Figma design handoff package/i);
    assert.match(content, /OAuth, dynamic client registration, PKCE/i);
    assert.match(content, /contextIsolation: true/i);
    assert.match(content, /Do not add Playwright/i);
  });
});

describe("Figma tool write guards", () => {
  it("image writing rejects traversal before any Figma API call", async () => {
    await assert.rejects(
      () =>
        fetchFigmaFrameImage(
          {
            root: tempRoot,
            fileKey: "fileKey",
            nodeId: "1:23",
            format: "png",
            scale: 2,
            relativeOutputPath: "../outside.png"
          },
          testConfig()
        ),
      /Path traversal|relative path/i
    );
  });

  it("image writing requires write mode docs, patch, or elevated", async () => {
    await assert.rejects(
      () =>
        fetchFigmaFrameImage(
          {
            root: tempRoot,
            fileKey: "fileKey",
            nodeId: "1:23",
            format: "png",
            scale: 2,
            relativeOutputPath: "design/frame.png"
          },
          testConfig({ docsWritesAllowed: false, writeMode: "off", writeToolsEnabled: false })
        ),
      /writeMode docs, patch, or elevated/i
    );
  });
});

describe("Figma public safety scanning", () => {
  it("blocks figma.local.json and real-looking figmaAccessToken values", async () => {
    const tokenValue = `${"abcdefghijklmnopqrstuvwxyz"}${"123456"}`;
    fs.mkdirSync(path.join(tempRoot, "config"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "config", "figma.local.json"), "{}\n", "utf8");
    fs.writeFileSync(path.join(tempRoot, "README.md"), `${JSON.stringify({ figmaAccessToken: tokenValue })}\n`, "utf8");

    const localConfigResult = await scanFiles(tempRoot, ["config/figma.local.json"], "paths");
    const tokenResult = await scanFiles(tempRoot, ["README.md"], "paths");

    assert.equal(localConfigResult.safe, false);
    assert.equal(localConfigResult.blockingFindings[0]?.rule, "local-config");
    assert.equal(tokenResult.safe, false);
    assert.ok(tokenResult.blockingFindings.some((finding) => finding.rule === "figma-access-token" || finding.rule === "named-secret"));
  });
});
