import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { type AppConfig } from "../src/config.js";
import { createToolboxRuntimeContext } from "../src/server/registerTools.js";
import { artifactToolbox } from "../src/tools/domainToolboxes.js";

let tempRoot: string;
let auditRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-artifacts-"));
  auditRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-artifacts-audit-"));
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.rmSync(auditRoot, { recursive: true, force: true });
});

function testConfig(root = tempRoot): AppConfig {
  return {
    repoRoot: root,
    allowedRoots: [root],
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

function context(config: AppConfig) {
  return createToolboxRuntimeContext(config, { scope: "files.read" });
}

function writeFile(relativePath: string, content: string, mtime = "2026-01-01T00:00:00.000Z"): void {
  const absolutePath = path.join(tempRoot, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf8");
  const date = new Date(mtime);
  fs.utimesSync(absolutePath, date, date);
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function assertNoAbsolutePath(value: unknown): void {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, new RegExp(tempRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
}

async function call(action: string, params: Record<string, unknown> = {}, config = testConfig()) {
  return artifactToolbox({ action, params }, config, context(config));
}

describe("artifact catalog toolbox actions", () => {
  it("accepts the six new actions, preserves existing actions, and rejects unknown params", async () => {
    writeFile("docs/artifacts/one.md", "# One\n");
    const config = testConfig();

    for (const action of ["list_artifacts", "latest_artifact", "current_action_context", "review_queue"]) {
      const result = await call(action, {}, config);
      assert.equal(result.ok, true, `${action} should be accepted`);
    }

    const listed = await call("list_artifacts", { unexpected: true }, config);
    const imageActionStillListed = await call("unknown_action", {}, config);
    const packageSummary = await call("local_package_summary", {}, config);

    assert.equal(listed.ok, false);
    assert.equal(listed.error?.code, "INVALID_INPUT");
    assert.equal(packageSummary.ok, true);
    assert.ok((imageActionStillListed.error?.details?.supportedActions as string[] | undefined)?.includes("read_image_artifact"));
    assert.ok((imageActionStillListed.error?.details?.supportedActions as string[] | undefined)?.includes("review_queue"));
  });

  it("discovers registry and JSON-sidecar artifacts, deduplicates pairs, filters with AND semantics, and paginates", async () => {
    const markdown = "# Registry Artifact\n";
    const json = `${JSON.stringify({
      artifactId: "ART-SIDECAR",
      phaseId: "phase-03",
      artifactType: "decision_record",
      workCardId: "WC03-REPAIR02",
      title: "Sidecar artifact",
      reviewStatus: "draft",
      markdownPath: "docs/artifacts/sidecar.md"
    })}\n`;
    writeFile("docs/artifacts/registry.md", markdown, "2026-01-02T00:00:00.000Z");
    writeFile("docs/artifacts/registry.json", "{\"ok\":true}\n", "2026-01-02T00:00:00.000Z");
    writeFile("docs/artifacts/sidecar.md", "# Sidecar\n", "2026-01-03T00:00:00.000Z");
    writeFile("docs/artifacts/sidecar.json", json, "2026-01-03T00:00:00.000Z");
    writeFile("docs/artifacts/tie-a.md", "# Tie A\n", "2026-01-04T00:00:00.000Z");
    writeFile("docs/artifacts/tie-b.md", "# Tie B\n", "2026-01-04T00:00:00.000Z");
    writeFile(
      ".champcity/artifact-registry.json",
      `${JSON.stringify({
        artifacts: [
          {
            artifactId: "ART-REG",
            pairId: "PAIR-REG",
            phaseId: "phase-03",
            artifactType: "builder_report",
            workCardId: "WC03-REPAIR02",
            title: "Registry artifact",
            markdownPath: "docs/artifacts/registry.md",
            jsonPath: "docs/artifacts/registry.json",
            hashes: {
              markdownSha256: sha256(markdown),
              jsonSha256: sha256("{\"ok\":true}\n")
            }
          }
        ]
      })}\n`
    );

    const result = await call("list_artifacts", {
      phaseId: "phase-03",
      artifactType: "builder_report",
      workCardId: "WC03-REPAIR02",
      limit: 1
    });
    const body = result.result as { artifacts: Array<{ artifactId: string; markdownPath?: string }>; nextCursor?: string; totalReturned: number; truncated: boolean };
    const secondPage = await call("list_artifacts", { limit: 2, cursor: "2" });
    const all = await call("list_artifacts", { limit: 20 });
    const allBody = all.result as { artifacts: Array<{ artifactId: string; modifiedAt: string }> };

    assert.equal(result.ok, true);
    assert.equal(body.totalReturned, 1);
    assert.equal(body.truncated, false);
    assert.equal(body.artifacts[0]?.artifactId, "ART-REG");
    assert.equal(body.artifacts[0]?.markdownPath, "docs/artifacts/registry.md");
    assert.equal((secondPage.result as { totalReturned: number }).totalReturned, 2);
    assert.equal(allBody.artifacts[0]?.modifiedAt, "2026-01-04T00:00:00.000Z");
    assert.ok((allBody.artifacts[0]?.artifactId ?? "") < (allBody.artifacts[1]?.artifactId ?? ""), "artifactId is the stable tie-breaker");
    assertNoAbsolutePath(all);
  });

  it("classifies source, sidecar, and derived artifact records and filters source-only views", async () => {
    writeFile("docs/artifacts/source.md", "---\nartifactId: ART-SOURCE\nartifactType: plan\nstatus: approved\n---\n# Source\n", "2026-01-03T00:00:00.000Z");
    writeFile("docs/artifacts/sidecar.json", `${JSON.stringify({ artifactId: "ART-SIDECAR-ONLY", artifactType: "plan", status: "draft" })}\n`, "2026-01-02T00:00:00.000Z");
    writeFile("docs/artifacts/derived.md", "# Derived\n", "2026-01-01T00:00:00.000Z");

    const all = await call("list_artifacts", { limit: 10 });
    const sourceOnly = await call("list_artifacts", { sourceOnly: true, limit: 10 });
    const sidecars = await call("list_artifacts", { recordKind: "sidecar", limit: 10 });
    const noSupportRecords = await call("list_artifacts", { includeDerived: false, includeSidecars: false, limit: 10 });

    assert.deepEqual(
      (all.result as { artifacts?: Array<{ recordKind?: string }> }).artifacts?.map((entry) => entry.recordKind).sort(),
      ["derived", "sidecar", "source"]
    );
    assert.deepEqual(
      (sourceOnly.result as { artifacts?: Array<{ artifactId?: string }> }).artifacts?.map((entry) => entry.artifactId),
      ["ART-SOURCE"]
    );
    assert.deepEqual(
      (sidecars.result as { artifacts?: Array<{ artifactId?: string }> }).artifacts?.map((entry) => entry.artifactId),
      ["ART-SIDECAR-ONLY"]
    );
    assert.deepEqual(
      (noSupportRecords.result as { artifacts?: Array<{ artifactId?: string }> }).artifacts?.map((entry) => entry.artifactId),
      ["ART-SOURCE"]
    );
  });

  it("reads artifacts by stable ID with preferred, markdown, JSON, both, missing component, and large JSON behavior", async () => {
    writeFile("docs/artifacts/readable.md", "# Readable\n");
    writeFile(
      "docs/artifacts/readable.json",
      `${JSON.stringify({
        artifactId: "ART-READ",
        artifactType: "builder_report",
        markdownPath: "docs/artifacts/readable.md"
      })}\n`
    );
    writeFile("docs/artifacts/json-only.json", `${JSON.stringify({ artifactId: "ART-JSON", artifactType: "data_pack", value: 1 })}\n`);
    writeFile("docs/artifacts/bad.json", "{\"artifactId\":\"ART-BAD\",", "2026-01-02T00:00:00.000Z");
    writeFile("docs/artifacts/large.json", `${JSON.stringify({ artifactId: "ART-LARGE", payload: "x".repeat(510_000) })}\n`);

    const preferred = await call("read_artifact_by_id", { artifactId: "ART-READ" });
    const both = await call("read_artifact_by_id", { artifactId: "ART-READ", component: "both" });
    const jsonOnly = await call("read_artifact_by_id", { artifactId: "ART-JSON", component: "preferred" });
    const missing = await call("read_artifact_by_id", { artifactId: "ART-JSON", component: "markdown" });
    const invalid = await call("read_artifact_by_id", { artifactId: "ART-BAD", component: "json" });
    const large = await call("read_artifact_by_id", { artifactId: "ART-LARGE", component: "json" });

    assert.equal((preferred.result as { status?: string }).status, "ok");
    assert.match(((preferred.result as { markdown?: { content?: string } }).markdown?.content ?? ""), /Readable/u);
    assert.equal(Boolean((both.result as { markdown?: unknown }).markdown), true);
    assert.equal(Boolean((both.result as { json?: unknown }).json), true);
    assert.equal((jsonOnly.result as { json?: { value?: { value?: number } } }).json?.value?.value, 1);
    assert.equal((missing.result as { status?: string }).status, "component_not_found");
    assert.equal((invalid.result as { json?: { validJson?: boolean } }).json?.validJson, false);
    assert.equal((large.result as { status?: string }).status, "content_too_large");
    assertNoAbsolutePath(both);
  });

  it("selects the latest matching artifact using modified time and artifact ID tie-breaks", async () => {
    writeFile("docs/artifacts/old.md", "---\nartifactId: ART-OLD\nartifactType: note\nphaseId: phase-03\n---\n# Old\n", "2026-01-01T00:00:00.000Z");
    writeFile("docs/artifacts/new.md", "---\nartifactId: ART-NEW\nartifactType: note\nphaseId: phase-03\n---\n# New\n", "2026-01-05T00:00:00.000Z");

    const latest = await call("latest_artifact", { phaseId: "phase-03", artifactType: "note", includeContent: true });
    const none = await call("latest_artifact", { phaseId: "phase-99" });

    assert.equal((latest.result as { artifact?: { artifactId?: string } }).artifact?.artifactId, "ART-NEW");
    assert.match(String((latest.result as { content?: { value?: string } }).content?.value), /New/u);
    assert.equal((none.result as { status?: string }).status, "no_matching_artifact");
  });

  it("reports pair synchronization, hash mismatches, invalid JSON, and absent canonical payload authority without mutation", async () => {
    const markdown = "# Pair\n";
    const json = `${JSON.stringify({ artifactId: "ART-PAIR", pairId: "PAIR-1", artifactType: "builder_report", markdownPath: "docs/artifacts/pair.md" })}\n`;
    writeFile("docs/artifacts/pair.md", markdown);
    writeFile("docs/artifacts/pair.json", json);
    writeFile("docs/artifacts/broken.md", "# Broken\n");
    writeFile("docs/artifacts/broken.json", "{\"artifactId\":\"ART-BROKEN\",");
    writeFile(
      ".champcity/artifact-registry.json",
      `${JSON.stringify({
        artifacts: [
          {
            artifactId: "ART-PAIR",
            pairId: "PAIR-1",
            artifactType: "builder_report",
            markdownPath: "docs/artifacts/pair.md",
            jsonPath: "docs/artifacts/pair.json",
            revision: 1,
            hashes: {
              markdownSha256: sha256(markdown),
              jsonSha256: sha256("wrong")
            }
          },
          {
            artifactId: "ART-MISSING",
            artifactType: "builder_report",
            markdownPath: "docs/artifacts/missing.md",
            jsonPath: "docs/artifacts/missing.json"
          }
        ]
      })}\n`
    );
    const before = fs.readFileSync(path.join(tempRoot, "docs", "artifacts", "pair.json"), "utf8");

    const mismatch = await call("artifact_pair_status", { artifactId: "ART-PAIR" });
    const missing = await call("artifact_pair_status", { artifactId: "ART-MISSING" });
    const invalid = await call("artifact_pair_status", { artifactId: "ART-BROKEN" });
    const after = fs.readFileSync(path.join(tempRoot, "docs", "artifacts", "pair.json"), "utf8");

    assert.equal((mismatch.result as { status?: string }).status, "hash_mismatch");
    assert.equal((mismatch.result as { payloadHash?: { status?: string } }).payloadHash?.status, "not_configured");
    assert.equal((missing.result as { status?: string }).status, "incomplete_pair");
    assert.equal((invalid.result as { status?: string }).status, "invalid_json");
    assert.equal(after, before);
  });

  it("returns current-action context only from structured authority files", async () => {
    writeFile(
      "planning/workflow/current-action.json",
      `${JSON.stringify({
        currentActionId: "ACT-1",
        currentAction: "implement_artifact_actions",
        expectedOutput: { artifactType: "builder_report" },
        sourceBundle: { id: "SB-1", artifacts: [{ artifactId: "ART-1", relativePath: "docs/artifacts/a.md" }] },
        controllingFiles: ["AGENTS.MD", "missing.md"]
      })}\n`
    );
    writeFile("AGENTS.MD", "# Rules\n");

    const configured = await call("current_action_context", {});
    fs.rmSync(path.join(tempRoot, "planning"), { recursive: true, force: true });
    const notConfigured = await call("current_action_context", {});

    assert.equal((configured.result as { status?: string }).status, "ok");
    assert.equal((configured.result as { currentAction?: string }).currentAction, "implement_artifact_actions");
    assert.equal((configured.result as { blockers?: unknown[] }).blockers?.length, 1);
    assert.equal((notConfigured.result as { status?: string }).status, "not_configured");
    assert.equal((notConfigured.result as { reasonCode?: string }).reasonCode, "current_action_authority_not_configured");
    assert.ok((notConfigured.result as { checkedLocations?: unknown[] }).checkedLocations?.length);
  });

  it("exports a planning corpus manifest with hashes, source filtering, full-text paging, and binary reporting", async () => {
    const alpha = "# Alpha\n\nCorpus alpha text.\n";
    const beta = "# Beta\n\nCorpus beta text.\n";
    writeFile("planning/alpha.md", alpha, "2026-01-01T00:00:00.000Z");
    writeFile("planning/beta.md", beta, "2026-01-02T00:00:00.000Z");
    writeFile("planning/beta.json", `${JSON.stringify({ artifactId: "ART-BETA", artifactType: "plan", status: "draft", markdownPath: "planning/beta.md" })}\n`);
    const binaryPath = path.join(tempRoot, "planning", "binary.bin");
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
    fs.writeFileSync(binaryPath, Buffer.from([0, 1, 2, 3]));

    const manifestOnly = await call("export_planning_corpus", { pathPrefix: "planning", limit: 2 });
    const page1 = await call("export_planning_corpus", { pathPrefix: "planning", includeFullText: true, limit: 2, maxBundleBytes: 1000 });
    const nextCursor = (page1.result as { page?: { nextCursor?: string | null } }).page?.nextCursor;
    const page2 = await call("export_planning_corpus", { pathPrefix: "planning", includeFullText: true, limit: 2, maxBundleBytes: 1000, cursor: nextCursor });
    const sidecars = await call("export_planning_corpus", { pathPrefix: "planning", includeSidecars: true, limit: 10 });
    const denied = await call("export_planning_corpus", { pathPrefix: "docs" });

    assert.equal(manifestOnly.ok, true);
    assert.equal((manifestOnly.result as { counts?: { totalDiscoveredFilesystemFileCount?: number } }).counts?.totalDiscoveredFilesystemFileCount, 4);
    assert.ok((manifestOnly.result as { manifest?: Array<{ path?: string; sha256?: string }> }).manifest?.some((entry) => entry.path === "planning/alpha.md" && entry.sha256 === sha256(alpha)));
    assert.equal((page1.result as { fullText?: Array<{ path?: string; readStatus?: string }> }).fullText?.some((entry) => entry.path === "planning/alpha.md" && entry.readStatus === "read"), true);
    assert.equal((page2.result as { fullText?: Array<{ path?: string; readStatus?: string }> }).fullText?.some((entry) => entry.path === "planning/binary.bin" && entry.readStatus === "unsupported"), true);
    assert.equal((sidecars.result as { manifest?: Array<{ path?: string }> }).manifest?.some((entry) => entry.path === "planning/beta.json"), true);
    assert.equal(denied.ok, false);
    assert.equal(denied.error?.code, "PATH_DENIED");
  });

  it("returns only explicit Architect-review queue items and rejects unsafe metadata paths", async () => {
    writeFile("docs/artifacts/awaiting.md", "# Awaiting\n", "2026-01-02T00:00:00.000Z");
    writeFile(
      "docs/artifacts/awaiting.json",
      `${JSON.stringify({
        artifactId: "ART-AWAIT",
        phaseId: "phase-03",
        artifactType: "builder_report",
        workCardId: "WC03-REPAIR02",
        reviewStatus: "submitted_for_architect_review",
        submittedAt: "2026-01-05T00:00:00.000Z",
        markdownPath: "docs/artifacts/awaiting.md"
      })}\n`
    );
    writeFile("docs/artifacts/draft.json", `${JSON.stringify({ artifactId: "ART-DRAFT", artifactType: "builder_report", reviewStatus: "draft" })}\n`);
    writeFile("docs/artifacts/operator.json", `${JSON.stringify({ artifactId: "ART-OP", artifactType: "builder_report", reviewStatus: "operator_review_required" })}\n`);
    writeFile("docs/artifacts/approved.json", `${JSON.stringify({ artifactId: "ART-APPROVED", artifactType: "builder_report", reviewStatus: "approved" })}\n`);
    writeFile(
      ".champcity/artifact-registry.json",
      `${JSON.stringify({ artifacts: [{ artifactId: "ART-ESCAPE", artifactType: "builder_report", markdownPath: "../escape.md" }] })}\n`
    );

    const queue = await call("review_queue", { phaseId: "phase-03", artifactType: "builder_report", workCardId: "WC03-REPAIR02" });
    const unconfiguredRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-no-review-"));
    try {
      const unconfiguredConfig = testConfig(unconfiguredRoot);
      writeFile("docs/artifacts/plain.md", "# Plain\n");
      const unconfigured = await artifactToolbox({ action: "review_queue", params: {} }, unconfiguredConfig, context(unconfiguredConfig));
      assert.equal((unconfigured.result as { status?: string }).status, "review_authority_not_configured");
    } finally {
      fs.rmSync(unconfiguredRoot, { recursive: true, force: true });
    }

    const body = queue.result as { queue: Array<{ artifactId?: string; normalizedReviewStatus?: string }>; warnings: string[] };
    assert.deepEqual(body.queue.map((entry) => entry.artifactId), ["ART-AWAIT"]);
    assert.equal(body.queue[0]?.normalizedReviewStatus, "awaiting_architect_review");
    assert.ok(body.warnings.some((warning) => /Rejected unsafe artifact metadata path/u.test(warning)));
    assertNoAbsolutePath(queue);
  });
});
