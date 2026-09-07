export function rxLog(scope: string, message: string, extra?: Record<string, string | number | null | undefined>): void {
  const suffix = extra
    ? ' ' +
      Object.entries(extra)
        .filter(([, value]) => value != null && value !== '')
        .map(([key, value]) => `${key}=${value}`)
        .join(' ')
    : '';
  console.info(`[rxdb][${scope}] ${message}${suffix}`);
}

export function rxError(scope: string, error: unknown): void {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`[rxdb][${scope}] ${message}`);
}
