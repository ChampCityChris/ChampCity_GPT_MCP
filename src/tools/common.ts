import { AppConfig } from "../config.js";
import { AuditLogEntry, writeAuditLog } from "../security/auditLog.js";
import { getErrorMessage } from "../utils/errors.js";

type AuditMeta = Omit<AuditLogEntry, "timestamp" | "result" | "reason">;

export async function withAudit<T>(
  config: AppConfig,
  meta: AuditMeta,
  handler: (updateAudit: (entry: Partial<AuditMeta>) => void) => Promise<T>
): Promise<T> {
  let auditMeta = { ...meta };

  const updateAudit = (entry: Partial<AuditMeta>): void => {
    auditMeta = {
      ...auditMeta,
      ...entry
    };
  };

  try {
    const output = await handler(updateAudit);
    await writeAuditLog(config.auditLogPath, {
      ...auditMeta,
      result: "allow",
      reason: "ok"
    });
    return output;
  } catch (error) {
    await writeAuditLog(config.auditLogPath, {
      ...auditMeta,
      result: "deny",
      reason: getErrorMessage(error)
    });
    throw error;
  }
}
