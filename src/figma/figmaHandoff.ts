import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { type AppConfig } from "../config.js";
import { assertFilePolicyAllowsPath } from "../security/filePolicy.js";
import { resolveProjectPath, toRootRelativePath } from "../security/pathPolicy.js";
import { assertInsideGitRepo } from "../utils/git.js";
import { AppError } from "../utils/errors.js";
import { downloadFigmaImage, fetchFigmaFile, fetchFigmaImages, type FigmaImagesResponse } from "./figmaClient.js";
import { extractFigmaDesignSummary, type FigmaDesignSummary, type FigmaFrameSummary } from "./figmaExtract.js";
import { parseFigmaUrl } from "./figmaUrl.js";

export interface CreateFigmaHandoffPackageInput {
  root: string;
  figmaUrl: string;
  targetArea: string;
  frameNames?: string[];
  nodeIds?: string[];
  relativeOutputDir?: string;
  overwrite?: boolean;
}

export interface CreateFigmaHandoffPackageOutput {
  handoffDir: string;
  filesCreated: string[];
  screenshotsCreated: string[];
  warnings: string[];
}

export interface FigmaHandoffDependencies {
  token: string;
  fetchFile?: typeof fetchFigmaFile;
  fetchImages?: typeof fetchFigmaImages;
  downloadImage?: typeof downloadFigmaImage;
}

interface SafeWriteResult {
  relativePath: string;
  sizeBytes: number;
  sha256: string;
}

const DEFAULT_OUTPUT_DIR = "design/figma-handoff";

function slug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return normalized || "figma-node";
}

function ensureDocsWriteMode(config: AppConfig, toolName: string): void {
  if (!config.docsWritesAllowed) {
    throw new AppError("APPROVAL_REQUIRED", `${toolName} requires writeMode docs, patch, or elevated.`);
  }
}

async function exists(filePath: string): Promise<boolean> {
  return fs.stat(filePath).then(() => true).catch(() => false);
}

async function safeWrite(root: string, relativePath: string, data: string | Buffer, config: AppConfig, overwrite: boolean): Promise<SafeWriteResult> {
  const resolved = resolveProjectPath(root, relativePath, config.allowedRoots);
  const normalizedRelativePath = toRootRelativePath(resolved.rootRealPath, resolved.resolvedPath);
  assertFilePolicyAllowsPath(resolved.resolvedPath, normalizedRelativePath);
  if (config.requireGitRoot) {
    assertInsideGitRepo(resolved.resolvedPath);
  }

  if ((await exists(resolved.resolvedPath)) && !overwrite) {
    throw new AppError("APPROVAL_REQUIRED", "Refusing to overwrite an existing Figma handoff file unless overwrite is true.", {
      relativePath: normalizedRelativePath
    });
  }

  await fs.mkdir(path.dirname(resolved.resolvedPath), { recursive: true });
  const temporaryPath = path.join(path.dirname(resolved.resolvedPath), `.${path.basename(resolved.resolvedPath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(temporaryPath, data);
  await fs.rename(temporaryPath, resolved.resolvedPath);
  const buffer = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return {
    relativePath: normalizedRelativePath,
    sizeBytes: buffer.length,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex")
  };
}

function selectFrames(summary: FigmaDesignSummary, input: CreateFigmaHandoffPackageInput, parsedNodeId: string | null): FigmaFrameSummary[] {
  const requestedIds = new Set([...(input.nodeIds ?? []), parsedNodeId].filter((entry): entry is string => Boolean(entry)));
  const requestedNames = new Set((input.frameNames ?? []).map((entry) => entry.toLowerCase()));
  const frames: FigmaFrameSummary[] = [];

  for (const frame of summary.topLevelFrames) {
    if (requestedIds.has(frame.nodeId) || requestedNames.has(frame.name.toLowerCase())) {
      frames.push(frame);
    }
  }

  for (const nodeId of requestedIds) {
    if (!frames.some((frame) => frame.nodeId === nodeId)) {
      frames.push({ name: nodeId, nodeId });
    }
  }

  return frames;
}

function markdownList(values: string[], fallback: string): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join("\n") : `- TODO: ${fallback}`;
}

function frameList(frames: FigmaFrameSummary[]): string {
  if (frames.length === 0) {
    return "- TODO: Select target frames or pass nodeIds.";
  }

  return frames
    .map((frame) => `- ${frame.name} (${frame.nodeId})${frame.pageName ? ` on ${frame.pageName}` : ""}${frame.width && frame.height ? ` - ${frame.width}x${frame.height}` : ""}`)
    .join("\n");
}

function buildDocs(summary: FigmaDesignSummary, input: CreateFigmaHandoffPackageInput, selectedFrames: FigmaFrameSummary[], figmaUrl: string): Record<string, string> {
  const targetArea = input.targetArea.trim();
  return {
    "README_DESIGN_HANDOFF.md": `# Figma Design Handoff

Source: ${figmaUrl}
Target area: ${targetArea}
Figma file: ${summary.fileName}

Use this package as design context. Screenshots and metadata may come from a private Figma file; review before committing.
`,
    "figma-link.txt": `${figmaUrl}\n`,
    "specs/screen-map.md": `# Screen Map

## Pages
${markdownList(summary.pages, "List pages from Figma.")}

## Selected Frames
${frameList(selectedFrames)}
`,
    "specs/component-inventory.md": `# Component Inventory

## Components
${markdownList(summary.components.slice(0, 100).map((entry) => `${entry.name} (${entry.key})`), "Inventory components.")}

## Component Sets
${markdownList(summary.componentSets.slice(0, 100).map((entry) => `${entry.name} (${entry.key})`), "Inventory component sets.")}
`,
    "specs/interaction-notes.md": `# Interaction Notes

- TODO: Review prototype flows, hover states, focus states, validation states, and empty/loading/error states.
- TODO: Confirm responsive behavior for ${targetArea}.
`,
    "specs/implementation-notes.md": `# Implementation Notes

- Target area: ${targetArea}
- Use screenshots in ../screenshots as visual authority when present.
- Preserve existing app security behavior and avoid backend rewrites unless UI wiring requires them.
- TODO: Map Figma components to existing code components.
- TODO: Fill any spacing, motion, and responsive details not represented in REST metadata.
`,
    "specs/acceptance-criteria.md": `# Acceptance Criteria

- Implement the selected UI area to match the Figma handoff package.
- Preserve existing MCP/OAuth/write-mode behavior.
- Keep Electron contextIsolation true and nodeIntegration false.
- Run build, tests, typecheck, lint, audit, and relevant release checks.
- Report changed files and validation results.
`,
    "tokens/design-tokens.json": `${JSON.stringify(
      {
        source: "figma-rest-api",
        fileName: summary.fileName,
        colors: summary.colorFills,
        textStyles: summary.textStyles,
        styles: summary.styles,
        todos: summary.colorFills.length === 0 || summary.textStyles.length === 0 ? ["Confirm complete design tokens manually from Figma if REST metadata is incomplete."] : []
      },
      null,
      2
    )}\n`
  };
}

export async function createFigmaHandoffPackage(
  input: CreateFigmaHandoffPackageInput,
  config: AppConfig,
  deps: FigmaHandoffDependencies
): Promise<CreateFigmaHandoffPackageOutput> {
  ensureDocsWriteMode(config, "create_figma_handoff_package");
  const relativeOutputDir = input.relativeOutputDir?.trim() || DEFAULT_OUTPUT_DIR;
  const parsedUrl = parseFigmaUrl(input.figmaUrl);
  const fetchFile = deps.fetchFile ?? fetchFigmaFile;
  const fetchImages = deps.fetchImages ?? fetchFigmaImages;
  const downloadImage = deps.downloadImage ?? downloadFigmaImage;
  const warnings: string[] = [];
  const filesCreated: string[] = [];
  const screenshotsCreated: string[] = [];
  const rawFile = await fetchFile(parsedUrl.fileKey, { token: deps.token });
  const summary = extractFigmaDesignSummary(rawFile);
  const selectedFrames = selectFrames(summary, input, parsedUrl.nodeId);
  const docs = buildDocs(summary, input, selectedFrames, input.figmaUrl);

  for (const [relativePath, content] of Object.entries(docs)) {
    const result = await safeWrite(input.root, path.join(relativeOutputDir, relativePath), content, config, input.overwrite === true);
    filesCreated.push(result.relativePath);
  }

  if (selectedFrames.length > 0) {
    let imageResponse: FigmaImagesResponse | undefined;
    try {
      imageResponse = await fetchImages(parsedUrl.fileKey, selectedFrames.map((frame) => frame.nodeId), "png", 2, { token: deps.token });
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }

    for (const frame of selectedFrames) {
      const imageUrl = imageResponse?.images?.[frame.nodeId];
      if (!imageUrl) {
        warnings.push(`TODO: No screenshot export URL returned for ${frame.name} (${frame.nodeId}).`);
        continue;
      }

      const image = await downloadImage(imageUrl, { token: deps.token });
      const screenshotPath = path.join(relativeOutputDir, "screenshots", `${slug(frame.name)}-${slug(frame.nodeId)}.png`);
      const result = await safeWrite(input.root, screenshotPath, image, config, input.overwrite === true);
      filesCreated.push(result.relativePath);
      screenshotsCreated.push(result.relativePath);
    }
  } else {
    warnings.push("TODO: No selected frames were found for screenshot export.");
  }

  await fs.mkdir(path.join(resolveProjectPath(input.root, relativeOutputDir, config.allowedRoots).resolvedPath, "assets"), { recursive: true });
  await fs.mkdir(path.join(resolveProjectPath(input.root, relativeOutputDir, config.allowedRoots).resolvedPath, "screenshots"), { recursive: true });

  return {
    handoffDir: toRootRelativePath(resolveProjectPath(input.root, relativeOutputDir, config.allowedRoots).rootRealPath, resolveProjectPath(input.root, relativeOutputDir, config.allowedRoots).resolvedPath),
    filesCreated,
    screenshotsCreated,
    warnings
  };
}
