import React from "react";
import type { LauncherState, LauncherHandlers } from "../launcherTypes.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { AlertBanner } from "../components/AlertBanner.js";
import { Panel } from "../components/Panel.js";
import { CopyField } from "../components/CopyField.js";
import { IconPlay, IconStop, IconRestart, IconGlobe, IconCheck, IconX, IconWarn, IconServer, IconShield, IconActivity } from "../components/Icons.js";
import { safeHostname } from "../displayHelpers.js";

interface Props {
  state: LauncherState;
  handlers: LauncherHandlers;
  onNavigate: (s: "connection" | "logs") => void;
}

function StatCard({ icon, label, value, valueCls, sub }: {
  icon: React.ReactNode; label: string; value: string;
  valueCls: string; sub: string;
}) {
  return (
    <div className="lc-stat-card">
      <div className="lc-stat-card-top">
        <span className="lc-stat-icon">{icon}</span>
        <span className={`lc-stat-value ${valueCls}`} style={{ fontSize: "0.65rem" }}>●</span>
      </div>
      <span className="lc-stat-label">{label}</span>
      <span className={`lc-stat-value ${valueCls}`}>{value}</span>
      <span className="lc-stat-sub">{sub}</span>
    </div>
  );
}

function HealthRow({ label, value, ok, status }: { label: string; value: string; ok?: boolean; status?: "pass" | "warn" | "fail" }) {
  const resolved = status ?? (ok ? "pass" : "fail");
  return (
    <div className="lc-health-row">
      <span className="lc-health-label">{label}</span>
      <span className="lc-health-val">
        {resolved === "pass" ? <IconCheck size={13} style={{ color: "var(--green)" } as React.CSSProperties} />
             : resolved === "warn" ? <IconWarn size={13} style={{ color: "var(--yellow)" } as React.CSSProperties} />
             : <IconX size={13} style={{ color: "var(--red)" } as React.CSSProperties} />}
        {value}
      </span>
    </div>
  );
}

function publicReachabilityLabel(tunnel: LauncherState["tunnel"]): string {
  if (tunnel.publicReachability === "reachable") return "Reachable";
  if (tunnel.publicReachability === "degraded") return "Degraded";
  if (tunnel.publicReachability === "unreachable") return "Unreachable";
  return "Unknown";
}

function publicReachabilityStatus(tunnel: LauncherState["tunnel"]): "pass" | "warn" | "fail" {
  if (tunnel.publicReachability === "reachable") return "pass";
  if (tunnel.publicReachability === "unreachable") return "fail";
  return "warn";
}

function persistenceLabel(tunnel: LauncherState["tunnel"]): string {
  if (tunnel.persistence === "confirmed") return "Confirmed";
  if (tunnel.persistence === "not_configured") return "Not configured";
  if (tunnel.persistence === "not_confirmed") return "Not confirmed";
  return "Unknown";
}

function writeAlert(write: LauncherState["write"]) {
  if (write.overallReadiness === "blocked") {
    return {
      type: "error" as const,
      text: write.overallReadinessReason
    };
  }

  if (write.oauthWriteReadiness === "last_observed_granted") {
    return {
      type: "info" as const,
      text: write.oauthWriteReadinessDetail
    };
  }

  if (write.overallReadiness === "unknown") {
    return {
      type: "warn" as const,
      text: write.overallReadinessReason
    };
  }

  return null;
}

export function DashboardScreen({ state, handlers, onNavigate }: Props) {
  const { server, oauth, tunnel, write } = state;
  const isRunning  = server.state === "running";
  const isStarting = server.state === "starting";
  const isStopped  = server.state === "stopped" || server.state === "unknown";
  const alert = writeAlert(write);

  return (
    <div>
      {/* Header */}
      <div className="lc-screen-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <h1 className="lc-screen-title">Server Dashboard</h1>
            <StatusBadge status={server.state} />
          </div>
          <p className="lc-screen-sub">
            Local MCP server at{" "}
            <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem" }}>{server.localEndpoint}</code>
            {" · "}Public at{" "}
            <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem" }}>{safeHostname(server.publicEndpoint)}</code>
          </p>
        </div>
        <div className="lc-actions">
          {isStopped || server.state === "error" ? (
            <button className="lc-btn lc-btn--start" onClick={handlers.onStartServer}>
              <IconPlay size={13} /> Start Server
            </button>
          ) : (
            <button className="lc-btn" onClick={handlers.onStopServer} disabled={isStarting}>
              <IconStop size={13} /> Stop
            </button>
          )}
          <button className="lc-btn" onClick={handlers.onRestartServer} disabled={isStopped || isStarting}>
            <IconRestart size={13} /> Restart
          </button>
          <button className="lc-btn" onClick={() => onNavigate("connection")}>
            <IconGlobe size={13} /> Connect
          </button>
        </div>
      </div>

      {/* Active banners */}
      {alert && (
        <AlertBanner type={alert.type}>
          OAuth <code>files.write</code>: {alert.text}
        </AlertBanner>
      )}
      {tunnel.overallReadiness === "current_ready_persistence_unconfirmed" && (
        <AlertBanner type="warn">
          Cloudflare tunnel auto-start is not confirmed. The public endpoint is currently reachable, but reboot recovery has not been confirmed.
        </AlertBanner>
      )}

      {/* Stat cards */}
      <div className="lc-stat-grid">
        <StatCard
          icon={<IconServer size={14} />}
          label="Local Server"
          value={isRunning ? "Running" : server.state === "error" ? "Error" : "Stopped"}
          valueCls={isRunning ? "lc-stat-value--pass" : server.state === "error" ? "lc-stat-value--fail" : "lc-stat-value--stopped"}
          sub={server.pid ? `PID ${server.pid}` : "—"}
        />
        <StatCard
          icon={<IconGlobe size={14} />}
          label="Public Endpoint"
          value={publicReachabilityLabel(tunnel)}
          valueCls={publicReachabilityStatus(tunnel) === "pass" ? "lc-stat-value--pass" : publicReachabilityStatus(tunnel) === "warn" ? "lc-stat-value--warn" : "lc-stat-value--fail"}
          sub={tunnel.publicDomain}
        />
        <StatCard
          icon={<IconShield size={14} />}
          label="OAuth"
          value={oauth.adminConfigured ? "Configured" : "Not set"}
          valueCls={oauth.adminConfigured ? "lc-stat-value--pass" : "lc-stat-value--fail"}
          sub={`${oauth.registeredClients} registered clients`}
        />
        <StatCard
          icon={<IconActivity size={14} />}
          label="Write Scope"
          value={write.oauthWriteReadinessLabel}
          valueCls={write.oauthWriteReadinessSeverity === "fail" ? "lc-stat-value--fail" : write.oauthWriteReadinessSeverity === "warn" ? "lc-stat-value--warn" : "lc-stat-value--pass"}
          sub={`Mode: ${write.mode}`}
        />
      </div>

      {/* Two-column: endpoints + auth */}
      <div className="lc-two-col">
        <Panel title="Endpoints" noPad>
          <div className="lc-panel-body">
            <CopyField label="Local MCP"  value={server.localEndpoint}  onCopy={handlers.onCopyText} />
            <CopyField label="Public MCP" value={server.publicEndpoint} onCopy={handlers.onCopyText} />
            <CopyField label="Health"     value={server.healthEndpoint} onCopy={handlers.onCopyText} />
            <HealthRow label="Public reachability" value={publicReachabilityLabel(tunnel)} status={publicReachabilityStatus(tunnel)} />
            <HealthRow label="Tunnel auto-start" value={persistenceLabel(tunnel)} status={tunnel.persistence === "confirmed" ? "pass" : "warn"} />
          </div>
        </Panel>

        <Panel title="Authentication" noPad>
          <div className="lc-panel-body">
            <HealthRow label="OAuth Issuer"     value={safeHostname(oauth.issuer)} ok={safeHostname(oauth.issuer) !== "--"} />
            <HealthRow label="Admin Password"   value="Configured (local-file)"        ok={oauth.adminConfigured} />
            <HealthRow label="Stored Access Tokens" value={`${oauth.activeTokens} active`} status="warn" />
            <HealthRow label="Unauth Local"     value={oauth.unauthLocalEnabled ? "Enabled" : "Disabled"} ok={!oauth.unauthLocalEnabled} />
            <HealthRow label="PKCE"             value={oauth.pkceEnabled ? "Enabled" : "Disabled"} ok={oauth.pkceEnabled} />
            <HealthRow
              label="files.write"
              value={write.oauthWriteReadinessLabel}
              status={write.oauthWriteReadinessSeverity === "fail" ? "fail" : write.oauthWriteReadinessSeverity === "warn" ? "warn" : "pass"}
            />
          </div>
        </Panel>
      </div>

      {/* Recent activity */}
      <Panel title="Recent Activity" subtitle="Last 5 events" noPad>
        <div className="lc-panel-body" style={{ paddingTop: 0, paddingBottom: 0 }}>
          {state.logs.slice(-5).map(log => (
            <div key={log.id} className="lc-log-row">
              <span className="lc-log-time">{log.timestamp}</span>
              <StatusBadge
                status={log.level === "error" ? "fail" : log.level === "warn" ? "warn" : log.level === "debug" ? "stopped" : "info"}
                label={log.level}
              />
              <span className="lc-log-msg">{log.message}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: "8px 16px 10px" }}>
          <button className="lc-btn" style={{ fontSize: "0.75rem" }} onClick={() => onNavigate("logs")}>
            View all logs →
          </button>
        </div>
      </Panel>
    </div>
  );
}
