import { PROVIDER_TIMEOUT_MS } from './constants.ts';
import { FinancialAssistantError } from './errors.ts';

export type ProviderTimeoutExecution<T> = (args: {
  signal: AbortSignal;
  deadlineMs: number;
}) => Promise<T>;

/**
 * Runs a provider call with a hard wait timeout and cooperative AbortSignal.
 *
 * Cancellation is cooperative: adapters MUST honor `signal` (e.g. pass to `fetch`).
 * JavaScript cannot forcibly terminate arbitrary synchronous provider code.
 *
 * Lifecycle:
 * 1. Create AbortController + deadlineMs.
 * 2. Start provider work; always attach a no-op catch so late rejection is consumed.
 * 3. On timeout: abort signal, clear timer, throw generic `timeout` (fail closed).
 * 4. On provider settle first: clear timer; return or rethrow provider error.
 * 5. Late settle after timeout cannot change the response (ignored via `timedOut` flag).
 */
export async function runWithProviderTimeout<T>(
  execute: ProviderTimeoutExecution<T>,
  timeoutMs: number = PROVIDER_TIMEOUT_MS,
  nowMs: number = Date.now()
): Promise<T> {
  const controller = new AbortController();
  const deadlineMs = nowMs + timeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  const providerPromise = Promise.resolve().then(() =>
    execute({ signal: controller.signal, deadlineMs })
  );

  // Prevent unhandled rejection if the provider settles after we already timed out.
  const consumed = providerPromise.then(
    () => undefined,
    () => undefined
  );

  try {
    const outcome = await new Promise<
      { kind: 'value'; value: T } | { kind: 'error'; error: unknown } | { kind: 'timeout' }
    >((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        resolve({ kind: 'timeout' });
      }, timeoutMs);

      providerPromise.then(
        (value) => {
          if (!timedOut) resolve({ kind: 'value', value });
        },
        (error) => {
          if (!timedOut) resolve({ kind: 'error', error });
        }
      );
    });

    if (outcome.kind === 'timeout') {
      throw new FinancialAssistantError(
        'timeout',
        'Provider exceeded timeout',
        504
      );
    }
    if (outcome.kind === 'error') {
      throw outcome.error;
    }
    return outcome.value;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    void consumed;
  }
}

/** @deprecated Use runWithProviderTimeout — kept name alias for import clarity in tests. */
export const withProviderTimeout = runWithProviderTimeout;
