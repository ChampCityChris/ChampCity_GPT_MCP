import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { type AppConfig } from "../src/config.js";
import { createToolboxRuntimeContext } from "../src/server/registerTools.js";
import { artifactToolbox, diagnosticsToolbox } from "../src/tools/domainToolboxes.js";
import {
  parseArchitectInterviewDocument,
  saveArchitectInterviewOutput
} from "../src/tools/saveArchitectInterviewOutput.js";

let tempRoot: string;
let auditRoot: string;

const intakePath = "planning/project/Project_Intake/PROJECT_INTAKE_fixture.json";
const promptPath = "planning/project/Project_Architect_Interview_Prompts/PROJECT_ARCHITECT_INTERVIEW_PROMPT_fixture.json";
const targetPath = "planning/project/Project_Architect_Interviews/PROJECT_ARCHITECT_INTERVIEW_fixture.md";
const jsonSiblingPath = "planning/project/Project_Architect_Interviews/PROJECT_ARCHITECT_INTERVIEW_fixture.json";

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-save-architect-interview-"));
  auditRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-save-architect-interview-audit-"));
  initRepo();
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.rmSync(auditRoot, { recursive: true, force: true });
});

function git(args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: tempRoot,
    encoding: "utf8",
    shell: false,
    windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function initRepo(): void {
  git(["init"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test User"]);
  git(["checkout", "-b", "dev"]);
  writeFile("package.json", `${JSON.stringify({ name: "champcity-save-fixture", version: "0.1.0" }, null, 2)}\n`);
  git(["add", "package.json"]);
  git(["commit", "-m", "Initial fixture"]);
}

function writeFile(relativePath: string, content: string): void {
  const absolutePath = path.join(tempRoot, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf8");
}

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(tempRoot, ...relativePath.split("/")), "utf8");
}

function writeJson(relativePath: string, value: unknown): void {
  writeFile(relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function config(writeMode: AppConfig["writeMode"] = "docs"): AppConfig {
  return {
    repoRoot: tempRoot,
    allowedRoots: [tempRoot],
    defaultWorkspaceRoot: tempRoot,
    defaultWorkspaceRootSource: "repoRoot",
    auditLogPath: path.join(auditRoot, "audit.log"),
    requireGitRoot: true,
    allowedCommands: [],
    writeToolsEnabled: writeMode !== "off",
    writeToolsEnabledSource: "default",
    writeMode,
    writeModeSource: "default",
    docsWritesAllowed: writeMode === "docs" || writeMode === "patch" || writeMode === "elevated",
    patchWritesAllowed: writeMode === "patch" || writeMode === "elevated",
    elevatedOperationsAllowed: writeMode === "elevated",
    writeApprovalToken: { source: "none" },
    workspaces: [{ workspaceId: "champcity_ai", label: "ChampCity AI", root: tempRoot, source: "configured" }],
    defaultWorkspaceId: "champcity_ai",
    defaultWorkspaceIdSource: "local-file"
  };
}

function context(appConfig: AppConfig, scope = "files.read files.write") {
  return createToolboxRuntimeContext(appConfig, { scope });
}

function seedEvidence(overrides: { intake?: Record<string, unknown>; prompt?: Record<string, unknown>; target?: string } = {}): void {
  const intake = {
    artifactType: "project-intake",
    artifactRevision: 1,
    participationRole: "gatingReview",
    projectArtifactKey: "fixture_project",
    projectSlug: "fixture_project",
    projectName: "Fixture Project",
    documentDisposition: { status: "Approved" },
    ...overrides.intake
  };
  writeJson(intakePath, intake);

  const prompt = {
    artifactType: "project-architect-interview-prompt",
    artifactRevision: 1,
    participationRole: "nonReviewHandoff",
    projectArtifactKey: "fixture_project",
    projectSlug: "fixture_project",
    sourceRevisions: [{ path: intakePath, revision: 1 }],
    workflowData: {
      architectOutputTargets: {
        markdown: overrides.target ?? targetPath
      }
    },
    documentDisposition: { status: "Approved" },
    ...overrides.prompt
  };
  writeJson(promptPath, prompt);
}

function interviewBody(label = "Initial"): string {
  return `## Project Understanding

${label} substantive interview body.

## Goals and Success Criteria

- The durable output is captured.
`;
}

async function saveViaToolbox(markdownBody: string, appConfig = config(), scope = "files.read files.write") {
  return artifactToolbox(
    {
      action: "save_architect_interview_output",
      workspaceId: "champcity_ai",
      params: { markdownBody }
    },
    appConfig,
    context(appConfig, scope)
  );
}

describe("artifact_toolbox.save_architect_interview_output", () => {
  it("exists, remains discoverable, and read-only callers can still use artifact read actions", async () => {
    seedEvidence();
    const appConfig = config("docs");
    const inventory = await diagnosticsToolbox({ action: "mcp_tool_inventory", workspaceId: "champcity_ai" }, appConfig, context(appConfig));
    const unsupported = await artifactToolbox({ action: "missing_action", workspaceId: "champcity_ai" }, appConfig, context(appConfig, "files.read"));
    const readOnlyList = await artifactToolbox({ action: "list_artifacts", workspaceId: "champcity_ai" }, appConfig, context(appConfig, "files.read"));

    assert.equal(inventory.ok, true);
    assert.ok(JSON.stringify(inventory.result).includes("save_architect_interview_output"));
    assert.equal(unsupported.ok, false);
    assert.ok((unsupported.error?.details?.supportedActions as string[] | undefined)?.includes("save_architect_interview_output"));
    assert.equal(readOnlyList.ok, true);
  });

  it("is denied without files.write and when local write mode is off", async () => {
    seedEvidence();
    const docsConfig = config("docs");
    const missingScope = await saveViaToolbox(interviewBody(), docsConfig, "files.read");
    const offConfig = config("off");
    const writeModeOff = await saveViaToolbox(interviewBody(), offConfig);

    assert.equal(missingScope.ok, false);
    assert.equal(missingScope.error?.code, "APPROVAL_REQUIRED");
    assert.match(missingScope.error?.message ?? "", /files\.write/u);
    assert.equal(writeModeOff.ok, false);
    assert.equal(writeModeOff.error?.code, "APPROVAL_REQUIRED");
    assert.match(writeModeOff.error?.message ?? "", /writeMode docs, patch, or elevated/u);
  });

  it("creates valid canonical Markdown on first save without a JSON sibling", async () => {
    seedEvidence();
    const result = await saveViaToolbox(interviewBody());
    const output = result.result as { status?: string; relativePath?: string; artifactRevision?: number; disposition?: string; sha256?: string };
    const saved = readFile(targetPath);
    const parsed = parseArchitectInterviewDocument(saved);

    assert.equal(result.ok, true);
    assert.equal(output.status, "saved");
    assert.equal(output.relativePath, targetPath);
    assert.equal(output.artifactRevision, 1);
    assert.equal(output.disposition, "Pending");
    assert.match(output.sha256 ?? "", /^[a-f0-9]{64}$/u);
    assert.equal(parsed.artifactRevision, 1);
    assert.equal(parsed.disposition, "Pending");
    assert.deepEqual(parsed.sourceRevisions, [
      { path: intakePath, revision: 1 },
      { path: promptPath, revision: 1 }
    ]);
    assert.equal(fs.existsSync(path.join(tempRoot, ...jsonSiblingPath.split("/"))), false);
  });

  it("returns already_saved for identical retries and increments exactly once for changed Pending content", async () => {
    seedEvidence();
    const first = await saveViaToolbox(interviewBody("First"));
    const retry = await saveViaToolbox(interviewBody("First"));
    const changed = await saveViaToolbox(interviewBody("Changed"));
    const parsed = parseArchitectInterviewDocument(readFile(targetPath));

    assert.equal((first.result as { artifactRevision?: number }).artifactRevision, 1);
    assert.equal((retry.result as { status?: string; artifactRevision?: number }).status, "already_saved");
    assert.equal((retry.result as { artifactRevision?: number }).artifactRevision, 1);
    assert.equal((changed.result as { status?: string; artifactRevision?: number }).status, "saved");
    assert.equal((changed.result as { artifactRevision?: number }).artifactRevision, 2);
    assert.equal(parsed.artifactRevision, 2);
    assert.equal(parsed.disposition, "Pending");
  });

  it("refuses approved, malformed, and identity-mismatched existing targets", async () => {
    seedEvidence();
    await saveViaToolbox(interviewBody("Approved"));
    writeFile(targetPath, readFile(targetPath).replace("Document.Status=Pending", "Document.Status=Approved"));
    const approved = await saveViaToolbox(interviewBody("Changed"));

    writeFile(targetPath, "# malformed\n");
    const malformed = await saveViaToolbox(interviewBody("Changed"));

    await fs.promises.unlink(path.join(tempRoot, ...targetPath.split("/")));
    await saveViaToolbox(interviewBody("Identity"));
    writeFile(targetPath, readFile(targetPath).replace("projectSlug=fixture_project", "projectSlug=other_project"));
    const mismatched = await saveViaToolbox(interviewBody("Changed again"));

    assert.equal(approved.ok, false);
    assert.equal(approved.error?.code, "APPROVAL_REQUIRED");
    assert.equal(malformed.ok, false);
    assert.equal(malformed.error?.code, "INVALID_INPUT");
    assert.equal(mismatched.ok, false);
    assert.equal(mismatched.error?.code, "INVALID_INPUT");
  });

  it("rejects caller authority fields, canonical body metadata, missing/conflicting evidence, and unsafe derived targets", async () => {
    seedEvidence();
    const callerAuthority = await artifactToolbox(
      {
        action: "save_architect_interview_output",
        workspaceId: "champcity_ai",
        params: { markdownBody: interviewBody(), relativePath: targetPath }
      },
      config(),
      context(config())
    );
    const bodyMetadata = await saveViaToolbox(`# Project Architect Interview
Artifact.Revision=9
${interviewBody()}`);

    fs.rmSync(path.join(tempRoot, ...promptPath.split("/")));
    const missingPrompt = await saveViaToolbox(interviewBody());

    seedEvidence({ prompt: { projectSlug: "conflicting_project" } });
    const conflict = await saveViaToolbox(interviewBody());

    seedEvidence({ target: "../escape.md" });
    const unsafeTarget = await saveViaToolbox(interviewBody());

    assert.equal(callerAuthority.ok, false);
    assert.equal(callerAuthority.error?.code, "INVALID_INPUT");
    assert.equal(bodyMetadata.ok, false);
    assert.equal(bodyMetadata.error?.code, "INVALID_INPUT");
    assert.equal(missingPrompt.ok, false);
    assert.equal(missingPrompt.error?.code, "INVALID_INPUT");
    assert.equal(conflict.ok, false);
    assert.equal(conflict.error?.code, "INVALID_INPUT");
    assert.equal(unsafeTarget.ok, false);
    assert.equal(unsafeTarget.error?.code, "PATH_DENIED");
  });

  it("rejects evidence-change races and restores original bytes after verification failure", async () => {
    seedEvidence();
    const appConfig = config();
    await saveViaToolbox(interviewBody("Original"), appConfig);
    const original = readFile(targetPath);

    let raceError: unknown;
    try {
      await saveArchitectInterviewOutput(
        { workspaceId: "champcity_ai", markdownBody: interviewBody("Race") },
        appConfig,
        {
          beforeEvidenceRecheck: () => {
            const prompt = JSON.parse(readFile(promptPath)) as Record<string, unknown>;
            prompt.artifactRevision = 2;
            writeJson(promptPath, prompt);
          }
        }
      );
    } catch (error) {
      raceError = error;
    }

    const prompt = JSON.parse(readFile(promptPath)) as Record<string, unknown>;
    prompt.artifactRevision = 1;
    writeJson(promptPath, prompt);

    let verificationError: unknown;
    try {
      await saveArchitectInterviewOutput(
        { workspaceId: "champcity_ai", markdownBody: interviewBody("Corrupt") },
        appConfig,
        {
          afterInstall: (absolutePath) => {
            fs.writeFileSync(absolutePath, "# corrupt\n", "utf8");
          }
        }
      );
    } catch (error) {
      verificationError = error;
    }

    const audit = fs.readFileSync(path.join(auditRoot, "audit.log"), "utf8");
    assert.match(String(raceError), /changed before/u);
    assert.match(String(verificationError), /canonical|valid/u);
    assert.equal(readFile(targetPath), original);
    assert.doesNotMatch(audit, /Original substantive interview body|Corrupt substantive interview body/u);
    assert.doesNotMatch(audit, new RegExp(tempRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  });

  it("keeps HTTP transport action-scope enforcement generic without a literal special branch", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src", "transports", "httpTransport.ts"), "utf8");

    assert.match(source, /requiredScopeForPublicToolCall\(toolName, toolCall\.action\)/u);
    assert.doesNotMatch(source, /save_architect_interview_output/u);
  });
});
