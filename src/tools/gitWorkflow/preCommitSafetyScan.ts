import { type AppConfig } from "../../config.js";
import { withAudit } from "../common.js";
import { preCommitSafetyScan as runPreCommitSafetyScan, type SafetyScanSummary } from "./safety.js";

export async function preCommitSafetyScan(rawInput: unknown, config: AppConfig): Promise<SafetyScanSummary> {
  return withAudit(config, { toolName: "pre_commit_safety_scan" }, async (updateAudit) => {
    const result = await runPreCommitSafetyScan(rawInput, config);
    updateAudit({
      requestedPath: result.scannedFiles.join(";")
    });
    return result;
  });
}
