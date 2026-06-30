import fs from "node:fs";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const json = args.includes("--json");
const unknownArgs = args.filter((arg) => arg !== "--json");

if (unknownArgs.length > 0) {
  console.error(`Unknown argument: ${unknownArgs.join(" ")}`);
  process.exit(1);
}

const selfTestModuleUrl = new URL("../dist/src/validation/mcpSelfTest.js", import.meta.url);
const selfTestModulePath = fileURLToPath(selfTestModuleUrl);

if (!fs.existsSync(selfTestModulePath)) {
  console.error("MCP self-test requires a current build. Run npm run build first.");
  process.exit(1);
}

function sanitizeMessage(value) {
  return String(value)
    .replace(/[A-Z]:[\\/]+Users[\\/]+[^\\/ \r\n"'`]+[\\/]+AppData[\\/]+Local[\\/]+Temp/giu, "%TEMP%")
    .replace(/[A-Z]:[\\/]+Users[\\/]+[^\\/ \r\n"'`]+/giu, "%USERPROFILE%")
    .replace(/\/Users\/[^/ \r\n"'`]+/gu, "%USERPROFILE%")
    .replace(/\/home\/[^/ \r\n"'`]+/gu, "%USERPROFILE%");
}

let selfTestModule;
try {
  selfTestModule = await import(selfTestModuleUrl.href);
} catch (error) {
  const report = {
    ok: false,
    checkedAt: new Date().toISOString(),
    summary: {
      passed: 0,
      failed: 1,
      warnings: 0,
      info: 0
    },
    checks: [
      {
        id: "TOOL_REGISTRY_LOADS",
        status: "FAIL",
        message: "MCP tool registry could not be imported.",
        evidence: {
          message: sanitizeMessage(error instanceof Error ? error.message : error)
        }
      }
    ]
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("MCP self-test FAIL");
    console.log(`FAIL TOOL_REGISTRY_LOADS - ${report.checks[0].message}`);
    console.log("Summary: 0 passed, 1 failed, 0 warnings, 0 info");
  }
  process.exit(1);
}

const { formatMcpSelfTestHuman, runMcpSelfTest } = selfTestModule;
const report = await runMcpSelfTest();

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(formatMcpSelfTestHuman(report));
}

process.exit(report.ok ? 0 : 1);
