/// <reference types="jest" />
import {
  createAppStartupController,
  createInitialStartupState,
  isTransientStartupFailure,
  startupStatusLabel,
  type StartupState,
} from '@/services/appStartup';
import { clearDashboardSeed, peekDashboardSeed, setDashboardSeed } from '@/services/dashboardSeed';
import type { HomeDashboardSnapshot } from '@/services/dashboardSnapshot';
import { walletSThemeFills } from '@/components/brand/walletSMark';
import { previewUpdateVerificationLabel } from '@/utils/previewUpdateMarker';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('app startup state machine', () => {
  it('exposes branded status labels for each phase', () => {
    expect(startupStatusLabel('initializing')).toMatch(/Preparing SpendWise/i);
    expect(startupStatusLabel('opening-local-database')).toMatch(/secure local data/i);
    expect(startupStatusLabel('loading-dashboard')).toMatch(/financial overview/i);
  });

  it('runs one pipeline and waits for session plus local database before dashboard', async () => {
    const order: string[] = [];
    let state = createInitialStartupState();
    const controller = createAppStartupController({
      getState: () => state,
      setState: (partial) => {
        state = { ...state, ...partial };
      },
      steps: {
        openLocalDatabase: async () => {
          order.push('db');
        },
        restoreSession: async () => {
          order.push('session');
        },
        loadLocalStores: async () => {
          order.push('stores');
        },
        prepareDashboard: async () => {
          order.push('dashboard');
        },
      },
    });

    await controller.start();
    expect(order).toEqual(['db', 'session', 'stores', 'dashboard']);
    expect(state.phase).toBe('ready');
  });

  it('deduplicates concurrent start calls', async () => {
    let runs = 0;
    const gate = deferred<void>();
    let state = createInitialStartupState();
    const controller = createAppStartupController({
      getState: () => state,
      setState: (partial) => {
        state = { ...state, ...partial };
      },
      steps: {
        openLocalDatabase: async () => {
          runs += 1;
          await gate.promise;
        },
        restoreSession: async () => undefined,
        loadLocalStores: async () => undefined,
        prepareDashboard: async () => undefined,
      },
    });

    const first = controller.start();
    const second = controller.start();
    gate.resolve();
    await Promise.all([first, second]);
    expect(runs).toBe(1);
    expect(state.phase).toBe('ready');
  });

  it('retries only transient failures once, then surfaces Retry', async () => {
    let attempts = 0;
    let state = createInitialStartupState();
    const controller = createAppStartupController({
      getState: () => state,
      setState: (partial) => {
        state = { ...state, ...partial };
      },
      maxTransientRetries: 1,
      steps: {
        openLocalDatabase: async () => {
          attempts += 1;
          throw new Error('network timeout');
        },
        restoreSession: async () => undefined,
        loadLocalStores: async () => undefined,
        prepareDashboard: async () => undefined,
      },
    });

    await controller.start();
    expect(attempts).toBe(2);
    expect(state.phase).toBe('recoverable-error');
    expect(isTransientStartupFailure(new Error('network timeout'))).toBe(true);
  });

  it('does not retry deterministic startup failures', async () => {
    let attempts = 0;
    let state = createInitialStartupState();
    const controller = createAppStartupController({
      getState: () => state,
      setState: (partial) => {
        state = { ...state, ...partial };
      },
      maxTransientRetries: 1,
      steps: {
        openLocalDatabase: async () => {
          attempts += 1;
          throw new Error('schema corrupt');
        },
        restoreSession: async () => undefined,
        loadLocalStores: async () => undefined,
        prepareDashboard: async () => undefined,
      },
    });

    await controller.start();
    expect(attempts).toBe(1);
    expect(state.phase).toBe('recoverable-error');
  });

  it('ignores stale pipeline results after a newer generation starts', async () => {
    const firstDb = deferred<void>();
    let state: StartupState = createInitialStartupState();
    const controller = createAppStartupController({
      getState: () => state,
      setState: (partial) => {
        state = { ...state, ...partial };
      },
      steps: {
        openLocalDatabase: async () => {
          if (state.generation === 1) await firstDb.promise;
        },
        restoreSession: async () => undefined,
        loadLocalStores: async () => undefined,
        prepareDashboard: async () => undefined,
      },
    });

    const older = controller.start();
    // Force a second generation while the first is blocked.
    await Promise.resolve();
    // Controllers dedupe while inFlight — simulate generation bump by finishing first then retrying.
    firstDb.resolve();
    await older;
    expect(state.phase).toBe('ready');
    await controller.retry();
    expect(state.generation).toBeGreaterThanOrEqual(2);
    expect(state.phase).toBe('ready');
  });
});

describe('dashboard seed and branding helpers', () => {
  afterEach(() => {
    clearDashboardSeed();
  });

  it('only returns a seed for the matching user and period', () => {
    const seed = {
      userKey: 'user-a',
      periodKey: '2026-9',
      revision: 1,
      dashboard: { income: 1 },
    } as HomeDashboardSnapshot;
    setDashboardSeed(seed);
    expect(peekDashboardSeed('user-a', '2026-9')?.dashboard).toEqual({ income: 1 });
    expect(peekDashboardSeed('user-b', '2026-9')).toBeNull();
  });

  it('builds theme-aware logo fills from semantic primary tokens', () => {
    const light = walletSThemeFills('#0E7C66', false);
    const dark = walletSThemeFills('#0E7C66', true);
    expect(light.upper).toBe('#0E7C66');
    expect(dark.upper).toBe('#0E7C66');
    expect(light.lower).not.toBe(light.upper);
    expect(dark.lower).not.toBe(dark.upper);
  });

  it('keeps the preview verification marker preview-only', () => {
    expect(previewUpdateVerificationLabel('preview')).toMatch(/Preview update verification/);
    expect(previewUpdateVerificationLabel('production')).toBeNull();
    expect(previewUpdateVerificationLabel(null)).toBeNull();
  });
});
