// Icons.tsx — inline SVG icons, no external dependencies
import React from "react";

type P = { size?: number; className?: string; style?: React.CSSProperties };
const I = ({ size = 14, className, style, d }: P & { d: string }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
    className={className} style={style} aria-hidden="true">
    <path d={d} />
  </svg>
);

export const IconPlay     = (p: P) => <I {...p} d="M4 2l10 6-10 6V2z" />;
export const IconStop     = (p: P) => <I {...p} d="M3 3h10v10H3z" />;
export const IconRestart  = (p: P) => <I {...p} d="M2 8a6 6 0 1 1 1.5 4M2 12V8h4" />;
export const IconCopy     = (p: P) => <I {...p} d="M5 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-2M7 1h6a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" />;
export const IconCheck    = (p: P) => <I {...p} d="M2 8l4 4 8-8" />;
export const IconX        = (p: P) => <I {...p} d="M2 2l12 12M14 2L2 14" />;
export const IconWarn     = (p: P) => <I {...p} d="M8 1L15 14H1L8 1zM8 6v4M8 12v.5" />;
export const IconInfo     = (p: P) => <I {...p} d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zM8 7v5M8 5v.5" />;
export const IconChevronR = (p: P) => <I {...p} d="M5 3l6 5-6 5" />;
export const IconChevronD = (p: P) => <I {...p} d="M3 5l5 6 5-6" />;
export const IconSearch   = (p: P) => <I {...p} d="M10.5 10.5L14 14M6.5 11a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z" />;
export const IconDownload = (p: P) => <I {...p} d="M8 1v9M4 7l4 4 4-4M2 12h12" />;
export const IconTrash    = (p: P) => <I {...p} d="M2 4h12M6 4V2h4v2M5 4l1 10h4l1-10" />;
export const IconRefresh  = (p: P) => <I {...p} d="M2 8a6 6 0 1 1 1.5 4M2 12V8h4" />;
export const IconServer   = (p: P) => <I {...p} d="M2 4h12v4H2zM2 8h12v4H2zM5 6h.5M5 10h.5" />;
export const IconShield   = (p: P) => <I {...p} d="M8 1L2 4v4c0 4 3 6 6 7 3-1 6-3 6-7V4L8 1z" />;
export const IconGlobe    = (p: P) => <I {...p} d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zM1 8h14M8 1c-2 2-3 4-3 7s1 5 3 7c2-2 3-4 3-7s-1-5-3-7z" />;
export const IconEye      = (p: P) => <I {...p} d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />;
export const IconEyeOff   = (p: P) => <I {...p} d="M2 2l12 12M6.4 6.4A3 3 0 0 0 11 11M4.2 4.2C2.9 5.3 2 6.6 1.7 8c.8 3 3.9 5 6.3 5 1.2 0 2.4-.4 3.3-1.1M9.5 3A7 7 0 0 1 15 8c-.3 1-.9 2-1.7 2.8" />;
export const IconLink     = (p: P) => <I {...p} d="M6 9a3 3 0 0 0 4.5.5l2-2a3 3 0 0 0-4.2-4.2L7 4.5M10 7a3 3 0 0 0-4.5-.5l-2 2a3 3 0 0 0 4.2 4.2L9 11.5" />;
export const IconActivity = (p: P) => <I {...p} d="M1 8h3l2-5 3 10 2-5h4" />;
