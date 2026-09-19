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
  /** Optional OTA apply before local work. Return 'reloading' to abort pipeline. */
  applyUpdate?: () => Promise<'reloading' | 'skipped'>;
  openLocalDatabase: () => Promise<void>;
  restoreSession: () => Promise<void>;
  loadLocalStores: () => Promise<void>;
  prepareDashboard: () => Promise<void>;
  afterReady?: () => void;
};

const TRANSIENT_HINT = /timeout|timed out|network|offline|temporarily|ECONNRESET|ENOTFOUND|unavailable/i;

/** Hard cap so a blocked JS/native DB open cannot freeze the branded loader forever. */
export const STARTUP_FORCE_READY_MS = 2_500;
export const STARTUP_DB_TIMEOUT_MS = 8_000;
export const STARTUP_SOFT_TIMEOUT_MS = 3_000;
export const STARTUP_UPDATE_TIMEOUT_MS = 5_000;

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
    // Soft steps must not block first paint.
  }
}

export function createAppStartupController(deps: {
  setState: (partial: Partial<StartupState>) => void;
  getState: () => StartupState;
  steps: AppStartupSteps;
  maxTransientRetries?: number;
  dbTimeoutMs?: number;
  softTimeoutMs?: number;
  forceReadyMs?: number;
  updateTimeoutMs?: number;
}) {
  const maxTransientRetries = deps.maxTransientRetries ?? 0;
  const dbTimeoutMs = deps.dbTimeoutMs ?? STARTUP_DB_TIMEOUT_MS;
  const softTimeoutMs = deps.softTimeoutMs ?? STARTUP_SOFT_TIMEOUT_MS;
  const forceReadyMs = deps.forceReadyMs ?? STARTUP_FORCE_READY_MS;
  const updateTimeoutMs = deps.updateTimeoutMs ?? STARTUP_UPDATE_TIMEOUT_MS;
  let inFlight: Promise<void> | null = null;

  const setPhase = (phase: StartupPhase, error: string | null = null) => {
    deps.setState({
      phase,
      message: error ?? startupStatusLabel(phase),
      error,
    });
  };

  const markReady = (generation: number) => {
    if (deps.getState().generation !== generation) return;
    if (deps.getState().phase === 'ready') return;
    setPhase('ready');
    deps.steps.afterReady?.();
  };

  const runPipeline = async (generation: number): Promise<void> => {
    const stillCurrent = () => deps.getState().generation === generation;

    if (deps.steps.applyUpdate) {
      setPhase('initializing');
      try {
        const result = await withStartupTimeout(
          deps.steps.applyUpdate(),
          updateTimeoutMs,
          'startup update check'
        );
        if (result === 'reloading') return;
      } catch {
        // Offline or Expo Updates unavailable — continue with local launch.
      }
      if (!stillCurrent()) return;
    }

    setPhase('opening-local-database');
    // Soft: a hung SQLite/RxDB open must not trap the user on StartupScreen.
    await runSoft(deps.steps.openLocalDatabase, dbTimeoutMs, 'local database');
    if (!stillCurrent()) return;

    setPhase('restoring-session');
    await runSoft(deps.steps.restoreSession, softTimeoutMs, 'session restore');
    if (!stillCurrent()) return;

    setPhase('loading-dashboard');
    await runSoft(deps.steps.loadLocalStores, softTimeoutMs, 'local stores');
    if (!stillCurrent()) return;
    void runSoft(deps.steps.prepareDashboard, softTimeoutMs, 'dashboard seed');

    markReady(generation);
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
      const forceTimer = setTimeout(() => {
        markReady(generation);
      }, forceReadyMs);

      let attempt = 0;
      try {
        while (attempt <= maxTransientRetries) {
          try {
            await runPipeline(generation);
            return;
          } catch (error) {
            if (deps.getState().generation !== generation) return;
            if (deps.getState().phase === 'ready') return;
            const transient = isTransientStartupFailure(error) && attempt < maxTransientRetries;
            if (transient) {
              attempt += 1;
              continue;
            }
            // Prefer entering the app over a permanent branded loader.
            markReady(generation);
            if (deps.getState().phase !== 'ready') {
              setPhase(
                'recoverable-error',
                toUserMessage(error, 'SpendWise could not start. Please try again.')
              );
            }
            return;
          }
        }
      } finally {
        clearTimeout(forceTimer);
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
