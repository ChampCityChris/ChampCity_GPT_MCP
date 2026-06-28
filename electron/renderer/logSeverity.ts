export type InferredLogLevel = "info" | "warn" | "error" | "debug";

export function inferLogLevel(message: string): InferredLogLevel {
  const structuredStatuses = message
    .split(/\r?\n/u)
    .map((line) => line.match(/^(?:\[[^\]]+\]\s+[^:]+:\s*)?(PASS|WARN|FAIL|ERROR)\b/iu)?.[1]?.toUpperCase())
    .filter(Boolean);
  if (structuredStatuses.includes("FAIL") || structuredStatuses.includes("ERROR")) {
    return "error";
  }
  if (structuredStatuses.includes("WARN")) {
    return "warn";
  }
  if (structuredStatuses.includes("PASS")) {
    return "info";
  }

  const text = message.toLowerCase();
  if (/\berror\b|\bfailed\b|\bfail\b/u.test(text)) {
    return "error";
  }

  if (text.includes("warn") || text.includes("not_ready")) {
    return "warn";
  }

  if (text.includes("debug")) {
    return "debug";
  }

  return "info";
}
