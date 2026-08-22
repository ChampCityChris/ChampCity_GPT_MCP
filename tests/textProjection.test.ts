import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { type AppConfig } from "../src/config.js";
import { createToolboxRuntimeContext } from "../src/server/registerTools.js";
import { artifactToolbox, diagnosticsToolbox, repoToolbox } from "../src/tools/domainToolboxes.js";
import { TEXT_PROJECTION_HARD_CONTENT_ITEM_BYTES } from "../src/tools/textProjection.js";

let tempRoot: string;
let auditRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-text-projection-"));
  auditRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-text-projection-audit-"));
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.rmSync(auditRoot, { recursive: true, force: true });
});

function config(): AppConfig {
  return {
    repoRoot: tempRoot,
    allowedRoots: [tempRoot],
    defaultWorkspaceRoot: tempRoot,
    defaultWorkspaceRootSource: "repoRoot",
    auditLogPath: path.join(auditRoot, "audit.log"),
    requireGitRoot: false,
    allowedCommands: [],
    writeToolsEnabled: false,
    writeToolsEnabledSource: "default",
    writeMode: "off",
    writeModeSource: "default",
    docsWritesAllowed: false,
    patchWritesAllowed: false,
    elevatedOperationsAllowed: false,
    writeApprovalToken: { source: "none" }
  };
}

function writeFile(relativePath: string, content: string): void {
  const absolutePath = path.join(tempRoot, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf8");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function categoryCanary(category: string, targetBytes: number): string {
  const benign = [
    `# ${category} benign canary fixture`,
    "",
    "Purpose: deterministic public serializer coverage only; no real PII, secrets, or instructions for wrongdoing.",
    "Education terms: students, minors, teachers, grades, educational records, safeguarding policy.",
    "Medical administration terms: patients, prescriptions, hospital scheduling, pharmacy queue, no treatment advice.",
    "Cybersecurity governance terms: malware policy, incident response, credential rotation, no exploit instructions.",
    "Financial compliance terms: sanctions, suspicious activity, money laundering controls, no evasion guidance.",
    "Violence-prevention policy terms: weapons prohibition, school safety, reporting channels, no operational harm instructions.",
    "Unicode boundary marker: cafe, resume, snowman \u2603, math pi \u03c0, emoji \ud83d\ude80.",
    ""
  ].join("\n");
  let output = benign;
  let counter = 0;
  while (Buffer.byteLength(output, "utf8") < targetBytes) {
    output += `\n## ${category} boundary ${counter}\nNeutral line ${counter} keeps students and patients near chunk boundaries with credential rotation policy and safeguarding review.\n`;
    counter += 1;
  }
  return output;
}

async function readAllChunks(relativePath: string, cfg = config(), maximumBytes = 4096): Promise<{ text: string; chunks: unknown[] }> {
  const context = createToolboxRuntimeContext(cfg, { scope: "files.read" });
  let cursor: string | undefined;
  let text = "";
  const chunks: unknown[] = [];
  do {
    const result = await repoToolbox(
      {
        action: "read_text_chunk",
        params: cursor ? { cursor, maximumBytes } : { relativePath, maximumBytes }
      },
      cfg,
      context
    );
    assert.equal(result.ok, true, JSON.stringify(result.error));
    const content = result.mcpContent as Array<{ type: string; text?: string }>;
    const chunkText = content[1]?.text ?? "";
    assert.ok(Buffer.byteLength(chunkText, "utf8") <= TEXT_PROJECTION_HARD_CONTENT_ITEM_BYTES);
    text += chunkText;
    const metadata = result.structuredContent as { nextCursor?: string | null; complete?: boolean };
    chunks.push(metadata);
    cursor = metadata.nextCursor ?? undefined;
  } while (cursor);
  return { text, chunks };
}

describe("bounded text projection protocol", () => {
  it("inspects Markdown metadata without body text and reports stable heading ranges", async () => {
    const cfg = config();
    const context = createToolboxRuntimeContext(cfg, { scope: "files.read" });
    writeFile("docs/protocol.md", "# Alpha\n\nBody text must not appear in inspect.\n\n## Beta\nNested body.\n# Gamma\n");

    const result = await repoToolbox(
      { action: "inspect_text_file", params: { relativePath: "docs/protocol.md" } },
      cfg,
      context
    );

    assert.equal(result.ok, true);
    const inspect = result.result as {
      contentOmitted?: boolean;
      sourceSha256?: string;
      headingIndex?: Array<{ sectionId: string; startLine: number; endLine: number; text: string }>;
    };
    assert.equal(inspect.contentOmitted, true);
    assert.equal(JSON.stringify(inspect).includes("Body text must not appear"), false);
    assert.equal(inspect.headingIndex?.length, 3);
    assert.ok(inspect.headingIndex?.[0]?.sectionId.startsWith(`sec-${inspect.sourceSha256?.slice(0, 16)}`));
    assert.deepEqual(
      inspect.headingIndex?.map((heading) => [heading.text, heading.startLine, heading.endLine]),
      [["Alpha", 1, 6], ["Beta", 5, 6], ["Gamma", 7, 8]]
    );
  });

  it("chunks and reconstructs canary fixtures exactly across LF, CRLF, and Unicode content", async () => {
    const cases = [
      ["education-4k.md", categoryCanary("education", 4_096).replace(/\n/gu, "\r\n")],
      ["medical-8k.md", categoryCanary("medical administration", 8_192)],
      ["cyber-16k.md", categoryCanary("cybersecurity governance", 16_384)],
      ["finance-32k.md", categoryCanary("financial compliance", 32_768)],
      ["violence-prevention-64k.md", categoryCanary("violence prevention", 65_536)]
    ] as const;

    for (const [relativePath, content] of cases) {
      writeFile(`fixtures/${relativePath}`, content);
      const reconstructed = await readAllChunks(`fixtures/${relativePath}`, config(), 4096);
      assert.equal(reconstructed.text, content);
      assert.equal(sha256(reconstructed.text), sha256(content));
      assert.ok(reconstructed.chunks.length >= 1);
    }
  });

  it("bounds repo read_file and ignores raised maxBytes as a content-item override", async () => {
    const cfg = config();
    const context = createToolboxRuntimeContext(cfg, { scope: "files.read" });
    const content = categoryCanary("mixed neutral long form", 41_389);
    writeFile("planning/revisionary-interview-fixture.md", content);

    const result = await repoToolbox(
      { action: "read_file", params: { relativePath: "planning/revisionary-interview-fixture.md", maxBytes: 500_000 } },
      cfg,
      context
    );

    assert.equal(result.ok, true);
    assert.ok(result.mcpContent);
    const metadata = result.structuredContent as { contentComplete?: boolean; returnedByteCount?: number; nextCursor?: string };
    assert.equal(metadata.contentComplete, false);
    assert.ok(metadata.nextCursor);
    assert.ok((metadata.returnedByteCount ?? 0) <= TEXT_PROJECTION_HARD_CONTENT_ITEM_BYTES);
    assert.equal(JSON.stringify(metadata).includes(content.slice(0, 100)), false);
  });

  it("reads exact line ranges and Markdown sections with deterministic pagination", async () => {
    const cfg = config();
    const context = createToolboxRuntimeContext(cfg, { scope: "files.read" });
    writeFile("docs/sections.md", "# Root\nline 2\n## Child\nline 4\n### Nested\nline 6\n## Peer\nline 8\n");

    const lines = await repoToolbox(
      { action: "read_text_lines", params: { relativePath: "docs/sections.md", startLine: 3, maximumLines: 3 } },
      cfg,
      context
    );
    assert.equal(lines.ok, true);
    assert.equal((lines.mcpContent as Array<{ text?: string }>)[1]?.text, "## Child\nline 4\n### Nested\n");

    const inspect = await repoToolbox({ action: "inspect_text_file", params: { relativePath: "docs/sections.md" } }, cfg, context);
    const child = (inspect.result as { headingIndex: Array<{ text: string; sectionId: string }> }).headingIndex.find((entry) => entry.text === "Child");
    assert.ok(child);
    const section = await repoToolbox(
      { action: "read_markdown_section", params: { relativePath: "docs/sections.md", sectionId: child.sectionId, maximumBytes: 32 } },
      cfg,
      context
    );
    assert.equal(section.ok, true);
    const firstText = (section.mcpContent as Array<{ text?: string }>)[1]?.text ?? "";
    assert.ok(firstText.startsWith("## Child\n"));
    assert.equal(firstText.includes("## Peer"), false);
    const firstMeta = section.structuredContent as { nextCursor?: string | null };
    assert.ok(firstMeta.nextCursor);
    const second = await repoToolbox(
      { action: "read_markdown_section", params: { relativePath: "docs/sections.md", cursor: firstMeta.nextCursor } },
      cfg,
      context
    );
    assert.equal(second.ok, true);
    const combined = firstText + ((second.mcpContent as Array<{ text?: string }>)[1]?.text ?? "");
    assert.equal(combined, "## Child\nline 4\n### Nested\nline 6\n");
  });

  it("keeps line-range continuation inside the original requested range and rejects wrong actions or conflicting identifiers", async () => {
    const cfg = config();
    const context = createToolboxRuntimeContext(cfg, { scope: "files.read" });
    const content = "line-1\nline-2-is-long-enough-to-split\nline-3\nline-4-must-not-return\n";
    writeFile("docs/range.md", content);
    writeFile("docs/other.md", "other\n");

    const first = await repoToolbox(
      { action: "read_text_lines", params: { relativePath: "docs/range.md", startLine: 2, maximumLines: 2, maximumBytes: 12 } },
      cfg,
      context
    );
    assert.equal(first.ok, true, JSON.stringify(first.error));
    const firstMeta = first.structuredContent as { nextCursor?: string; complete?: boolean; returnedLineCount?: number };
    assert.ok(firstMeta.nextCursor);
    const lineCursor = firstMeta.nextCursor;
    assert.equal(firstMeta.complete, false);
    assert.equal(firstMeta.returnedLineCount, 1);

    let cursor: string | undefined = lineCursor;
    let reconstructed = (first.mcpContent as Array<{ text?: string }>)[1]?.text ?? "";
    while (cursor) {
      const next = await repoToolbox(
        { action: "read_text_lines", params: { cursor, maximumBytes: 12 } },
        cfg,
        context
      );
      assert.equal(next.ok, true, JSON.stringify(next.error));
      reconstructed += (next.mcpContent as Array<{ text?: string }>)[1]?.text ?? "";
      cursor = (next.structuredContent as { nextCursor?: string | null }).nextCursor ?? undefined;
    }
    assert.equal(reconstructed, "line-2-is-long-enough-to-split\nline-3\n");
    assert.equal(reconstructed.includes("line-4-must-not-return"), false);

    const repeatedIdentifiers = await repoToolbox(
      { action: "read_text_lines", params: { cursor: lineCursor, relativePath: "docs/range.md", startLine: 2, maximumLines: 2, maximumBytes: 12 } },
      cfg,
      context
    );
    assert.equal(repeatedIdentifiers.ok, true, JSON.stringify(repeatedIdentifiers.error));
    assert.equal((repeatedIdentifiers.mcpContent as Array<{ text?: string }>)[1]?.text, "ng-enough-to");

    const conflictingStartLine = await repoToolbox(
      { action: "read_text_lines", params: { cursor: lineCursor, startLine: 3, maximumBytes: 12 } },
      cfg,
      context
    );
    assert.equal(conflictingStartLine.ok, false);
    assert.equal(conflictingStartLine.error?.details?.classification, "contract_rejection");
    assert.equal(conflictingStartLine.mcpContent, undefined);

    const conflictingMaximumLines = await repoToolbox(
      { action: "read_text_lines", params: { cursor: lineCursor, maximumLines: 3, maximumBytes: 12 } },
      cfg,
      context
    );
    assert.equal(conflictingMaximumLines.ok, false);
    assert.equal(conflictingMaximumLines.error?.details?.classification, "contract_rejection");
    assert.equal(conflictingMaximumLines.mcpContent, undefined);

    const sameHardEndDifferentIdentifiers = await repoToolbox(
      { action: "read_text_lines", params: { cursor: lineCursor, startLine: 1, maximumLines: 3, maximumBytes: 12 } },
      cfg,
      context
    );
    assert.equal(sameHardEndDifferentIdentifiers.ok, false);
    assert.equal(sameHardEndDifferentIdentifiers.error?.details?.classification, "contract_rejection");
    assert.equal(sameHardEndDifferentIdentifiers.mcpContent, undefined);

    const afterRejectedConflict = await repoToolbox(
      { action: "read_text_lines", params: { cursor: lineCursor, maximumBytes: 12 } },
      cfg,
      context
    );
    assert.equal(afterRejectedConflict.ok, true, JSON.stringify(afterRejectedConflict.error));
    assert.equal((afterRejectedConflict.mcpContent as Array<{ text?: string }>)[1]?.text, "ng-enough-to");

    const wrongAction = await repoToolbox(
      { action: "read_text_chunk", params: { cursor: lineCursor } },
      cfg,
      context
    );
    assert.equal(wrongAction.ok, false);
    assert.equal(wrongAction.error?.details?.classification, "contract_rejection");

    const conflictingPath = await repoToolbox(
      { action: "read_text_lines", params: { cursor: lineCursor, relativePath: "docs/other.md", maximumBytes: 12 } },
      cfg,
      context
    );
    assert.equal(conflictingPath.ok, false);
    assert.equal(conflictingPath.error?.details?.classification, "contract_rejection");

    const full = await repoToolbox(
      { action: "read_text_chunk", params: { relativePath: "docs/range.md", maximumBytes: 12 } },
      cfg,
      context
    );
    const fullCursor = (full.structuredContent as { nextCursor?: string }).nextCursor;
    assert.ok(fullCursor);
    const fullAsSection = await repoToolbox(
      { action: "read_markdown_section", params: { cursor: fullCursor } },
      cfg,
      context
    );
    assert.equal(fullAsSection.ok, false);
    assert.equal(fullAsSection.error?.details?.classification, "contract_rejection");
  });

  it("rejects tampered and stale cursors as contract errors", async () => {
    const cfg = config();
    const context = createToolboxRuntimeContext(cfg, { scope: "files.read" });
    writeFile("docs/cursor.md", categoryCanary("cursor", 20_000));
    const first = await repoToolbox(
      { action: "read_text_chunk", params: { relativePath: "docs/cursor.md", maximumBytes: 2048 } },
      cfg,
      context
    );
    const cursor = (first.structuredContent as { nextCursor?: string }).nextCursor;
    assert.ok(cursor);

    const tampered = await repoToolbox(
      { action: "read_text_chunk", params: { cursor: `${cursor.slice(0, -2)}aa` } },
      cfg,
      context
    );
    assert.equal(tampered.ok, false);
    assert.equal(tampered.error?.code, "INVALID_INPUT");

    writeFile("docs/cursor.md", `${categoryCanary("cursor modified", 20_000)}\n`);
    const stale = await repoToolbox(
      { action: "read_text_chunk", params: { cursor } },
      cfg,
      context
    );
    assert.equal(stale.ok, false);
    assert.equal(stale.error?.code, "INVALID_INPUT");
  });

  it("delegates artifact Markdown and planning corpus full-text reads to bounded projection", async () => {
    const cfg = config();
    const context = createToolboxRuntimeContext(cfg, { scope: "files.read" });
    const content = categoryCanary("artifact", 20_000);
    writeFile("planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-TEXT.md", content);
    writeFile("planning/phases/phase-v1.0/Builder_Reports/BUILDER_REPORT_WC-OTHER.md", categoryCanary("artifact other", 20_000));

    const list = await artifactToolbox(
      { action: "list_artifacts", params: { workCardId: "WC-TEXT" } },
      cfg,
      context
    );
    const artifactId = (list.result as { artifacts: Array<{ artifactId: string }> }).artifacts[0]?.artifactId;
    assert.ok(artifactId);

    const inspect = await artifactToolbox(
      { action: "inspect_artifact_text", params: { artifactId } },
      cfg,
      context
    );
    assert.equal(inspect.ok, true);
    assert.equal(JSON.stringify(inspect.result).includes("students and patients near chunk boundaries"), false);

    const read = await artifactToolbox(
      { action: "read_artifact_by_id", params: { artifactId } },
      cfg,
      context
    );
    assert.equal(read.ok, true);
    assert.ok(read.mcpContent);
    assert.equal(JSON.stringify(read.structuredContent).includes(content.slice(0, 100)), false);

    const latest = await artifactToolbox(
      { action: "latest_artifact", params: { workCardId: "WC-TEXT", includeContent: true } },
      cfg,
      context
    );
    assert.equal(latest.ok, true);
    assert.ok(latest.mcpContent);

    const artifactCursor = (read.structuredContent as { nextCursor?: string }).nextCursor;
    assert.ok(artifactCursor);
    const cursorOnly = await artifactToolbox(
      { action: "read_artifact_text_chunk", params: { cursor: artifactCursor, maximumBytes: 1024 } },
      cfg,
      context
    );
    assert.equal(cursorOnly.ok, true, JSON.stringify(cursorOnly.error));
    assert.equal((cursorOnly.structuredContent as { artifact?: { artifactId?: string } }).artifact?.artifactId, artifactId);

    const otherList = await artifactToolbox(
      { action: "list_artifacts", params: { workCardId: "WC-OTHER" } },
      cfg,
      context
    );
    const otherArtifactId = (otherList.result as { artifacts: Array<{ artifactId: string }> }).artifacts[0]?.artifactId;
    assert.ok(otherArtifactId);
    const conflict = await artifactToolbox(
      { action: "read_artifact_text_chunk", params: { artifactId: otherArtifactId, cursor: artifactCursor } },
      cfg,
      context
    );
    assert.equal(conflict.ok, false);
    assert.equal(conflict.error?.details?.classification, "contract_rejection");

    const corpus = await artifactToolbox(
      { action: "export_planning_corpus", params: { includeFullText: true, limit: 5, maxBundleBytes: 100_000 } },
      cfg,
      context
    );
    assert.equal(corpus.ok, true);
    assert.ok(corpus.mcpContent);
    assert.ok((corpus.mcpContent as Array<{ text?: string }>).some((entry) => entry.text?.includes("# artifact benign canary fixture")));
    const fullText = (corpus.result as { fullText?: Array<Record<string, unknown>> }).fullText ?? [];
    assert.equal(fullText.some((entry) => "content" in entry), false);
    assert.ok(fullText.some((entry) => entry.readStatus === "bounded_projection"));
  });

  it("reports complete toolbox contracts and fixed unsupported-action alternatives", async () => {
    const cfg = config();
    const context = createToolboxRuntimeContext(cfg, { scope: "files.read" });
    const inventory = await diagnosticsToolbox({ action: "mcp_tool_inventory" }, cfg, context);
    assert.equal(inventory.ok, true);
    const actions = (inventory.result as { data?: { toolboxActions?: Record<string, string[]>; toolboxActionContracts?: unknown[] } }).data?.toolboxActions;
    assert.deepEqual(Object.keys(actions ?? {}).sort(), [
      "artifact_toolbox",
      "browser_toolbox",
      "diagnostics_toolbox",
      "git_toolbox",
      "integration_toolbox",
      "knowledge_toolbox",
      "repo_toolbox"
    ]);
    assert.ok(actions?.repo_toolbox.includes("inspect_text_file"));
    assert.ok(actions?.artifact_toolbox.includes("read_artifact_text_chunk"));

    const describe = await diagnosticsToolbox(
      { action: "describe_toolbox_action", params: { toolboxName: "repo_toolbox", actionName: "read_text_chunk" } },
      cfg,
      context
    );
    assert.equal(describe.ok, true);
    assert.equal((describe.result as { contract?: { responseSerializerMode?: string } }).contract?.responseSerializerMode, "bounded-text-v1");

    const unsupported = await artifactToolbox({ action: "read_markdown_artifact" }, cfg, context);
    assert.equal(unsupported.ok, false);
    assert.equal(unsupported.error?.details?.classification, "contract_rejection");
    assert.ok(JSON.stringify(unsupported.error?.details).includes("inspect_text_file"));
  });
});
