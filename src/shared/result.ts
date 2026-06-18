export const appErrorCodes = [
  "INVALID_ACTION",
  "ACTION_NOT_ALLOWED",
  "DUPLICATE_SUBMIT",
  "STORAGE_LOAD_FAILED",
  "STORAGE_SAVE_FAILED",
  "AI_TIMEOUT",
  "AI_JSON_INVALID",
  "AI_UNAVAILABLE",
  "SNAPSHOT_CORRUPTED",
  "REPLAY_FAILED",
] as const;
export type AppErrorCode = (typeof appErrorCodes)[number];

export const appErrorSources = [
  "rules",
  "storage",
  "ai_client",
  "ai_proxy",
  "ai_service",
  "app",
] as const;
export type AppErrorSource = (typeof appErrorSources)[number];

export type AppError = {
  code: AppErrorCode;
  message: string;
  userMessage?: string;
  retryable: boolean;
  source: AppErrorSource;
};

export type Result<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: AppError;
    };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function err(error: AppError): Result<never> {
  return { ok: false, error };
}
