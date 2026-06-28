import React from "react";
import { IconWarn, IconX, IconInfo } from "./Icons.js";

interface Props {
  type: "error" | "warn" | "info";
  children: React.ReactNode;
  className?: string;
}

export function AlertBanner({ type, children, className = "" }: Props) {
  const cls = `lc-alert lc-alert--${type} ${className}`;
  const icon = type === "error"
    ? <IconX size={15} />
    : type === "warn"
    ? <IconWarn size={15} />
    : <IconInfo size={15} />;
  return (
    <div className={cls} role="alert">
      {icon}
      <span>{children}</span>
    </div>
  );
}
