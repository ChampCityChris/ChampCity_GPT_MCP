const MAX_DIAGNOSTIC_TEXT_LENGTH = 500;
const MAX_DIAGNOSTIC_ROUTE_LENGTH = 128;
const MAX_DIAGNOSTIC_ENDPOINT_LENGTH = 128;
export const MAX_DIAGNOSTIC_JSON_RPC_ID_STRING_LENGTH = 128;

const APPROVED_ROUTES = new Set([
  "/mcp",
  "/health",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-authorization-server/mcp",
  "/oauth/register",
  "/oauth/authorize",
  "/oauth/token"
]);

const APPROVED_ROUTE_LABEL_PATTERN = /^(?:stateful-session|stateless-compat|auth-denied|scope-denied|batch-scope-denied|bad-request|server-error)$/u;

function collapseControls(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]+/gu, " ").replace(/\s+/gu, " ").trim();
}

export function sanitizeDiagnosticText(value: string): string {
  return collapseControls(value)
    .replace(/\b(?:https?|wss?):\/\/[^\s"'`<>)]+/giu, "<REDACTED_URL>")
    .replace(/\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d{1,5})?(?:\/[^\s"'`<>)]*)?/giu, "<REDACTED_URL>")
    .replace(/\b[a-z0-9-]+\.trycloudflare\.com\b/giu, "<REDACTED_URL>")
    .replace(/\b[a-z0-9.-]+\.cloudflareaccess\.com\b/giu, "<REDACTED_URL>")
    .replace(/\\\\\?\\UNC\\[^\\/\s"'`<>|]+\\[^\\/\s"'`<>|]+(?:\\[^\\/\s"'`<>|]+)*/gu, "<REDACTED_PATH>")
    .replace(/\\\\\?\\[A-Z]:\\[^"'`\r\n]+/giu, "<REDACTED_PATH>")
    .replace(/\\\\[^\\/\s"'`<>|]+\\[^\\/\s"'`<>|]+(?:\\[^\\/\s"'`<>|]+)*/gu, "<REDACTED_PATH>")
    .replace(/\b[A-Z]:[\\/]+[^"'`\r\n]+/giu, "<REDACTED_PATH>")
    .replace(/(^|[\s"'`([{=,:])\/(?!\/)[^\s"'`<>)]*/gu, (_match, prefix: string) => `${prefix}<REDACTED_PATH>`)
    .replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|figd_[A-Za-z0-9_-]{20,})\b/gu, "<REDACTED_SECRET>")
    .replace(
      /\b(?<key>access[_-]?token|refresh[_-]?token|authorization[_-]?code|id[_-]?token|api[_-]?key|client[_-]?secret|code[_-]?verifier|code[_-]?challenge|figmaAccessToken|password|secret|cookie)\b\s*[:=]\s*["']?[^"'\s\r\n]+["']?/giu,
      "$<key>=<REDACTED_SECRET>"
    )
    .replace(
      /\b(?<key>patch|content|prompt|artifact[_-]?text|file[_-]?content|search[_-]?content)\b\s*[:=]\s*["']?[^"'\r\n]+["']?/giu,
      "$<key>=<REDACTED_TEXT>"
    )
    .replace(/\bat\s+[A-Za-z0-9_.<>[\]-]+(?:\s+\([^)]+\)|:[0-9]+:[0-9]+)/gu, "<REDACTED_STACK>")
    .slice(0, MAX_DIAGNOSTIC_TEXT_LENGTH);
}

export function sanitizeDiagnosticJsonRpcId(value: unknown): string | number | null | undefined {
  if (typeof value === "number" || value === null) {
    return value;
  }

  if (typeof value === "string") {
    return sanitizeDiagnosticText(value).slice(0, MAX_DIAGNOSTIC_JSON_RPC_ID_STRING_LENGTH);
  }

  return undefined;
}

export function sanitizeDiagnosticRoute(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const route = collapseControls(value).slice(0, MAX_DIAGNOSTIC_ROUTE_LENGTH);
  if (APPROVED_ROUTES.has(route) || APPROVED_ROUTE_LABEL_PATTERN.test(route)) {
    return route;
  }

  return undefined;
}

export function sanitizeDiagnosticEndpoint(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const sanitized = sanitizeDiagnosticText(value).slice(0, MAX_DIAGNOSTIC_ENDPOINT_LENGTH);
  if (sanitized.includes("<REDACTED_URL>") || sanitized.includes("<REDACTED_PATH>")) {
    return "<REDACTED_ENDPOINT>";
  }

  return /^[A-Za-z0-9._:-]{1,128}$/u.test(sanitized) ? sanitized : "<REDACTED_ENDPOINT>";
}
