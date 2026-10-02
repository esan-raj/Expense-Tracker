/// <reference types="jest" />
let mockIdCounter = 0;
jest.mock('@/utils/id', () => ({ createId: () => `id-${(mockIdCounter += 1)}` }));

const remote = {
  upsertCategory: jest.fn(async (..._args: unknown[]) => undefined),
  upsertAccount: jest.fn(async (..._args: unknown[]) => undefined),
  upsertTransaction: jest.fn(async (..._args: unknown[]) => undefined),
  upsertBudget: jest.fn(async (..._args: unknown[]) => undefined),
  upsertRecurring: jest.fn(async (..._args: unknown[]) => undefined),
  upsertInvestment: jest.fn(async (..._args: unknown[]) => undefined),
  upsertProfile: jest.fn(async (..._args: unknown[]) => undefined),
  insertGeneratedTransaction: jest.fn(),
};

jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { fetch: jest.fn() } }));
jest.mock('@/services/supabase', () => ({ supabase: {}, isSupabaseConfigured: () => true }));
jest.mock('@/services/supabase/remote', () => ({
  get remoteApi() {
    return remote;
  },
}));
jest.mock('@/services/financeRevision', () => ({ bumpFinanceRevision: jest.fn() }));

import { getRxDatabase } from '@/database';
import { resetDatabaseConnection } from '@/database/database';
import { resetSessionForTests, setCurrentUserId } from '@/database/session';
import { ownershipRepository } from '@/database/repositories/ownershipRepository';
import { syncQueueRepository } from '@/database/repositories/syncQueueRepository';
import { syncService } from '@/services/syncService';
import { syncGate } from '@/services/syncSingleFlight';
import { captureSyncContext } from '@/services/syncSession';

const T0 = '2026-10-01T08:00:00.000Z';

function category(id: string, userId: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    userId,
    name: `Category ${id}`,
    icon: 'ellipse',
    color: '#000000',
    type: 'expense',
    isDefault: false,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: '',
    ...extra,
  };
}

function account(id: string, userId: string) {
  return {
    id,
    userId,
    name: `Account ${id}`,
    type: 'bank',
    institutionName: '',
    currency: 'INR',
    openingBalance: 0,
    creditLimit: 0,
    isActive: true,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: '',
  };
}

function transaction(id: string, userId: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    userId,
    type: 'expense',
    amount: 250,
    categoryId: 'c-local',
    title: 'Lunch',
    description: '',
    date: '2026-10-01',
    paymentMethod: 'upi',
    notes: '',
    isRecurring: false,
    recurringId: '',
    createdAt: T0,
    updatedAt: T0,
    deletedAt: '',
    accountId: 'a-local',
    isTransfer: false,
    transferGroupId: '',
    transferRole: '',
    ...extra,
  };
}

function queueRow(
  id: string,
  userId: string,
  entityType: string,
  entityId: string,
  payload: object | string,
  extra: Record<string, unknown> = {}
) {
  return {
    id,
    userId,
    entityType,
    entityId,
    operation: 'update',
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    createdAt: T0,
    retryCount: 0,
    lastError: '',
    ...extra,
  };
}

async function queueRows() {
  const db = await getRxDatabase();
  const rows = await db.syncQueue.find().exec();
  return rows.map((row) => row.toMutableJSON());
}

/** Claim for a signed-in session, the way the auth layer and sync do. */
function claimAs(userId: string) {
  setCurrentUserId(userId);
  return syncService.claimUnassigned(captureSyncContext()!);
}

async function ownerOf(collection: 'categories' | 'accounts' | 'transactions', id: string) {
  const db = await getRxDatabase();
  const row = await db[collection].findOne(id).exec();
  return row ? row.userId : null;
}

describe('claiming signed-out data and ownerless outbox entries', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    resetSessionForTests();
    syncGate.reset();
    await resetDatabaseConnection();
  });

  afterAll(async () => {
    resetSessionForTests();
    await resetDatabaseConnection();
  });

  it('queues and uploads a category created while signed out once an account signs in', async () => {
    const db = await getRxDatabase();
    await db.categories.insert(category('c-local', ''));

    setCurrentUserId('user-a');
    await syncService.pushLocalChanges();

    expect(remote.upsertCategory).toHaveBeenCalledWith(expect.objectContaining({ id: 'c-local' }));
    expect(await ownerOf('categories', 'c-local')).toBe('user-a');
    expect(await queueRows()).toEqual([]);
  });

  it('uploads a signed-out account and category before the transaction that references them', async () => {
    const db = await getRxDatabase();
    await db.categories.insert(category('c-local', ''));
    await db.accounts.insert(account('a-local', ''));
    await db.transactions.insert(transaction('t-local', ''));

    setCurrentUserId('user-a');
    await syncService.pushLocalChanges();

    const txOrder = remote.upsertTransaction.mock.invocationCallOrder[0];
    expect(remote.upsertTransaction).toHaveBeenCalledWith(expect.objectContaining({ id: 't-local' }));
    expect(remote.upsertCategory.mock.invocationCallOrder[0]).toBeLessThan(txOrder);
    expect(remote.upsertAccount.mock.invocationCallOrder[0]).toBeLessThan(txOrder);
    expect(await ownerOf('transactions', 't-local')).toBe('user-a');
    expect(await ownerOf('accounts', 'a-local')).toBe('user-a');
  });

  it('keeps every row queued when claiming fails part-way, and finishes on the next attempt', async () => {
    const db = await getRxDatabase();
    await db.categories.insert(category('c-local', ''));
    await db.transactions.insert(transaction('t-local', ''));
    const realClaim = ownershipRepository.claim.bind(ownershipRepository);
    const claim = jest.spyOn(ownershipRepository, 'claim').mockImplementation(async (type, ids, userId) => {
      if (type === 'transaction') throw new Error('storage unavailable');
      return realClaim(type, ids, userId);
    });

    await expect(claimAs('user-a')).rejects.toThrow('storage unavailable');
    expect(await ownerOf('transactions', 't-local')).toBe('');
    expect((await syncQueueRepository.list('user-a')).map((item) => item.entityId).sort()).toEqual(['c-local', 't-local']);

    claim.mockRestore();
    await claimAs('user-a');

    expect(await ownerOf('transactions', 't-local')).toBe('user-a');
    const entries = await syncQueueRepository.list('user-a');
    expect(entries.map((item) => item.entityId).sort()).toEqual(['c-local', 't-local']);
  });

  it('is idempotent: claiming twice neither duplicates nor re-creates outbox entries', async () => {
    const db = await getRxDatabase();
    await db.categories.insert(category('c-local', ''));
    await db.accounts.insert(account('a-local', ''));

    await claimAs('user-a');
    const first = await queueRows();
    await claimAs('user-a');
    const second = await queueRows();

    expect(first).toHaveLength(2);
    expect(second).toEqual(first);
  });

  it('claims built-in categories and signed-out tombstones without queuing them', async () => {
    const db = await getRxDatabase();
    const defaults = await db.categories.find({ selector: { isDefault: true } }).exec();
    expect(defaults.length).toBeGreaterThan(0);
    await db.categories.insert(category('c-hidden', '', { deletedAt: '2026-10-01T09:00:00.000Z' }));

    await claimAs('user-a');

    expect(await ownerOf('categories', defaults[0].id)).toBe('user-a');
    expect(await ownerOf('categories', 'c-hidden')).toBe('user-a');
    expect(await queueRows()).toEqual([]);
  });

  it('hands an ownerless entry to the account that owns its entity, keeping its retry metadata', async () => {
    const db = await getRxDatabase();
    await db.categories.insert(category('c-mine', 'user-a'));
    await db.syncQueue.insert(
      queueRow('q-race', '', 'category', 'c-mine', { id: 'c-mine', name: 'Groceries' }, { retryCount: 2, lastError: 'timeout' })
    );

    await claimAs('user-a');

    expect(await queueRows()).toEqual([
      expect.objectContaining({ id: 'q-race', userId: 'user-a', retryCount: 2, lastError: 'timeout' }),
    ]);
  });

  it('never claims an ownerless entry for another account’s entity, a missing entity, or an unreadable payload', async () => {
    const db = await getRxDatabase();
    await db.categories.bulkInsert([
      category('c-theirs', 'user-b'),
      category('c-mine', 'user-a'),
      category('c-mine-2', 'user-a'),
    ]);
    await db.syncQueue.bulkInsert([
      queueRow('q-theirs', '', 'category', 'c-theirs', { id: 'c-theirs' }),
      queueRow('q-missing', '', 'category', 'c-gone', { id: 'c-gone' }),
      queueRow('q-foreign-payload', '', 'category', 'c-mine', { id: 'c-mine', userId: 'user-b' }),
      queueRow('q-garbage', '', 'category', 'c-mine-2', '{not json'),
    ]);

    await claimAs('user-a');

    const rows = await queueRows();
    expect(rows.map((row) => [row.id, row.userId]).sort()).toEqual([
      ['q-foreign-payload', ''],
      ['q-garbage', ''],
      ['q-missing', ''],
      ['q-theirs', ''],
    ]);
  });

  it('keeps only the newest entry when the account already queued the same entity', async () => {
    const db = await getRxDatabase();
    await db.categories.bulkInsert([category('c-older-orphan', 'user-a'), category('c-newer-orphan', 'user-a')]);
    await db.syncQueue.bulkInsert([
      queueRow('q-orphan-old', '', 'category', 'c-older-orphan', { id: 'c-older-orphan', name: 'old' }),
      queueRow('q-mine-new', 'user-a', 'category', 'c-older-orphan', { id: 'c-older-orphan', name: 'new' }, { createdAt: '2026-10-01T09:00:00.000Z' }),
      queueRow('q-orphan-new', '', 'category', 'c-newer-orphan', { id: 'c-newer-orphan', name: 'new' }, { createdAt: '2026-10-01T09:00:00.000Z' }),
      queueRow('q-mine-old', 'user-a', 'category', 'c-newer-orphan', { id: 'c-newer-orphan', name: 'old' }),
    ]);

    await claimAs('user-a');

    const rows = await queueRows();
    expect(rows.map((row) => [row.id, row.userId]).sort()).toEqual([
      ['q-mine-new', 'user-a'],
      ['q-orphan-new', 'user-a'],
    ]);
  });

  it('claims an ownerless profile entry only for the account it describes', async () => {
    const db = await getRxDatabase();
    await db.syncQueue.bulkInsert([
      queueRow('q-profile-a', '', 'profile', 'user-a', { currency: 'INR' }),
      queueRow('q-profile-b', '', 'profile', 'user-b', { currency: 'USD' }),
    ]);

    await claimAs('user-a');

    const rows = await queueRows();
    expect(rows.map((row) => [row.id, row.userId]).sort()).toEqual([
      ['q-profile-a', 'user-a'],
      ['q-profile-b', ''],
    ]);
  });

  it('after sign-out, a second account claims only rows written since, never the first account’s data', async () => {
    const db = await getRxDatabase();
    await db.categories.insert(category('c-first', ''));
    await claimAs('user-a');
    const firstQueue = await syncQueueRepository.list('user-a');

    setCurrentUserId(null);
    await db.categories.insert(category('c-between', ''));
    setCurrentUserId('user-b');
    await syncService.pushLocalChanges();

    expect(await ownerOf('categories', 'c-first')).toBe('user-a');
    expect(await ownerOf('categories', 'c-between')).toBe('user-b');
    expect(remote.upsertCategory).toHaveBeenCalledTimes(1);
    expect(remote.upsertCategory).toHaveBeenCalledWith(expect.objectContaining({ id: 'c-between' }));
    expect(await syncQueueRepository.list('user-a')).toEqual(firstQueue);
    expect(await syncQueueRepository.list('user-b')).toEqual([]);
  });

  it('does not overwrite rows that already belong to an account', async () => {
    const db = await getRxDatabase();
    await db.categories.insert(category('c-theirs', 'user-b', { updatedAt: '2026-10-01T09:30:00.000Z' }));

    expect(await ownershipRepository.claim('category', ['c-theirs'], 'user-a')).toEqual([]);
    await claimAs('user-a');

    const row = await db.categories.findOne('c-theirs').exec();
    expect(row?.userId).toBe('user-b');
    expect(row?.updatedAt).toBe('2026-10-01T09:30:00.000Z');
    expect(await queueRows()).toEqual([]);
  });

  it('never hard-deletes local rows while claiming', async () => {
    const db = await getRxDatabase();
    await db.categories.bulkInsert([category('c-local', ''), category('c-hidden', '', { deletedAt: T0 }), category('c-b', 'user-b')]);
    await db.transactions.insert(transaction('t-local', ''));
    const before = { categories: await db.categories.count().exec(), transactions: await db.transactions.count().exec() };

    await claimAs('user-a');

    expect(await db.categories.count().exec()).toBe(before.categories);
    expect(await db.transactions.count().exec()).toBe(before.transactions);
  });

  it('a full replacement for one account leaves other accounts’ rows and every outbox alone', async () => {
    const db = await getRxDatabase();
    await db.categories.bulkInsert([category('c-old-a', 'user-a'), category('c-b', 'user-b')]);
    await db.syncQueue.bulkInsert([
      queueRow('q-a', 'user-a', 'category', 'c-old-a', { id: 'c-old-a' }),
      queueRow('q-b', 'user-b', 'category', 'c-b', { id: 'c-b' }),
    ]);
    const { categoryRepository } = await import('@/database/repositories/categoryRepository');

    await categoryRepository.replaceAll(
      [{ id: 'c-new', name: 'From server', icon: 'cart', color: '#111111', type: 'expense', isDefault: false, createdAt: T0 }],
      { ownerId: 'user-a' }
    );

    expect(await ownerOf('categories', 'c-old-a')).toBeNull();
    expect(await ownerOf('categories', 'c-new')).toBe('user-a');
    expect(await ownerOf('categories', 'c-b')).toBe('user-b');
    expect((await queueRows()).map((row) => row.id).sort()).toEqual(['q-a', 'q-b']);
  });

  it('does nothing without a user id', async () => {
    const db = await getRxDatabase();
    await db.syncQueue.insert(queueRow('q-orphan', '', 'category', 'c-local', { id: 'c-local' }));

    expect(await syncQueueRepository.claimUnowned('', async () => true)).toBe(0);
    expect(await ownershipRepository.claim('category', ['c-local'], '')).toEqual([]);
    expect(await queueRows()).toEqual([expect.objectContaining({ id: 'q-orphan', userId: '' })]);
  });
});
