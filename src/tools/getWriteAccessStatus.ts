import { z } from "zod";

import { type AppConfig } from "../config.js";
import { getPendingPatchProposalCount } from "../pendingPatches.js";
import { withAudit } from "./common.js";

export const GetWriteAccessStatusInputSchema = z.object({});

export interface GetWriteAccessStatusOutput {
  writeMode: "off" | "docs" | "patch" | "elevated";
  writeModeSource: "env" | "local-file" | "legacy-env" | "default";
  docsWritesAllowed: boolean;
  patchWritesAllowed: boolean;
  elevatedOperationsAllowed: boolean;
  legacyApprovalTokenConfigured: boolean;
  pendingPatchProposalCount: number;
  oauthFilesWriteGranted: boolean | "unknown";
}

export async function getWriteAccessStatus(rawInput: unknown, config: AppConfig): Promise<GetWriteAccessStatusOutput> {
  return withAudit(config, { toolName: "get_write_access_status" }, async () => {
    GetWriteAccessStatusInputSchema.parse(rawInput);
    return {
      writeMode: config.writeMode,
      writeModeSource: config.writeModeSource,
      docsWritesAllowed: config.docsWritesAllowed,
      patchWritesAllowed: config.patchWritesAllowed,
      elevatedOperationsAllowed: config.elevatedOperationsAllowed,
      legacyApprovalTokenConfigured: config.writeApprovalToken.source !== "none",
      pendingPatchProposalCount: getPendingPatchProposalCount(config.repoRoot),
      oauthFilesWriteGranted: "unknown"
    };
  });
}
