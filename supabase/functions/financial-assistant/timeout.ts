import { PROVIDER_TIMEOUT_MS } from './constants.ts';
import { FinancialAssistantError } from './errors.ts';

/** Fail closed if a provider call exceeds the hard timeout. */
export async function withProviderTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = PROVIDER_TIMEOUT_MS
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new FinancialAssistantError('timeout', `Provider exceeded ${timeoutMs}ms timeout`, 504)
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
