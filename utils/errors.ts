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

export function logError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`[SpendWise] ${context}: ${message}`);
}

export function toUserMessage(error: unknown, fallback: string): string {
  if (error instanceof AppError) {
    return error.userMessage;
  }
  return fallback;
}
