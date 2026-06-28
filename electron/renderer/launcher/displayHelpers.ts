import type { BadgeStatus } from "./launcherTypes.js";

export function safeText(value: string | undefined | null, fallback = "--"): string {
  const text = value?.trim();
  return text ? text : fallback;
}

export function safeHostname(value: string | undefined | null, fallback = "--"): string {
  const text = value?.trim();
  if (!text) {
    return fallback;
  }

  try {
    return new URL(text).hostname || text;
  } catch {
    return text;
  }
}

export function safePortLabel(value: string | undefined | null, fallback = "offline"): string {
  const text = value?.trim();
  if (!text) {
    return fallback;
  }

  try {
    return new URL(text).port || safeHostname(text, fallback);
  } catch {
    return text;
  }
}

export function triStateStatus(value: boolean | "unknown"): BadgeStatus {
  if (value === true) {
    return "pass";
  }

  if (value === false) {
    return "fail";
  }

  return "unknown";
}

export function triStateLabel(value: boolean | "unknown"): string {
  if (value === true) {
    return "granted";
  }

  if (value === false) {
    return "not granted";
  }

  return "unknown";
}
