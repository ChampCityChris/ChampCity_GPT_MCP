import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  CHATGPT_EVIDENCE_TEMPLATE_PATH,
  REQUIRED_CAV_REFERENCES,
  REQUIRED_SAFE_REPLACEMENT_TOOLS,
  REQUIRED_SECTIONS,
  validateChatGptEvidenceText,
  type ChatGptEvidenceReport
} from "../src/validation/chatgptEvidence.js";

const repoRoot = process.cwd();
const templatePath = path.join(repoRoot, CHATGPT_EVIDENCE_TEMPLATE_PATH);

function readTemplate(): string {
  return fs.readFileSync(templatePath, "utf8");
}

function runCli(args: string[]) {
  const result = spawnSync(process.execPath, ["scripts/validate-chatgpt-evidence.mjs", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    windowsHide: true
  });

  return {
    status: result.status,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? "")
  };
}

describe("ChatGPT evidence validator", () => {
  it("template contains all required sections", () => {
    const template = readTemplate();

    for (const section of REQUIRED_SECTIONS) {
      assert.match(template, new RegExp(`^#{1,6}\\s+(?:\\d+\\.\\s+)?${section.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s*$`, "imu"));
    }
  });

  it("template mentions all required CAV IDs", () => {
    const template = readTemplate();

    for (const cavId of REQUIRED_CAV_REFERENCES) {
      assert.match(template, new RegExp(`\\b${cavId}\\b`, "u"));
    }
  });

  it("template mentions all required safe replacement tools", () => {
    const template = readTemplate();

    for (const toolName of REQUIRED_SAFE_REPLACEMENT_TOOLS) {
      assert.match(template, new RegExp(toolName, "u"));
    }
  });

  it("passes the template in template mode", () => {
    const report = validateChatGptEvidenceText(readTemplate(), {
      target: CHATGPT_EVIDENCE_TEMPLATE_PATH,
      templateMode: true
    });

    assert.equal(report.ok, true);
    assert.equal(report.summary.failed, 0);
  });

  it("fails evidence with token-looking content", () => {
    const tokenLikeValue = ["sk", "test", "A".repeat(32)].join("-");
    const report = validateChatGptEvidenceText(`${readTemplate()}\n\nToken test: ${tokenLikeValue}\n`, {
      target: "token-fixture"
    });

    assert.equal(report.ok, false);
    assert.ok(report.checks.some((check) => check.id === "REDACTION_SAFETY" && check.status === "FAIL"));
  });

  it("fails evidence with private local user path content", () => {
    const privatePath = ["C:", "Users", "localperson", "secret.txt"].join("\\");
    const report = validateChatGptEvidenceText(`${readTemplate()}\n\nPath test: ${privatePath}\n`, {
      target: "path-fixture"
    });

    assert.equal(report.ok, false);
    assert.ok(report.checks.some((check) => check.id === "REDACTION_SAFETY" && check.status === "FAIL"));
  });

  it("fails evidence missing a required section", () => {
    const template = readTemplate().replace(/^## 4\. Live tools\/list evidence\s*$/imu, "## 4. Removed Section");
    const report = validateChatGptEvidenceText(template, { target: "missing-section-fixture" });

    assert.equal(report.ok, false);
    assert.ok(report.checks.some((check) => check.id === "REQUIRED_SECTIONS" && check.status === "FAIL"));
  });

  it("fails evidence missing a required CAV reference", () => {
    const template = readTemplate().replaceAll("CAV-033", "CAV-XXX");
    const report = validateChatGptEvidenceText(template, { target: "missing-cav-fixture" });

    assert.equal(report.ok, false);
    assert.ok(report.checks.some((check) => check.id === "REQUIRED_CAV_REFERENCES" && check.status === "FAIL"));
  });

  it("permits safe redaction placeholders", () => {
    const placeholders = ["%USERPROFILE%", "%TEMP%", "<REDACTED_LOCAL_PATH>", "<REDACTED_SECRET>", "<REDACTED_PUBLIC_ENDPOINT>"];
    const report = validateChatGptEvidenceText(`${readTemplate()}\n\n${placeholders.join("\n")}\n`, {
      target: "placeholder-fixture"
    });

    assert.equal(report.ok, true);
  });

  it("JSON validator output is valid and includes ok, summary, and checks", () => {
    const result = runCli(["--template", "--json"]);

    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout) as ChatGptEvidenceReport;
    assert.equal(typeof parsed.ok, "boolean");
    assert.equal(typeof parsed.summary.passed, "number");
    assert.ok(Array.isArray(parsed.checks));
    assert.ok(parsed.checks.length > 0);
  });
});
