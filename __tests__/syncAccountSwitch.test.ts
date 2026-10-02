/// <reference types="jest" />

let mockUser: string | null = 'user-a';
const setUser = (userId: string | null) => {
  mockUser = userId;
};

type Handler = () => void;
interface ChannelChain {
  on: (event: string, filter: unknown, handler: Handler) => ChannelChain;
  subscribe: () => ChannelChain;
}
const channelHandlers: Handler[] = [];
const mockSupabase = {
  channel: jest.fn(() => {
    const chain: ChannelChain = {
      on: jest.fn((_event: string, _filter: unknown, handler: Handler) => {
        channelHandlers.push(handler);
        return chain;
      }),
      subscribe: jest.fn(() => chain),
    };
    return chain;
  }),
  removeChannel: jest.fn(async () => undefined),
};

const pulled = (items: unknown[]) => jest.fn(async (..._args: unknown[]): Promise<unknown[]> => items);
const remote = {
  serverTime: jest.fn(async (): Promise<string | null> => '2026-10-01T12:00:00.000Z'),
  upsertCategory: jest.fn(async (..._args: unknown[]): Promise<void> => undefined),
  upsertTransaction: jest.fn(async (..._args: unknown[]) => undefined),
  insertGeneratedTransaction: jest.fn(),
  pullTransactions: pulled([]),
  pullCategories: pulled([]),
  pullBudgets: pulled([]),
  pullRecurring: pulled([]),
  pullAccounts: pulled([]),
  pullInvestments: pulled([]),
  pullProfile: jest.fn(async () => null),
};
const queue = {
  list: jest.fn(async (..._args: unknown[]): Promise<unknown[]> => []),
  removeIfUnchanged: jest.fn(async (..._args: unknown[]) => true),
  markFailure: jest.fn(async (..._args: unknown[]) => undefined),
  enqueue: jest.fn(async (..._args: unknown[]) => undefined),
  claimUnowned: jest.fn(async (..._args: unknown[]) => 0),
  clearForUser: jest.fn(async (..._args: unknown[]) => undefined),
  pendingEntityIds: jest.fn(async () => new Set<string>()),
  count: jest.fn(async () => 0),
};
const state = {
  get: jest.fn(async () => ({ userId: null, lastSyncedAt: null, status: null, lastError: null })),
  save: jest.fn(async (..._args: unknown[]) => undefined),
};
const cursors = {
  get: jest.fn(async (..._args: unknown[]) => ({ cursor: null, lastFullPullAt: null })),
  save: jest.fn(async (..._args: unknown[]) => undefined),
};
function repo() {
  return {
    getByIdIncludingDeleted: jest.fn(async (..._args: unknown[]): Promise<unknown> => null),
    upsertFromRemote: jest.fn(async (..._args: unknown[]): Promise<void> => undefined),
    replaceAll: jest.fn(async (..._args: unknown[]) => undefined),
    list: jest.fn(async (..._args: unknown[]): Promise<unknown[]> => []),
    listActiveOwnedBy: jest.fn(async (..._args: unknown[]): Promise<unknown[]> => []),
    hide: jest.fn(async (..._args: unknown[]) => undefined),
    countByCategory: jest.fn(async (..._args: unknown[]) => 0),
  };
}
const repos = {
  transaction: repo(),
  category: repo(),
  budget: repo(),
  recurring: repo(),
  account: repo(),
  investment: repo(),
};

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })) },
}));
jest.mock('@/services/supabase', () => ({
  get supabase() {
    return mockSupabase;
  },
  isSupabaseConfigured: () => true,
}));
jest.mock('@/services/supabase/remote', () => ({
  get remoteApi() {
    return remote;
  },
}));
jest.mock('@/database/repositories/transactionRepository', () => ({
  get transactionRepository() {
    return repos.transaction;
  },
}));
jest.mock('@/database/repositories/categoryRepository', () => ({
  get categoryRepository() {
    return repos.category;
  },
}));
jest.mock('@/database/repositories/budgetRepository', () => ({
  get budgetRepository() {
    return repos.budget;
  },
}));
jest.mock('@/database/repositories/recurringRepository', () => ({
  get recurringRepository() {
    return repos.recurring;
  },
}));
jest.mock('@/database/repositories/accountRepository', () => ({
  get accountRepository() {
    return repos.account;
  },
}));
jest.mock('@/database/repositories/investmentRepository', () => ({
  get investmentRepository() {
    return repos.investment;
  },
}));
jest.mock('@/database/repositories/settingsRepository', () => ({ settingsRepository: { update: jest.fn() } }));
jest.mock('@/database/repositories/ownershipRepository', () => ({
  OWNED_ENTITY_TYPES: [],
  ownershipRepository: { listUnassigned: jest.fn(async () => []), claim: jest.fn(), ownerOf: jest.fn() },
}));
jest.mock('@/database/repositories/syncQueueRepository', () => ({
  get syncQueueRepository() {
    return queue;
  },
  get syncStateRepository() {
    return state;
  },
  get syncCursorRepository() {
    return cursors;
  },
}));
jest.mock('@/database/session', () => ({
  getCurrentUserId: () => mockUser,
  setCurrentUserId: (userId: string | null) => setUser(userId),
}));
jest.mock('@/services/categoryDedupeService', () => ({ categoryDedupeService: { apply: jest.fn(async () => undefined) } }));
jest.mock('@/services/financeRevision', () => ({ bumpFinanceRevision: jest.fn() }));

import { subscribeSyncStatus, syncService } from '@/services/syncService';
import { createSyncGate, syncGate } from '@/services/syncSingleFlight';
import type { SyncStatus } from '@/types/sync';

function entry(id: string, entityId: string) {
  return {
    id,
    entityType: 'category',
    entityId,
    operation: 'update',
    payload: JSON.stringify({ id: entityId, name: entityId }),
    createdAt: '2026-10-01T08:00:00.000Z',
    retryCount: 0,
    lastError: null,
  };
}

async function flushRealtime() {
  for (let i = 0; i < 50 && syncGate.isRunning(); i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('sync gate with account changes', () => {
  function deferred() {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  }

  it('joins a request from the account already syncing without another run', async () => {
    const gate = createSyncGate(() => 'user-a');
    const hold = deferred();
    const execute = jest.fn(async () => hold.promise);

    const first = gate.run('full', execute);
    const second = gate.run('full', execute);
    hold.release();
    await Promise.all([first, second]);

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('queues exactly one full run for a different account, however many times it asks', async () => {
    let owner = 'user-a';
    const gate = createSyncGate(() => owner);
    const hold = deferred();
    const owners: string[] = [];
    const execute = jest.fn(async (kind: 'pull' | 'full') => {
      owners.push(`${owner}:${kind}`);
      if (owners.length === 1) await hold.promise;
    });

    const first = gate.run('full', execute);
    owner = 'user-b';
    const requests = [gate.run('pull', execute), gate.run('full', execute), gate.run('pull', execute)];
    hold.release();
    await Promise.all([first, ...requests]);

    expect(owners).toEqual(['user-a:full', 'user-b:full']);
    expect(gate.isRunning()).toBe(false);
  });

  it('does not queue a run for a request made while signed out', async () => {
    let owner: string | null = 'user-a';
    const gate = createSyncGate(() => owner);
    const hold = deferred();
    const execute = jest.fn(async () => hold.promise);

    const first = gate.run('full', execute);
    owner = null;
    const second = gate.run('full', execute);
    hold.release();
    await Promise.all([first, second]);

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('forgets the previous owner after a failed run', async () => {
    let owner = 'user-a';
    const gate = createSyncGate(() => owner);
    const execute = jest.fn(async () => {
      if (execute.mock.calls.length === 1) throw new Error('network down');
    });

    await expect(gate.run('full', execute)).rejects.toThrow('network down');
    owner = 'user-b';
    await gate.run('full', execute);

    expect(execute).toHaveBeenCalledTimes(2);
    expect(gate.isRunning()).toBe(false);
  });
});

describe('sync pipeline when the account changes mid-run', () => {
  let statuses: SyncStatus[] = [];
  /** Account signed in whenever a full sync started (status 'syncing'), in order. */
  let fullRuns: Array<string | null> = [];
  let unsubscribe: () => void = () => undefined;
  const runsStarted = () => fullRuns;

  beforeEach(() => {
    jest.clearAllMocks();
    syncGate.reset();
    syncService.stopRealtime();
    channelHandlers.length = 0;
    setUser('user-a');
    statuses = [];
    fullRuns = [];
    unsubscribe = subscribeSyncStatus((status) => {
      statuses.push(status);
      if (status === 'syncing') fullRuns.push(mockUser);
    });
    queue.list.mockImplementation(async () => []);
    remote.upsertCategory.mockImplementation(async () => undefined);
    for (const pull of [remote.pullTransactions, remote.pullCategories, remote.pullBudgets, remote.pullRecurring, remote.pullAccounts, remote.pullInvestments]) {
      pull.mockImplementation(async () => []);
    }
    repos.account.upsertFromRemote.mockImplementation(async () => undefined);
  });

  afterEach(() => {
    unsubscribe();
  });

  it('stops pushing the old account’s outbox and runs one full sync for the new account', async () => {
    queue.list.mockImplementation(async (userId) => (userId === 'user-a' ? [entry('q1', 'c1'), entry('q2', 'c2')] : []));
    remote.upsertCategory.mockImplementationOnce(async () => setUser('user-b'));

    await syncService.performFullSync();

    expect(remote.upsertCategory).toHaveBeenCalledTimes(1);
    expect(queue.removeIfUnchanged).toHaveBeenCalledTimes(1);
    expect(queue.markFailure).not.toHaveBeenCalled();
    expect(runsStarted()).toEqual(['user-a', 'user-b']);
    expect(cursors.save.mock.calls.map((call) => call[0])).toEqual(['user-b']);
    expect(statuses).toEqual(['syncing', 'syncing', 'synced']);
    expect(state.save).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
  });

  it('stops applying the old account’s pull and never stores its cursor after the switch', async () => {
    const accounts = [
      { id: 'acc-1', updatedAt: '2026-10-01T10:00:00.000Z' },
      { id: 'acc-2', updatedAt: '2026-10-01T10:00:00.000Z' },
    ];
    remote.pullAccounts.mockImplementation(async () => (mockUser === 'user-a' ? accounts : []));
    repos.account.upsertFromRemote.mockImplementationOnce(async () => setUser('user-b'));

    await syncService.pullRemoteChanges();

    expect(repos.account.upsertFromRemote).toHaveBeenCalledTimes(1);
    expect(repos.account.upsertFromRemote).toHaveBeenCalledWith(expect.objectContaining({ id: 'acc-1' }));
    expect(cursors.save.mock.calls.map((call) => call[0])).toEqual(['user-b']);
    expect(runsStarted()).toEqual(['user-b']);
  });

  it('abandons a first-sync replacement when the account changes while downloading', async () => {
    remote.pullAccounts.mockImplementation(async () =>
      mockUser === 'user-a' ? [{ id: 'acc-1', updatedAt: '2026-10-01T10:00:00.000Z', deletedAt: null }] : []
    );
    remote.pullTransactions.mockImplementationOnce(async () => {
      setUser('user-b');
      return [];
    });

    await syncService.performFullSync();

    for (const repository of Object.values(repos)) expect(repository.replaceAll).not.toHaveBeenCalled();
    expect(queue.clearForUser).not.toHaveBeenCalled();
    expect(cursors.save).not.toHaveBeenCalledWith('user-a', expect.anything(), expect.anything());
    expect(runsStarted()).toEqual(['user-a', 'user-b']);
  });

  it('replaces only the signed-in account’s rows and outbox', async () => {
    remote.pullAccounts.mockImplementation(async () => [{ id: 'acc-1', updatedAt: '2026-10-01T10:00:00.000Z', deletedAt: null }]);

    await syncService.performFullSync();

    for (const repository of Object.values(repos)) {
      expect(repository.replaceAll).toHaveBeenCalledWith(expect.any(Array), { ownerId: 'user-a' });
    }
    expect(queue.clearForUser).toHaveBeenCalledWith('user-a');
    expect(cursors.save).toHaveBeenCalledWith('user-a', '2026-10-01T12:00:00.000Z', true);
  });

  it('goes offline without another run when the account signs out mid-sync', async () => {
    queue.list.mockImplementation(async () => [entry('q1', 'c1'), entry('q2', 'c2')]);
    remote.upsertCategory.mockImplementationOnce(async () => setUser(null));

    await syncService.performFullSync();

    expect(remote.upsertCategory).toHaveBeenCalledTimes(1);
    expect(runsStarted()).toEqual(['user-a']);
    expect(statuses).toEqual(['syncing', 'offline']);
    expect(state.save).toHaveBeenCalledWith({ status: 'offline' });
    expect(cursors.save).not.toHaveBeenCalled();
    expect(syncGate.isRunning()).toBe(false);
  });

  it('does not loop: a single switch produces exactly one extra run', async () => {
    remote.serverTime.mockImplementationOnce(async () => {
      setUser('user-b');
      return '2026-10-01T12:00:00.000Z';
    });

    await syncService.pullRemoteChanges();

    expect(remote.serverTime).toHaveBeenCalledTimes(2);
    expect(statuses).toEqual(['syncing', 'synced']);
    expect(syncGate.isRunning()).toBe(false);
  });

  it('reports a genuine failure as an error without retrying for another account', async () => {
    remote.serverTime.mockRejectedValueOnce(new Error('network down'));

    await syncService.performFullSync();

    expect(statuses).toEqual(['syncing', 'error']);
    expect(runsStarted()).toEqual(['user-a']);
  });

  it('ignores realtime events from the previous account’s channel', async () => {
    const onChange = jest.fn();
    await syncService.startRealtime('user-a', onChange);
    expect(channelHandlers.length).toBeGreaterThan(0);

    channelHandlers[0]();
    await flushRealtime();
    expect(remote.serverTime).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);

    setUser('user-b');
    channelHandlers[1]();
    await flushRealtime();
    expect(remote.serverTime).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('logs a failed realtime pull instead of leaving an unhandled rejection', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const onChange = jest.fn(() => {
      throw new Error('render failed');
    });
    await syncService.startRealtime('user-a', onChange);

    channelHandlers[0]();
    await flushRealtime();

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
