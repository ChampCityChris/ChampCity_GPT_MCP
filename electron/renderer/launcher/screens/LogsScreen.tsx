import React, { useState, useMemo } from "react";
import type { LauncherState, LauncherHandlers, LogLevel } from "../launcherTypes.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { Panel } from "../components/Panel.js";
import { IconSearch, IconCopy, IconDownload, IconTrash } from "../components/Icons.js";

interface Props {
  state: LauncherState;
  handlers: LauncherHandlers;
}

type Filter = "all" | LogLevel;

const LEVEL_STATUS: Record<LogLevel, "fail" | "warn" | "info" | "stopped"> = {
  error: "fail",
  warn:  "warn",
  info:  "info",
  debug: "stopped",
};

export function LogsScreen({ state, handlers }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const rows = useMemo(() =>
    state.logs.filter(l =>
      (filter === "all" || l.level === filter) &&
      (query === "" || l.message.toLowerCase().includes(query.toLowerCase()))
    ),
    [state.logs, filter, query]
  );

  return (
    <div>
      <div className="lc-screen-header">
        <div>
          <h1 className="lc-screen-title">Logs</h1>
          <p className="lc-screen-sub">Server activity · Doctor · Build · HTTP start/stop · Errors</p>
        </div>
        <div className="lc-actions">
          <button className="lc-btn" onClick={handlers.onCopyLogs}>
            <IconCopy size={13} /> Copy View
          </button>
          <button className="lc-btn" onClick={handlers.onExportLogs}>
            <IconDownload size={13} /> Export
          </button>
          <button className="lc-btn" onClick={handlers.onClearLogs}>
            <IconTrash size={13} /> Clear View
          </button>
        </div>
      </div>

      <Panel noPad>
        {/* Toolbar */}
        <div className="lc-log-toolbar">
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <span style={{ position: "absolute", left: 8, color: "var(--muted)", pointerEvents: "none" }}>
              <IconSearch size={13} />
            </span>
            <input
              className="lc-log-search"
              style={{ paddingLeft: 28 }}
              type="search"
              placeholder="Search logs…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              aria-label="Search logs"
            />
          </div>
          {(["all", "info", "warn", "error", "debug"] as Filter[]).map(lv => (
            <button
              key={lv}
              className={`lc-log-filter${filter === lv ? " lc-log-filter--active" : ""}`}
              onClick={() => setFilter(lv)}
            >
              {lv === "all" ? "All" : lv.charAt(0).toUpperCase() + lv.slice(1)}
            </button>
          ))}
          <span className="lc-log-count">{rows.length} entries</span>
        </div>

        {/* Log table */}
        {rows.length === 0 ? (
          <div style={{ padding: "48px 16px", textAlign: "center", color: "var(--muted)", fontSize: "0.84rem" }}>
            {query || filter !== "all" ? "No entries match the current filter." : "No log entries yet."}
          </div>
        ) : (
          <div style={{ padding: "0 14px 14px" }}>
            {rows.map(log => (
              <div key={log.id} className="lc-log-row">
                <span className="lc-log-time">{log.timestamp}</span>
                <StatusBadge status={LEVEL_STATUS[log.level]} label={log.level} />
                <span className="lc-log-msg">{log.message}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
