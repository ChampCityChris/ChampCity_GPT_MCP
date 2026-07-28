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

const metadataOpen = "<!-- CHAMPCITY-METADATA";
const metadataClose = "CHAMPCITY-METADATA -->";
const intakePath = "planning/project/Project_Intake/PROJECT_INTAKE_fixture.md";
const promptPath = "planning/project/Project_Architect_Interview_Prompts/PROJECT_ARCHITECT_INTERVIEW_PROMPT_fixture.md";
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

function canonicalDocument(metadata: Record<string, unknown>, body: string): string {
  return [metadataOpen, JSON.stringify(metadata, null, 2), metadataClose, "", `${body.replace(/\r\n?/gu, "\n").replace(/\n*$/u, "")}\n`].join("\n");
}

function baseIntake(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    artifactType: "project-intake",
    artifactRevision: 1,
    participationRole: "gatingReview",
    identity: { "Project.ArtifactKey": "fixture_project" },
    sourceRevisions: [],
    workflowData: {
      projectName: "Fixture Project",
      projectSlug: "fixture_project"
    },
    documentDisposition: { status: "Approved", notes: "", reviewedAt: "2026-07-28T00:00:00.000Z" },
    ...overrides
  };
}

function basePrompt(overrides: Record<string, unknown> = {}, target = targetPath): Record<string, unknown> {
  return {
    schemaVersion: 1,
    artifactType: "project-architect-interview-prompt",
    artifactRevision: 1,
    participationRole: "nonReviewHandoff",
    identity: { projectSlug: "fixture_project", "Project.ArtifactKey": "fixture_project" },
    sourceRevisions: [{ path: intakePath, revision: 1 }],
    workflowData: {
      projectName: "Fixture Project",
      projectSlug: "fixture_project",
      architectOutputTargets: {
        markdown: target
      }
    },
    documentDisposition: { status: "Approved", notes: "", reviewedAt: null },
    ...overrides
  };
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

function seedEvidence(
  overrides: { intake?: Record<string, unknown>; prompt?: Record<string, unknown>; target?: string; intakeBody?: string; promptBody?: string } = {}
): void {
  writeFile(
    intakePath,
    canonicalDocument(baseIntake(overrides.intake), overrides.intakeBody ?? "# Project Intake: Fixture Project\n")
  );
  writeFile(
    promptPath,
    canonicalDocument(basePrompt(overrides.prompt, overrides.target), overrides.promptBody ?? "# Project Architect Interview Prompt: Fixture Project\n")
  );
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

  it("resolves canonical .md Intake and Prompt, then creates canonical Markdown without a JSON sibling", async () => {
    seedEvidence();
    writeFile("planning/project/Project_Intake/PROJECT_INTAKE_fixture.json", "{broken");
    writeFile("planning/project/Project_Architect_Interview_Prompts/PROJECT_ARCHITECT_INTERVIEW_PROMPT_fixture.json", "{broken");

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
    assert.ok(saved.startsWith(metadataOpen));
    assert.equal(parsed.artifactRevision, 1);
    assert.equal(parsed.disposition, "Pending");
    assert.deepEqual(parsed.identity, { "Project.ArtifactKey": "fixture_project", projectSlug: "fixture_project" });
    assert.deepEqual(parsed.sourceRevisions, [
      { path: intakePath, revision: 1 },
      { path: promptPath, revision: 1 }
    ]);
    assert.equal(parsed.metadata.workflowData && Object.keys(parsed.metadata.workflowData).length, 0);
    assert.equal(parsed.metadata.documentDisposition.notes, "");
    assert.equal(parsed.metadata.documentDisposition.reviewedAt, null);
    assert.equal(parsed.body, interviewBody());
    assert.doesNotMatch(saved, /Artifact\.Revision=|Document\.Status=|## Source Revisions/u);
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
    writeFile(targetPath, readFile(targetPath).replace("\"status\": \"Pending\"", "\"status\": \"Approved\""));
    const approved = await saveViaToolbox(interviewBody("Changed"));

    writeFile(targetPath, "# malformed\n");
    const malformed = await saveViaToolbox(interviewBody("Changed"));

    await fs.promises.unlink(path.join(tempRoot, ...targetPath.split("/")));
    await saveViaToolbox(interviewBody("Identity"));
    writeFile(targetPath, readFile(targetPath).replace("\"Project.ArtifactKey\": \"fixture_project\"", "\"Project.ArtifactKey\": \"other_project\""));
    const mismatched = await saveViaToolbox(interviewBody("Changed again"));

    assert.equal(approved.ok, false);
    assert.equal(approved.error?.code, "APPROVAL_REQUIRED");
    assert.equal(malformed.ok, false);
    assert.equal(malformed.error?.code, "INVALID_INPUT");
    assert.equal(mismatched.ok, false);
    assert.equal(mismatched.error?.code, "INVALID_INPUT");
  });

  it("rejects caller authority fields, canonical body metadata, duplicate, malformed, stale, historical, and unsafe evidence", async () => {
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
    const bodyMetadata = await saveViaToolbox(`${metadataOpen}\n{}\n${metadataClose}\n\n${interviewBody()}`);

    writeFile(
      "planning/project/Project_Intake/PROJECT_INTAKE_duplicate.md",
      canonicalDocument(baseIntake({ identity: { "Project.ArtifactKey": "duplicate_project" } }), "# Duplicate\n")
    );
    const duplicate = await saveViaToolbox(interviewBody());

    fs.rmSync(path.join(tempRoot, "planning", "project", "Project_Intake"), { recursive: true, force: true });
    fs.mkdirSync(path.join(tempRoot, "planning", "project", "Project_Intake"), { recursive: true });
    writeFile(intakePath, `${metadataOpen}\n{broken\n${metadataClose}\n\n# Broken\n`);
    const malformed = await saveViaToolbox(interviewBody());

    seedEvidence({ prompt: { sourceRevisions: [{ path: intakePath, revision: 999 }] } });
    const stale = await saveViaToolbox(interviewBody());

    seedEvidence({ intake: { participationRole: "historical" } });
    const historical = await saveViaToolbox(interviewBody());

    seedEvidence({ target: "../escape.md" });
    const unsafeTarget = await saveViaToolbox(interviewBody());

    assert.equal(callerAuthority.ok, false);
    assert.equal(callerAuthority.error?.code, "INVALID_INPUT");
    assert.equal(bodyMetadata.ok, false);
    assert.equal(bodyMetadata.error?.code, "INVALID_INPUT");
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.error?.code, "INVALID_INPUT");
    assert.equal(malformed.ok, false);
    assert.equal(malformed.error?.code, "INVALID_INPUT");
    assert.equal(stale.ok, false);
    assert.equal(stale.error?.code, "INVALID_INPUT");
    assert.equal(historical.ok, false);
    assert.equal(historical.error?.code, "INVALID_INPUT");
    assert.equal(unsafeTarget.ok, false);
    assert.equal(unsafeTarget.error?.code, "PATH_DENIED");
  });

  it("permits artifact persistence for configured non-Git workspaces without using Git as authority", async () => {
    fs.rmSync(path.join(tempRoot, ".git"), { recursive: true, force: true });
    seedEvidence();
    const appConfig = config("docs");
    const result = await saveViaToolbox(interviewBody("Non Git"), appConfig);

    assert.equal(result.ok, true);
    assert.equal((result.result as { status?: string }).status, "saved");
    assert.equal(parseArchitectInterviewDocument(readFile(targetPath)).body, interviewBody("Non Git"));
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
            writeFile(promptPath, canonicalDocument(basePrompt({ artifactRevision: 2 }), "# Prompt changed\n"));
          }
        }
      );
    } catch (error) {
      raceError = error;
    }

    writeFile(promptPath, canonicalDocument(basePrompt(), "# Prompt restored\n"));

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
    assert.match(String(verificationError), /canonical|valid/iu);
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
