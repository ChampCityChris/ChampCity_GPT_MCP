import React from "react";

interface Props {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  noPad?: boolean;
  style?: React.CSSProperties;
}

export function Panel({ title, subtitle, children, actions, className = "", noPad, style }: Props) {
  return (
    <div className={`lc-panel ${className}`} style={style}>
      {title && (
        <div className="lc-panel-heading">
          <h2>{title}</h2>
          {subtitle && <span className="lc-panel-heading-sub">{subtitle}</span>}
          {actions}
        </div>
      )}
      <div className={noPad ? "" : "lc-panel-body"}>
        {children}
      </div>
    </div>
  );
}
