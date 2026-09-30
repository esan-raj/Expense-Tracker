/// <reference types="jest" />

const remote = {
  serverTime: jest.fn(),
  insertGeneratedTransaction: jest.fn(),
  upsertTransaction: jest.fn(async () => undefined),
  pullTransactions: jest.fn(async (..._args: unknown[]) => []),
  pullCategories: jest.fn(async (..._args: unknown[]) => []),
  pullBudgets: jest.fn(async (..._args: unknown[]) => []),
  pullRecurring: jest.fn(async (..._args: unknown[]) => []),
  pullAccounts: jest.fn(async (..._args: unknown[]) => []),
  pullInvestments: jest.fn(async (..._args: unknown[]) => []),
  pullProfile: jest.fn(async () => null),
};
const queue = {
  list: jest.fn(async (): Promise<unknown[]> => []),
  remove: jest.fn(async () => undefined),
  markFailure: jest.fn(async () => undefined),
};
const cursors = {
  get: jest.fn(),
  save: jest.fn(async () => undefined),
};
const txRepo = { delete: jest.fn(async () => undefined), getByIdIncludingDeleted: jest.fn() };
const emptyRepo = { claimUnassigned: jest.fn(async () => undefined), getByIdIncludingDeleted: jest.fn() };

jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { fetch: jest.fn() } }));
jest.mock('@/services/supabase', () => ({ supabase: {}, isSupabaseConfigured: () => true }));
jest.mock('@/services/supabase/remote', () => ({
  get remoteApi() {
    return remote;
  },
}));
jest.mock('@/database/repositories/transactionRepository', () => ({
  get transactionRepository() {
    return { ...txRepo, claimUnassigned: emptyRepo.claimUnassigned };
  },
}));
jest.mock('@/database/repositories/categoryRepository', () => ({
  get categoryRepository() {
    return emptyRepo;
  },
}));
jest.mock('@/database/repositories/budgetRepository', () => ({
  get budgetRepository() {
    return emptyRepo;
  },
}));
jest.mock('@/database/repositories/recurringRepository', () => ({
  get recurringRepository() {
    return emptyRepo;
  },
}));
jest.mock('@/database/repositories/accountRepository', () => ({
  get accountRepository() {
    return emptyRepo;
  },
}));
jest.mock('@/database/repositories/investmentRepository', () => ({
  get investmentRepository() {
    return emptyRepo;
  },
}));
jest.mock('@/database/repositories/settingsRepository', () => ({ settingsRepository: { update: jest.fn() } }));
jest.mock('@/database/repositories/syncQueueRepository', () => ({
  get syncQueueRepository() {
    return queue;
  },
  syncStateRepository: {
    get: jest.fn(async () => ({ userId: 'u1', lastSyncedAt: '2026-09-30T10:00:00.000Z', status: 'synced', lastError: null })),
    save: jest.fn(async () => undefined),
  },
  get syncCursorRepository() {
    return cursors;
  },
}));
jest.mock('@/database/session', () => ({ getCurrentUserId: () => 'u1', setCurrentUserId: jest.fn() }));
jest.mock('@/services/financeRevision', () => ({ bumpFinanceRevision: jest.fn() }));

import { syncService } from '@/services/syncService';
import { syncGate } from '@/services/syncSingleFlight';
import { recurringOccurrenceId } from '@/utils/deterministicId';
import { PULL_CURSOR_OVERLAP_MS } from '@/utils/syncLogic';

describe('server cursor pull', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    syncGate.reset();
  });

  it('pulls by server_updated_at from the stored cursor and advances it to the server time', async () => {
    remote.serverTime.mockResolvedValue('2026-09-30T18:00:00.000Z');
    cursors.get.mockResolvedValue({ cursor: '2026-09-30T17:00:00.000Z', lastFullPullAt: '2026-09-30T12:00:00.000Z' });

    await syncService.pullRemoteChanges();

    const since = new Date(Date.parse('2026-09-30T17:00:00.000Z') - PULL_CURSOR_OVERLAP_MS).toISOString();
    expect(remote.pullTransactions).toHaveBeenCalledWith(since, 'server_updated_at');
    expect(cursors.save).toHaveBeenCalledWith('u1', '2026-09-30T18:00:00.000Z', false);
  });

  it('keeps the legacy updated_at pull until migration 008 is applied', async () => {
    remote.serverTime.mockResolvedValue(null);

    await syncService.pullRemoteChanges();

    expect(remote.pullTransactions).toHaveBeenCalledWith('2026-09-30T10:00:00.000Z', 'updated_at');
    expect(cursors.save).not.toHaveBeenCalled();
  });
});

describe('generated recurring occurrence push', () => {
  const id = recurringOccurrenceId('rule-1', '2026-09-30');
  const item = (payload: object) => ({
    id: 'q1',
    entityType: 'transaction',
    entityId: (payload as { id: string }).id,
    operation: 'create',
    payload: JSON.stringify(payload),
    createdAt: '2026-09-30T18:00:00.000Z',
    retryCount: 0,
    lastError: null,
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uploads insert-only and applies a remote delete locally instead of resurrecting it', async () => {
    queue.list.mockResolvedValue([item({ id, recurringId: 'rule-1', date: '2026-09-30' })]);
    remote.insertGeneratedTransaction.mockResolvedValue('deleted_remotely');

    await syncService.pushLocalChanges();

    expect(remote.insertGeneratedTransaction).toHaveBeenCalled();
    expect(remote.upsertTransaction).not.toHaveBeenCalled();
    expect(txRepo.delete).toHaveBeenCalledWith(id);
    expect(queue.remove).toHaveBeenCalledWith('q1');
  });

  it('uses a normal upsert for transactions without a derived id', async () => {
    queue.list.mockResolvedValue([item({ id: 'random-id', recurringId: 'rule-1', date: '2026-09-30' })]);

    await syncService.pushLocalChanges();

    expect(remote.insertGeneratedTransaction).not.toHaveBeenCalled();
    expect(remote.upsertTransaction).toHaveBeenCalled();
  });
});
