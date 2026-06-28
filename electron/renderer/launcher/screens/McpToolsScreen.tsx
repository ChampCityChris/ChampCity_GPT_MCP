import React, { useState } from "react";
import type { LauncherState, LauncherHandlers, WriteMode } from "../launcherTypes.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { AlertBanner } from "../components/AlertBanner.js";
import { Panel } from "../components/Panel.js";
import { IconRefresh, IconChevronR } from "../components/Icons.js";

interface Props {
  state: LauncherState;
  handlers: LauncherHandlers;
}

const WRITE_MODES: { mode: WriteMode; label: string; desc: string }[] = [
  { mode: "off",      label: "Off",             desc: "No write operations" },
  { mode: "docs",     label: "Architect Docs",  desc: "Markdown/docs only" },
  { mode: "patch",    label: "Controlled Patch",desc: "Patch proposals only" },
  { mode: "elevated", label: "Elevated",        desc: "High risk — use sparingly" },
];

export function McpToolsScreen({ state, handlers }: Props) {
  const { write, figma, tools } = state;
  const [openTool, setOpenTool] = useState<string | null>(null);
  const [figmaToken, setFigmaToken] = useState("");

  return (
    <div>
      <div className="lc-screen-header">
        <div>
          <h1 className="lc-screen-title">MCP Tools</h1>
          <p className="lc-screen-sub">Server capabilities, write access, and Figma handoff</p>
        </div>
        <div className="lc-actions">
          <button className="lc-btn" onClick={handlers.onValidateTools}>
            <IconRefresh size={13} /> Re-validate all
          </button>
        </div>
      </div>

      {/* Write Access */}
      <Panel title="Write Access" subtitle="Use docs for planning artifacts, patch for code changes" noPad>
        <div className="lc-data-grid">
          <p><strong>Current write mode:</strong>{" "}
            <StatusBadge status={write.mode === "off" ? "stopped" : write.mode === "elevated" ? "warn" : "pass"} label={write.mode} />
          </p>
          <p><strong>Docs writes:</strong>{" "}
            <StatusBadge status={write.docsAllowed ? "pass" : "stopped"} label={write.docsAllowed ? "allowed" : "blocked"} />
          </p>
          <p><strong>Patch writes:</strong>{" "}
            <StatusBadge status={write.patchAllowed ? "pass" : "stopped"} label={write.patchAllowed ? "allowed" : "blocked"} />
          </p>
          <p><strong>Elevated operations:</strong>{" "}
            <StatusBadge status={write.elevatedAllowed ? "warn" : "stopped"} label={write.elevatedAllowed ? "allowed" : "blocked"} />
          </p>
          <p><strong>Pending patch proposals:</strong> {write.pendingPatches}</p>
          <p><strong>Elevated token configured:</strong>{" "}
            <StatusBadge status={write.tokenConfigured ? "pass" : "fail"} label={write.tokenConfigured ? "yes" : "no"} />
          </p>
          <p><strong>Elevated token source:</strong> {write.tokenSource ?? "—"}</p>
          <p><strong>Local readiness:</strong>{" "}
            <StatusBadge
              status={write.localReadiness === "ready" ? "pass" : write.localReadiness === "blocked" ? "fail" : "unknown"}
              label={write.localReadiness}
            />
          </p>
          <p><strong>OAuth files.write readiness:</strong>{" "}
            <StatusBadge
              status={write.oauthWriteReadinessSeverity}
              label={write.oauthWriteReadinessLabel}
            />
          </p>
          <p><strong>Stored write token:</strong> {String(write.oauthFilesWriteGranted)}</p>
          <p><strong>Overall write readiness:</strong>{" "}
            <StatusBadge status={write.readiness} label={write.overallReadiness} />
          </p>
          <p style={{ gridColumn: "1 / -1" }}><strong>OAuth evidence:</strong> {write.oauthWriteEvidenceSource}{write.oauthWriteEvidenceAt ? ` at ${write.oauthWriteEvidenceAt}` : ""}</p>
          <p style={{ gridColumn: "1 / -1" }}><strong>Readiness detail:</strong> {write.overallReadinessReason}</p>
          {write.configPath && (
            <p style={{ gridColumn: "1 / -1" }}>
              <strong>Write config:</strong>{" "}
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", wordBreak: "break-all" }}>{write.configPath}</span>
            </p>
          )}
        </div>

        <AlertBanner type={write.overallReadiness === "blocked" ? "error" : write.overallReadiness === "unknown" ? "warn" : "info"} className="">
          {write.overallReadinessReason}
        </AlertBanner>

        <div className="lc-inline-actions">
          {WRITE_MODES.map(wm => (
            <button
              key={wm.mode}
              className={`lc-btn${write.mode === wm.mode ? " lc-btn--primary" : ""}`}
              onClick={() => handlers.onSetWriteMode?.(wm.mode)}
              title={wm.desc}
            >
              Set: {wm.label}
            </button>
          ))}
          {write.pendingPatches > 0 && (
            <button className="lc-btn lc-btn--danger" onClick={handlers.onClearPendingPatchProposals}>Clear Pending Patches ({write.pendingPatches})</button>
          )}
          <button className="lc-btn" onClick={handlers.onOpenWriteTokenModal}>Configure Elevated Token</button>
        </div>
      </Panel>

      {/* Figma Handoff */}
      <Panel title="Figma Handoff" subtitle="Setup and debug status; ChatGPT runs Make handoff through MCP" noPad>
        <div className="lc-data-grid">
          <p><strong>Figma token configured:</strong>{" "}
            <StatusBadge status={figma.tokenConfigured ? "pass" : "fail"} label={figma.tokenConfigured ? "yes" : "no"} />
          </p>
          <p><strong>Token source:</strong> {figma.tokenSource ?? "—"}</p>
          <p><strong>Config path:</strong>{" "}
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", wordBreak: "break-all" }}>{figma.configPath ?? "—"}</span>
          </p>
          <p><strong>MCP Make tool:</strong>{" "}
            <StatusBadge status={figma.makeToolStatus === "available" ? "pass" : "unknown"} label={figma.makeToolStatus ?? "unknown"} />
          </p>
          <p><strong>MCP endpoint:</strong>{" "}
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}>{figma.mcpEndpoint ?? "—"}</span>
          </p>
          <p><strong>MCP mode:</strong> {figma.mcpMode ?? "—"}</p>
          <p><strong>MCP connection:</strong>{" "}
            <StatusBadge status={figma.mcpConnection === "self-hosted" ? "pass" : "unknown"} label={figma.mcpConnection ?? "unknown"} />
          </p>
          <p><strong>MCP auth:</strong>{" "}
            <StatusBadge status={figma.mcpAuth ? "pass" : "unknown"} label={figma.mcpAuth ?? "unknown"} />
          </p>
          <p><strong>Make availability:</strong>{" "}
            <StatusBadge status={figma.makeAvailability === "available" ? "pass" : "unknown"} label={figma.makeAvailability ?? "unknown"} />
          </p>
          <p><strong>Last parsed node:</strong> {figma.lastParsedNode ?? "None"}</p>
        </div>

        <div className="lc-panel-body" style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <label className="lc-field-label" htmlFor="figmaToken">Figma access token</label>
          <div className="lc-pw-row">
            <input id="figmaToken" className="lc-pw-input" type="password"
              value={figmaToken} onChange={e => setFigmaToken(e.target.value)}
              placeholder="figd_…" autoComplete="off" spellCheck={false} />
            <button className="lc-btn lc-btn--primary" onClick={() => { handlers.onSaveFigmaToken?.(figmaToken); setFigmaToken(""); }}>
              Save
            </button>
          </div>
        </div>

        <div className="lc-inline-actions">
          <button className="lc-btn lc-btn--danger" onClick={handlers.onClearFigmaToken}>Clear Token</button>
          <button className="lc-btn" onClick={handlers.onTestFigmaConnection}>Test Connection</button>
        </div>
      </Panel>

      {/* Tools list */}
      <Panel title="Available Tools" subtitle={`${tools.length} registered`} noPad>
        <div>
          {tools.map(tool => (
            <div key={tool.name}>
              <div
                className="lc-tool-row"
                onClick={() => setOpenTool(openTool === tool.name ? null : tool.name)}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === "Enter" && setOpenTool(openTool === tool.name ? null : tool.name)}
              >
                <span className={`lc-tool-chevron${openTool === tool.name ? " lc-tool-chevron--open" : ""}`}>
                  <IconChevronR size={12} />
                </span>
                <span className="lc-tool-name">{tool.name}</span>
                <span className="lc-tool-desc">{tool.description}</span>
                <span className="lc-tool-meta">
                  <span className={`lc-tool-tested${tool.tested ? " lc-tool-tested--yes" : " lc-tool-tested--no"}`}>
                    {tool.tested ? "✓ tested" : "untested"}
                  </span>
                  <StatusBadge
                    status={tool.status === "active" ? "pass" : tool.status === "error" ? "fail" : "stopped"}
                    label={tool.status}
                  />
                </span>
              </div>
              {openTool === tool.name && (
                <div className="lc-tool-detail">
                  <p style={{ margin: "0 0 8px", fontSize: "0.82rem", color: "var(--muted-strong)" }}>{tool.description}</p>
                  {tool.errorNote && (
                    <AlertBanner type="error">{tool.errorNote}</AlertBanner>
                  )}
                  <div className="lc-btn-group">
                    <button className="lc-btn" disabled title="No live tool test handler is exposed yet">Test Tool</button>
                    <button className="lc-btn" disabled title="No live schema viewer is exposed yet">View Schema</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
