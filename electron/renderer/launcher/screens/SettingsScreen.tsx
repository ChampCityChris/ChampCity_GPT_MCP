import React, { useEffect, useState } from "react";
import type { LauncherState, LauncherHandlers } from "../launcherTypes.js";
import { Panel } from "../components/Panel.js";
import { AlertBanner } from "../components/AlertBanner.js";

interface Props {
  state: LauncherState;
  handlers: LauncherHandlers;
}

export function SettingsScreen({ state, handlers }: Props) {
  const { roots, requireGitRoot, auditLogPath, allowedCommands, runtime } = state;

  const [localRequireGit, setLocalRequireGit] = useState(requireGitRoot);
  const [localAuditPath,  setLocalAuditPath]  = useState(auditLogPath);
  const [localCommands,   setLocalCommands]   = useState(allowedCommands);

  useEffect(() => {
    setLocalRequireGit(requireGitRoot);
    setLocalAuditPath(auditLogPath);
    setLocalCommands(allowedCommands);
  }, [allowedCommands, auditLogPath, requireGitRoot]);

  return (
    <div>
      <div className="lc-screen-header">
        <div>
          <h1 className="lc-screen-title">Settings</h1>
          <p className="lc-screen-sub">Configure allowed roots, audit logging, and allowed commands</p>
        </div>
        <div className="lc-actions">
          <button className="lc-btn" onClick={handlers.onOpenSetupWizard} disabled={!handlers.onOpenSetupWizard}>Setup Wizard</button>
        </div>
      </div>

      <div className="lc-two-col">
        {/* Allowed Roots Manager */}
        <Panel
          title="Allowed Roots Manager"
          subtitle={`config/allowed-roots.local.json`}
          noPad
        >
          <div className="lc-panel-body">
            <AlertBanner type="warn">
              Avoid broad roots such as your user folder, Desktop, Documents, or a drive root.
            </AlertBanner>

            {roots.map((root, i) => (
              <div key={i} className="lc-root-row">
                <input
                  className="lc-root-input"
                  type="text"
                  value={root.path}
                  readOnly
                  aria-label={`Allowed root ${i + 1}`}
                />
                <button className="lc-btn lc-btn--danger"
                  onClick={() => handlers.onRemoveRoot?.(root.path)}>
                  Remove
                </button>
              </div>
            ))}

            <div className="lc-btn-group" style={{ marginTop: 8 }}>
              <button className="lc-btn" onClick={handlers.onAddRoot}>Add Root</button>
              <button className="lc-btn" onClick={handlers.onResetRoots}>Reset Defaults</button>
              <button className="lc-btn lc-btn--primary" onClick={handlers.onSaveConfig}>Save Config</button>
            </div>

            <label className="lc-toggle" style={{ marginTop: 14 }}>
              <input
                type="checkbox"
                checked={localRequireGit}
                onChange={e => {
                  setLocalRequireGit(e.target.checked);
                  handlers.onSaveRequireGitRoot?.(e.target.checked);
                }}
              />
              <span>Require allowed roots to be git repositories</span>
            </label>

            <label className="lc-field-label" htmlFor="auditLogPath">Audit log path</label>
            <input
              id="auditLogPath"
              className="lc-text-input"
              type="text"
              value={localAuditPath}
              onChange={e => setLocalAuditPath(e.target.value)}
              onBlur={() => handlers.onSaveAuditLogPath?.(localAuditPath)}
            />

            <label className="lc-field-label" htmlFor="allowedCommands">Allowed commands</label>
            <textarea
              id="allowedCommands"
              className="lc-textarea"
              value={localCommands}
              onChange={e => setLocalCommands(e.target.value)}
              onBlur={() => handlers.onSaveAllowedCommands?.(localCommands)}
              spellCheck={false}
              aria-label="Allowed shell commands, one per line"
            />
          </div>

          <div className="lc-inline-actions">
            <button className="lc-btn" onClick={handlers.onOpenAuditLog}>Open Audit Log</button>
            <button className="lc-btn" onClick={handlers.onOpenLogsFolder}>Open Logs Folder</button>
            <button className="lc-btn" onClick={handlers.onOpenGeneratedFolder}>Open Generated Folder</button>
          </div>
        </Panel>

        {/* Runtime Info + Advanced */}
        <div>
          <Panel title="Runtime" subtitle={`v${runtime.appVersion ?? "?"}`} noPad>
            <div className="lc-data-grid">
              <p><strong>Mode:</strong> {runtime.mode ?? "—"}</p>
              <p><strong>Node:</strong> {runtime.nodeVersion ?? "—"}</p>
              <p><strong>Server runtime:</strong>{" "}
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}>{runtime.serverRuntime ?? "—"}</span>
              </p>
              <p><strong>Entrypoint:</strong>{" "}
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}>{runtime.serverEntrypoint ?? "—"}</span>
              </p>
              <p style={{ gridColumn: "1 / -1" }}>
                <strong>Config dir:</strong>{" "}
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", wordBreak: "break-all" }}>{runtime.configDir ?? "—"}</span>
              </p>
              <p style={{ gridColumn: "1 / -1" }}>
                <strong>Logs dir:</strong>{" "}
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", wordBreak: "break-all" }}>{runtime.logsDir ?? "—"}</span>
              </p>
              <p style={{ gridColumn: "1 / -1" }}>
                <strong>Generated dir:</strong>{" "}
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", wordBreak: "break-all" }}>{runtime.generatedDir ?? "—"}</span>
              </p>
            </div>
          </Panel>

          <Panel noPad>
            <details className="lc-advanced-details">
              <summary>Advanced: Settings and Local STDIO Clients</summary>
              <p>
                STDIO remains available with{" "}
                <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.78em" }}>node .\dist\src\index.js</code>{" "}
                or with <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.78em" }}>--transport stdio</code>{" "}
                for trusted local clients that launch the process themselves.
              </p>
              <div className="lc-btn-group">
                <button className="lc-btn" onClick={handlers.onCopyGenericConfig}>Copy Generic STDIO Config</button>
                <button className="lc-btn" onClick={handlers.onOpenDocs}>Open Desktop App Docs</button>
                <button className="lc-btn lc-btn--danger" onClick={handlers.onResetSetupWizard}>Reset Setup Wizard</button>
              </div>
            </details>
          </Panel>
        </div>
      </div>
    </div>
  );
}
