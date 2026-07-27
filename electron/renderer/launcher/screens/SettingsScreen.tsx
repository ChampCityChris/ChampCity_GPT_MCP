import React, { useEffect, useState } from "react";
import type { LauncherState, LauncherHandlers } from "../launcherTypes.js";
import { Panel } from "../components/Panel.js";
import { AlertBanner } from "../components/AlertBanner.js";

interface Props {
  state: LauncherState;
  handlers: LauncherHandlers;
}

export function SettingsScreen({ state, handlers }: Props) {
  const { roots, auditLogPath, allowedCommands, runtime } = state;

  const [localAuditPath,  setLocalAuditPath]  = useState(auditLogPath);
  const [localCommands,   setLocalCommands]   = useState(allowedCommands);

  useEffect(() => {
    setLocalAuditPath(auditLogPath);
    setLocalCommands(allowedCommands);
  }, [allowedCommands, auditLogPath]);

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
              <div key={root.workspaceId ?? root.path} className="lc-root-row lc-root-row--workspace">
                <div className="lc-workspace-policy-main">
                  <strong>{root.label ?? `Workspace ${i + 1}`}</strong>
                  <span>{root.workspaceId ?? "workspace"}</span>
                  <input
                    className="lc-root-input"
                    type="text"
                    value={root.path}
                    readOnly
                    aria-label={`Allowed root ${i + 1}`}
                  />
                </div>
                <div className="lc-workspace-policy-controls">
                  <select
                    className="lc-text-input"
                    value={root.writePolicy ?? "git_required"}
                    aria-label={`Write policy for ${root.label ?? root.workspaceId ?? root.path}`}
                    onChange={(event) => handlers.onUpdateWorkspacePolicy?.(
                      root.workspaceId ?? "",
                      event.target.value === "artifact_only" ? "artifact_only" : "git_required"
                    )}
                    disabled={!root.workspaceId}
                  >
                    <option value="git_required">Git-backed repository</option>
                    <option value="artifact_only">Planning artifacts only</option>
                  </select>
                  {root.writePolicy === "artifact_only" && (
                    <input
                      className="lc-text-input"
                      type="text"
                      value={(root.artifactWriteRoots && root.artifactWriteRoots.length > 0 ? root.artifactWriteRoots : ["planning"]).join(", ")}
                      aria-label={`Artifact write roots for ${root.label ?? root.workspaceId ?? root.path}`}
                      onChange={(event) => handlers.onUpdateWorkspaceArtifactRoots?.(
                        root.workspaceId ?? "",
                        event.target.value.split(",").map((entry) => entry.trim()).filter(Boolean)
                      )}
                    />
                  )}
                  <button className="lc-btn lc-btn--danger"
                    onClick={() => handlers.onRemoveRoot?.(root.path)}>
                    Remove
                  </button>
                </div>
                {root.writePolicy === "artifact_only" && (
                  <p className="lc-help-text">
                    Planning mode allows only bounded Markdown/JSON artifact persistence. Patch and Git workflows remain unavailable, and ChampCity MCP will not run git init.
                  </p>
                )}
                {(root.artifactWriteRoots ?? []).includes(".") && (
                  <AlertBanner type="warn">
                    Artifact root "." permits Markdown/JSON artifact-extension writes throughout this workspace.
                  </AlertBanner>
                )}
              </div>
            ))}

            <div className="lc-btn-group" style={{ marginTop: 8 }}>
              <button className="lc-btn" onClick={handlers.onAddRoot}>Add Root</button>
              <button className="lc-btn" onClick={handlers.onResetRoots}>Reset Defaults</button>
              <button className="lc-btn lc-btn--primary" onClick={handlers.onSaveConfig}>Save Config</button>
            </div>

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
