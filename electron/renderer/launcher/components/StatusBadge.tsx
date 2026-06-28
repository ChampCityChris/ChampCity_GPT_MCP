import React from "react";
import type { BadgeStatus, ServerState } from "../launcherTypes.js";

interface Props {
  status: BadgeStatus | ServerState;
  label?: string;
}

const CONFIG: Record<string, { cls: string; dot: boolean; label: string }> = {
  pass:     { cls: "lc-badge--pass",    dot: false, label: "Pass"     },
  running:  { cls: "lc-badge--running", dot: true,  label: "Running"  },
  warn:     { cls: "lc-badge--warn",    dot: false, label: "Warn"     },
  fail:     { cls: "lc-badge--fail",    dot: false, label: "Fail"     },
  error:    { cls: "lc-badge--error",   dot: false, label: "Error"    },
  stopped:  { cls: "lc-badge--stopped", dot: false, label: "Stopped"  },
  starting: { cls: "lc-badge--info",    dot: true,  label: "Starting…"},
  stopping: { cls: "lc-badge--warn",    dot: false, label: "Stopping…"},
  info:     { cls: "lc-badge--info",    dot: false, label: "Info"     },
  unknown:  { cls: "lc-badge--unknown", dot: false, label: "Unknown"  },
};

export function StatusBadge({ status, label }: Props) {
  const c = CONFIG[status] ?? CONFIG.unknown;
  return (
    <span className={`lc-badge ${c.cls}`}>
      {c.dot && <span className="lc-badge-dot" />}
      {label ?? c.label}
    </span>
  );
}
