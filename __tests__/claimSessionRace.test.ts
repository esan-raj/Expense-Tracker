/// <reference types="jest" />
let mockIdCounter = 0;
jest.mock('@/utils/id', () => ({ createId: () => `id-${(mockIdCounter += 1)}` }));

const SERVER_NOW = '2026-10-02T09:00:00.000Z';
const mockUploads: Array<{ id: string; as: string | null }> = [];

function mockUpsert() {
  return jest.fn(async (item: { id: string }) => {
    const { getCurrentUserId } = jest.requireActual('@/database/session') as typeof import('@/database/session');
    mockUploads.push({ id: item.id, as: getCurrentUserId() });
  });
}
const mockNothing = jest.fn(async (..._args: unknown[]) => []);
const remote = {
  serverTime: jest.fn(async () => SERVER_NOW),
  upsertCategory: mockUpsert(),
  upsertAccount: mockUpsert(),
  upsertTransaction: mockUpsert(),
  upsertBudget: mockUpsert(),
  upsertRecurring: mockUpsert(),
  upsertInvestment: mockUpsert(),
  upsertProfile: jest.fn(async (..._args: unknown[]) => undefined),
  insertGeneratedTransaction: jest.fn(),
  pullTransactions: mockNothing,
  pullCategories: mockNothing,
  pullBudgets: mockNothing,
  pullRecurring: mockNothing,
  pullAccounts: mockNothing,
  pullInvestments: mockNothing,
  pullProfile: jest.fn(async () => null),
};

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })) },
}));
jest.mock('@/services/supabase', () => ({ supabase: {}, isSupabaseConfigured: () => true }));
jest.mock('@/services/supabase/remote', () => ({
  get remoteApi() {
    return remote;
  },
}));
jest.mock('@/services/financeRevision', () => ({ bumpFinanceRevision: jest.fn() }));

import { getRxDatabase } from '@/database';
import { resetDatabaseConnection } from '@/database/database';
import { getCurrentUserId, isInScope, resetSessionForTests, setCurrentUserId } from '@/database/session';
import { ownershipRepository } from '@/database/repositories/ownershipRepository';
import { syncQueueRepository, syncStateRepository } from '@/database/repositories/syncQueueRepository';
import { syncService } from '@/services/syncService';
import { syncGate } from '@/services/syncSingleFlight';
import { captureSyncContext, SyncSessionChangedError } from '@/services/syncSession';

const T0 = '2026-10-01T08:00:00.000Z';

function category(id: string, userId: string, extra: Record<string, unknown> = {}) {
  return {
    id, userId, name: `Category ${id}`, icon: 'cart', color: '#123456', type: 'expense', isDefault: false,
    createdAt: T0, updatedAt: T0, deletedAt: '', ...extra,
  };
}

function queueRow(id: string, userId: string, entityId: string, payload: object) {
  return {
    id, userId, entityType: 'category', entityId, operation: 'update', payload: JSON.stringify(payload),
    createdAt: T0, retryCount: 0, lastError: '',
  };
}

async function row(id: string) {
  const db = await getRxDatabase();
  const doc = await db.categories.findOne(id).exec();
  return doc ? doc.toMutableJSON() : null;
}

async function queued() {
  const db = await getRxDatabase();
  return (await db.syncQueue.find().exec())
    .map((doc) => doc.toMutableJSON())
    .filter((entry) => entry.entityId.startsWith('c-'))
    .map((entry) => ({ id: entry.id, userId: entry.userId, entityId: entry.entityId, retryCount: entry.retryCount }));
}

let info: jest.SpyInstance;
const syncRuns = () => info.mock.calls.filter(([message]) => message === '[sync] initializing').length;
const staleStops = () =>
  info.mock.calls.filter(([message]) => message === '[sync] account changed during sync; stale run stopped').length;

/** Run `effect` inside the first call of `method` that touches `entityId`, before or after the real work. */
function interrupt<K extends 'enqueue' | 'claim'>(
  method: K,
  when: 'before' | 'after',
  effect: () => void,
  entityId = 'c-1'
) {
  let fired = false;
  if (method === 'enqueue') {
    const real = syncQueueRepository.enqueue.bind(syncQueueRepository);
    jest.spyOn(syncQueueRepository, 'enqueue').mockImplementation(async (...args) => {
      const hit = !fired && args[1] === entityId;
      if (hit) fired = true;
      if (hit && when === 'before') effect();
      await real(...args);
      if (hit && when === 'after') effect();
    });
  } else {
    const real = ownershipRepository.claim.bind(ownershipRepository);
    jest.spyOn(ownershipRepository, 'claim').mockImplementation(async (...args) => {
      const hit = !fired && args[1].includes(entityId);
      if (hit) fired = true;
      if (hit && when === 'before') effect();
      const result = await real(...args);
      if (hit && when === 'after') effect();
      return result;
    });
  }
}

/** Leave c-1 half claimed by user-a: its upload entry exists for user-a, the row is still unassigned. */
async function halfClaimedByA() {
  interrupt('enqueue', 'after', () => setCurrentUserId(null));
  setCurrentUserId('user-a');
  await syncService.performFullSync();
  jest.restoreAllMocks();
  info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  expect(await row('c-1')).toEqual(expect.objectContaining({ userId: '' }));
  expect(await queued()).toEqual([expect.objectContaining({ userId: 'user-a', entityId: 'c-1' })]);
}

describe('claiming signed-out data while the session changes', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    mockUploads.length = 0;
    resetSessionForTests();
    syncGate.reset();
    await resetDatabaseConnection();
    info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const db = await getRxDatabase();
    await db.categories.insert(category('c-1', ''));
  });

  afterAll(async () => {
    resetSessionForTests();
    await resetDatabaseConnection();
  });

  it('claims, queues and uploads signed-out work for the signed-in account', async () => {
    setCurrentUserId('user-a');
    await syncService.performFullSync();

    expect((await row('c-1'))?.userId).toBe('user-a');
    expect(mockUploads).toEqual([{ id: 'c-1', as: 'user-a' }]);
    expect(await queued()).toEqual([]);
    expect(syncRuns()).toBe(1);
  });

  it('is not interrupted by a repeated auth notification for the same account', async () => {
    interrupt('enqueue', 'after', () => setCurrentUserId('user-a'));
    setCurrentUserId('user-a');
    await syncService.performFullSync();

    expect((await row('c-1'))?.userId).toBe('user-a');
    expect(mockUploads).toEqual([{ id: 'c-1', as: 'user-a' }]);
    expect(staleStops()).toBe(0);
    expect(syncRuns()).toBe(1);
  });

  it('never changes who is signed in, and refuses a stale context', async () => {
    setCurrentUserId('user-a');
    const stale = captureSyncContext()!;
    setCurrentUserId('user-b');

    await expect(syncService.claimUnassigned(stale)).rejects.toBeInstanceOf(SyncSessionChangedError);

    expect(getCurrentUserId()).toBe('user-b');
    expect((await row('c-1'))?.userId).toBe('');
    expect(await queued()).toEqual([]);
  });

  it('A → B before anything is queued: B gets the row in one follow-up sync', async () => {
    const real = ownershipRepository.listUnassigned.bind(ownershipRepository);
    let fired = false;
    jest.spyOn(ownershipRepository, 'listUnassigned').mockImplementation(async (type) => {
      if (!fired) {
        fired = true;
        setCurrentUserId('user-b');
      }
      return real(type);
    });
    setCurrentUserId('user-a');
    await syncService.performFullSync();

    expect((await row('c-1'))?.userId).toBe('user-b');
    expect(mockUploads).toEqual([{ id: 'c-1', as: 'user-b' }]);
    expect(await syncQueueRepository.list('user-a')).toEqual([]);
    expect(syncRuns()).toBe(2);
  });

  it('A → B after queuing, before claiming: the row follows its queued upload to A and B never uploads it', async () => {
    interrupt('enqueue', 'after', () => setCurrentUserId('user-b'));
    setCurrentUserId('user-a');
    await syncService.performFullSync();

    expect((await row('c-1'))?.userId).toBe('user-a');
    expect(await queued()).toEqual([expect.objectContaining({ userId: 'user-a', entityId: 'c-1' })]);
    expect(mockUploads).toEqual([]);
    expect(isInScope((await row('c-1'))!)).toBe(false);
    expect(syncRuns()).toBe(2);
  });

  it('A → B while the claim is starting: the stale pipeline does not patch the row', async () => {
    const owners: Array<string | null> = [];
    const real = ownershipRepository.claim.bind(ownershipRepository);
    let fired = false;
    jest.spyOn(ownershipRepository, 'claim').mockImplementation(async (type, ids, userId, ...rest) => {
      if (!fired && ids.includes('c-1')) {
        fired = true;
        setCurrentUserId('user-b');
        const claimed = await real(type, ids, userId, ...rest).catch((error: unknown) => {
          owners.push((error as Error).name);
          throw error;
        });
        owners.push(claimed.length ? 'patched' : 'skipped');
        return claimed;
      }
      return real(type, ids, userId, ...rest);
    });
    setCurrentUserId('user-a');
    await syncService.performFullSync();

    expect(owners).toEqual(['SyncSessionChangedError']);
    expect((await row('c-1'))?.userId).toBe('user-a');
    expect(mockUploads).toEqual([]);
  });

  it('A → B after the row was claimed: A keeps it, and ownerless entries are not handed over by the stale run', async () => {
    const db = await getRxDatabase();
    await db.syncQueue.insert(queueRow('q-orphan', '', 'c-1', { id: 'c-1' }));
    interrupt('claim', 'after', () => setCurrentUserId('user-b'));
    setCurrentUserId('user-a');
    await syncService.performFullSync();

    expect((await row('c-1'))?.userId).toBe('user-a');
    expect((await queued()).map((entry) => [entry.id === 'q-orphan' ? 'ownerless' : 'claim', entry.userId]).sort()).toEqual([
      ['claim', 'user-a'],
      ['ownerless', ''],
    ]);
    expect(mockUploads).toEqual([]);
  });

  it('A → B → A: the old pipeline stops and exactly one fresh sync finishes the work for A', async () => {
    interrupt('enqueue', 'after', () => {
      setCurrentUserId('user-b');
      setCurrentUserId('user-a');
    });
    setCurrentUserId('user-a');
    await syncService.performFullSync();

    expect(staleStops()).toBe(1);
    expect(syncRuns()).toBe(2);
    expect((await row('c-1'))?.userId).toBe('user-a');
    expect(mockUploads).toEqual([{ id: 'c-1', as: 'user-a' }]);
    expect(await queued()).toEqual([]);
  });

  it('sign-out while queuing: nothing is claimed, the queued upload is kept, and no sync is scheduled', async () => {
    interrupt('enqueue', 'after', () => setCurrentUserId(null));
    setCurrentUserId('user-a');
    await syncService.performFullSync();

    expect((await row('c-1'))?.userId).toBe('');
    expect(await queued()).toEqual([expect.objectContaining({ userId: 'user-a', retryCount: 0 })]);
    expect(syncRuns()).toBe(1);
    expect((await syncStateRepository.get()).status).toBe('offline');
    expect(mockUploads).toEqual([]);
  });

  it('sign-out while the ownership patch starts: the row stays unassigned', async () => {
    interrupt('claim', 'before', () => setCurrentUserId(null));
    setCurrentUserId('user-a');
    await syncService.performFullSync();

    expect((await row('c-1'))?.userId).toBe('');
    expect(await queued()).toEqual([expect.objectContaining({ userId: 'user-a', entityId: 'c-1' })]);
    expect(mockUploads).toEqual([]);
  });

  it('a half-finished claim completes for A after an app restart, without a duplicate entry', async () => {
    await halfClaimedByA();
    syncGate.reset();
    resetSessionForTests();

    setCurrentUserId('user-a');
    await syncService.claimUnassigned(captureSyncContext()!);
    expect(await queued()).toEqual([expect.objectContaining({ userId: 'user-a', entityId: 'c-1' })]);
    await syncService.performFullSync();

    expect((await row('c-1'))?.userId).toBe('user-a');
    expect(mockUploads).toEqual([{ id: 'c-1', as: 'user-a' }]);
    expect(await queued()).toEqual([]);
  });

  it('a half-finished claim completes when A signs in again, uploading once', async () => {
    await halfClaimedByA();
    setCurrentUserId('user-a');
    await syncService.performFullSync();
    await syncService.performFullSync();

    expect((await row('c-1'))?.userId).toBe('user-a');
    expect(mockUploads).toEqual([{ id: 'c-1', as: 'user-a' }]);
    expect(await queued()).toEqual([]);
  });

  it('a half-finished claim for A is never taken or uploaded by B', async () => {
    await halfClaimedByA();
    setCurrentUserId('user-b');
    await syncService.claimLocalData(captureSyncContext()!);
    await syncService.performFullSync();

    expect((await row('c-1'))?.userId).toBe('user-a');
    expect(await syncQueueRepository.list('user-b')).toEqual([]);
    expect(mockUploads.filter((upload) => upload.id === 'c-1')).toEqual([]);
    expect(await queued()).toEqual([expect.objectContaining({ userId: 'user-a', entityId: 'c-1' })]);
  });

  it("keeps A's claimed rows out of B's view and B's uploads", async () => {
    setCurrentUserId('user-a');
    await syncService.claimUnassigned(captureSyncContext()!);
    setCurrentUserId('user-b');
    await syncService.performFullSync();

    expect(isInScope((await row('c-1'))!)).toBe(false);
    expect(await syncQueueRepository.list('user-b')).toEqual([]);
    expect(mockUploads).toEqual([]);
    expect(await queued()).toEqual([expect.objectContaining({ userId: 'user-a', entityId: 'c-1' })]);
  });

  it("never uploads A's entry for a row that now belongs to B, and keeps the entry untouched", async () => {
    const db = await getRxDatabase();
    await db.categories.insert(category('c-2', 'user-b'));
    await db.syncQueue.insert(queueRow('q-leftover', 'user-a', 'c-2', category('c-2', '')));
    setCurrentUserId('user-a');
    await syncService.performFullSync();

    expect(mockUploads.filter((upload) => upload.id === 'c-2')).toEqual([]);
    expect((await queued()).find((entry) => entry.id === 'q-leftover')).toEqual(
      expect.objectContaining({ userId: 'user-a', retryCount: 0 })
    );
    expect((await row('c-2'))?.userId).toBe('user-b');
  });

  it('leaves a row unassigned when two other accounts have uploads queued for it', async () => {
    const db = await getRxDatabase();
    await db.syncQueue.bulkInsert([
      queueRow('q-a', 'user-a', 'c-1', category('c-1', '')),
      queueRow('q-c', 'user-c', 'c-1', category('c-1', '')),
    ]);
    setCurrentUserId('user-b');
    await syncService.performFullSync();

    expect((await row('c-1'))?.userId).toBe('');
    expect(await syncQueueRepository.list('user-b')).toEqual([]);
    expect(mockUploads).toEqual([]);
  });

  it('never hard-deletes a financial row across interrupted claims', async () => {
    const db = await getRxDatabase();
    await db.categories.insert(category('c-2', '', { deletedAt: T0 }));
    const before = await db.categories.count().exec();
    interrupt('enqueue', 'after', () => setCurrentUserId('user-b'));
    setCurrentUserId('user-a');
    await syncService.performFullSync();
    setCurrentUserId(null);
    setCurrentUserId('user-a');
    await syncService.performFullSync();

    expect(await db.categories.count().exec()).toBe(before);
    expect((await row('c-2'))?.deletedAt).toBe(T0);
  });
});
