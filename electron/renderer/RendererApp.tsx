import React, { useCallback, useEffect, useMemo, useState } from "react";

import { LauncherApp } from "./launcher/LauncherApp.js";
import type { LauncherHandlers, LogEntry, ServerState, WriteMode } from "./launcher/launcherTypes.js";
import {
  adaptLauncherState,
  DEFAULT_ALLOWED_COMMANDS,
  type LocalLauncherConfig
} from "./launcherStateAdapter.js";
import { inferLogLevel } from "./logSeverity.js";

type AppStatus = Awaited<ReturnType<Window["champcity"]["getAppStatus"]>>;
type ModalKind = "oauth-password" | "write-token" | "figma-test" | null;

let logCounter = 0;

function createLogEntry(message: string): LogEntry {
  return {
    id: `${Date.now()}-${++logCounter}`,
    timestamp: new Date().toLocaleTimeString([], { hour12: false }),
    level: inferLogLevel(message),
    message
  };
}

function operationOutput(result: unknown): string | null {
  if (typeof result === "string") {
    return result;
  }

  if (result && typeof result === "object" && "output" in result && typeof result.output === "string") {
    return result.output;
  }

  return null;
}

export function RendererApp(): React.JSX.Element {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [localConfig, setLocalConfig] = useState<LocalLauncherConfig | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [serverOverride, setServerOverride] = useState<ServerState | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);

  const appendLog = useCallback((message: string) => {
    setLogs((current) => [...current, createLogEntry(message)].slice(-400));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, configResult] = await Promise.all([
        window.champcity.getAppStatus(),
        window.champcity.readLocalConfig()
      ]);
      setStatus(nextStatus);
      setLocalConfig(configResult.config);
    } catch (error) {
      appendLog(`ERROR ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [appendLog]);

  useEffect(() => {
    void refresh();
    return window.champcity.onLog((line) => appendLog(line));
  }, [appendLog, refresh]);

  const runOperation = useCallback(
    async <T,>(operation: () => Promise<T>, options: { refresh?: boolean } = {}) => {
      try {
        const result = await operation();
        const output = operationOutput(result);
        if (output) {
          appendLog(output);
        }
        if (options.refresh !== false) {
          await refresh();
        }
        return result;
      } catch (error) {
        appendLog(`ERROR ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    },
    [appendLog, refresh]
  );

  const startServer = useCallback(async () => {
    if (!status) {
      appendLog("Status is still loading; try again in a moment.");
      return;
    }

    if (!status.http.oauthAdminPasswordConfigured && !status.http.authTokenConfigured && !status.http.unauthenticatedLocalHttpAllowed) {
      appendLog("OAuth admin password is required. Configure OAuth Admin Password, use legacy HTTP auth token, or explicitly enable local unauthenticated test mode.");
      return;
    }

    if (status.http.oauthAdminPasswordConfigured) {
      appendLog("Starting OAuth-protected local HTTP MCP server.");
    } else if (status.http.authTokenConfigured) {
      appendLog("Starting legacy bearer-authenticated local HTTP MCP server.");
    } else if (status.http.unauthenticatedLocalHttpAllowed) {
      appendLog("LOCAL TEST ONLY - DO NOT TUNNEL.");
    }

    setServerOverride("starting");
    try {
      await runOperation(() => window.champcity.startDiagnosticServer());
    } finally {
      setServerOverride(null);
    }
  }, [appendLog, runOperation, status]);

  const stopServer = useCallback(async () => {
    setServerOverride("stopping");
    try {
      await runOperation(() => window.champcity.stopDiagnosticServer());
    } finally {
      setServerOverride(null);
    }
  }, [runOperation]);

  const restartServer = useCallback(async () => {
    await stopServer();
    await startServer();
  }, [startServer, stopServer]);

  const saveConfig = useCallback(async () => {
    if (!localConfig) {
      appendLog("Local config is still loading.");
      return;
    }

    let result = await window.champcity.saveLocalConfig(localConfig, false);
    if (result.requiresConfirmation) {
      const confirmed = window.confirm(
        `One or more roots are outside the expected Projects area:\n\n${(result.outsideProjectsRoots ?? []).join("\n")}\n\nSave anyway?`
      );
      if (!confirmed) {
        appendLog(`Config save canceled: ${(result.warnings ?? []).join("; ")}`);
        return;
      }
      result = await window.champcity.saveLocalConfig(localConfig, true);
    }

    if (result.ok) {
      setLocalConfig(result.config ?? localConfig);
      appendLog(`Saved local config to ${result.path}`);
    } else {
      appendLog(`Config save failed: ${(result.warnings ?? ["Unknown error"]).join("; ")}`);
    }

    await refresh();
  }, [appendLog, localConfig, refresh]);

  const handlers = useMemo<LauncherHandlers>(() => ({
    onStartServer: startServer,
    onStopServer: stopServer,
    onRestartServer: restartServer,
    onOpenHealth: () => void runOperation(() => window.champcity.openLocalHealthCheck()),
    onCopyText: (text) => {
      navigator.clipboard.writeText(text)
        .then(() => appendLog("Copied value to clipboard."))
        .catch((error: unknown) => appendLog(`ERROR ${error instanceof Error ? error.message : String(error)}`));
    },
    onRunDoctor: () => void runOperation(() => window.champcity.runDoctor()),
    onClearLogs: () => setLogs([]),
    onCopyLogs: () => {
      const text = logs.map((log) => `[${log.timestamp}] ${log.level}: ${log.message}`).join("\n");
      navigator.clipboard.writeText(text)
        .then(() => appendLog("Copied current log view to clipboard."))
        .catch((error: unknown) => appendLog(`ERROR ${error instanceof Error ? error.message : String(error)}`));
    },
    onExportLogs: () => void runOperation(() => window.champcity.openLogsFolder()),
    onOpenOAuthModal: () => setModal("oauth-password"),
    onOpenWriteTokenModal: () => setModal("write-token"),
    onSetWriteMode: (mode: WriteMode) => {
      const warnings: Record<WriteMode, string> = {
        off: "No writes will be allowed.",
        docs: "ChatGPT can create Markdown files inside allowed roots when OAuth files.write is granted.",
        patch: "ChatGPT can apply only patches it previously proposed and that still match the stored patch hash.",
        elevated: "High-risk mode. Allows elevated operations such as scripts when local elevated approval is supplied."
      };
      const confirmed = mode === "off" || window.confirm(`${warnings[mode]}\n\nRestart the local HTTP server for a running process to pick it up.`);
      if (!confirmed) {
        appendLog(`Write mode ${mode} canceled.`);
        return;
      }
      void runOperation(() => window.champcity.setWriteMode(mode));
    },
    onClearPendingPatchProposals: () => void runOperation(() => window.champcity.clearPendingPatchProposals()),
    onResetOAuthClients: () => {
      if (window.confirm("Reset locally registered OAuth clients? ChatGPT will need to register again.")) {
        void runOperation(() => window.champcity.resetOAuthClients());
      } else {
        appendLog("OAuth client reset canceled.");
      }
    },
    onRevokeOAuthTokens: () => {
      if (window.confirm("Revoke all locally stored OAuth access tokens? ChatGPT will need to reconnect.")) {
        void runOperation(() => window.champcity.revokeAllOAuthTokens());
      } else {
        appendLog("OAuth token revocation canceled.");
      }
    },
    onRevokeAllSessions: () => {
      if (window.confirm("Revoke all local OAuth sessions? ChatGPT will need to reconnect.")) {
        void runOperation(() => window.champcity.revokeAllOAuthTokens());
      } else {
        appendLog("OAuth session revocation canceled.");
      }
    },
    onClearExpiredSessions: () => void runOperation(() => window.champcity.clearExpiredOAuthTokens()),
    onAddRoot: () => {
      void runOperation(async () => {
        const selected = await window.champcity.selectFolder();
        if (!selected) {
          return { ok: true, output: "Allowed root selection canceled." };
        }

        setLocalConfig((current) => {
          if (!current || current.allowedRoots.includes(selected)) {
            return current;
          }
          return { ...current, allowedRoots: [...current.allowedRoots, selected] };
        });
        return { ok: true, output: `Added allowed root ${selected}. Save Config to persist.` };
      }, { refresh: false });
    },
    onRemoveRoot: (path) => {
      setLocalConfig((current) => current ? { ...current, allowedRoots: current.allowedRoots.filter((root) => root !== path) } : current);
      appendLog(`Removed allowed root ${path}. Save Config to persist.`);
    },
    onSaveConfig: saveConfig,
    onResetRoots: () => {
      if (!status) {
        appendLog("Status is still loading.");
        return;
      }
      setLocalConfig({
        allowedRoots: [status.repoRoot],
        requireGitRoot: true,
        auditLog: `${status.repoRoot}\\logs\\audit.log`,
        allowedCommands: [...DEFAULT_ALLOWED_COMMANDS]
      });
      appendLog("Reset allowed roots to defaults. Save Config to persist.");
    },
    onSaveRequireGitRoot: (value) => {
      setLocalConfig((current) => current ? { ...current, requireGitRoot: value } : current);
    },
    onSaveAuditLogPath: (value) => {
      setLocalConfig((current) => current ? { ...current, auditLog: value } : current);
    },
    onSaveAllowedCommands: (value) => {
      setLocalConfig((current) => current ? { ...current, allowedCommands: value.split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean) } : current);
    },
    onGenerateNotes: () => void runOperation(() => window.champcity.generateClientConfigs()),
    onOpenCloudflareGuide: () => void runOperation(() => window.champcity.openCloudflareGuide()),
    onOpenChatGptGuide: () => void runOperation(() => window.champcity.openChatGptGuide()),
    onValidateTools: () => void runOperation(() => window.champcity.runDoctor()),
    onSaveFigmaToken: (token) => {
      if (!token.trim()) {
        appendLog("Figma access token is required.");
        return;
      }
      void runOperation(() => window.champcity.saveFigmaAccessToken(token.trim()));
    },
    onClearFigmaToken: () => {
      if (window.confirm("Clear the locally saved Figma access token?")) {
        void runOperation(() => window.champcity.clearFigmaAccessToken());
      } else {
        appendLog("Figma token clear canceled.");
      }
    },
    onTestFigmaConnection: () => setModal("figma-test"),
    onOpenAuditLog: () => void runOperation(() => window.champcity.openAuditLog()),
    onOpenLogsFolder: () => void runOperation(() => window.champcity.openLogsFolder()),
    onOpenGeneratedFolder: () => void runOperation(() => window.champcity.openGeneratedFolder()),
    onCopyGenericConfig: () => void runOperation(() => window.champcity.copyGenericConfig()),
    onOpenDocs: () => void runOperation(() => window.champcity.openDocs()),
    onResetSetupWizard: () => {
      if (window.confirm("Reset the setup wizard state? Existing local config, OAuth clients, tokens, and write settings will be left in place.")) {
        void runOperation(() => window.champcity.resetSetupWizard());
      } else {
        appendLog("Setup wizard reset canceled.");
      }
    }
  }), [appendLog, localConfig, logs, refresh, restartServer, runOperation, saveConfig, startServer, status, stopServer]);

  const launcherState = useMemo(
    () => adaptLauncherState(status, localConfig, logs, serverOverride),
    [localConfig, logs, serverOverride, status]
  );

  return (
    <>
      <LauncherApp state={launcherState} handlers={handlers} />
      {modal === "oauth-password" && (
        <OAuthPasswordModal
          onCancel={() => setModal(null)}
          onSave={(password) => {
            void runOperation(() => window.champcity.configureOAuthAdminPassword(password)).then(() => setModal(null));
          }}
        />
      )}
      {modal === "write-token" && (
        <WriteTokenModal
          onCancel={() => setModal(null)}
          onGenerate={() => window.champcity.generateWriteApprovalToken()}
          onCopy={(token) => runOperation(() => window.champcity.copyTemporaryWriteToken(token), { refresh: false })}
          onClear={() => runOperation(() => window.champcity.clearWriteApprovalToken()).then(() => setModal(null))}
          onSave={(token) => runOperation(() => window.champcity.saveWriteApprovalToken(token)).then(() => setModal(null))}
        />
      )}
      {modal === "figma-test" && (
        <FigmaTestModal
          onCancel={() => setModal(null)}
          onTest={(figmaUrlOrFileKey) => {
            void runOperation(() => window.champcity.testFigmaConnection(figmaUrlOrFileKey)).then(() => setModal(null));
          }}
        />
      )}
    </>
  );
}

function OAuthPasswordModal({ onCancel, onSave }: {
  onCancel: () => void;
  onSave: (password: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");

  return (
    <div className="lc-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="oauthPasswordTitle">
      <section className="lc-modal">
        <div className="lc-modal-header">
          <h2 id="oauthPasswordTitle" className="lc-modal-title">Configure OAuth Admin Password</h2>
        </div>
        <div className="lc-modal-body">
          <p>This password approves ChatGPT OAuth authorization requests. It is stored only as a local hash.</p>
          <label className="lc-field-label" htmlFor="oauthPassword">OAuth admin password</label>
          <input id="oauthPassword" className="lc-pw-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
          <label className="lc-field-label" htmlFor="oauthPasswordConfirm">Confirm password</label>
          <input id="oauthPasswordConfirm" className="lc-pw-input" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" />
          {error && <p style={{ color: "var(--red)" }}>{error}</p>}
          <div className="lc-modal-actions">
            <button className="lc-btn lc-btn--primary" onClick={() => {
              if (password.length < 12) {
                setError("Use at least 12 characters.");
                return;
              }
              if (password !== confirmation) {
                setError("Passwords do not match.");
                return;
              }
              onSave(password);
            }}>Save Password</button>
            <button className="lc-btn" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function WriteTokenModal({ onCancel, onGenerate, onCopy, onClear, onSave }: {
  onCancel: () => void;
  onGenerate: () => Promise<{ ok: boolean; token: string }>;
  onCopy: (token: string) => Promise<unknown>;
  onClear: () => Promise<unknown>;
  onSave: (token: string) => Promise<unknown>;
}) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");

  return (
    <div className="lc-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="writeTokenTitle">
      <section className="lc-modal">
        <div className="lc-modal-header">
          <h2 id="writeTokenTitle" className="lc-modal-title">Configure Elevated Approval Token</h2>
        </div>
        <div className="lc-modal-body">
          <p>Save this token somewhere temporary. Elevated operations still require local approval and should be rotated after use.</p>
          <label className="lc-field-label" htmlFor="writeToken">Elevated approval token</label>
          <input id="writeToken" className="lc-pw-input" type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" spellCheck={false} />
          {error && <p style={{ color: "var(--red)" }}>{error}</p>}
          <div className="lc-modal-actions">
            <button className="lc-btn" onClick={() => {
              void onGenerate().then((result) => setToken(result.token));
            }}>Generate Strong Token</button>
            <button className="lc-btn" onClick={() => {
              if (!token.trim()) {
                setError("Generate or enter a token before copying.");
                return;
              }
              void onCopy(token.trim());
            }}>Copy Temporary Token</button>
            <button className="lc-btn lc-btn--primary" onClick={() => {
              if (token.trim().length < 16) {
                setError("Use at least 16 characters.");
                return;
              }
              void onSave(token.trim());
            }}>Save Token</button>
            <button className="lc-btn lc-btn--danger" onClick={() => void onClear()}>Clear Token</button>
            <button className="lc-btn" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function FigmaTestModal({ onCancel, onTest }: {
  onCancel: () => void;
  onTest: (figmaUrlOrFileKey: string) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  return (
    <div className="lc-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="figmaTestTitle">
      <section className="lc-modal">
        <div className="lc-modal-header">
          <h2 id="figmaTestTitle" className="lc-modal-title">Test Figma Connection</h2>
        </div>
        <div className="lc-modal-body">
          <p>Enter a Figma file key or full Figma URL to verify the saved access token.</p>
          <label className="lc-field-label" htmlFor="figmaTestValue">Figma file key or URL</label>
          <input id="figmaTestValue" className="lc-pw-input" type="text" value={value} onChange={(event) => setValue(event.target.value)} autoComplete="off" spellCheck={false} />
          {error && <p style={{ color: "var(--red)" }}>{error}</p>}
          <div className="lc-modal-actions">
            <button className="lc-btn lc-btn--primary" onClick={() => {
              const trimmed = value.trim();
              if (!trimmed) {
                setError("Enter a Figma file key or URL before testing.");
                return;
              }
              onTest(trimmed);
            }}>Test Connection</button>
            <button className="lc-btn" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </section>
    </div>
  );
}
