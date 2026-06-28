import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { type AppConfig } from "../config.js";
import { assertMarkdownArtifactPath } from "../security/filePolicy.js";
import { resolveProjectPath, toRootRelativePath } from "../security/pathPolicy.js";
import { AppError } from "../utils/errors.js";
import { assertInsideGitRepo } from "../utils/git.js";

export interface CreateCodexUiHandoffPromptInput {
  root: string;
  handoffPath: string;
  targetFile?: string;
  targetArea?: string;
  overwrite?: boolean;
}

export interface CreateCodexUiHandoffPromptOutput {
  targetFile: string;
  sizeBytes: number;
  sha256: string;
}

const DEFAULT_TARGET_FILE = "docs/handoffs/CODEX_UI_REDESIGN_HANDOFF.md";

async function exists(filePath: string): Promise<boolean> {
  return fs.stat(filePath).then(() => true).catch(() => false);
}

function buildPrompt(input: Required<Pick<CreateCodexUiHandoffPromptInput, "handoffPath" | "targetFile">> & Pick<CreateCodexUiHandoffPromptInput, "targetArea">): string {
  const targetArea = input.targetArea?.trim() || "the requested UI area";
  return `# Codex UI Implementation Handoff

You are Codex implementing ${targetArea} in this repository.

Use the Figma design handoff package at \`${input.handoffPath}\` as the visual and design authority. Read its README, specs, tokens, screenshots, and assets before editing code. If the handoff contains TODOs, preserve them as implementation questions rather than guessing.

Preserve existing ChampCity GPT behavior:
- MCP server behavior and tool contracts.
- OAuth, dynamic client registration, PKCE, access tokens, refresh tokens, and revocation behavior.
- Cloudflare/public endpoint setup and local 127.0.0.1 HTTP flow.
- Write-mode behavior for off, docs, patch, and elevated modes.
- Public safety scan and commit/push workflow tools.
- Existing path, file, audit, and allowed-root restrictions.

Implementation constraints:
- Avoid backend rewrites unless required for UI wiring.
- Keep Electron \`contextIsolation: true\` and \`nodeIntegration: false\`.
- Do not add Playwright.
- Do not expose or log Figma tokens or other local secrets.

Validation to run:
- \`npm run build\`
- \`npm test\`
- \`npm run typecheck\`
- \`npm run lint\`
- \`npm audit --audit-level=low\`
- \`npm run check:public\`
- If Electron files changed: \`npm run app:dist\` and \`npm run check:release\`

Final report:
- Changed files.
- Validation results.
- Whether app release was rebuilt.
- Any remaining handoff TODOs or manual visual checks.
`;
}

export async function createCodexUiHandoffPrompt(input: CreateCodexUiHandoffPromptInput, config: AppConfig): Promise<CreateCodexUiHandoffPromptOutput> {
  if (!config.docsWritesAllowed) {
    throw new AppError("APPROVAL_REQUIRED", "create_codex_ui_handoff_prompt requires writeMode docs, patch, or elevated.");
  }

  const targetFile = input.targetFile?.trim() || DEFAULT_TARGET_FILE;
  const handoff = resolveProjectPath(input.root, input.handoffPath, config.allowedRoots);
  const target = resolveProjectPath(input.root, targetFile, config.allowedRoots);
  const targetRelativePath = toRootRelativePath(target.rootRealPath, target.resolvedPath);
  assertMarkdownArtifactPath(target.resolvedPath, targetRelativePath);

  if (config.requireGitRoot) {
    assertInsideGitRepo(handoff.resolvedPath);
    assertInsideGitRepo(target.resolvedPath);
  }

  if ((await exists(target.resolvedPath)) && !input.overwrite) {
    throw new AppError("APPROVAL_REQUIRED", "Refusing to overwrite an existing Codex UI handoff prompt unless overwrite is true.", {
      relativePath: targetRelativePath
    });
  }

  const content = buildPrompt({
    handoffPath: toRootRelativePath(handoff.rootRealPath, handoff.resolvedPath),
    targetFile,
    targetArea: input.targetArea
  });
  await fs.mkdir(path.dirname(target.resolvedPath), { recursive: true });
  const temporaryPath = path.join(path.dirname(target.resolvedPath), `.${path.basename(target.resolvedPath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(temporaryPath, content, "utf8");
  await fs.rename(temporaryPath, target.resolvedPath);

  return {
    targetFile: targetRelativePath,
    sizeBytes: Buffer.byteLength(content, "utf8"),
    sha256: crypto.createHash("sha256").update(content).digest("hex")
  };
}
