import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { type AppConfig } from "../../config.js";
import { createCodexUiHandoffPrompt } from "../../figma/codexUiPrompt.js";
import { downloadFigmaImage, fetchFigmaFile, fetchFigmaImages } from "../../figma/figmaClient.js";
import { requireFigmaAccessToken, getFigmaStatus } from "../../figma/figmaConfig.js";
import { extractFigmaDesignSummary } from "../../figma/figmaExtract.js";
import { createFigmaHandoffPackage } from "../../figma/figmaHandoff.js";
import { runFigmaMakeFileHandoff } from "../../figma/figmaMakeFileHandoff.js";
import { runFigmaMakeHandoff } from "../../figma/figmaMakeHandoff.js";
import { testFigmaMcpConnection } from "../../figma/figmaMcpClient.js";
import { getFigmaMcpConfig, validateFigmaMcpEndpoint, type FigmaMcpMode } from "../../figma/figmaMcpConfig.js";
import { parseFigmaUrl } from "../../figma/figmaUrl.js";
import { assertFilePolicyAllowsPath } from "../../security/filePolicy.js";
import { resolveProjectPath, toRootRelativePath } from "../../security/pathPolicy.js";
import { AppError } from "../../utils/errors.js";
import { assertInsideGitRepo } from "../../utils/git.js";
import { withAudit } from "../common.js";
import { MAX_RELATIVE_PATH_LENGTH, MAX_ROOT_LENGTH } from "../inputLimits.js";

const MAX_FIGMA_URL_LENGTH = 4096;
const MAX_FILE_KEY_LENGTH = 256;
const MAX_NODE_ID_LENGTH = 256;

const EmptyInputSchema = z.object({}).passthrough();
const ParseFigmaUrlInputSchema = z.object({
  url: z.string().min(1).max(MAX_FIGMA_URL_LENGTH)
});
const FetchFigmaFileSummaryInputSchema = z.object({
  fileKey: z.string().min(1).max(MAX_FILE_KEY_LENGTH),
  maxFrames: z.number().int().min(1).max(500).default(100)
});
const FetchFigmaFrameImageInputSchema = z.object({
  root: z.string().min(1).max(MAX_ROOT_LENGTH),
  fileKey: z.string().min(1).max(MAX_FILE_KEY_LENGTH),
  nodeId: z.string().min(1).max(MAX_NODE_ID_LENGTH),
  format: z.enum(["png", "svg"]),
  scale: z.union([z.literal(1), z.literal(2)]).default(2),
  relativeOutputPath: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH),
  overwrite: z.boolean().default(false)
});
const CreateFigmaHandoffPackageInputSchema = z.object({
  root: z.string().min(1).max(MAX_ROOT_LENGTH),
  figmaUrl: z.string().min(1).max(MAX_FIGMA_URL_LENGTH),
  targetArea: z.string().min(1).max(500),
  frameNames: z.array(z.string().min(1).max(300)).max(100).optional(),
  nodeIds: z.array(z.string().min(1).max(MAX_NODE_ID_LENGTH)).max(100).optional(),
  relativeOutputDir: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH).optional(),
  overwrite: z.boolean().default(false)
});
const CreateCodexUiHandoffPromptInputSchema = z.object({
  root: z.string().min(1).max(MAX_ROOT_LENGTH),
  handoffPath: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH),
  targetFile: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH).default("docs/handoffs/CODEX_UI_REDESIGN_HANDOFF.md"),
  targetArea: z.string().min(1).max(500).optional(),
  overwrite: z.boolean().default(false)
});
const RunFigmaMakeHandoffInputSchema = z.object({
  makeUrl: z.string().min(1).max(MAX_FIGMA_URL_LENGTH),
  targetUiArea: z.string().min(1).max(500).default("ChampCity GPT UI"),
  implementationScope: z.string().min(1).max(2000).optional(),
  outputDirectory: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH).default("design/figma-handoff/make"),
  codexPromptFile: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH).default("docs/handoffs/CODEX_FIGMA_MAKE_UI_HANDOFF.md"),
  notes: z.string().max(5000).optional()
});
const RunFigmaMakeFileHandoffInputSchema = z.object({
  makeFilePath: z.string().min(1).max(MAX_ROOT_LENGTH),
  targetUiArea: z.string().min(1).max(500).default("ChampCity GPT UI"),
  implementationScope: z.string().min(1).max(2000).optional(),
  outputDirectory: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH).default("design/figma-handoff/make-file"),
  codexPromptFile: z.string().min(1).max(MAX_RELATIVE_PATH_LENGTH).default("docs/handoffs/CODEX_FIGMA_MAKE_FILE_HANDOFF.md"),
  notes: z.string().max(5000).optional()
});
const TestFigmaMcpConnectionInputSchema = z
  .object({
    endpoint: z.string().url().max(MAX_FIGMA_URL_LENGTH).optional(),
    mode: z.enum(["desktop", "remote"]).optional()
  })
  .optional();

export async function getFigmaStatusTool(rawInput: unknown, config: AppConfig) {
  EmptyInputSchema.parse(rawInput);
  return {
    ...getFigmaStatus(config.repoRoot),
    figmaMcp: getFigmaMcpConfig(config.repoRoot)
  };
}

export async function parseFigmaUrlTool(rawInput: unknown) {
  const input = ParseFigmaUrlInputSchema.parse(rawInput);
  return parseFigmaUrl(input.url);
}

export async function fetchFigmaFileSummary(rawInput: unknown, config: AppConfig) {
  const input = FetchFigmaFileSummaryInputSchema.parse(rawInput);
  const token = requireFigmaAccessToken(config.repoRoot);
  const rawFile = await fetchFigmaFile(input.fileKey, { token });
  const summary = extractFigmaDesignSummary(rawFile, input.maxFrames);
  return {
    fileName: summary.fileName,
    pages: summary.pages,
    topLevelFrames: summary.topLevelFrames,
    componentsCount: summary.components.length,
    componentSetsCount: summary.componentSets.length,
    styles: summary.styles.slice(0, 100),
    stylesCount: summary.styles.length
  };
}

export async function fetchFigmaFrameImage(rawInput: unknown, config: AppConfig) {
  const requestedPath = typeof rawInput === "object" && rawInput !== null ? String((rawInput as { relativeOutputPath?: unknown }).relativeOutputPath ?? "") : undefined;

  return withAudit(config, { toolName: "fetch_figma_frame_image", requestedPath }, async (updateAudit) => {
    const input = FetchFigmaFrameImageInputSchema.parse(rawInput);
    if (!config.docsWritesAllowed) {
      throw new AppError("APPROVAL_REQUIRED", "fetch_figma_frame_image requires writeMode docs, patch, or elevated.");
    }

    const extension = path.extname(input.relativeOutputPath).toLowerCase();
    if (extension !== `.${input.format}`) {
      throw new AppError("INVALID_INPUT", `relativeOutputPath must end in .${input.format}.`);
    }

    const resolved = resolveProjectPath(input.root, input.relativeOutputPath, config.allowedRoots);
    const relativePath = toRootRelativePath(resolved.rootRealPath, resolved.resolvedPath);
    assertFilePolicyAllowsPath(resolved.resolvedPath, relativePath);
    if (config.requireGitRoot) {
      assertInsideGitRepo(resolved.resolvedPath);
    }
    const token = requireFigmaAccessToken(config.repoRoot);

    const exists = await fs.stat(resolved.resolvedPath).then(() => true).catch(() => false);
    if (exists && !input.overwrite) {
      throw new AppError("APPROVAL_REQUIRED", "Refusing to overwrite an existing Figma image unless overwrite is true.", {
        relativePath
      });
    }

    const images = await fetchFigmaImages(input.fileKey, [input.nodeId], input.format, input.scale, { token });
    const imageUrl = images.images?.[input.nodeId];
    if (!imageUrl) {
      throw new AppError("PROCESS_FAILED", "Figma did not return an export URL for the requested frame.");
    }

    const data = await downloadFigmaImage(imageUrl, { token });
    await fs.mkdir(path.dirname(resolved.resolvedPath), { recursive: true });
    const temporaryPath = path.join(path.dirname(resolved.resolvedPath), `.${path.basename(resolved.resolvedPath)}.${process.pid}.${Date.now()}.tmp`);
    await fs.writeFile(temporaryPath, data);
    await fs.rename(temporaryPath, resolved.resolvedPath);
    const sha256 = crypto.createHash("sha256").update(data).digest("hex");
    updateAudit({
      requestedPath: input.relativeOutputPath,
      resolvedPath: resolved.resolvedPath,
      byteCount: data.length
    });
    return {
      relativePath,
      sizeBytes: data.length,
      sha256
    };
  });
}

export async function createFigmaHandoffPackageTool(rawInput: unknown, config: AppConfig) {
  const input = CreateFigmaHandoffPackageInputSchema.parse(rawInput);
  const token = requireFigmaAccessToken(config.repoRoot);
  return withAudit(config, { toolName: "create_figma_handoff_package", requestedPath: input.relativeOutputDir ?? "design/figma-handoff" }, async (updateAudit) => {
    const output = await createFigmaHandoffPackage(input, config, { token });
    updateAudit({
      requestedPath: output.handoffDir,
      byteCount: output.filesCreated.length
    });
    return output;
  });
}

export async function createCodexUiHandoffPromptTool(rawInput: unknown, config: AppConfig) {
  const input = CreateCodexUiHandoffPromptInputSchema.parse(rawInput);
  return withAudit(config, { toolName: "create_codex_ui_handoff_prompt", requestedPath: input.targetFile }, async (updateAudit) => {
    const output = await createCodexUiHandoffPrompt(input, config);
    updateAudit({
      requestedPath: output.targetFile,
      byteCount: output.sizeBytes
    });
    return output;
  });
}

export async function runFigmaMakeHandoffTool(rawInput: unknown, config: AppConfig) {
  const input = RunFigmaMakeHandoffInputSchema.parse(rawInput);
  const requestedPath = input.outputDirectory || "design/figma-handoff/make";
  return withAudit(config, { toolName: "run_figma_make_handoff", requestedPath }, async (updateAudit) => {
    const output = await runFigmaMakeHandoff(input, config);
    updateAudit({
      requestedPath: output.handoffDirectory,
      byteCount: output.createdFiles.length
    });
    return output;
  });
}

export async function runFigmaMakeFileHandoffTool(rawInput: unknown, config: AppConfig) {
  const input = RunFigmaMakeFileHandoffInputSchema.parse(rawInput);
  const requestedPath = input.outputDirectory || "design/figma-handoff/make-file";
  return withAudit(config, { toolName: "run_figma_make_file_handoff", requestedPath }, async (updateAudit) => {
    const output = await runFigmaMakeFileHandoff(input, config);
    updateAudit({
      requestedPath: output.handoffDirectory,
      byteCount: output.createdFiles.length
    });
    return output;
  });
}

export async function testFigmaMcpConnectionTool(rawInput: unknown, config: AppConfig) {
  const input = TestFigmaMcpConnectionInputSchema.parse(rawInput) ?? {};
  const configured = getFigmaMcpConfig(config.repoRoot);
  const figmaMcpConfig =
    input.endpoint || input.mode
      ? {
          endpoint: validateFigmaMcpEndpoint(input.endpoint ?? configured.endpoint, (input.mode ?? configured.mode) as FigmaMcpMode),
          mode: (input.mode ?? configured.mode) as FigmaMcpMode,
          source: configured.source
        }
      : configured;
  return testFigmaMcpConnection(figmaMcpConfig);
}
