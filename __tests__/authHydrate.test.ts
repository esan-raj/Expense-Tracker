/// <reference types="jest" />

const getPersistedSession = jest.fn();
const syncStateGet = jest.fn();

jest.mock('@/services/authService', () => ({
  authService: {
    getPersistedSession: () => getPersistedSession(),
    getSession: jest.fn(async () => null),
    onAuthStateChange: jest.fn(),
  },
}));

jest.mock('@/services/syncService', () => ({
  syncService: {
    claimUnassigned: jest.fn(async () => undefined),
    claimLocalData: jest.fn(async () => undefined),
    stopRealtime: jest.fn(),
  },
}));

jest.mock('@/database/repositories/syncQueueRepository', () => ({
  syncStateRepository: {
    get: () => syncStateGet(),
  },
}));

describe('local auth hydrate', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('keeps the last account scoped but does not mark a signed-in user when logged out', async () => {
    getPersistedSession.mockResolvedValue(null);
    syncStateGet.mockResolvedValue({ userId: 'previous-user', lastSyncedAt: null, status: null, lastError: null });

    const { useAuthStore } = require('@/store/useAuthStore') as typeof import('@/store/useAuthStore');
    const session = require('@/database/session') as typeof import('@/database/session');

    await useAuthStore.getState().hydrate();

    expect(session.getCurrentUserId()).toBeNull();
    expect(session.getScopedUserId()).toBe('previous-user');
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().hydrated).toBe(true);
  });

  it('marks the cached user as current when a persisted session exists', async () => {
    getPersistedSession.mockResolvedValue({ access_token: 'tok', user: { id: 'user-1' } });
    syncStateGet.mockResolvedValue({ userId: 'user-1', lastSyncedAt: null, status: null, lastError: null });

    const { useAuthStore } = require('@/store/useAuthStore') as typeof import('@/store/useAuthStore');
    const session = require('@/database/session') as typeof import('@/database/session');

    await useAuthStore.getState().hydrate();

    expect(session.getCurrentUserId()).toBe('user-1');
    expect(useAuthStore.getState().user?.id).toBe('user-1');
  });
});
