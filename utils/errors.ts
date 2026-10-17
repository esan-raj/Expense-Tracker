export class AppError extends Error {
  userMessage: string;

  constructor(userMessage: string, cause?: unknown) {
    super(userMessage);
    this.name = 'AppError';
    this.userMessage = userMessage;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/** Extract a safe diagnostic message from Error, Postgrest, or plain objects. */
export function getErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  if (error && typeof error === 'object') {
    const record = error as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
      error_description?: unknown;
    };
    const parts = [record.message, record.details, record.hint, record.code, record.error_description]
      .map((part) => (part == null ? '' : String(part).trim()))
      .filter(Boolean);
    if (parts.length > 0) {
      return parts.join(' | ');
    }
  }
  return fallback;
}

export function logError(context: string, error: unknown): void {
  console.error(`[SpendWise] ${context}: ${getErrorMessage(error)}`);
}

export function toUserMessage(error: unknown, fallback: string): string {
  if (error instanceof AppError) {
    return error.userMessage;
  }
  return fallback;
}
