import { toUserMessage } from '@/utils/errors';

export type StartupPhase =
  | 'initializing'
  | 'restoring-session'
  | 'opening-local-database'
  | 'loading-dashboard'
  | 'ready'
  | 'recoverable-error';

export type StartupState = {
  phase: StartupPhase;
  message: string;
  error: string | null;
  generation: number;
};

export function startupStatusLabel(phase: StartupPhase): string {
  switch (phase) {
    case 'opening-local-database':
      return 'Opening your secure local data…';
    case 'restoring-session':
      return 'Restoring your session…';
    case 'loading-dashboard':
      return 'Loading your financial overview…';
    case 'recoverable-error':
      return 'Still preparing SpendWise…';
    case 'ready':
      return 'Ready';
    case 'initializing':
    default:
      return 'Preparing SpendWise…';
  }
}

export function createInitialStartupState(): StartupState {
  return {
    phase: 'initializing',
    message: startupStatusLabel('initializing'),
    error: null,
    generation: 0,
  };
}

export type AppStartupSteps = {
  openLocalDatabase: () => Promise<void>;
  restoreSession: () => Promise<void>;
  loadLocalStores: () => Promise<void>;
  prepareDashboard: () => Promise<void>;
  afterReady?: () => void;
};

const TRANSIENT_HINT = /timeout|timed out|network|offline|temporarily|ECONNRESET|ENOTFOUND|unavailable/i;

export const STARTUP_DB_TIMEOUT_MS = 20_000;
export const STARTUP_SOFT_TIMEOUT_MS = 6_000;

export function isTransientStartupFailure(error: unknown): boolean {
  if (!error) return false;
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return TRANSIENT_HINT.test(text);
}

export async function withStartupTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${ms}ms`));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runSoft(step: () => Promise<void>, timeoutMs: number, label: string): Promise<void> {
  try {
    await withStartupTimeout(step(), timeoutMs, label);
  } catch {
    // Soft steps must not block first paint; Home/sync recover in-app.
  }
}

export function createAppStartupController(deps: {
  setState: (partial: Partial<StartupState>) => void;
  getState: () => StartupState;
  steps: AppStartupSteps;
  /** Bounded automatic recovery attempts for transient races only. */
  maxTransientRetries?: number;
  dbTimeoutMs?: number;
  softTimeoutMs?: number;
}) {
  const maxTransientRetries = deps.maxTransientRetries ?? 1;
  const dbTimeoutMs = deps.dbTimeoutMs ?? STARTUP_DB_TIMEOUT_MS;
  const softTimeoutMs = deps.softTimeoutMs ?? STARTUP_SOFT_TIMEOUT_MS;
  let inFlight: Promise<void> | null = null;

  const setPhase = (phase: StartupPhase, error: string | null = null) => {
    deps.setState({
      phase,
      message: error ?? startupStatusLabel(phase),
      error,
    });
  };

  const runPipeline = async (generation: number): Promise<void> => {
    const stillCurrent = () => deps.getState().generation === generation;

    setPhase('opening-local-database');
    await withStartupTimeout(deps.steps.openLocalDatabase(), dbTimeoutMs, 'local database');
    if (!stillCurrent()) return;

    setPhase('restoring-session');
    await runSoft(deps.steps.restoreSession, softTimeoutMs, 'session restore');
    if (!stillCurrent()) return;

    setPhase('loading-dashboard');
    await runSoft(deps.steps.loadLocalStores, softTimeoutMs, 'local stores');
    if (!stillCurrent()) return;
    // Dashboard seed is best-effort and must never gate first paint.
    void runSoft(deps.steps.prepareDashboard, softTimeoutMs, 'dashboard seed');

    setPhase('ready');
    deps.steps.afterReady?.();
  };

  const start = async (): Promise<StartupState> => {
    if (inFlight) {
      await inFlight;
      return deps.getState();
    }

    const generation = deps.getState().generation + 1;
    deps.setState({
      generation,
      phase: 'initializing',
      message: startupStatusLabel('initializing'),
      error: null,
    });

    inFlight = (async () => {
      let attempt = 0;
      while (attempt <= maxTransientRetries) {
        try {
          await runPipeline(generation);
          return;
        } catch (error) {
          if (deps.getState().generation !== generation) return;
          const transient = isTransientStartupFailure(error) && attempt < maxTransientRetries;
          if (transient) {
            attempt += 1;
            continue;
          }
          setPhase(
            'recoverable-error',
            toUserMessage(error, 'SpendWise could not start. Please try again.')
          );
          return;
        }
      }
    })().finally(() => {
      inFlight = null;
    });

    await inFlight;
    return deps.getState();
  };

  return {
    isRunning(): boolean {
      return inFlight !== null;
    },
    start,
    retry(): Promise<StartupState> {
      if (inFlight) return inFlight.then(() => deps.getState());
      return start();
    },
  };
}
