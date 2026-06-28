import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { type AppConfig } from "../config.js";
import { assertFilePolicyAllowsPath } from "../security/filePolicy.js";
import { resolveProjectPath, toRootRelativePath } from "../security/pathPolicy.js";
import { AppError } from "../utils/errors.js";
import { assertInsideGitRepo } from "../utils/git.js";
import {
  redactSecrets,
  retrieveFigmaMakeResources,
  safeResourceFileName,
  type FigmaMcpClientDeps,
  type FigmaMcpExtractionResult,
  type RetrievedFigmaMcpResource
} from "./figmaMcpClient.js";
import { type FigmaMcpConfig, getFigmaMcpConfig } from "./figmaMcpConfig.js";
import { parseFigmaMakeUrl, type ParsedFigmaMakeUrl } from "./figmaUrl.js";

export interface RunFigmaMakeHandoffInput {
  makeUrl: string;
  targetUiArea?: string;
  implementationScope?: string;
  outputDirectory?: string;
  codexPromptFile?: string;
  notes?: string;
}

export type FigmaMakeHandoffStatus = "success" | "partial" | "failed";

export interface RunFigmaMakeHandoffOutput {
  status: FigmaMakeHandoffStatus;
  urlType: "make";
  makeProjectId: string;
  makeUrl: string;
  handoffDirectory: string;
  codexPromptFile: string;
  createdFiles: string[];
  screenshots: string[];
  metadataFiles: string[];
  resourceFiles: string[];
  warnings: string[];
  errors: string[];
}

interface SafeWriteResult {
  relativePath: string;
  sizeBytes: number;
  sha256: string;
}

interface WrittenResource {
  resource: RetrievedFigmaMcpResource;
  localPath: string;
  sizeBytes: number;
  sha256: string;
}

const DEFAULT_TARGET_UI_AREA = "ChampCity GPT UI";
const DEFAULT_OUTPUT_DIRECTORY = "design/figma-handoff/make";
const DEFAULT_CODEX_PROMPT_FILE = "docs/handoffs/CODEX_FIGMA_MAKE_UI_HANDOFF.md";
const PACKAGE_PROMPT_FILE = "CODEX_FIGMA_MAKE_UI_HANDOFF.md";

function ensureDocsWriteMode(config: AppConfig): void {
  if (!config.docsWritesAllowed) {
    throw new AppError("APPROVAL_REQUIRED", "run_figma_make_handoff requires writeMode docs, patch, or elevated.");
  }
}

async function safeWrite(root: string, relativePath: string, data: string | Buffer, config: AppConfig): Promise<SafeWriteResult> {
  const resolved = resolveProjectPath(root, relativePath, config.allowedRoots);
  const normalizedRelativePath = toRootRelativePath(resolved.rootRealPath, resolved.resolvedPath);
  assertFilePolicyAllowsPath(resolved.resolvedPath, normalizedRelativePath);
  if (config.requireGitRoot) {
    assertInsideGitRepo(resolved.resolvedPath);
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

function outputBase(input: RunFigmaMakeHandoffInput, parsed?: ParsedFigmaMakeUrl): RunFigmaMakeHandoffOutput {
  return {
    status: "failed",
    urlType: "make",
    makeProjectId: parsed?.makeProjectId ?? "",
    makeUrl: parsed?.makeUrl ?? input.makeUrl,
    handoffDirectory: input.outputDirectory?.trim() || DEFAULT_OUTPUT_DIRECTORY,
    codexPromptFile: input.codexPromptFile?.trim() || DEFAULT_CODEX_PROMPT_FILE,
    createdFiles: [],
    screenshots: [],
    metadataFiles: [],
    resourceFiles: [],
    warnings: [],
    errors: []
  };
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/gu, "/");
}

function listPaths(paths: string[], fallback: string): string {
  return paths.length > 0 ? paths.map((entry) => `- \`${entry}\``).join("\n") : `- ${fallback}`;
}

function uniqueStrings(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = redactSecrets(value).replace(/\s+/gu, " ").trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    output.push(trimmed);
    if (output.length >= limit) {
      break;
    }
  }
  return output;
}

function statusForExtraction(extraction: FigmaMcpExtractionResult): FigmaMakeHandoffStatus {
  if (extraction.resources.length === 0) {
    return "failed";
  }

  return extraction.failedResources.length > 0 || extraction.errors.length > 0 ? "partial" : "success";
}

function buildSourceUrlJson(options: {
  parsed: ParsedFigmaMakeUrl;
  capturedAt: string;
  mcpConfig: FigmaMcpConfig;
}): string {
  return `${JSON.stringify(
    {
      sourceType: "figma-make-official-figma-mcp-resources",
      makeUrl: options.parsed.makeUrl,
      makeProjectId: options.parsed.makeProjectId,
      preservedQuery: new URL(options.parsed.makeUrl).search,
      retrievedAt: options.capturedAt,
      upstreamFigmaMcpMode: options.mcpConfig.mode
    },
    null,
    2
  )}\n`;
}

function buildMakeProjectJson(options: {
  parsed: ParsedFigmaMakeUrl;
  targetUiArea: string;
  implementationScope: string;
  notes: string;
  status: FigmaMakeHandoffStatus;
  resourceFiles: string[];
  mcpConfig: FigmaMcpConfig;
}): string {
  return `${JSON.stringify(
    {
      sourceType: "figma-make-official-figma-mcp-resources",
      makeProjectId: options.parsed.makeProjectId,
      slug: options.parsed.slug,
      makeUrl: options.parsed.makeUrl,
      targetUiArea: options.targetUiArea,
      implementationScope: options.implementationScope,
      notes: options.notes,
      upstreamFigmaMcp: {
        mode: options.mcpConfig.mode,
        endpoint: options.mcpConfig.endpoint,
        source: options.mcpConfig.source
      },
      extractionStatus: options.status,
      resourceFiles: options.resourceFiles,
      screenshots: []
    },
    null,
    2
  )}\n`;
}

function buildConnectionJson(options: {
  mcpConfig: FigmaMcpConfig;
  extraction: FigmaMcpExtractionResult;
  status: FigmaMakeHandoffStatus;
}): string {
  return `${JSON.stringify(
    {
      endpoint: options.mcpConfig.endpoint,
      mode: options.mcpConfig.mode,
      source: options.mcpConfig.source,
      connectionStatus: options.extraction.errors.some((error) => /could not connect/i.test(error)) ? "failed" : "reachable",
      authStatus: options.extraction.errors.some((error) => /401|403|unauthorized|forbidden/i.test(error)) ? "required-or-expired" : "unknown",
      makeResourceRetrievalAvailable: options.extraction.inventory.makeResourceRetrievalAvailable,
      extractionStatus: options.status,
      serverVersion: options.extraction.inventory.serverVersion,
      serverCapabilities: options.extraction.inventory.serverCapabilities
    },
    null,
    2
  )}\n`;
}

function buildResourceInventoryJson(options: {
  extraction: FigmaMcpExtractionResult;
  writtenResources: WrittenResource[];
}): string {
  return `${JSON.stringify(
    {
      inventory: options.extraction.inventory,
      retrievedResources: options.writtenResources.map((entry) => ({
        uri: entry.resource.uri,
        mimeType: entry.resource.mimeType,
        kind: entry.resource.kind,
        source: entry.resource.source,
        localPath: entry.localPath,
        sizeBytes: entry.sizeBytes,
        sha256: entry.sha256
      })),
      failedResources: options.extraction.failedResources
    },
    null,
    2
  )}\n`;
}

function buildExtractedResourceInventoryMd(options: {
  parsed: ParsedFigmaMakeUrl;
  mcpConfig: FigmaMcpConfig;
  writtenResources: WrittenResource[];
  failedResources: FigmaMcpExtractionResult["failedResources"];
}): string {
  const resourceLines = options.writtenResources.map(
    (entry) => `- \`${entry.localPath}\` (${entry.resource.kind}, ${entry.resource.mimeType ?? "unknown mime"}, ${entry.sizeBytes} bytes) from \`${entry.resource.uri}\``
  );
  const failedLines = options.failedResources.map((entry) => `- \`${entry.uri}\`: ${entry.error}`);

  return `# Extracted Figma Make Resource Inventory

Source type: Figma Make via official Figma MCP resources
Make URL: ${options.parsed.makeUrl}
Make project id: ${options.parsed.makeProjectId}
Upstream Figma MCP mode: ${options.mcpConfig.mode}
Upstream Figma MCP endpoint: ${options.mcpConfig.endpoint}

## Retrieved Files

${resourceLines.length > 0 ? resourceLines.join("\n") : "- No resources were retrieved."}

## Failed Resource Reads

${failedLines.length > 0 ? failedLines.join("\n") : "- None."}
`;
}

function buildExtractionSummary(options: {
  parsed: ParsedFigmaMakeUrl;
  mcpConfig: FigmaMcpConfig;
  targetUiArea: string;
  status: FigmaMakeHandoffStatus;
  extraction: FigmaMcpExtractionResult;
  resourceFiles: string[];
  warnings: string[];
  errors: string[];
  retrievedAt: string;
}): string {
  return `# Figma Make Extraction Summary

Source type: Figma Make via official Figma MCP resources
Make URL: ${options.parsed.makeUrl}
Make project id: ${options.parsed.makeProjectId}
Target UI area: ${options.targetUiArea}
Retrieved at: ${options.retrievedAt}
Upstream Figma MCP mode: ${options.mcpConfig.mode}
Upstream Figma MCP endpoint: ${options.mcpConfig.endpoint}
Status: ${options.status}

## Resource Retrieval

- Official Figma MCP resources/files retrieved: ${options.resourceFiles.length}
- Screenshot capture attempted: no
- Browser scraping attempted: no
- Network scraping attempted: no
- Clipboard automation attempted: no
- Metadata-only output accepted as success: no

## Resource Files

${listPaths(options.resourceFiles, "No resource files were retrieved. This is a failed Make handoff, not a usable partial package.")}

## Inventory Counts

- Listed resources: ${options.extraction.inventory.resources.length}
- Listed resource templates: ${options.extraction.inventory.resourceTemplates.length}
- Listed tools: ${options.extraction.inventory.tools.length}
- Listed prompts: ${options.extraction.inventory.prompts.length}
- Make retrieval availability signal: ${options.extraction.inventory.makeResourceRetrievalAvailable ? "yes" : "unknown/no"}

## Warnings

${options.warnings.length > 0 ? options.warnings.map((warning) => `- ${warning}`).join("\n") : "- None."}

## Errors

${options.errors.length > 0 ? options.errors.map((error) => `- ${error}`).join("\n") : "- None."}
`;
}

function buildCodexPrompt(options: {
  parsed: ParsedFigmaMakeUrl;
  targetUiArea: string;
  implementationScope: string;
  handoffDirectory: string;
  codexPromptFile: string;
  mcpConfig: FigmaMcpConfig;
  resourceInventoryPath: string;
  resourceFiles: string[];
  createdFiles: string[];
  metadataFiles: string[];
  warnings: string[];
  notes: string;
}): string {
  return `# Codex Figma Make UI Handoff

You are Codex implementing a UI change from extracted Figma Make resources.

Before editing files, verify the repository path and confirm you are working in the intended ChampCity GPT MCP app checkout.

## Source

- Source type: Figma Make via official Figma MCP resources
- Original Make URL: ${options.parsed.makeUrl}
- Make project id: ${options.parsed.makeProjectId}
- Upstream Figma MCP mode used: ${options.mcpConfig.mode}
- Target UI area: ${options.targetUiArea}
- Implementation scope: ${options.implementationScope}
- Handoff package: \`${options.handoffDirectory}\`
- Prompt file: \`${options.codexPromptFile}\`
- Extracted resource inventory: \`${options.resourceInventoryPath}\`

## Extracted Make Files

${listPaths(options.resourceFiles, "No extracted Make resources are available. Stop and report the blocker instead of implementing from metadata.")}

## Generated Artifacts

Metadata:
${listPaths(options.metadataFiles, "No metadata files were generated.")}

Created files:
${listPaths(options.createdFiles, "No files were generated.")}

## Extraction Notes

${options.warnings.length > 0 ? options.warnings.map((warning) => `- ${warning}`).join("\n") : "- None."}

## Implementation Instructions

- Inspect the extracted Make files before coding.
- Do not rely on screenshots.
- Screenshots are not part of this workflow.
- Preserve existing functionality.
- Avoid broad refactors.
- Keep changes scoped to ${options.targetUiArea}.
- Verify the repo path before changing files.
- Do not modify OAuth, Cloudflare tunnel configuration, MCP authentication, Figma token storage, or server lifecycle unless specifically in scope.
- Do not expose, log, or write Figma tokens, session cookies, auth headers, or local secrets.
- If the extracted files are incomplete, report the limitation clearly instead of guessing.

## Validation And Final Report

- Run the relevant build, typecheck, and tests for the files you changed.
- Report files changed.
- Report validation commands and results.
- Report any remaining extraction gaps.

## User Notes

${options.notes || "No additional notes provided."}
`;
}

function dedupeResourceFiles(resources: RetrievedFigmaMcpResource[]): RetrievedFigmaMcpResource[] {
  const seen = new Set<string>();
  const output: RetrievedFigmaMcpResource[] = [];
  for (const resource of resources) {
    const dataKey = Buffer.isBuffer(resource.data) ? resource.data.toString("base64") : resource.data;
    const key = `${resource.uri}:${resource.kind}:${dataKey}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(resource);
  }
  return output;
}

export async function runFigmaMakeHandoff(
  input: RunFigmaMakeHandoffInput,
  config: AppConfig,
  deps: FigmaMcpClientDeps = {}
): Promise<RunFigmaMakeHandoffOutput> {
  ensureDocsWriteMode(config);

  let parsed: ParsedFigmaMakeUrl;
  try {
    parsed = parseFigmaMakeUrl(input.makeUrl);
  } catch (error) {
    const output = outputBase(input);
    output.errors.push(error instanceof Error ? error.message : String(error));
    return output;
  }

  const output = outputBase(input, parsed);
  const targetUiArea = input.targetUiArea?.trim() || DEFAULT_TARGET_UI_AREA;
  const implementationScope = input.implementationScope?.trim() || "Implement the UI indicated by the extracted Figma Make resources.";
  const outputDirectory = input.outputDirectory?.trim() || DEFAULT_OUTPUT_DIRECTORY;
  const codexPromptFile = input.codexPromptFile?.trim() || DEFAULT_CODEX_PROMPT_FILE;
  const notes = redactSecrets(input.notes?.trim() || "");
  const retrievedAt = new Date().toISOString();
  const mcpConfig = getFigmaMcpConfig(config.repoRoot);

  try {
    await fs.mkdir(resolveProjectPath(config.repoRoot, path.join(outputDirectory, "source"), config.allowedRoots).resolvedPath, { recursive: true });

    const extraction = await retrieveFigmaMakeResources(mcpConfig, parsed, deps);
    const resources = dedupeResourceFiles(extraction.resources);
    const writtenResources: WrittenResource[] = [];

    for (let index = 0; index < resources.length; index += 1) {
      const resource = resources[index]!;
      const safeName = safeResourceFileName(resource, index);
      const relativePath = path.join(outputDirectory, "source", safeName);
      const data = typeof resource.data === "string" ? redactSecrets(resource.data) : resource.data;
      const result = await safeWrite(config.repoRoot, relativePath, data, config);
      output.createdFiles.push(result.relativePath);
      output.resourceFiles.push(result.relativePath);
      writtenResources.push({
        resource,
        localPath: result.relativePath,
        sizeBytes: result.sizeBytes,
        sha256: result.sha256
      });
    }

    const status = statusForExtraction({ ...extraction, resources });
    output.status = status;
    output.warnings.push(...uniqueStrings(extraction.warnings, 100));
    output.errors.push(...uniqueStrings([...extraction.errors, ...extraction.failedResources.map((entry) => `${entry.uri}: ${entry.error}`)], 100));

    const resourceInventoryPath = normalizeRelativePath(path.join(outputDirectory, "extracted-resource-inventory.md"));
    const docs: Record<string, string> = {
      "source-url.json": buildSourceUrlJson({ parsed, capturedAt: retrievedAt, mcpConfig }),
      "make-project.json": buildMakeProjectJson({
        parsed,
        targetUiArea,
        implementationScope,
        notes,
        status,
        resourceFiles: output.resourceFiles,
        mcpConfig
      }),
      "figma-mcp-connection.json": buildConnectionJson({ mcpConfig, extraction, status }),
      "figma-mcp-resource-inventory.json": buildResourceInventoryJson({ extraction, writtenResources }),
      "extracted-resource-inventory.md": buildExtractedResourceInventoryMd({
        parsed,
        mcpConfig,
        writtenResources,
        failedResources: extraction.failedResources
      }),
      "extraction-summary.md": buildExtractionSummary({
        parsed,
        mcpConfig,
        targetUiArea,
        status,
        extraction,
        resourceFiles: output.resourceFiles,
        warnings: output.warnings,
        errors: output.errors,
        retrievedAt
      })
    };

    for (const [relativeFile, content] of Object.entries(docs)) {
      const result = await safeWrite(config.repoRoot, path.join(outputDirectory, relativeFile), content, config);
      output.createdFiles.push(result.relativePath);
      output.metadataFiles.push(result.relativePath);
    }

    output.handoffDirectory = toRootRelativePath(
      resolveProjectPath(config.repoRoot, outputDirectory, config.allowedRoots).rootRealPath,
      resolveProjectPath(config.repoRoot, outputDirectory, config.allowedRoots).resolvedPath
    );

    const prompt = buildCodexPrompt({
      parsed,
      targetUiArea,
      implementationScope,
      handoffDirectory: output.handoffDirectory,
      codexPromptFile,
      mcpConfig,
      resourceInventoryPath,
      resourceFiles: output.resourceFiles,
      createdFiles: output.createdFiles,
      metadataFiles: output.metadataFiles,
      warnings: output.warnings,
      notes
    });
    const promptResult = await safeWrite(config.repoRoot, codexPromptFile, prompt, config);
    output.codexPromptFile = promptResult.relativePath;
    output.createdFiles.push(promptResult.relativePath);

    const packagePromptPath = path.join(outputDirectory, PACKAGE_PROMPT_FILE);
    if (normalizeRelativePath(packagePromptPath) !== normalizeRelativePath(promptResult.relativePath)) {
      const packagePromptResult = await safeWrite(config.repoRoot, packagePromptPath, prompt, config);
      output.createdFiles.push(packagePromptResult.relativePath);
      output.metadataFiles.push(packagePromptResult.relativePath);
    }

    output.screenshots = [];
    if (output.resourceFiles.length === 0) {
      output.status = "failed";
    }
    return output;
  } catch (error) {
    output.status = "failed";
    output.errors.push(error instanceof Error ? redactSecrets(error.message) : redactSecrets(String(error)));
    output.screenshots = [];
    output.resourceFiles = [];
    return output;
  }
}
