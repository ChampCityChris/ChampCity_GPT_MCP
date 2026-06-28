import React from "react";
import type { Screen, ServerState } from "../launcherTypes.js";
import { safePortLabel } from "../displayHelpers.js";

const champCityIco = "./assets/champcity-crest.png";

interface NavItem { id: Screen; label: string; alert?: boolean; }

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "connection", label: "Connection" },
  { id: "logs", label: "Logs" },
  { id: "tools", label: "MCP Tools" },
  { id: "troubleshoot", label: "Troubleshoot", alert: true },
  { id: "settings", label: "Settings" },
];

interface Props {
  activeScreen: Screen;
  serverState: ServerState;
  localEndpoint: string;
  onNavigate: (screen: Screen) => void;
}

export function Sidebar({ activeScreen, serverState, localEndpoint, onNavigate }: Props) {
  const dotCls =
    serverState === "running" ? "lc-status-dot lc-status-dot--running" :
    serverState === "error" ? "lc-status-dot lc-status-dot--error" :
    serverState === "starting" ? "lc-status-dot lc-status-dot--warn" :
    "lc-status-dot";

  let statusText = "offline";
  if (serverState === "running") {
    statusText = `${safePortLabel(localEndpoint)} - active`;
  } else if (serverState === "starting") {
    statusText = "starting...";
  } else if (serverState === "stopping") {
    statusText = "stopping...";
  } else if (serverState === "error") {
    statusText = "error";
  }

  return (
    <aside className="lc-sidebar" aria-label="Primary navigation">
      <div className="lc-brand">
        <div className="lc-brand-mark">
          <img src={champCityIco} alt="ChampCity crest" />
        </div>
        <div>
          <p className="lc-brand-name">ChampCity</p>
          <p className="lc-brand-sub">MCP Launcher</p>
        </div>
      </div>

      <nav className="lc-nav" aria-label="Screens">
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            className={[
              "lc-nav-item",
              activeScreen === item.id ? "lc-nav-item--active" : "",
              item.alert && activeScreen !== item.id ? "lc-nav-item--alert" : "",
            ].join(" ").trim()}
            onClick={() => onNavigate(item.id)}
            aria-current={activeScreen === item.id ? "page" : undefined}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="lc-sidebar-status">
        <span className={dotCls} aria-hidden="true" />
        <span>{statusText}</span>
      </div>
    </aside>
  );
}
