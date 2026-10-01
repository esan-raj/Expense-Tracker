/// <reference types="jest" />
import { findStaleCategoryIds } from '@/utils/categoryReconciliation';

const remote = {
  serverTime: jest.fn(),
  pullTransactions: jest.fn(async (..._args: unknown[]): Promise<unknown[]> => []),
  pullCategories: jest.fn(async (..._args: unknown[]): Promise<unknown[]> => []),
  pullBudgets: jest.fn(async (..._args: unknown[]): Promise<unknown[]> => []),
  pullRecurring: jest.fn(async (..._args: unknown[]): Promise<unknown[]> => []),
  pullAccounts: jest.fn(async (..._args: unknown[]): Promise<unknown[]> => []),
  pullInvestments: jest.fn(async (..._args: unknown[]): Promise<unknown[]> => []),
  pullProfile: jest.fn(async () => null),
};
const categories = {
  listActiveOwnedBy: jest.fn(async (..._args: unknown[]): Promise<Array<{ id: string; isDefault: boolean }>> => []),
  hide: jest.fn(async (..._args: unknown[]) => undefined),
  getByIdIncludingDeleted: jest.fn(async (..._args: unknown[]): Promise<unknown> => null),
  upsertFromRemote: jest.fn(async (..._args: unknown[]) => undefined),
};
const counts = {
  transactions: jest.fn(async (..._args: unknown[]) => 0),
  recurring: jest.fn(async (..._args: unknown[]) => 0),
  budgets: jest.fn(async (..._args: unknown[]) => 0),
};
const queue = { list: jest.fn(async (): Promise<unknown[]> => []) };
const cursors = { get: jest.fn(), save: jest.fn(async (..._args: unknown[]) => undefined) };
const syncState = { get: jest.fn() };
const dedupe = { apply: jest.fn(async () => undefined) };

jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { fetch: jest.fn() } }));
jest.mock('@/services/supabase', () => ({ supabase: {}, isSupabaseConfigured: () => true }));
jest.mock('@/services/supabase/remote', () => ({
  get remoteApi() {
    return remote;
  },
}));
jest.mock('@/database/repositories/categoryRepository', () => ({
  get categoryRepository() {
    return categories;
  },
}));
jest.mock('@/database/repositories/transactionRepository', () => ({
  get transactionRepository() {
    return { countByCategory: counts.transactions };
  },
}));
jest.mock('@/database/repositories/recurringRepository', () => ({
  get recurringRepository() {
    return { countByCategory: counts.recurring };
  },
}));
jest.mock('@/database/repositories/budgetRepository', () => ({
  get budgetRepository() {
    return { countByCategory: counts.budgets };
  },
}));
jest.mock('@/database/repositories/accountRepository', () => ({ accountRepository: {} }));
jest.mock('@/database/repositories/investmentRepository', () => ({ investmentRepository: {} }));
jest.mock('@/database/repositories/settingsRepository', () => ({ settingsRepository: { update: jest.fn() } }));
jest.mock('@/database/repositories/syncQueueRepository', () => ({
  get syncQueueRepository() {
    return queue;
  },
  get syncStateRepository() {
    return syncState;
  },
  get syncCursorRepository() {
    return cursors;
  },
}));
jest.mock('@/services/categoryDedupeService', () => ({
  get categoryDedupeService() {
    return dedupe;
  },
}));
jest.mock('@/database/session', () => ({ getCurrentUserId: () => 'u1', setCurrentUserId: jest.fn() }));
jest.mock('@/services/financeRevision', () => ({ bumpFinanceRevision: jest.fn() }));

import { syncService, reconcileCategoriesAfterFullPull } from '@/services/syncService';
import { syncGate } from '@/services/syncSingleFlight';

const SERVER_NOW = '2026-10-01T18:00:00.000Z';
const hoursBefore = (h: number) => new Date(Date.parse(SERVER_NOW) - h * 3_600_000).toISOString();

function remoteCategory(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    icon: 'ellipse',
    color: '#000000',
    type: 'expense',
    isDefault: false,
    createdAt: hoursBefore(100),
    updatedAt: hoursBefore(50),
    deletedAt: null,
    userId: 'u1',
    ...extra,
  };
}

function useFullServerPull() {
  remote.serverTime.mockResolvedValue(SERVER_NOW);
  cursors.get.mockResolvedValue({ cursor: hoursBefore(1), lastFullPullAt: hoursBefore(25) });
}

function useIncrementalServerPull() {
  remote.serverTime.mockResolvedValue(SERVER_NOW);
  cursors.get.mockResolvedValue({ cursor: hoursBefore(1), lastFullPullAt: hoursBefore(2) });
}

describe('findStaleCategoryIds', () => {
  const base = {
    remoteIds: new Set<string>(),
    pendingIds: new Set<string>(),
    referencedIds: new Set<string>(),
  };

  it('prunes only non-default, unqueued, unreferenced categories missing from the server', () => {
    const owned = [
      { id: 'default', isDefault: true },
      { id: 'on-server', isDefault: false },
      { id: 'queued', isDefault: false },
      { id: 'referenced', isDefault: false },
      { id: 'stale', isDefault: false },
    ];
    expect(
      findStaleCategoryIds({
        owned,
        remoteIds: new Set(['on-server']),
        pendingIds: new Set(['queued']),
        referencedIds: new Set(['referenced']),
      })
    ).toEqual(['stale']);
  });

  it('keeps built-in defaults even when the server has no categories', () => {
    expect(findStaleCategoryIds({ ...base, owned: [{ id: 'food', isDefault: true }] })).toEqual([]);
  });
});

describe('full-pull category reconciliation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    syncGate.reset();
    syncState.get.mockResolvedValue({ userId: 'u1', lastSyncedAt: hoursBefore(3), status: 'synced', lastError: null });
    categories.listActiveOwnedBy.mockResolvedValue([]);
    categories.getByIdIncludingDeleted.mockResolvedValue(null);
    remote.pullCategories.mockResolvedValue([]);
    queue.list.mockResolvedValue([]);
    counts.transactions.mockResolvedValue(0);
    counts.recurring.mockResolvedValue(0);
    counts.budgets.mockResolvedValue(0);
  });

  it('reconciles on the initial full pull before the server cursor exists', async () => {
    remote.serverTime.mockResolvedValue(null);
    syncState.get.mockResolvedValue({ userId: 'u1', lastSyncedAt: null, status: null, lastError: null });
    categories.listActiveOwnedBy.mockResolvedValue([{ id: 'stale', isDefault: false }]);

    await syncService.pullRemoteChanges();

    expect(remote.pullCategories).toHaveBeenCalledWith(null, 'updated_at');
    expect(categories.hide).toHaveBeenCalledWith('stale');
    expect(dedupe.apply).toHaveBeenCalledTimes(1);
    expect(cursors.save).not.toHaveBeenCalled();
  });

  it('reconciles on a scheduled full pull even though a legacy cursor exists', async () => {
    useFullServerPull();
    remote.pullCategories.mockResolvedValue([remoteCategory('kept')]);
    categories.listActiveOwnedBy.mockResolvedValue([
      { id: 'kept', isDefault: false },
      { id: 'stale', isDefault: false },
    ]);

    await syncService.pullRemoteChanges();

    expect(remote.pullCategories).toHaveBeenCalledWith(null, 'server_updated_at');
    expect(categories.listActiveOwnedBy).toHaveBeenCalledWith('u1');
    expect(categories.hide).toHaveBeenCalledTimes(1);
    expect(categories.hide).toHaveBeenCalledWith('stale');
    expect(cursors.save).toHaveBeenCalledWith('u1', SERVER_NOW, true);
  });

  it('still reconciles when the full pull returns zero categories, keeping defaults', async () => {
    useFullServerPull();
    categories.listActiveOwnedBy.mockResolvedValue([
      { id: 'food', isDefault: true },
      { id: 'stale', isDefault: false },
    ]);

    await syncService.pullRemoteChanges();

    expect(categories.hide).toHaveBeenCalledTimes(1);
    expect(categories.hide).toHaveBeenCalledWith('stale');
    expect(dedupe.apply).toHaveBeenCalledTimes(1);
  });

  it('never prunes on an incremental pull', async () => {
    useIncrementalServerPull();
    categories.listActiveOwnedBy.mockResolvedValue([{ id: 'absent-from-delta', isDefault: false }]);

    await syncService.pullRemoteChanges();

    expect(remote.pullCategories).toHaveBeenCalledWith(expect.any(String), 'server_updated_at');
    expect(categories.listActiveOwnedBy).not.toHaveBeenCalled();
    expect(categories.hide).not.toHaveBeenCalled();
    expect(dedupe.apply).not.toHaveBeenCalled();
    expect(cursors.save).toHaveBeenCalledWith('u1', SERVER_NOW, false);
  });

  it('runs dedupe on an incremental pull that changed categories', async () => {
    useIncrementalServerPull();
    remote.pullCategories.mockResolvedValue([remoteCategory('changed')]);

    await syncService.pullRemoteChanges();

    expect(categories.hide).not.toHaveBeenCalled();
    expect(dedupe.apply).toHaveBeenCalledTimes(1);
  });

  it('keeps categories still waiting in the outbox (created locally, not yet uploaded)', async () => {
    useFullServerPull();
    categories.listActiveOwnedBy.mockResolvedValue([{ id: 'new-local', isDefault: false }]);
    queue.list.mockResolvedValue([{ entityType: 'category', entityId: 'new-local', operation: 'create' }]);

    await syncService.pullRemoteChanges();

    expect(categories.hide).not.toHaveBeenCalled();
  });

  it.each([
    ['a transaction', counts.transactions],
    ['a recurring rule', counts.recurring],
    ['a budget', counts.budgets],
  ])('keeps a missing category that is still used by %s', async (_label, counter) => {
    useFullServerPull();
    categories.listActiveOwnedBy.mockResolvedValue([{ id: 'used', isDefault: false }]);
    counter.mockResolvedValue(1);

    await syncService.pullRemoteChanges();

    expect(categories.hide).not.toHaveBeenCalled();
  });

  it('applies a remote tombstone as a soft delete and does not prune it again', async () => {
    useFullServerPull();
    const tombstone = remoteCategory('gone', { deletedAt: hoursBefore(5), updatedAt: hoursBefore(5) });
    remote.pullCategories.mockResolvedValue([tombstone]);
    categories.getByIdIncludingDeleted.mockResolvedValue({ ...tombstone, deletedAt: null, updatedAt: hoursBefore(40) });
    categories.listActiveOwnedBy.mockResolvedValue([]);

    await syncService.pullRemoteChanges();

    expect(categories.upsertFromRemote).toHaveBeenCalledWith(expect.objectContaining({ id: 'gone', deletedAt: tombstone.deletedAt }));
    expect(categories.hide).not.toHaveBeenCalled();
  });

  it('does not advance the cursor when reconciliation fails', async () => {
    useFullServerPull();
    categories.listActiveOwnedBy.mockResolvedValue([{ id: 'stale', isDefault: false }]);
    categories.hide.mockRejectedValueOnce(new Error('disk full'));

    await expect(syncService.pullRemoteChanges()).rejects.toThrow('disk full');

    expect(cursors.save).not.toHaveBeenCalled();
    expect(dedupe.apply).not.toHaveBeenCalled();
  });

  it('does not advance the cursor when applying a pulled record fails', async () => {
    useIncrementalServerPull();
    remote.pullCategories.mockResolvedValue([remoteCategory('broken')]);
    categories.upsertFromRemote.mockRejectedValueOnce(new Error('write failed'));

    await expect(syncService.pullRemoteChanges()).rejects.toThrow('write failed');

    expect(cursors.save).not.toHaveBeenCalled();
  });

  it('does not advance the cursor when dedupe fails after reconciliation', async () => {
    useFullServerPull();
    dedupe.apply.mockRejectedValueOnce(new Error('dedupe failed'));

    await expect(syncService.pullRemoteChanges()).rejects.toThrow('dedupe failed');

    expect(cursors.save).not.toHaveBeenCalled();
  });

  it('returns the ids it hid', async () => {
    categories.listActiveOwnedBy.mockResolvedValue([
      { id: 'a', isDefault: false },
      { id: 'b', isDefault: false },
    ]);
    await expect(reconcileCategoriesAfterFullPull('u1', [{ id: 'a' }])).resolves.toEqual(['b']);
  });
});
