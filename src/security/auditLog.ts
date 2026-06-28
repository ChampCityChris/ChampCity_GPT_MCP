import fs from "node:fs/promises";
import path from "node:path";

export interface AuditLogEntry {
  timestamp?: string;
  toolName: string;
  action?: string;
  root?: string;
  branch?: string;
  fileCount?: number;
  requestedPath?: string;
  resolvedPath?: string;
  command?: string;
  result: "allow" | "deny";
  reason: string;
  byteCount?: number;
}

export async function writeAuditLog(auditLogPath: string, entry: AuditLogEntry): Promise<void> {
  const timestampedEntry = {
    timestamp: entry.timestamp ?? new Date().toISOString(),
    ...entry
  };

  await fs.mkdir(path.dirname(auditLogPath), { recursive: true });
  await fs.appendFile(auditLogPath, `${JSON.stringify(timestampedEntry)}\n`, "utf8");
}
