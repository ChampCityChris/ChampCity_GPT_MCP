import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);

function parseArgs(rawArgs) {
  const parsed = {
    file: undefined,
    dir: undefined,
    json: false,
    template: false
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--template") {
      parsed.template = true;
    } else if (arg === "--file") {
      index += 1;
      parsed.file = rawArgs[index];
    } else if (arg.startsWith("--file=")) {
      parsed.file = arg.slice("--file=".length);
    } else if (arg === "--dir") {
      index += 1;
      parsed.dir = rawArgs[index];
    } else if (arg.startsWith("--dir=")) {
      parsed.dir = arg.slice("--dir=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (parsed.file && parsed.dir) {
    throw new Error("Use either --file or --dir, not both.");
  }

  if (!parsed.file && !parsed.dir && !parsed.template) {
    throw new Error("Provide --file <path>, --dir <path>, or --template.");
  }

  return parsed;
}

function usage() {
  return [
    "Usage:",
    "  npm run chatgpt:evidence:validate -- --file <path>",
    "  npm run chatgpt:evidence:validate -- --dir <path>",
    "  npm run chatgpt:evidence:validate -- --template",
    "  npm run chatgpt:evidence:validate -- --file <path> --template --json"
  ].join("\n");
}

function sanitizeMessage(value) {
  return String(value)
    .replace(/[A-Z]:[\\/]+Users[\\/]+[^\\/ \r\n"'`]+/giu, "%USERPROFILE%")
    .replace(/\/Users\/[^/ \r\n"'`]+/gu, "%USERPROFILE%")
    .replace(/\/home\/[^/ \r\n"'`]+/gu, "%USERPROFILE%");
}

let parsedArgs;
try {
  parsedArgs = parseArgs(args);
} catch (error) {
  console.error(sanitizeMessage(error instanceof Error ? error.message : error));
  console.error(usage());
  process.exit(1);
}

const validatorModuleUrl = new URL("../dist/src/validation/chatgptEvidence.js", import.meta.url);
const validatorModulePath = fileURLToPath(validatorModuleUrl);

if (!fs.existsSync(validatorModulePath)) {
  console.error("ChatGPT evidence validator requires a current build. Run npm run build first.");
  process.exit(1);
}

let validatorModule;
try {
  validatorModule = await import(validatorModuleUrl.href);
} catch (error) {
  const report = {
    ok: false,
    checkedAt: new Date().toISOString(),
    target: "validator-module",
    summary: {
      passed: 0,
      failed: 1,
      warnings: 0
    },
    checks: [
      {
        id: "VALIDATOR_IMPORT",
        status: "FAIL",
        message: "ChatGPT evidence validator could not be imported.",
        evidence: {
          message: sanitizeMessage(error instanceof Error ? error.message : error)
        }
      }
    ]
  };

  if (parsedArgs.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("ChatGPT evidence validation FAIL");
    console.log(`FAIL VALIDATOR_IMPORT - ${report.checks[0].message}`);
    console.log("Summary: 0 passed, 1 failed, 0 warnings");
  }
  process.exit(1);
}

const {
  CHATGPT_EVIDENCE_TEMPLATE_PATH,
  formatChatGptEvidenceHuman,
  validateChatGptEvidenceDirectory,
  validateChatGptEvidenceFile
} = validatorModule;

const targetFile = parsedArgs.file ?? (parsedArgs.template && !parsedArgs.dir ? CHATGPT_EVIDENCE_TEMPLATE_PATH : undefined);
const targetDir = parsedArgs.dir;

let report;
try {
  if (targetDir) {
    report = validateChatGptEvidenceDirectory(path.resolve(process.cwd(), targetDir), {
      templateMode: parsedArgs.template
    });
  } else {
    report = validateChatGptEvidenceFile(path.resolve(process.cwd(), targetFile), {
      templateMode: parsedArgs.template
    });
  }
} catch (error) {
  report = {
    ok: false,
    checkedAt: new Date().toISOString(),
    target: targetFile ?? targetDir ?? "unknown",
    summary: {
      passed: 0,
      failed: 1,
      warnings: 0
    },
    checks: [
      {
        id: "EVIDENCE_READ",
        status: "FAIL",
        message: "Evidence target could not be read.",
        evidence: {
          message: sanitizeMessage(error instanceof Error ? error.message : error)
        }
      }
    ]
  };
}

if (parsedArgs.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(formatChatGptEvidenceHuman(report));
}

process.exit(report.ok ? 0 : 1);
