import fs from "node:fs";
import path from "node:path";

export type ChatGptEvidenceCheckStatus = "PASS" | "FAIL" | "WARN";

export interface ChatGptEvidenceCheck {
  id: string;
  status: ChatGptEvidenceCheckStatus;
  message: string;
  evidence?: unknown;
}

export interface ChatGptEvidenceReport {
  ok: boolean;
  checkedAt: string;
  target: string;
  summary: {
    passed: number;
    failed: number;
    warnings: number;
  };
  checks: ChatGptEvidenceCheck[];
}

export interface ValidateChatGptEvidenceOptions {
  checkedAt?: Date;
  repoRoot?: string;
  target?: string;
  templateMode?: boolean;
}

export const CHATGPT_EVIDENCE_TEMPLATE_PATH =
  "planning/phases/phase-v1.0/Live_Connector_Evidence/CHATGPT_LIVE_CONNECTOR_EVIDENCE_TEMPLATE.md";

export const REQUIRED_SECTIONS = [
  "Validation metadata",
  "Local deterministic baseline",
  "Live ChatGPT setup evidence",
  "Live tools/list evidence",
  "Live successful safe tool-call evidence",
  "Live denied unsafe/gated-call evidence",
  "Safety-layer regression evidence",
  "Failure classification",
  "Redaction checklist",
  "Final release-gate summary"
] as const;

export const REQUIRED_CAV_REFERENCES = [
  "CAV-007",
  "CAV-008",
  "CAV-009",
  "CAV-010",
  "CAV-011",
  "CAV-012",
  "CAV-013",
  "CAV-015",
  "CAV-018",
  "CAV-019",
  "CAV-021",
  "CAV-023",
  "CAV-030",
  "CAV-033"
] as const;

export const REQUIRED_SAFE_REPLACEMENT_TOOLS = [
  "get_workspace_status_summary",
  "get_change_set_readiness_summary",
  "get_release_artifact_summary",
  "get_release_publication_summary",
  "get_builder_report_index",
  "get_builder_report_summary"
] as const;

export const REQUIRED_METADATA_FIELDS = [
  "Evidence file version:",
  "Validation date/time:",
  "Operator:",
  "Architect:",
  "App version:",
  "Commit:",
  "Branch:",
  "Package/build source:",
  "ChatGPT plan/session type:",
  "Connector name:",
  "Public endpoint alias:",
  "Public endpoint redacted:",
  "Cloudflare tunnel state:",
  "OAuth path:",
  "Write mode:",
  "OAuth scopes observed:",
  "Local MCP self-test result:",
  "Evidence redactions confirmed:"
] as const;

const REQUIRED_BASELINE_COMMANDS = [
  "npm run mcp:self-test",
  "npm run mcp:self-test -- --json",
  "npm run check:public"
] as const;

const SAFE_PLACEHOLDERS = [
  "%USERPROFILE%",
  "%TEMP%",
  "<REDACTED_LOCAL_PATH>",
  "<REDACTED_PUBLIC_ENDPOINT>",
  "<REDACTED_SECRET>"
] as const;

interface UnsafePattern {
  id: string;
  regex: RegExp;
  message: string;
}

const UNSAFE_PATTERNS: readonly UnsafePattern[] = [
  {
    id: "OPENAI_TOKEN",
    regex: /sk-[A-Za-z0-9_-]{20,}/u,
    message: "OpenAI-style token-looking content is not allowed."
  },
  {
    id: "GITHUB_TOKEN",
    regex: /gh[pousr]_[A-Za-z0-9_]{20,}/u,
    message: "GitHub token-looking content is not allowed."
  },
  {
    id: "FIGMA_TOKEN",
    regex: /figd_[A-Za-z0-9_-]{20,}/u,
    message: "Figma token-looking content is not allowed."
  },
  {
    id: "CLOUDFLARE_TOKEN",
    regex: /(?:cloudflare|cf)[^\r\n]{0,40}(?:api[_ -]?token|token)\s*[:=]\s*(?!<)[A-Za-z0-9_-]{30,}/iu,
    message: "Cloudflare token-looking content is not allowed."
  },
  {
    id: "ACCESS_TOKEN_ASSIGNMENT",
    regex: /(?:^|[?&\s;])access_token\s*=/iu,
    message: "Raw access-token assignment content is not allowed."
  },
  {
    id: "REFRESH_TOKEN_ASSIGNMENT",
    regex: /(?:^|[?&\s;])refresh_token\s*=/iu,
    message: "Raw refresh-token assignment content is not allowed."
  },
  {
    id: "AUTHORIZATION_CODE_ASSIGNMENT",
    regex: /(?:^|[?&\s;])authorization_code\s*=/iu,
    message: "Raw authorization-code assignment content is not allowed."
  },
  {
    id: "CLIENT_SECRET_ASSIGNMENT",
    regex: /(?:^|[?&\s;])client_secret\s*=/iu,
    message: "Raw client-secret assignment content is not allowed."
  },
  {
    id: "PASSWORD_ASSIGNMENT",
    regex: /(?:^|[?&\s;])password\s*=/iu,
    message: "Raw password assignment content is not allowed."
  },
  {
    id: "WINDOWS_USER_PATH",
    regex: /[A-Z]:\\Users\\(?!<)[^\\\s"'`<>]+/iu,
    message: "Private Windows user path content is not allowed."
  },
  {
    id: "WINDOWS_USER_PATH_SLASHES",
    regex: /[A-Z]:\/Users\/(?!<)[^/\s"'`<>]+/iu,
    message: "Private Windows user path content is not allowed."
  },
  {
    id: "MAC_USER_PATH",
    regex: /\/Users\/(?!<)[^/\s"'`<>]+/iu,
    message: "Private macOS user path content is not allowed."
  },
  {
    id: "LINUX_USER_PATH",
    regex: /\/home\/(?!<)[^/\s"'`<>]+/iu,
    message: "Private Linux user path content is not allowed."
  },
  {
    id: "ENV_SECRET_ASSIGNMENT",
    regex:
      /^(?:[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|ACCESS_TOKEN|REFRESH_TOKEN|CLIENT_SECRET|API_KEY|PRIVATE_KEY)[A-Z0-9_]*)\s*=\s*(?!<REDACTED_SECRET>|<[^>]+>)[^\s#<][^\r\n]{7,}$/imu,
    message: ".env-style secret assignment content is not allowed."
  },
  {
    id: "PRIVATE_KEY_BLOCK",
    regex: /PRIVATE KEY|-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
    message: "Private-key material is not allowed."
  }
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function pass(id: string, message: string, evidence?: unknown): ChatGptEvidenceCheck {
  return { id, status: "PASS", message, ...(evidence === undefined ? {} : { evidence }) };
}

function fail(id: string, message: string, evidence?: unknown): ChatGptEvidenceCheck {
  return { id, status: "FAIL", message, ...(evidence === undefined ? {} : { evidence }) };
}

function warn(id: string, message: string, evidence?: unknown): ChatGptEvidenceCheck {
  return { id, status: "WARN", message, ...(evidence === undefined ? {} : { evidence }) };
}

function summarize(checks: readonly ChatGptEvidenceCheck[]): ChatGptEvidenceReport["summary"] {
  return {
    passed: checks.filter((check) => check.status === "PASS").length,
    failed: checks.filter((check) => check.status === "FAIL").length,
    warnings: checks.filter((check) => check.status === "WARN").length
  };
}

function hasMarkdownHeading(markdown: string, sectionTitle: string): boolean {
  return new RegExp(`^#{1,6}\\s+(?:\\d+\\.\\s+)?${escapeRegExp(sectionTitle)}\\s*$`, "imu").test(markdown);
}

function hasLineLabel(markdown: string, label: string): boolean {
  return new RegExp(`^\\s*${escapeRegExp(label)}`, "imu").test(markdown);
}

function evaluateRequiredSections(markdown: string): ChatGptEvidenceCheck {
  const missingSections = REQUIRED_SECTIONS.filter((section) => !hasMarkdownHeading(markdown, section));
  if (missingSections.length > 0) {
    return fail("REQUIRED_SECTIONS", "Evidence is missing one or more required sections.", { missingSections });
  }

  return pass("REQUIRED_SECTIONS", "Evidence contains all required sections.", {
    sectionCount: REQUIRED_SECTIONS.length
  });
}

function evaluateRequiredCavReferences(markdown: string): ChatGptEvidenceCheck {
  const missingCavReferences = REQUIRED_CAV_REFERENCES.filter((cavId) => !new RegExp(`\\b${escapeRegExp(cavId)}\\b`, "u").test(markdown));
  if (missingCavReferences.length > 0) {
    return fail("REQUIRED_CAV_REFERENCES", "Evidence is missing one or more required CAV references.", {
      missingCavReferences
    });
  }

  return pass("REQUIRED_CAV_REFERENCES", "Evidence mentions all required CAV references.", {
    cavReferenceCount: REQUIRED_CAV_REFERENCES.length
  });
}

function evaluateRequiredSafeReplacementTools(markdown: string): ChatGptEvidenceCheck {
  const missingTools = REQUIRED_SAFE_REPLACEMENT_TOOLS.filter((toolName) => !markdown.includes(toolName));
  if (missingTools.length > 0) {
    return fail("REQUIRED_SAFE_REPLACEMENT_TOOLS", "Evidence is missing one or more required safe replacement tool names.", {
      missingTools
    });
  }

  return pass("REQUIRED_SAFE_REPLACEMENT_TOOLS", "Evidence mentions all required safe replacement tools.", {
    toolCount: REQUIRED_SAFE_REPLACEMENT_TOOLS.length
  });
}

function evaluateMetadataFields(markdown: string): ChatGptEvidenceCheck {
  const missingFields = REQUIRED_METADATA_FIELDS.filter((field) => !hasLineLabel(markdown, field));
  if (missingFields.length > 0) {
    return fail("VALIDATION_METADATA_FIELDS", "Evidence metadata is missing one or more required fields.", {
      missingFields
    });
  }

  return pass("VALIDATION_METADATA_FIELDS", "Evidence metadata contains all required fields.", {
    fieldCount: REQUIRED_METADATA_FIELDS.length
  });
}

function evaluateLocalBaselineCommands(markdown: string): ChatGptEvidenceCheck {
  const missingCommands = REQUIRED_BASELINE_COMMANDS.filter((command) => !markdown.includes(command));
  if (missingCommands.length > 0) {
    return fail("LOCAL_BASELINE_COMMANDS", "Evidence is missing one or more required local baseline commands.", {
      missingCommands
    });
  }

  return pass("LOCAL_BASELINE_COMMANDS", "Evidence mentions all required local deterministic baseline commands.", {
    commandCount: REQUIRED_BASELINE_COMMANDS.length
  });
}

function evaluateSafePlaceholdersAllowed(markdown: string): ChatGptEvidenceCheck {
  const missingPlaceholders = SAFE_PLACEHOLDERS.filter((placeholder) => !markdown.includes(placeholder));
  if (missingPlaceholders.length > 0) {
    return warn("SAFE_PLACEHOLDERS_DOCUMENTED", "Evidence does not mention all standard safe redaction placeholders.", {
      missingPlaceholders
    });
  }

  return pass("SAFE_PLACEHOLDERS_DOCUMENTED", "Evidence mentions the standard safe redaction placeholders.", {
    placeholders: [...SAFE_PLACEHOLDERS]
  });
}

function evaluateRedactionSafety(markdown: string): ChatGptEvidenceCheck {
  const failures = UNSAFE_PATTERNS.filter((pattern) => pattern.regex.test(markdown)).map((pattern) => ({
    id: pattern.id,
    message: pattern.message
  }));

  if (failures.length > 0) {
    return fail("REDACTION_SAFETY", "Evidence contains unsafe token, credential, private path, or key-looking content.", {
      failures
    });
  }

  return pass("REDACTION_SAFETY", "Evidence does not contain obvious unsafe token, credential, private path, or key-looking content.", {
    patternCount: UNSAFE_PATTERNS.length
  });
}

function sanitizeTargetPath(value: string, repoRoot: string): string {
  const resolved = path.resolve(value);
  const root = path.resolve(repoRoot);
  const relative = path.relative(root, resolved);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join("/");
  }

  return value
    .replace(/[A-Z]:[\\/]+Users[\\/]+[^\\/ \r\n"'`]+/giu, "%USERPROFILE%")
    .replace(/\/Users\/[^/ \r\n"'`]+/gu, "%USERPROFILE%")
    .replace(/\/home\/[^/ \r\n"'`]+/gu, "%USERPROFILE%");
}

export function validateChatGptEvidenceText(markdown: string, options: ValidateChatGptEvidenceOptions = {}): ChatGptEvidenceReport {
  const checkedAt = (options.checkedAt ?? new Date()).toISOString();
  const target = options.target ?? "inline";
  const checks = [
    evaluateRequiredSections(markdown),
    evaluateRequiredCavReferences(markdown),
    evaluateRequiredSafeReplacementTools(markdown),
    evaluateMetadataFields(markdown),
    evaluateLocalBaselineCommands(markdown),
    evaluateSafePlaceholdersAllowed(markdown),
    evaluateRedactionSafety(markdown)
  ];
  const summary = summarize(checks);

  return {
    ok: summary.failed === 0,
    checkedAt,
    target,
    summary,
    checks
  };
}

export function validateChatGptEvidenceFile(filePath: string, options: ValidateChatGptEvidenceOptions = {}): ChatGptEvidenceReport {
  const repoRoot = options.repoRoot ?? process.cwd();
  const target = options.target ?? sanitizeTargetPath(filePath, repoRoot);
  const markdown = fs.readFileSync(path.resolve(filePath), "utf8");
  return validateChatGptEvidenceText(markdown, { ...options, target });
}

export function validateChatGptEvidenceDirectory(dirPath: string, options: ValidateChatGptEvidenceOptions = {}): ChatGptEvidenceReport {
  const repoRoot = options.repoRoot ?? process.cwd();
  const resolvedDir = path.resolve(dirPath);
  const target = options.target ?? sanitizeTargetPath(resolvedDir, repoRoot);
  const entries = fs
    .readdirSync(resolvedDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((entry) => entry.toLowerCase().endsWith(".md"))
    .filter((entry) => {
      if (options.templateMode) {
        return entry === path.basename(CHATGPT_EVIDENCE_TEMPLATE_PATH);
      }
      return entry !== "README.md" && entry !== path.basename(CHATGPT_EVIDENCE_TEMPLATE_PATH);
    })
    .sort((a, b) => a.localeCompare(b));

  if (entries.length === 0) {
    const checkedAt = (options.checkedAt ?? new Date()).toISOString();
    const checks = [
      warn(
        "EVIDENCE_DIRECTORY_EMPTY",
        options.templateMode
          ? "No template Markdown file was found in the evidence directory."
          : "No live evidence Markdown files were found in the evidence directory.",
        { directory: target }
      )
    ];
    const summary = summarize(checks);
    return {
      ok: true,
      checkedAt,
      target,
      summary,
      checks
    };
  }

  const reports = entries.map((entry) => {
    const filePath = path.join(resolvedDir, entry);
    return validateChatGptEvidenceFile(filePath, {
      ...options,
      target: sanitizeTargetPath(filePath, repoRoot)
    });
  });
  const checks = reports.flatMap((report) =>
    report.checks.map((check) => ({
      ...check,
      id: `${report.target}:${check.id}`
    }))
  );
  const summary = summarize(checks);

  return {
    ok: summary.failed === 0,
    checkedAt: (options.checkedAt ?? new Date()).toISOString(),
    target,
    summary,
    checks
  };
}

export function formatChatGptEvidenceHuman(report: ChatGptEvidenceReport): string {
  const lines = [
    `ChatGPT evidence validation ${report.ok ? "PASS" : "FAIL"}`,
    `Target: ${report.target}`,
    ...report.checks.map((check) => `${check.status.padEnd(4)} ${check.id} - ${check.message}`),
    `Summary: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.warnings} warnings`
  ];

  return lines.join("\n");
}
