/// <reference types="jest" />

let mockUser: string | null = 'user-a';
const performFullSync = jest.fn(async (): Promise<void> => undefined);

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { fetch: jest.fn(), addEventListener: jest.fn(() => jest.fn()) },
}));
jest.mock('@/services/syncService', () => ({
  syncService: { performFullSync: () => performFullSync() },
  subscribeSyncStatus: jest.fn(),
}));
jest.mock('@/database/repositories/syncQueueRepository', () => ({
  syncStateRepository: { get: jest.fn(async () => ({ userId: null, lastSyncedAt: null, status: 'idle', lastError: null })) },
  syncQueueRepository: { count: jest.fn(async () => 0) },
}));
jest.mock('@/database/session', () => ({ getCurrentUserId: () => mockUser }));

import { useSyncStore } from '@/store/useSyncStore';

describe('syncNow across an account change', () => {
  beforeEach(() => {
    performFullSync.mockReset();
    mockUser = 'user-a';
  });

  it('shares the in-flight sync with callers from the same account', async () => {
    let release!: () => void;
    performFullSync.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));

    const first = useSyncStore.getState().syncNow();
    const second = useSyncStore.getState().syncNow();
    await Promise.resolve();
    release();
    await Promise.all([first, second]);

    expect(performFullSync).toHaveBeenCalledTimes(1);
  });

  it('forwards a new account’s request to the gate (which queues one run) instead of only joining the old sync', async () => {
    let release!: () => void;
    performFullSync.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
    performFullSync.mockImplementation(async () => undefined);

    const first = useSyncStore.getState().syncNow();
    await Promise.resolve();
    mockUser = 'user-b';
    const second = useSyncStore.getState().syncNow();
    const third = useSyncStore.getState().syncNow();
    release();
    await Promise.all([first, second, third]);

    expect(performFullSync).toHaveBeenCalledTimes(3);
  });

  it('does not start an extra sync for a signed-out caller', async () => {
    let release!: () => void;
    performFullSync.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));

    const first = useSyncStore.getState().syncNow();
    await Promise.resolve();
    mockUser = null;
    const second = useSyncStore.getState().syncNow();
    release();
    await Promise.all([first, second]);

    expect(performFullSync).toHaveBeenCalledTimes(1);
  });
});
