import React, { useState } from "react";
import { IconCopy, IconCheck } from "./Icons.js";

interface Props {
  label: string;
  value: string;
  onCopy?: (value: string) => void;
}

export function CopyField({ label, value, onCopy }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (onCopy) {
      onCopy(value);
    } else {
      navigator.clipboard?.writeText(value).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="lc-copy-field">
      <span className="lc-copy-label">{label}</span>
      <div className="lc-copy-row">
        <span className="lc-copy-value" title={value}>{value}</span>
        <button
          className={`lc-copy-btn${copied ? " lc-copy-btn--copied" : ""}`}
          onClick={handleCopy}
          aria-label={copied ? "Copied" : `Copy ${label}`}
          title={copied ? "Copied!" : "Copy"}
        >
          {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
        </button>
      </div>
    </div>
  );
}
