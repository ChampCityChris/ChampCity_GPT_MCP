// LauncherApp.tsx
// Root component for the ChampCity MCP Launcher UI.
// Import this in your Electron renderer (replacing RendererApp) and pass live state + handlers.

import React, { useState } from "react";
import "./launcher.css";

import type { LauncherState, LauncherHandlers, Screen } from "./launcherTypes.js";
import { Sidebar }            from "./components/Sidebar.js";
import { DashboardScreen }    from "./screens/DashboardScreen.js";
import { ConnectionScreen }   from "./screens/ConnectionScreen.js";
import { LogsScreen }         from "./screens/LogsScreen.js";
import { McpToolsScreen }     from "./screens/McpToolsScreen.js";
import { TroubleshootScreen } from "./screens/TroubleshootScreen.js";
import { SettingsScreen }     from "./screens/SettingsScreen.js";

interface Props {
  state: LauncherState;
  handlers: LauncherHandlers;
  initialScreen?: Screen;
}

export function LauncherApp({ state, handlers, initialScreen = "dashboard" }: Props) {
  const [screen, setScreen] = useState<Screen>(initialScreen);

  return (
    <div className="lc-shell">
      <Sidebar
        activeScreen={screen}
        serverState={state.server.state}
        localEndpoint={state.server.localEndpoint}
        onNavigate={setScreen}
      />

      <div className="lc-workspace">
        {screen === "dashboard" && (
          <DashboardScreen
            state={state}
            handlers={handlers}
            onNavigate={s => setScreen(s)}
          />
        )}
        {screen === "connection" && (
          <ConnectionScreen state={state} handlers={handlers} />
        )}
        {screen === "logs" && (
          <LogsScreen state={state} handlers={handlers} />
        )}
        {screen === "tools" && (
          <McpToolsScreen state={state} handlers={handlers} />
        )}
        {screen === "troubleshoot" && (
          <TroubleshootScreen state={state} handlers={handlers} onNavigate={setScreen} />
        )}
        {screen === "settings" && (
          <SettingsScreen state={state} handlers={handlers} />
        )}
      </div>
    </div>
  );
}
