import { type AppErrorCode } from "./errors.js";

export type AppErrorCodeClassification = "contract" | "policy" | "authorization" | "execution" | "transport";

export const APP_ERROR_CODE_CLASSIFICATION = {
  INVALID_INPUT: "contract",
  PATH_DENIED: "policy",
  FILE_DENIED: "policy",
  PATCH_DENIED: "policy",
  COMMAND_DENIED: "policy",
  APPROVAL_REQUIRED: "authorization",
  GIT_REQUIRED: "policy",
  GIT_CAPABILITY_UNAVAILABLE: "execution",
  WORKSPACE_POLICY_DENIED: "policy",
  TARGET_OUTSIDE_ARTIFACT_ROOTS: "policy",
  PROCESS_FAILED: "execution",
  WORKSPACE_REQUIRED: "policy",
  WORKSPACE_NOT_FOUND: "policy",
  REPARSE_POINT_REJECTED: "policy",
  EXTENSION_MISMATCH: "policy",
  MIME_MISMATCH: "policy",
  UNSUPPORTED_IMAGE: "policy",
  IMAGE_DIMENSIONS_REJECTED: "policy",
  FILE_TOO_LARGE: "policy",
  DOWNLOAD_TIMED_OUT: "execution",
  DOWNLOAD_FAILED: "execution",
  DESTINATION_EXISTS: "policy",
  VERIFICATION_FAILED: "execution"
} as const satisfies Record<AppErrorCode, AppErrorCodeClassification>;

const EXTRA_AUTHORIZATION_DENIAL_CODES = new Set(["OAUTH_SCOPE_DENIED"]);
const EXTRA_TRANSPORT_CODES = new Set(["TRANSPORT_ERROR"]);

export function classifyAppErrorCode(code: string | undefined): AppErrorCodeClassification {
  if (!code) {
    return "execution";
  }

  if (EXTRA_AUTHORIZATION_DENIAL_CODES.has(code)) {
    return "authorization";
  }

  if (EXTRA_TRANSPORT_CODES.has(code)) {
    return "transport";
  }

  return APP_ERROR_CODE_CLASSIFICATION[code as AppErrorCode] ?? "execution";
}

export function isPolicyDeniedErrorCode(code: string | undefined): boolean {
  return classifyAppErrorCode(code) === "policy";
}

export function isContractRejectedErrorCode(code: string | undefined): boolean {
  return classifyAppErrorCode(code) === "contract";
}

export function isAuthorizationDeniedErrorCode(code: string | undefined): boolean {
  return classifyAppErrorCode(code) === "authorization";
}
