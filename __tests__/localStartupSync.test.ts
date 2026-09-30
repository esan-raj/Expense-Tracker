/// <reference types="jest" />

const netFetch = jest.fn();
const netListen = jest.fn((..._args: unknown[]) => jest.fn());

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

describe('local-first sync hydrate', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    netFetch.mockResolvedValue({ isConnected: true, isInternetReachable: true });
  });

  it('hydrate loads local queue state without NetInfo or sync', async () => {
    const { useSyncStore } = require('@/store/useSyncStore') as typeof import('@/store/useSyncStore');
    const { syncService } = require('@/services/syncService') as typeof import('@/services/syncService');

    await useSyncStore.getState().hydrate();

    expect(useSyncStore.getState().pendingCount).toBe(2);
    expect(netFetch).not.toHaveBeenCalled();
    expect(netListen).not.toHaveBeenCalled();
    expect(syncService.performFullSync).not.toHaveBeenCalled();
  });

  it('startNetworkSync enables NetInfo and syncs when online', async () => {
    const { useSyncStore } = require('@/store/useSyncStore') as typeof import('@/store/useSyncStore');
    const { syncService } = require('@/services/syncService') as typeof import('@/services/syncService');

    await useSyncStore.getState().hydrate();
    await useSyncStore.getState().startNetworkSync();

    expect(netFetch).toHaveBeenCalled();
    expect(netListen).toHaveBeenCalled();
    expect(syncService.performFullSync).toHaveBeenCalled();
  });

  it('startNetworkSync makes local writes trigger a sync', async () => {
    jest.useFakeTimers();
    try {
      const { useSyncStore } = require('@/store/useSyncStore') as typeof import('@/store/useSyncStore');
      const { syncService } = require('@/services/syncService') as typeof import('@/services/syncService');
      const outbox = require('@/services/outbox') as typeof import('@/services/outbox');
      const { syncQueueRepository } = require('@/database/repositories/syncQueueRepository') as {
        syncQueueRepository: { enqueue?: jest.Mock };
      };
      syncQueueRepository.enqueue = jest.fn(async () => undefined);

      await useSyncStore.getState().startNetworkSync();
      (syncService.performFullSync as jest.Mock).mockClear();

      await outbox.queueChange('transaction', 't1', 'delete', { id: 't1' });
      jest.advanceTimersByTime(outbox.LOCAL_CHANGE_PUSH_DELAY_MS);

      expect(syncService.performFullSync).toHaveBeenCalledTimes(1);
      outbox.setLocalChangeHandler(null);
    } finally {
      jest.useRealTimers();
    }
  });
});
