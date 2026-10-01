/// <reference types="jest" />

const netFetch = jest.fn();
const netUnsubscribe = jest.fn();
const netListen = jest.fn((..._args: unknown[]) => netUnsubscribe);

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: () => netFetch(),
    addEventListener: (listener: (state: unknown) => void) => netListen(listener),
  },
}));

jest.mock('@/services/syncService', () => ({
  syncService: {
    performFullSync: jest.fn(async () => undefined),
  },
  subscribeSyncStatus: jest.fn(),
}));

jest.mock('@/database/repositories/syncQueueRepository', () => ({
  syncStateRepository: {
    get: jest.fn(async () => ({
      userId: 'u1',
      lastSyncedAt: null,
      status: 'idle',
      lastError: null,
    })),
  },
  syncQueueRepository: {
    count: jest.fn(async () => 2),
  },
}));

jest.mock('@/database/session', () => ({
  getCurrentUserId: jest.fn(() => 'u1'),
}));

type Modules = {
  useSyncStore: typeof import('@/store/useSyncStore').useSyncStore;
  performFullSync: jest.Mock;
  count: jest.Mock;
  getState: jest.Mock;
  session: { getCurrentUserId: jest.Mock };
  outbox: typeof import('@/services/outbox');
};

function load(): Modules {
  const { useSyncStore } = require('@/store/useSyncStore') as typeof import('@/store/useSyncStore');
  const { syncService } = require('@/services/syncService') as { syncService: { performFullSync: jest.Mock } };
  const repos = require('@/database/repositories/syncQueueRepository') as {
    syncQueueRepository: { count: jest.Mock; enqueue?: jest.Mock };
    syncStateRepository: { get: jest.Mock };
  };
  repos.syncQueueRepository.enqueue = jest.fn(async () => undefined);
  return {
    useSyncStore,
    performFullSync: syncService.performFullSync,
    count: repos.syncQueueRepository.count,
    getState: repos.syncStateRepository.get,
    session: require('@/database/session') as { getCurrentUserId: jest.Mock },
    outbox: require('@/services/outbox') as typeof import('@/services/outbox'),
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

describe('local-first sync hydrate', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    netFetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
    netListen.mockImplementation(() => netUnsubscribe);
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('hydrate loads local queue state without NetInfo or sync', async () => {
    const { useSyncStore, performFullSync } = load();

    await useSyncStore.getState().hydrate();

    expect(useSyncStore.getState().pendingCount).toBe(2);
    expect(netFetch).not.toHaveBeenCalled();
    expect(netListen).not.toHaveBeenCalled();
    expect(performFullSync).not.toHaveBeenCalled();
  });

  it('startNetworkSync enables NetInfo and syncs when online', async () => {
    const { useSyncStore, performFullSync } = load();

    await useSyncStore.getState().hydrate();
    await useSyncStore.getState().startNetworkSync();

    expect(netFetch).toHaveBeenCalled();
    expect(netListen).toHaveBeenCalled();
    expect(performFullSync).toHaveBeenCalled();
  });

  describe('network initialization', () => {
    it('shares one initialization between concurrent calls', async () => {
      const { useSyncStore, session, outbox } = load();
      session.getCurrentUserId.mockReturnValue(null);
      const setHandler = jest.spyOn(outbox, 'setLocalChangeHandler');

      await Promise.all([useSyncStore.getState().startNetworkSync(), useSyncStore.getState().startNetworkSync()]);

      expect(netFetch).toHaveBeenCalledTimes(1);
      expect(netListen).toHaveBeenCalledTimes(1);
      expect(setHandler).toHaveBeenCalledTimes(1);
    });

    it('recovers after NetInfo.fetch rejects and syncs on the retry', async () => {
      const { useSyncStore, performFullSync, outbox } = load();
      const setHandler = jest.spyOn(outbox, 'setLocalChangeHandler');
      netFetch.mockRejectedValueOnce(new Error('netinfo unavailable'));

      await expect(useSyncStore.getState().startNetworkSync()).rejects.toThrow('netinfo unavailable');
      expect(netListen).not.toHaveBeenCalled();
      expect(setHandler).not.toHaveBeenCalled();
      expect(performFullSync).not.toHaveBeenCalled();

      await expect(useSyncStore.getState().startNetworkSync()).resolves.toBeUndefined();
      expect(netFetch).toHaveBeenCalledTimes(2);
      expect(netListen).toHaveBeenCalledTimes(1);
      expect(setHandler).toHaveBeenCalledTimes(1);
      expect(performFullSync).toHaveBeenCalledTimes(1);
    });

    it('does not sync after a successful retry when nobody is signed in', async () => {
      const { useSyncStore, performFullSync, session } = load();
      session.getCurrentUserId.mockReturnValue(null);
      netFetch.mockRejectedValueOnce(new Error('netinfo unavailable'));

      await expect(useSyncStore.getState().startNetworkSync()).rejects.toThrow();
      await useSyncStore.getState().startNetworkSync();

      expect(netListen).toHaveBeenCalledTimes(1);
      expect(performFullSync).not.toHaveBeenCalled();
    });

    it('cleans up a partially installed listener before allowing a retry', async () => {
      const { useSyncStore, outbox } = load();
      const setHandler = jest.spyOn(outbox, 'setLocalChangeHandler');
      setHandler.mockImplementationOnce(() => {
        throw new Error('handler install failed');
      });

      await expect(useSyncStore.getState().startNetworkSync()).rejects.toThrow('handler install failed');
      expect(netListen).toHaveBeenCalledTimes(1);
      expect(netUnsubscribe).toHaveBeenCalledTimes(1);
      expect(setHandler).toHaveBeenLastCalledWith(null);

      await useSyncStore.getState().startNetworkSync();
      expect(netListen).toHaveBeenCalledTimes(2);
      expect(netUnsubscribe).toHaveBeenCalledTimes(1);
      expect(setHandler).toHaveBeenLastCalledWith(expect.any(Function));
    });

    it('clears the local-change handler when the listener itself fails to install', async () => {
      const { useSyncStore, outbox } = load();
      const setHandler = jest.spyOn(outbox, 'setLocalChangeHandler');
      netListen.mockImplementationOnce(() => {
        throw new Error('listener failed');
      });

      await expect(useSyncStore.getState().startNetworkSync()).rejects.toThrow('listener failed');
      expect(setHandler).toHaveBeenCalledWith(null);
      expect(setHandler).not.toHaveBeenCalledWith(expect.any(Function));

      await useSyncStore.getState().startNetworkSync();
      expect(netListen).toHaveBeenCalledTimes(2);
      expect(setHandler.mock.calls.filter(([handler]) => typeof handler === 'function')).toHaveLength(1);
    });
  });

  describe('session restored after force-ready', () => {
    it('syncs when called again after the session is restored late', async () => {
      const { useSyncStore, performFullSync, session } = load();

      session.getCurrentUserId.mockReturnValue(null);
      await Promise.all([useSyncStore.getState().startNetworkSync(), useSyncStore.getState().startNetworkSync()]);
      expect(performFullSync).not.toHaveBeenCalled();
      expect(netListen).toHaveBeenCalledTimes(1);

      session.getCurrentUserId.mockReturnValue('u1');
      await useSyncStore.getState().startNetworkSync();
      expect(performFullSync).toHaveBeenCalledTimes(1);
      expect(netListen).toHaveBeenCalledTimes(1);
    });

    it('reproduces force-ready, late restore and the user effect with one listener and one sync', async () => {
      const { useSyncStore, performFullSync, count, session } = load();
      const sync = deferred();
      performFullSync.mockImplementation(() => sync.promise);

      // afterReady runs before the persisted session is restored.
      session.getCurrentUserId.mockReturnValue(null);
      await useSyncStore.getState().startNetworkSync();
      expect(performFullSync).not.toHaveBeenCalled();

      // Session restores; the user effect and a NetInfo reconnect both ask for sync.
      session.getCurrentUserId.mockReturnValue('u1');
      const fromUserEffect = useSyncStore.getState().startNetworkSync();
      const fromReconnect = useSyncStore.getState().syncNow();
      await flush();
      sync.resolve();
      await Promise.all([fromUserEffect, fromReconnect]);

      expect(netFetch).toHaveBeenCalledTimes(1);
      expect(netListen).toHaveBeenCalledTimes(1);
      expect(performFullSync).toHaveBeenCalledTimes(1);
      expect(count).toHaveBeenCalledTimes(1);
    });
  });

  describe('syncNow single-flight', () => {
    it('runs one full sync and one status refresh for concurrent authenticated starts', async () => {
      const { useSyncStore, performFullSync, count, getState } = load();
      const sync = deferred();
      performFullSync.mockImplementation(() => sync.promise);

      const first = useSyncStore.getState().startNetworkSync();
      const second = useSyncStore.getState().startNetworkSync();
      await flush();
      sync.resolve();
      await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);

      expect(netFetch).toHaveBeenCalledTimes(1);
      expect(performFullSync).toHaveBeenCalledTimes(1);
      expect(count).toHaveBeenCalledTimes(1);
      expect(getState).toHaveBeenCalledTimes(1);
      expect(useSyncStore.getState().pendingCount).toBe(2);
    });

    it('rejects every concurrent caller on failure and lets a later sync run', async () => {
      const { useSyncStore, performFullSync, count } = load();
      performFullSync.mockRejectedValueOnce(new Error('offline'));

      const a = useSyncStore.getState().syncNow();
      const b = useSyncStore.getState().syncNow();
      await expect(a).rejects.toThrow('offline');
      await expect(b).rejects.toThrow('offline');
      expect(performFullSync).toHaveBeenCalledTimes(1);
      expect(count).not.toHaveBeenCalled();

      await expect(useSyncStore.getState().syncNow()).resolves.toBeUndefined();
      expect(performFullSync).toHaveBeenCalledTimes(2);
      expect(count).toHaveBeenCalledTimes(1);
    });
  });

  describe('local outbox changes', () => {
    it('trigger a sync after the push delay', async () => {
      jest.useFakeTimers();
      try {
        const { useSyncStore, performFullSync, outbox } = load();

        await useSyncStore.getState().startNetworkSync();
        performFullSync.mockClear();

        await outbox.queueChange('transaction', 't1', 'delete', { id: 't1' });
        jest.advanceTimersByTime(outbox.LOCAL_CHANGE_PUSH_DELAY_MS);
        await flush();

        expect(performFullSync).toHaveBeenCalledTimes(1);
        outbox.setLocalChangeHandler(null);
      } finally {
        jest.useRealTimers();
      }
    });

    it('runs a follow-up sync when a change lands while syncNow is still finishing', async () => {
      const { useSyncStore, performFullSync, session, outbox } = load();
      let handler: (() => void) | null = null;
      jest.spyOn(outbox, 'setLocalChangeHandler').mockImplementation((next) => {
        handler = next;
      });
      session.getCurrentUserId.mockReturnValue(null);
      await useSyncStore.getState().startNetworkSync();
      session.getCurrentUserId.mockReturnValue('u1');

      const sync = deferred();
      performFullSync.mockImplementationOnce(() => sync.promise);
      const running = useSyncStore.getState().syncNow();
      await flush();
      handler!();
      expect(performFullSync).toHaveBeenCalledTimes(1);

      sync.resolve();
      await running;
      await flush();
      expect(performFullSync).toHaveBeenCalledTimes(2);
    });
  });
});
