import { z } from "zod";

import { AppConfig } from "../config.js";
import { resolveAllowedRoot } from "../security/pathPolicy.js";
import { AppError } from "../utils/errors.js";
import { runProcess } from "../utils/git.js";
import { assertValidWriteApprovalToken } from "../writeAccess.js";
import { withAudit } from "./common.js";
import { MAX_APPROVAL_TOKEN_LENGTH, MAX_COMMAND_LENGTH, MAX_ROOT_LENGTH } from "./inputLimits.js";

export const RunAllowedScriptInputSchema = z.object({
  root: z.string().min(1).max(MAX_ROOT_LENGTH),
  command: z.string().min(1).max(MAX_COMMAND_LENGTH),
  timeoutSeconds: z.number().int().positive().max(600).default(120),
  approvalToken: z.string().max(MAX_APPROVAL_TOKEN_LENGTH).optional()
});

export type RunAllowedScriptInput = z.infer<typeof RunAllowedScriptInputSchema>;

export interface RunAllowedScriptOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
}

export function parseAllowedCommand(command: string): { executable: string; args: string[] } {
  const tokens = command.match(/"[^"]+"|'[^']+'|\S+/g);
  if (!tokens || tokens.length === 0) {
    throw new AppError("COMMAND_DENIED", "Allowed command is empty.");
  }

  const cleaned = tokens.map((token) => token.replace(/^["']|["']$/g, ""));
  return {
    executable: cleaned[0],
    args: cleaned.slice(1)
  };
}

export function assertCommandAllowed(command: string, allowedCommands: string[]): void {
  if (!allowedCommands.includes(command)) {
    throw new AppError("COMMAND_DENIED", "Command is not in CHAMPCITY_GPT_ALLOWED_COMMANDS.", {
      command
    });
  }
}

export async function runAllowedScript(rawInput: unknown, config: AppConfig): Promise<RunAllowedScriptOutput> {
  const command = typeof rawInput === "object" && rawInput !== null ? String((rawInput as { command?: unknown }).command ?? "") : undefined;

  return withAudit(config, { toolName: "run_allowed_script", command }, async (updateAudit) => {
    const input = RunAllowedScriptInputSchema.parse(rawInput);
    if (!config.elevatedOperationsAllowed) {
      throw new AppError("APPROVAL_REQUIRED", "run_allowed_script requires writeMode elevated.");
    }
    assertValidWriteApprovalToken("run_allowed_script", input.approvalToken, config.writeApprovalToken);
    assertCommandAllowed(input.command, config.allowedCommands);
    const root = resolveAllowedRoot(input.root, config.allowedRoots);
    const parsedCommand = parseAllowedCommand(input.command);
    updateAudit({
      command: input.command,
      resolvedPath: root.rootRealPath
    });

    return runProcess(parsedCommand.executable, parsedCommand.args, root.rootRealPath, {
      timeoutMs: input.timeoutSeconds * 1000,
      maxBytes: 500_000
    });
  });
}
