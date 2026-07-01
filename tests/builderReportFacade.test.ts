import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { type AppConfig } from "../src/config.js";
import { getBuilderReportIndex, getBuilderReportSummary } from "../src/tools/builderReportFacade.js";
import { readProjectFile } from "../src/tools/readProjectFile.js";

let tempRoot: string;
let defaultRoot: string;
let aiRoot: string;
let auditRoot: string;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-builder-facade-"));
  defaultRoot = path.join(tempRoot, "ChampCity_GPT");
  aiRoot = path.join(tempRoot, "ChampCity_AI");
  auditRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-builder-facade-audit-"));
  fs.mkdirSync(defaultRoot, { recursive: true });
  fs.mkdirSync(aiRoot, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.rmSync(auditRoot, { recursive: true, force: true });
});

function testConfig(allowedRoots = [defaultRoot]): AppConfig {
  return {
    repoRoot: defaultRoot,
    allowedRoots,
    auditLogPath: path.join(auditRoot, "audit.log"),
    requireGitRoot: true,
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

function reportRelativePath(phaseFolder: string, fileName: string): string {
  return `planning/phases/${phaseFolder}/Builder_Reports/${fileName}`;
}

function writeReport(root: string, phaseFolder: string, fileName: string, content: string): string {
  const relativePath = reportRelativePath(phaseFolder, fileName);
  const absolutePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf8");
  return relativePath;
}

function assertNoAbsoluteLocalPath(value: unknown): void {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /[A-Z]:\\Users\\/iu);
  assert.doesNotMatch(serialized, /\/Users\/[^/"']+/iu);
  assert.doesNotMatch(serialized, /\/home\/[^/"']+/iu);
  assert.doesNotMatch(serialized, new RegExp(tempRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
}

describe("Builder Report facade tools", () => {
  it("get_builder_report_index finds a WC07-like report without caller root or glob", async () => {
    const relativePath = writeReport(
      defaultRoot,
      "phase-01",
      "BUILDER_REPORT_WC07_human_validation_and_repair_loop.md",
      "# Builder Report - WC07\n\nSafe report.\n"
    );

    const result = await getBuilderReportIndex({ workCardId: "WC07" }, testConfig());

    assert.equal(result.workspaceId, "champcity_gpt");
    assert.equal(result.resultCount, 1);
    assert.equal(result.reports[0]?.relativePath, relativePath);
    assert.equal(result.reports[0]?.fileName, "BUILDER_REPORT_WC07_human_validation_and_repair_loop.md");
    assert.equal(result.reports[0]?.phaseFolder, "phase-01");
    assert.equal(result.reports[0]?.workCardId, "WC07");
    assert.equal(result.reports[0]?.title, "Builder Report - WC07");
    assert.equal(result.truncated, false);
    assertNoAbsoluteLocalPath(result);
  });

  it("get_builder_report_index respects phaseFolder, workCardId, and maxResults", async () => {
    writeReport(defaultRoot, "phase-01", "BUILDER_REPORT_WC07_first.md", "# First\n");
    writeReport(defaultRoot, "phase-01", "BUILDER_REPORT_WC07_second.md", "# Second\n");
    writeReport(defaultRoot, "phase-v1.0", "BUILDER_REPORT_WC07_other_phase.md", "# Other\n");
    writeReport(defaultRoot, "phase-01", "BUILDER_REPORT_WC08_unmatched.md", "# Unmatched\n");

    const result = await getBuilderReportIndex({ phaseFolder: "phase-01", workCardId: "WC07", maxResults: 1 }, testConfig());

    assert.equal(result.query.phaseFolder, "phase-01");
    assert.equal(result.query.workCardId, "WC07");
    assert.equal(result.query.maxResults, 1);
    assert.equal(result.resultCount, 1);
    assert.equal(result.truncated, true);
    assert.equal(result.reports[0]?.phaseFolder, "phase-01");
    assert.equal(result.reports[0]?.workCardId, "WC07");
    assertNoAbsoluteLocalPath(result);
  });

  it("get_builder_report_index hard-caps excessive maxResults", async () => {
    for (let index = 0; index < 60; index += 1) {
      writeReport(defaultRoot, "phase-01", `BUILDER_REPORT_WC${String(index).padStart(2, "0")}_fixture.md`, `# Report ${index}\n`);
    }

    const result = await getBuilderReportIndex({ maxResults: 1000 }, testConfig());

    assert.equal(result.query.maxResults, 50);
    assert.equal(result.resultCount, 50);
    assert.equal(result.truncated, true);
    assertNoAbsoluteLocalPath(result);
  });

  it("get_builder_report_index supports safe aliases and all_allowed for configured roots", async () => {
    const relativePath = writeReport(
      aiRoot,
      "phase-01",
      "BUILDER_REPORT_WC07_human_validation_and_repair_loop.md",
      "# ChampCity AI WC07\n"
    );
    const config = testConfig([defaultRoot, aiRoot]);

    const aliasResult = await getBuilderReportIndex({ workspaceId: "champcity_ai", workCardId: "WC07" }, config);
    const allAllowedResult = await getBuilderReportIndex({ workspaceId: "all_allowed", workCardId: "WC07" }, config);

    assert.equal(aliasResult.workspaceId, "champcity_ai");
    assert.equal(aliasResult.resultCount, 1);
    assert.equal(aliasResult.reports[0]?.relativePath, relativePath);
    assert.equal(allAllowedResult.workspaceId, "all_allowed");
    assert.equal(allAllowedResult.resultCount, 1);
    assert.equal(allAllowedResult.reports[0]?.workspaceId, "champcity_ai");
    assertNoAbsoluteLocalPath(aliasResult);
    assertNoAbsoluteLocalPath(allAllowedResult);
  });

  it("get_builder_report_summary retrieves a report by safe reportPath", async () => {
    const relativePath = writeReport(defaultRoot, "phase-v1.0", "BUILDER_REPORT_WC-V1-0102A_fixture.md", "# Summary Path\n\nBody.\n");

    const result = await getBuilderReportSummary({ reportPath: relativePath }, testConfig());

    assert.equal(result.matched, true);
    assert.equal(result.ambiguous, false);
    assert.equal(result.report?.relativePath, relativePath);
    assert.equal(result.report?.workCardId, "WC-V1-0102A");
    assert.match(result.contentPreview ?? "", /Body/u);
    assertNoAbsoluteLocalPath(result);
  });

  it("get_builder_report_summary retrieves a report by phaseFolder and workCardId", async () => {
    const relativePath = writeReport(defaultRoot, "phase-01", "BUILDER_REPORT_FIX01_agents_report_rule.md", "# FIX01\n\nBody.\n");

    const result = await getBuilderReportSummary({ phaseFolder: "phase-01", workCardId: "fix01" }, testConfig());

    assert.equal(result.matched, true);
    assert.equal(result.ambiguous, false);
    assert.equal(result.report?.relativePath, relativePath);
    assert.equal(result.report?.workCardId, "FIX01");
    assertNoAbsoluteLocalPath(result);
  });

  it("get_builder_report_summary reports ambiguity instead of guessing", async () => {
    writeReport(defaultRoot, "phase-01", "BUILDER_REPORT_WC07_first.md", "# First\n");
    writeReport(defaultRoot, "phase-01", "BUILDER_REPORT_WC07_second.md", "# Second\n");

    const result = await getBuilderReportSummary({ phaseFolder: "phase-01", workCardId: "WC07" }, testConfig());

    assert.equal(result.matched, false);
    assert.equal(result.ambiguous, true);
    assert.equal(result.report, null);
    assert.equal(result.candidates?.length, 2);
    assertNoAbsoluteLocalPath(result);
  });

  it("get_builder_report_summary returns structured not-found output", async () => {
    writeReport(defaultRoot, "phase-01", "BUILDER_REPORT_WC07_existing.md", "# Existing\n");

    const result = await getBuilderReportSummary({ phaseFolder: "phase-01", workCardId: "WC99" }, testConfig());

    assert.equal(result.matched, false);
    assert.equal(result.ambiguous, false);
    assert.equal(result.report, null);
    assert.equal(result.truncated, false);
    assertNoAbsoluteLocalPath(result);
  });

  it("get_builder_report_summary bounds preview by maxChars hard cap", async () => {
    const relativePath = writeReport(defaultRoot, "phase-01", "BUILDER_REPORT_WC07_large.md", `# Large\n\n${"A".repeat(13_000)}\n`);

    const result = await getBuilderReportSummary({ reportPath: relativePath, maxChars: 99_999 }, testConfig());

    assert.equal(result.matched, true);
    assert.equal(result.contentPreview?.length, 12_000);
    assert.equal(result.truncated, true);
    assertNoAbsoluteLocalPath(result);
  });

  it("get_builder_report_summary sanitizes private local path-like content from previews", async () => {
    const windowsUserPath = ["C:", "Us" + "ers", "Alice", "Projects", "Secret"].join("\\");
    const unixUserPath = ["", "ho" + "me", "alice", "project"].join("/");
    const relativePath = writeReport(
      defaultRoot,
      "phase-01",
      "BUILDER_REPORT_WC07_paths.md",
      `# Paths\n\nWindows: ${windowsUserPath}\nUnix: ${unixUserPath}\naccess_token=secret-value\n`
    );

    const result = await getBuilderReportSummary({ reportPath: relativePath }, testConfig());

    assert.match(result.contentPreview ?? "", /%USERPROFILE%/u);
    assert.match(result.contentPreview ?? "", /access_token=<REDACTED_SECRET>/u);
    assert.equal((result.contentPreview ?? "").includes(windowsUserPath), false);
    assert.equal((result.contentPreview ?? "").includes(unixUserPath), false);
    assert.doesNotMatch(result.contentPreview ?? "", /secret-value/u);
    assert.ok(result.warnings.some((warning) => /redacted/u.test(warning)));
    assertNoAbsoluteLocalPath(result);
  });

  it("rejects path traversal attempts", async () => {
    await assert.rejects(
      () =>
        getBuilderReportSummary(
          { reportPath: "planning/phases/phase-01/Builder_Reports/../BUILDER_REPORT_WC07_escape.md" },
          testConfig()
        ),
      /Path traversal is not allowed|reportPath must be/u
    );
  });

  it("rejects workspaceId values that look like filesystem paths", async () => {
    const pathLikeWorkspaceId = ["C:", "Us" + "ers", "Alice", "Project"].join("\\");

    await assert.rejects(() => getBuilderReportIndex({ workspaceId: pathLikeWorkspaceId }, testConfig()), /Invalid/u);
  });

  it("rejects all_allowed for summary", async () => {
    await assert.rejects(
      () => getBuilderReportSummary({ workspaceId: "all_allowed", phaseFolder: "phase-01", workCardId: "WC07" }, testConfig()),
      /all_allowed is only supported/u
    );
  });

  it("keeps existing blocked-file behavior intact", async () => {
    fs.writeFileSync(path.join(defaultRoot, ".env"), "TOKEN=not-a-real-token\n", "utf8");

    await assert.rejects(
      () => readProjectFile({ root: defaultRoot, relativePath: ".env" }, testConfig()),
      /Environment files are blocked/u
    );
  });
});
