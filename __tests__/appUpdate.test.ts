/// <reference types="jest" />
import { createAppUpdateController, createInitialAppUpdateState } from '@/services/appUpdate/controller';
import {
  createAutoCheckCooldown,
  createUpdateCheckGate,
  decideReload,
  isNetworkFailure,
  resolveUpdateEnvironment,
  shouldAutoCheck,
  UPDATE_AUTO_CHECK_COOLDOWN_MS,
} from '@/services/appUpdate/logic';
import type { AppUpdateInfo, AppUpdateState, UpdatesAdapter } from '@/services/appUpdate/types';

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

const INFO: AppUpdateInfo = {
  appVersion: '1.0.0',
  nativeApplicationVersion: '1.0.0',
  nativeBuildVersion: '12',
  channel: 'preview',
  runtimeVersion: 'fingerprint-hash',
  updateId: 'update-1',
  createdAt: '2026-09-17T00:00:00.000Z',
  isEmbeddedLaunch: true,
  isEmergencyLaunch: false,
};

function createAdapter(overrides: Partial<UpdatesAdapter> = {}): UpdatesAdapter {
  return {
    isEnabled: true,
    environment: 'standalone',
    getInfo: () => INFO,
    checkForUpdate: async () => ({ isAvailable: false, isRollBackToEmbedded: false }),
    fetchUpdate: async () => ({ isNew: true, isRollBackToEmbedded: false }),
    reload: async () => undefined,
    ...overrides,
  };
}

function createHarness(overrides: {
  adapter?: Partial<UpdatesAdapter>;
  flush?: () => Promise<void>;
  isCriticalWork?: () => boolean;
} = {}) {
  let state = createInitialAppUpdateState(createAdapter(overrides.adapter));
  const flush = overrides.flush ?? (async () => undefined);
  const isCriticalWork = overrides.isCriticalWork ?? (() => false);
  const controller = createAppUpdateController({
    adapter: createAdapter(overrides.adapter),
    flush,
    isCriticalWork,
    getState: () => state,
    setState: (partial: Partial<AppUpdateState>) => {
      state = { ...state, ...partial };
    },
  });
  return {
    controller,
    getState: () => state,
  };
}

describe('app update environment', () => {
  it('treats Expo Go and development sessions as unsupported for auto-check', () => {
    expect(
      resolveUpdateEnvironment({ os: 'android', isDev: false, appOwnership: 'expo', updatesEnabled: false })
    ).toBe('expo-go');
    expect(
      resolveUpdateEnvironment({ os: 'android', isDev: true, appOwnership: 'guest', updatesEnabled: false })
    ).toBe('development');
    expect(shouldAutoCheck('expo-go')).toBe(false);
    expect(shouldAutoCheck('development')).toBe(false);
    expect(shouldAutoCheck('web')).toBe(false);
    expect(shouldAutoCheck('standalone')).toBe(true);
  });
});

describe('app update network and concurrency', () => {
  it('keeps the app running after a launch network failure', async () => {
    const harness = createHarness({
      adapter: {
        checkForUpdate: async () => {
          throw new Error('Network request failed');
        },
      },
    });

    const result = await harness.controller.check('launch');
    expect(result.status).toBe('idle');
    expect(result.bannerVisible).toBe(false);
    expect(result.lastError).toMatch(/offline/i);
    expect(isNetworkFailure(new Error('Network request failed'))).toBe(true);
  });

  it('surfaces a retryable error for a manual check when the network fails', async () => {
    const harness = createHarness({
      adapter: {
        checkForUpdate: async () => {
          throw new Error('ENOTFOUND u.expo.dev');
        },
      },
    });

    const result = await harness.controller.check('manual');
    expect(result.status).toBe('error');
    expect(result.bannerVisible).toBe(false);
    expect(result.message).toMatch(/offline/i);
  });

  it('runs one download when two checks start together', async () => {
    let checks = 0;
    let fetches = 0;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = createHarness({
      adapter: {
        checkForUpdate: async () => {
          checks += 1;
          release();
          await delay(30);
          return { isAvailable: true, isRollBackToEmbedded: false };
        },
        fetchUpdate: async () => {
          fetches += 1;
          return { isNew: true, isRollBackToEmbedded: false };
        },
      },
    });

    const first = harness.controller.check('launch');
    await started;
    const second = harness.controller.check('manual');
    await Promise.all([first, second]);

    expect(checks).toBe(1);
    expect(fetches).toBe(1);
    expect(harness.getState().status).toBe('ready');
  });

  it('applies a cooldown so foreground checks do not spam the update service', async () => {
    let checks = 0;
    const harness = createHarness({
      adapter: {
        checkForUpdate: async () => {
          checks += 1;
          return { isAvailable: false, isRollBackToEmbedded: false };
        },
      },
    });

    await harness.controller.check('launch');
    await harness.controller.check('foreground');
    expect(checks).toBe(1);

    const cooldown = createAutoCheckCooldown(UPDATE_AUTO_CHECK_COOLDOWN_MS);
    expect(cooldown.allow('launch', 1_000)).toBe(true);
    expect(cooldown.allow('foreground', 1_000 + UPDATE_AUTO_CHECK_COOLDOWN_MS - 1)).toBe(false);
    expect(cooldown.allow('manual', 1_000 + UPDATE_AUTO_CHECK_COOLDOWN_MS - 1)).toBe(true);
  });
});

describe('app update ready and reload safety', () => {
  it('downloads automatically on launch and shows a ready prompt', async () => {
    const reload = jest.fn(async () => undefined);
    const harness = createHarness({
      adapter: {
        checkForUpdate: async () => ({ isAvailable: true, isRollBackToEmbedded: false }),
        reload,
      },
    });

    const result = await harness.controller.check('launch');
    expect(result.status).toBe('ready');
    expect(result.bannerVisible).toBe(true);
    expect(result.promptVisible).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it('leaves manual checks in available until the user downloads', async () => {
    let fetches = 0;
    const harness = createHarness({
      adapter: {
        checkForUpdate: async () => ({ isAvailable: true, isRollBackToEmbedded: false }),
        fetchUpdate: async () => {
          fetches += 1;
          return { isNew: true, isRollBackToEmbedded: false };
        },
      },
    });

    await harness.controller.check('manual');
    expect(harness.getState().status).toBe('available');
    expect(fetches).toBe(0);
    await harness.controller.download();
    expect(fetches).toBe(1);
    expect(harness.getState().status).toBe('ready');
  });

  it('marks unavailable when no compatible update exists', async () => {
    const harness = createHarness({
      adapter: {
        checkForUpdate: async () => ({ isAvailable: false, isRollBackToEmbedded: false }),
      },
    });
    await harness.controller.check('manual');
    expect(harness.getState().status).toBe('unavailable');
    expect(harness.getState().message).toMatch(/latest compatible update/i);
    expect(harness.getState().lastCheckedAt).toBeTruthy();
  });

  it('suppresses the restart prompt after Later without clearing ready status', async () => {
    const harness = createHarness({
      adapter: {
        checkForUpdate: async () => ({ isAvailable: true, isRollBackToEmbedded: false }),
      },
    });
    await harness.controller.check('launch');
    expect(harness.getState().promptVisible).toBe(true);
    harness.controller.dismissPrompt();
    expect(harness.getState().promptVisible).toBe(false);
    expect(harness.getState().bannerVisible).toBe(true);
    expect(harness.getState().status).toBe('ready');
  });

  it('does not reload while critical work is in progress', async () => {
    const reload = jest.fn(async () => undefined);
    const flush = jest.fn(async () => undefined);
    const harness = createHarness({
      adapter: {
        checkForUpdate: async () => ({ isAvailable: true, isRollBackToEmbedded: false }),
        reload,
      },
      flush,
      isCriticalWork: () => true,
    });

    await harness.controller.check('launch');
    const decision = await harness.controller.apply();
    expect(decision).toEqual({
      ok: false,
      reason: 'critical-work',
      message: 'Finish the current edit, import, or restore before restarting.',
    });
    expect(flush).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(harness.getState().status).toBe('ready');
  });

  it('reloads only after a successful persistence flush', async () => {
    const reload = jest.fn(async () => undefined);
    const flush = jest.fn(async () => undefined);
    const harness = createHarness({
      adapter: {
        checkForUpdate: async () => ({ isAvailable: true, isRollBackToEmbedded: false }),
        reload,
      },
      flush,
    });

    await harness.controller.check('launch');
    await expect(harness.controller.apply()).resolves.toEqual({ ok: true });
    expect(flush).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('keeps the running app when persistence flush fails', async () => {
    const reload = jest.fn(async () => undefined);
    const harness = createHarness({
      adapter: {
        checkForUpdate: async () => ({ isAvailable: true, isRollBackToEmbedded: false }),
        reload,
      },
      flush: async () => {
        throw new Error('disk full');
      },
    });

    await harness.controller.check('launch');
    const decision = await harness.controller.apply();
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe('flush-failed');
    expect(reload).not.toHaveBeenCalled();
    expect(harness.getState().status).toBe('ready');
    expect(harness.getState().lastError).toMatch(/saving local data/i);
  });

  it('does not treat a later check as a reason to restart automatically', async () => {
    const reload = jest.fn(async () => undefined);
    const harness = createHarness({
      adapter: {
        checkForUpdate: async () => ({ isAvailable: false, isRollBackToEmbedded: false }),
        reload,
      },
    });
    const state = createInitialAppUpdateState(createAdapter());
    expect(state.bannerVisible).toBe(false);
    await harness.controller.check('launch');
    await harness.controller.check('manual');
    expect(reload).not.toHaveBeenCalled();
    expect(harness.getState().status).toBe('unavailable');
  });
});

describe('reload decision helpers', () => {
  it('blocks reload for critical work even if flush would succeed', () => {
    expect(decideReload({ criticalWork: true, flushSucceeded: true })).toMatchObject({
      ok: false,
      reason: 'critical-work',
    });
  });

  it('shares one in-flight gate result', async () => {
    const gate = createUpdateCheckGate();
    let runs = 0;
    const execute = async () => {
      runs += 1;
      await delay(20);
      return 'ok';
    };
    const [first, second] = await Promise.all([gate.run(execute), gate.run(execute)]);
    expect(first).toBe('ok');
    expect(second).toBe('ok');
    expect(runs).toBe(1);
  });
});
