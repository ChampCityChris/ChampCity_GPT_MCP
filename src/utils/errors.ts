export type AppErrorCode =
  | "INVALID_INPUT"
  | "PATH_DENIED"
  | "FILE_DENIED"
  | "PATCH_DENIED"
  | "COMMAND_DENIED"
  | "APPROVAL_REQUIRED"
  | "GIT_REQUIRED"
  | "GIT_CAPABILITY_UNAVAILABLE"
  | "WORKSPACE_POLICY_DENIED"
  | "TARGET_OUTSIDE_ARTIFACT_ROOTS"
  | "PROCESS_FAILED"
  | "WORKSPACE_REQUIRED"
  | "WORKSPACE_NOT_FOUND"
  | "REPARSE_POINT_REJECTED"
  | "EXTENSION_MISMATCH"
  | "MIME_MISMATCH"
  | "UNSUPPORTED_IMAGE"
  | "IMAGE_DIMENSIONS_REJECTED"
  | "FILE_TOO_LARGE"
  | "DOWNLOAD_TIMED_OUT"
  | "DOWNLOAD_FAILED"
  | "DESTINATION_EXISTS"
  | "VERIFICATION_FAILED";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: AppErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function serializeError(error: unknown): { code: string; message: string; details?: Record<string, unknown> } {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: getErrorMessage(error)
  };
}
