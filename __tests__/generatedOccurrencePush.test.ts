/// <reference types="jest" />

const remote = {
  serverTime: jest.fn(),
  insertGeneratedTransaction: jest.fn(),
  upsertTransaction: jest.fn(async (..._args: unknown[]) => undefined),
};
const queue = {
  list: jest.fn(async (..._args: unknown[]): Promise<unknown[]> => []),
  removeIfUnchanged: jest.fn(async (..._args: unknown[]) => true),
  markFailure: jest.fn(async (..._args: unknown[]) => undefined),
  enqueue: jest.fn(async () => undefined),
  claimUnowned: jest.fn(async () => 0),
};
const txRepo = {
  getByIdIncludingDeleted: jest.fn(async (..._args: unknown[]): Promise<unknown> => null),
  upsertFromRemote: jest.fn(async (..._args: unknown[]) => undefined),
};
const emptyRepo = { getByIdIncludingDeleted: jest.fn(async () => null) };

jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { fetch: jest.fn() } }));
jest.mock('@/services/supabase', () => ({ supabase: {}, isSupabaseConfigured: () => true }));
jest.mock('@/services/supabase/remote', () => ({
  get remoteApi() {
    return remote;
  },
}));
jest.mock('@/database/repositories/transactionRepository', () => ({
  get transactionRepository() {
    return txRepo;
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
jest.mock('@/database/repositories/ownershipRepository', () => ({
  OWNED_ENTITY_TYPES: [],
  ownershipRepository: { listUnassigned: jest.fn(async () => []), claim: jest.fn(), ownerOf: jest.fn() },
}));
jest.mock('@/database/repositories/syncQueueRepository', () => ({
  get syncQueueRepository() {
    return queue;
  },
  syncStateRepository: { get: jest.fn(), save: jest.fn(async () => undefined) },
  syncCursorRepository: { get: jest.fn(), save: jest.fn() },
}));
jest.mock('@/database/session', () => ({ getCurrentUserId: () => 'user-1', setCurrentUserId: jest.fn() }));
jest.mock('@/services/financeRevision', () => ({ bumpFinanceRevision: jest.fn() }));

import { syncService } from '@/services/syncService';
import { recurringOccurrenceId } from '@/utils/deterministicId';

const ID = recurringOccurrenceId('rule-1', '2026-10-01');
const GENERATED_AT = '2026-10-01T06:00:00.000Z';
const local = {
  id: ID,
  recurringId: 'rule-1',
  date: '2026-10-01',
  amount: 1500,
  accountId: 'acc-bank',
  categoryId: 'cat-rent',
  createdAt: GENERATED_AT,
  updatedAt: GENERATED_AT,
};
const serverCopy = {
  ...local,
  amount: 1750,
  notes: 'Edited on the other device',
  createdAt: '2026-10-01T05:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  deletedAt: null,
  userId: 'user-1',
};

function queued(payload: object = local) {
  return {
    id: 'q-1',
    entityType: 'transaction',
    entityId: ID,
    operation: 'create',
    payload: JSON.stringify(payload),
    createdAt: GENERATED_AT,
    retryCount: 0,
    lastError: null,
  };
}

describe('pushing a generated recurring occurrence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queue.list.mockResolvedValue([queued()]);
    txRepo.getByIdIncludingDeleted.mockResolvedValue({ ...local, deletedAt: null });
  });

  it('applies the winning server copy locally, then removes the queue entry', async () => {
    remote.insertGeneratedTransaction.mockResolvedValue({ outcome: 'kept_remote', remote: serverCopy });

    await syncService.pushLocalChanges();

    expect(txRepo.upsertFromRemote).toHaveBeenCalledWith(serverCopy);
    expect(queue.removeIfUnchanged).toHaveBeenCalledWith(expect.objectContaining({ id: 'q-1' }));
    expect(txRepo.upsertFromRemote.mock.invocationCallOrder[0]).toBeLessThan(
      queue.removeIfUnchanged.mock.invocationCallOrder[0]
    );
    expect(remote.upsertTransaction).not.toHaveBeenCalled();
  });

  it('does not touch local data when its own copy was inserted or written', async () => {
    remote.insertGeneratedTransaction.mockResolvedValue({ outcome: 'inserted', remote: { ...local, deletedAt: null } });

    await syncService.pushLocalChanges();

    expect(txRepo.upsertFromRemote).not.toHaveBeenCalled();
    expect(queue.removeIfUnchanged).toHaveBeenCalledTimes(1);
  });

  it('keeps the queue entry for a retry when local convergence fails', async () => {
    remote.insertGeneratedTransaction.mockResolvedValue({ outcome: 'kept_remote', remote: serverCopy });
    txRepo.upsertFromRemote.mockRejectedValueOnce(new Error('disk full'));

    await syncService.pushLocalChanges();

    expect(queue.removeIfUnchanged).not.toHaveBeenCalled();
    expect(queue.markFailure).toHaveBeenCalledWith('q-1', 'disk full', 1);
  });

  it('keeps the queue entry when the upload outcome is unknown', async () => {
    remote.insertGeneratedTransaction.mockRejectedValue(new Error('Network request failed'));

    await syncService.pushLocalChanges();

    expect(queue.removeIfUnchanged).not.toHaveBeenCalled();
    expect(txRepo.upsertFromRemote).not.toHaveBeenCalled();
    expect(queue.markFailure).toHaveBeenCalledWith('q-1', 'Network request failed', 1);
  });

  it('does not overwrite a local edit made while the upload was in flight', async () => {
    remote.insertGeneratedTransaction.mockResolvedValue({ outcome: 'kept_remote', remote: serverCopy });
    txRepo.getByIdIncludingDeleted.mockResolvedValue({ ...local, amount: 1600, updatedAt: '2026-10-01T10:00:00.000Z', deletedAt: null });

    await syncService.pushLocalChanges();

    expect(txRepo.upsertFromRemote).not.toHaveBeenCalled();
    expect(queue.removeIfUnchanged).toHaveBeenCalledWith(expect.objectContaining({ id: 'q-1', payload: JSON.stringify(local) }));
  });

  it('converges a remote tombstone locally without resurrecting it', async () => {
    const tombstone = { ...serverCopy, deletedAt: '2026-10-01T09:00:00.000Z' };
    remote.insertGeneratedTransaction.mockResolvedValue({ outcome: 'deleted_remotely', remote: tombstone });

    await syncService.pushLocalChanges();

    expect(txRepo.upsertFromRemote).toHaveBeenCalledWith(tombstone);
    expect(remote.upsertTransaction).not.toHaveBeenCalled();
  });
});
