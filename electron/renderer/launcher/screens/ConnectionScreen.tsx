import React, { useState } from "react";
import type { LauncherState, LauncherHandlers } from "../launcherTypes.js";
import { AlertBanner } from "../components/AlertBanner.js";
import { Panel } from "../components/Panel.js";
import { CopyField } from "../components/CopyField.js";
import { StatusBadge } from "../components/StatusBadge.js";

interface Props {
  state: LauncherState;
  handlers: LauncherHandlers;
}

type NoteTab = "chatgpt" | "generic" | "codex" | "claude";

function reachabilityBadge(tunnel: LauncherState["tunnel"]) {
  if (tunnel.publicReachability === "reachable") return "pass" as const;
  if (tunnel.publicReachability === "unreachable") return "fail" as const;
  return "warn" as const;
}

function reachabilityLabel(tunnel: LauncherState["tunnel"]): string {
  if (tunnel.publicReachability === "reachable") return "reachable";
  if (tunnel.publicReachability === "degraded") return "degraded";
  if (tunnel.publicReachability === "unreachable") return "unreachable";
  return "unknown";
}

function persistenceLabel(tunnel: LauncherState["tunnel"]): string {
  if (tunnel.persistence === "confirmed") return "confirmed";
  if (tunnel.persistence === "not_configured") return "not configured";
  if (tunnel.persistence === "not_confirmed") return "not confirmed";
  return "unknown";
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

export function ConnectionScreen({ state, handlers }: Props) {
  const { server, oauth, oauthSession, tunnel, write } = state;
  const [noteTab, setNoteTab] = useState<NoteTab>("chatgpt");
  const copy = handlers.onCopyText;
  const alert = writeAlert(write);

  return (
    <div>
      <div className="lc-screen-header">
        <div>
          <h1 className="lc-screen-title">Connection</h1>
          <p className="lc-screen-sub">Endpoints and OAuth values for ChatGPT and MCP clients</p>
        </div>
        <div className="lc-actions">
          <button className="lc-btn" onClick={handlers.onGenerateNotes}>Generate Setup Notes</button>
          <button className="lc-btn" onClick={handlers.onOpenChatGptGuide}>ChatGPT Guide</button>
        </div>
      </div>

      {alert && (
        <AlertBanner type={alert.type}>
          OAuth <code>files.write</code>: {alert.text}
        </AlertBanner>
      )}

      {/* Two-column: endpoints left, OAuth right */}
      <div className="lc-two-col" style={{ marginBottom: 14 }}>
        {/* Left */}
        <div>
          <Panel title="Local Endpoints" subtitle="Server-side testing only" noPad>
            <div className="lc-panel-body">
              <CopyField label="Local MCP Endpoint"  value={server.localEndpoint}  onCopy={copy} />
              <CopyField label="Local Health Check"  value={server.healthEndpoint} onCopy={copy} />
              <AlertBanner type="info">
                Remote clients like ChatGPT cannot reach <code>127.0.0.1</code>. Use the public tunnel URL.
              </AlertBanner>
            </div>
          </Panel>

          <Panel title="Public / Tunnel Endpoints" subtitle="Use these in ChatGPT" noPad>
            <div className="lc-panel-body">
              <CopyField label="Public MCP Endpoint"   value={server.publicEndpoint}       onCopy={copy} />
              <CopyField label="Public Health Check"   value={server.publicHealthEndpoint} onCopy={copy} />
              <p><strong>Current public reachability:</strong>{" "}
                <StatusBadge status={reachabilityBadge(tunnel)} label={reachabilityLabel(tunnel)} />
              </p>
              <p><strong>Cloudflare auto-start:</strong>{" "}
                <StatusBadge status={tunnel.persistence === "confirmed" ? "pass" : "warn"} label={persistenceLabel(tunnel)} />
              </p>
              {tunnel.publicReachability === "unreachable" ? (
                <AlertBanner type="error">
                  The public endpoint is currently unreachable. Run Doctor and check Cloudflare tunnel routing.
                </AlertBanner>
              ) : (
                <AlertBanner type="warn">
                  A reachable public endpoint does not prove the Cloudflare tunnel will restart after reboot.
                </AlertBanner>
              )}
            </div>
          </Panel>

          <Panel title="Common Mistakes" noPad>
            <div className="lc-panel-body">
              <AlertBanner type="warn">
                Do not use <code>localhost</code> or <code>127.0.0.1</code> in ChatGPT — use the public tunnel URL.
              </AlertBanner>
              <AlertBanner type="warn">
                The OAuth callback URL must exactly match your ChatGPT dev-app registration, including trailing slashes.
              </AlertBanner>
              <AlertBanner type="warn">
                ChatGPT requires PKCE (<code>code_challenge</code>). Ensure your client sends it.
              </AlertBanner>
            </div>
          </Panel>
        </div>

        {/* Right */}
        <div>
          <Panel title="ChatGPT OAuth Setup" subtitle="OAuth is primary for ChatGPT.com" noPad>
            <div className="lc-data-grid">
              <p><strong>Public issuer:</strong> {oauth.issuer}</p>
              <p><strong>MCP endpoint:</strong> {oauth.mcpEndpoint}</p>
              <p><strong>OAuth metadata:</strong> {oauth.oauthMetadata}</p>
              <p><strong>DCR endpoint:</strong> {oauth.registrationEndpoint}</p>
              <p><strong>Write mode:</strong> {oauth.writeMode}</p>
              <p><strong>files.write readiness:</strong>{" "}
                <StatusBadge status={write.oauthWriteReadinessSeverity}
                  label={write.oauthWriteReadinessLabel} />
              </p>
              <p><strong>Stored write token:</strong> {String(write.oauthFilesWriteGranted)}</p>
              <p><strong>Public reachability:</strong>{" "}
                <StatusBadge status={reachabilityBadge(tunnel)} label={reachabilityLabel(tunnel)} />
              </p>
              <p><strong>Tunnel auto-start:</strong>{" "}
                <StatusBadge status={tunnel.persistence === "confirmed" ? "pass" : "warn"} label={persistenceLabel(tunnel)} />
              </p>
              <p><strong>DCR:</strong>{" "}<StatusBadge status={oauth.dcrEnabled ? "pass" : "fail"} label={oauth.dcrEnabled ? "enabled" : "disabled"} /></p>
              <p><strong>Registered clients:</strong> {oauth.registeredClients}</p>
              <p><strong>ChatGPT clients:</strong> {oauth.registeredChatGptClients}</p>
              <p><strong>Doctor probe clients:</strong> {oauth.registeredDoctorProbeClients}</p>
              <p><strong>Client registry:</strong> <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", wordBreak: "break-all" }}>{oauth.clientRegistry}</span></p>
              {oauth.lastAuthorizeError && (
                <p style={{ gridColumn: "1 / -1" }}><strong>Last authorize error:</strong> <span style={{ color: oauth.lastAuthorizeErrorStale ? "var(--muted-strong)" : "var(--yellow)", fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}>{oauth.lastAuthorizeError}</span></p>
              )}
              <p><strong>PKCE method:</strong> {oauth.pkceMethodReceived ?? "—"}</p>
              {oauth.internalTools && <p style={{ gridColumn: "1 / -1" }}><strong>Internal tools:</strong> <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}>{oauth.internalTools}</span></p>}
            </div>
            <div className="lc-inline-actions">
              <button className="lc-btn" onClick={handlers.onOpenOAuthModal}>Configure OAuth Password</button>
              <button className="lc-btn" onClick={handlers.onResetOAuthClients}>Reset Clients</button>
              <button className="lc-btn" onClick={handlers.onRevokeOAuthTokens}>Revoke Tokens</button>
            </div>
          </Panel>

          <Panel title="OAuth Sessions" subtitle="Refresh tokens keep ChatGPT connected" noPad>
            <div className="lc-data-grid">
              <p><strong>Active clients:</strong> {oauthSession.activeClients}</p>
              <p><strong>Active refresh sessions:</strong> {oauthSession.activeRefreshSessions}</p>
              <p><strong>Expired sessions:</strong> {oauthSession.expiredSessions}</p>
              <p><strong>Revoked sessions:</strong> {oauthSession.revokedSessions}</p>
              <p><strong>Access token TTL:</strong> {oauthSession.accessTokenTtl}</p>
              <p><strong>Refresh token TTL:</strong> {oauthSession.refreshTokenTtl}</p>
            </div>
            <div className="lc-inline-actions">
              <button className="lc-btn lc-btn--danger" onClick={handlers.onRevokeAllSessions}>Revoke All Sessions</button>
              <button className="lc-btn" onClick={handlers.onClearExpiredSessions}>Clear Expired</button>
            </div>
          </Panel>

          <Panel title="OAuth URLs" noPad>
            <div className="lc-panel-body">
              <CopyField label="OAuth Issuer"           value={oauth.issuer}                onCopy={copy} />
              <CopyField label="Authorization Endpoint" value={`${oauth.issuer}/oauth/authorize`} onCopy={copy} />
              <CopyField label="Token Endpoint"         value={`${oauth.issuer}/oauth/token`}     onCopy={copy} />
              <CopyField label="Callback URL"           value={`${oauth.issuer}/oauth/callback`}  onCopy={copy} />
            </div>
          </Panel>
        </div>
      </div>

      {/* Generated Setup Notes */}
      <Panel title="Generated Setup Notes" subtitle="ChatGPT first; STDIO is advanced/local" noPad>
        <div className="lc-tab-row">
          {(["chatgpt", "generic", "codex", "claude"] as NoteTab[]).map(t => (
            <button key={t} className={`lc-tab${noteTab === t ? " lc-tab--active" : ""}`}
              onClick={() => setNoteTab(t)}>
              {t === "chatgpt" ? "ChatGPT HTTPS" : t === "generic" ? "Generic STDIO" : t === "codex" ? "Codex STDIO" : "Claude Desktop"}
            </button>
          ))}
        </div>
        <pre className="lc-code-preview">{state.generatedNotes[noteTab] ?? "Click Generate Setup Notes to populate."}</pre>
      </Panel>
    </div>
  );
}
