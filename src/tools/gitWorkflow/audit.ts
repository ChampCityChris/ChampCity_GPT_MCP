import { type AppConfig } from "../../config.js";
import { writeAuditLog } from "../../security/auditLog.js";
import { getErrorMessage } from "../../utils/errors.js";

export interface GitWorkflowAuditMeta {
  toolName: string;
  action: string;
  root?: string;
  branch?: string;
  fileCount?: number;
  reason?: string;
}

export async function auditGitWorkflow(
  config: AppConfig,
  meta: GitWorkflowAuditMeta,
  result: "allow" | "deny",
  reason = meta.reason ?? "ok"
): Promise<void> {
  await writeAuditLog(config.auditLogPath, {
    toolName: meta.toolName,
    action: meta.action,
    root: meta.root,
    branch: meta.branch,
    fileCount: meta.fileCount,
    result,
    reason
  });
}

export async function auditGitWorkflowError(config: AppConfig, meta: GitWorkflowAuditMeta, error: unknown): Promise<void> {
  await auditGitWorkflow(config, meta, "deny", getErrorMessage(error));
}
