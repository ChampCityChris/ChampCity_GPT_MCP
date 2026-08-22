import { AppConfig } from "../config.js";
import { AuditLogEntry, writeAuditLog } from "../security/auditLog.js";
import { getCurrentToolCallTraceContext, recordToolCallTrace } from "../server/toolCallTrace.js";
import { classifyAppErrorCode } from "../utils/errorClassification.js";
import { getErrorMessage, serializeError } from "../utils/errors.js";

type AuditMeta = Omit<AuditLogEntry, "timestamp" | "result" | "reason">;

export async function withAudit<T>(
  config: AppConfig,
  meta: AuditMeta,
  handler: (updateAudit: (entry: Partial<AuditMeta>) => void) => Promise<T>
): Promise<T> {
  const context = getCurrentToolCallTraceContext();
  let auditMeta = {
    ...meta,
    ...(context?.correlationId && !meta.correlationId ? { correlationId: context.correlationId } : {})
  };

  const updateAudit = (entry: Partial<AuditMeta>): void => {
    auditMeta = {
      ...auditMeta,
      ...entry
    };
  };

  try {
    recordToolCallTrace(config, {
      stage: "helper_started",
      publicTool: context?.publicTool,
      action: context?.action ?? auditMeta.action,
      workspaceId: context?.workspaceId ?? auditMeta.workspaceId,
      requestedPath: auditMeta.normalizedRelativePath ?? auditMeta.requestedPath,
      result: "allow"
    });
    const output = await handler(updateAudit);
    recordToolCallTrace(config, {
      stage: "helper_allowed",
      publicTool: context?.publicTool,
      action: context?.action ?? auditMeta.action,
      workspaceId: context?.workspaceId ?? auditMeta.workspaceId,
      requestedPath: auditMeta.normalizedRelativePath ?? auditMeta.requestedPath,
      result: "allow"
    });
    await writeAuditLog(config.auditLogPath, {
      ...auditMeta,
      result: "allow",
      reason: "ok"
    });
    return output;
  } catch (error) {
    const structuredError = serializeError(error);
    const classification = classifyAppErrorCode(structuredError.code);
    recordToolCallTrace(config, {
      stage: "helper_denied",
      publicTool: context?.publicTool,
      action: context?.action ?? auditMeta.action,
      workspaceId: context?.workspaceId ?? auditMeta.workspaceId,
      requestedPath: auditMeta.normalizedRelativePath ?? auditMeta.requestedPath,
      result: classification === "execution" || classification === "transport" ? "error" : "deny",
      errorMessage: structuredError.message,
      errorCode: structuredError.code
    });
    await writeAuditLog(config.auditLogPath, {
      ...auditMeta,
      result: "deny",
      reason: getErrorMessage(error)
    });
    throw error;
  }
}
