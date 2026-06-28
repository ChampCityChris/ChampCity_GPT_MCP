import React, { useState } from "react";
import type { LauncherState, LauncherHandlers, Screen } from "../launcherTypes.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { Panel } from "../components/Panel.js";
import { IconWarn, IconX, IconInfo, IconChevronD } from "../components/Icons.js";

interface Props {
  state: LauncherState;
  handlers: LauncherHandlers;
  onNavigate: (s: Screen) => void;
}

function SevIcon({ sev }: { sev: string }) {
  if (sev === "error") return <IconX    size={15} style={{ color: "var(--red)",    flexShrink: 0 } as React.CSSProperties} />;
  if (sev === "warn")  return <IconWarn size={15} style={{ color: "var(--yellow)", flexShrink: 0 } as React.CSSProperties} />;
  return                      <IconInfo size={15} style={{ color: "var(--blue)",   flexShrink: 0 } as React.CSSProperties} />;
}

export function TroubleshootScreen({ state, handlers, onNavigate }: Props) {
  const [open, setOpen] = useState<string | null>(state.issues[0]?.id ?? null);
  const { issues, doctorChecks, discovery, tunnel } = state;

  return (
    <div>
      <div className="lc-screen-header">
        <div>
          <h1 className="lc-screen-title">Troubleshooting</h1>
          <p className="lc-screen-sub">Detected issues with guided fixes</p>
        </div>
        <div className="lc-actions">
          <button className="lc-btn" onClick={handlers.onRunDoctor}>Run Doctor</button>
        </div>
      </div>

      <div className="lc-two-col" style={{ alignItems: "start" }}>
        {/* Left: Issues + Doctor */}
        <div>
          {/* Issue accordion */}
          <Panel noPad style={{ marginBottom: 14 }}>
            {issues.map(issue => (
              <div key={issue.id}>
                <div
                  className="lc-issue-row"
                  onClick={() => setOpen(open === issue.id ? null : issue.id)}
                  role="button" tabIndex={0}
                  onKeyDown={e => e.key === "Enter" && setOpen(open === issue.id ? null : issue.id)}
                >
                  <SevIcon sev={issue.severity} />
                  <span className="lc-issue-title">{issue.title}</span>
                  <span className={`lc-issue-chevron${open === issue.id ? " lc-issue-chevron--open" : ""}`}>
                    <IconChevronD size={13} />
                  </span>
                </div>
                {open === issue.id && (
                  <div className="lc-issue-detail">
                    <span className="lc-issue-section-label">What this means</span>
                    <p>{issue.what}</p>

                    <span className="lc-issue-section-label">How it was detected</span>
                    <p><code className="lc-issue-detected">{issue.detected}</code></p>

                    <span className="lc-issue-section-label">Suggested fix</span>
                    <p>{issue.fix}</p>

                    {issue.actionLabel && issue.actionScreen && (
                      <button className="lc-btn" style={{ marginTop: 4 }}
                        onClick={() => onNavigate(issue.actionScreen!)}>
                        {issue.actionLabel} →
                      </button>
                    )}
                    {issue.actionLabel && !issue.actionScreen && (
                      <button className="lc-btn" style={{ marginTop: 4 }}
                        onClick={handlers.onOpenCloudflareGuide}>
                        {issue.actionLabel} →
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </Panel>

          {/* Doctor checklist */}
          <Panel title="System Checks" subtitle="Run Doctor for current results" noPad>
            <div className="lc-panel-body">
              {doctorChecks.map((check, i) => (
                <div key={i} className="lc-check-row">
                  <StatusBadge
                    status={check.status === "pass" ? "pass" : check.status === "warn" ? "warn" : check.status === "running" ? "info" : "fail"}
                    label={check.status}
                  />
                  <div>
                    <span className={`lc-check-label${check.status === "fail" ? " lc-check-label--fail" : ""}`}>
                      {check.label}
                    </span>
                    {check.detail && <div className="lc-check-detail">{check.detail}</div>}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div>
          <Panel title="Public Tunnel Diagnostics" subtitle={tunnel.overallReadinessLabel} noPad>
            <div className="lc-data-grid">
              <p><strong>Current public endpoint:</strong>{" "}
                <StatusBadge
                  status={tunnel.publicReachability === "reachable" ? "pass" : tunnel.publicReachability === "unreachable" ? "fail" : "warn"}
                  label={tunnel.publicReachability}
                />
              </p>
              <p><strong>Tunnel runtime:</strong> {tunnel.runtime}</p>
              <p><strong>Auto-start persistence:</strong>{" "}
                <StatusBadge status={tunnel.persistence === "confirmed" ? "pass" : "warn"} label={tunnel.persistence} />
              </p>
              <p style={{ gridColumn: "1 / -1" }}><strong>Reachability detail:</strong> {tunnel.publicReachabilityDetail}</p>
              <p style={{ gridColumn: "1 / -1" }}><strong>Persistence detail:</strong> {tunnel.persistenceDetail}</p>
              <p style={{ gridColumn: "1 / -1" }}><strong>Overall:</strong> {tunnel.overallReadinessDetail}</p>
            </div>
          </Panel>

          {/* Right: Last MCP Discovery */}
          <Panel title="Last ChatGPT MCP Discovery" subtitle={discovery.timestamp ?? "None recorded"} noPad>
            <div className="lc-data-grid">
              <p><strong>Request path:</strong> <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}>{discovery.requestPath ?? "none"}</span></p>
              <p><strong>JSON-RPC methods:</strong> {discovery.jsonRpcMethods ?? "none"}</p>
              <p><strong>Auth subject:</strong> <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", wordBreak: "break-all" }}>{discovery.authSubject ?? "none"}</span></p>
              <p><strong>Last observed connector scopes:</strong> {discovery.oauthScopes ?? "none"}</p>
              <p><strong>Tool counts:</strong> {discovery.toolCounts ?? "none"}</p>
              <p><strong>Response:</strong>{" "}
                <StatusBadge status={discovery.response?.startsWith("200") ? "pass" : "unknown"} label={discovery.response ?? "none"} />
              </p>
              <p><strong>Transport route:</strong> {discovery.transportRoute ?? "none"}</p>
              <p><strong>Recent methods:</strong> {discovery.recentMethods ?? "none"}</p>
              {discovery.finalTools && (
                <p style={{ gridColumn: "1 / -1" }}>
                  <strong>Final tools:</strong>{" "}
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}>{discovery.finalTools}</span>
                </p>
              )}
              {discovery.filteredTools && discovery.filteredTools !== "none" && (
                <p style={{ gridColumn: "1 / -1" }}>
                  <strong>Filtered tools:</strong>{" "}
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}>{discovery.filteredTools}</span>
                </p>
              )}
              {discovery.schemaNotes && discovery.schemaNotes !== "none" && (
                <p style={{ gridColumn: "1 / -1" }}>
                  <strong>Schema notes:</strong> {discovery.schemaNotes}
                </p>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
