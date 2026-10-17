/// <reference types="jest" />
let mockIdCounter = 0;
jest.mock('@/utils/id', () => ({ createId: () => `id-${(mockIdCounter += 1)}` }));

type Row = { id: string; [key: string]: unknown };
type Entity = 'transaction' | 'category' | 'budget' | 'recurring' | 'account' | 'investment';

let mockOnline = true;
const SERVER_NOW = '2026-10-02T09:00:00.000Z';

/**
 * Stateful stand-in for account B's Supabase tables. Uploads are stamped with the signed-in
 * user like remoteApi does, and pulls return whatever the server holds.
 */
const server = {
  tables: new Map<Entity, Map<string, Row>>(),
  reset() {
    this.tables = new Map((['transaction', 'category', 'budget', 'recurring', 'account', 'investment'] as Entity[]).map((e) => [e, new Map()]));
  },
  seed(entity: Entity, row: Row) {
    this.tables.get(entity)!.set(row.id, { deletedAt: null, ...row, userId: 'user-b' });
  },
  rows(entity: Entity) {
    return [...this.tables.get(entity)!.values()];
  },
  has(entity: Entity, id: string) {
    return this.tables.get(entity)!.has(id);
  },
};
server.reset();

function upsert(entity: Entity) {
  return jest.fn(async (item: Row): Promise<void> => {
    server.tables.get(entity)!.set(item.id, { ...item, deletedAt: item.deletedAt ?? null, userId: 'user-b' });
  });
}
function remove(entity: Entity) {
  return jest.fn(async (id: string, deletedAt: string): Promise<void> => {
    const row = server.tables.get(entity)!.get(id);
    if (row) server.tables.get(entity)!.set(id, { ...row, deletedAt, updatedAt: deletedAt });
  });
}
function pull(entity: Entity) {
  return jest.fn(async (..._args: unknown[]): Promise<Row[]> => server.rows(entity));
}

const remote = {
  serverTime: jest.fn(async (): Promise<string | null> => SERVER_NOW),
  upsertTransaction: upsert('transaction'),
  upsertCategory: upsert('category'),
  upsertBudget: upsert('budget'),
  upsertRecurring: upsert('recurring'),
  upsertAccount: upsert('account'),
  upsertInvestment: upsert('investment'),
  upsertProfile: jest.fn(async (..._args: unknown[]): Promise<void> => undefined),
  deleteTransaction: remove('transaction'),
  deleteCategory: remove('category'),
  deleteBudget: remove('budget'),
  deleteRecurring: remove('recurring'),
  deleteAccount: remove('account'),
  deleteInvestment: remove('investment'),
  insertGeneratedTransaction: jest.fn(),
  pullTransactions: pull('transaction'),
  pullCategories: pull('category'),
  pullBudgets: pull('budget'),
  pullRecurring: pull('recurring'),
  pullAccounts: pull('account'),
  pullInvestments: pull('investment'),
  pullProfile: jest.fn(async () => null),
};

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { fetch: jest.fn(async () => ({ isConnected: mockOnline, isInternetReachable: mockOnline })) },
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
import { resetSessionForTests, setCurrentUserId } from '@/database/session';
import { syncQueueRepository, syncStateRepository } from '@/database/repositories/syncQueueRepository';
import { accountRepository } from '@/database/repositories/accountRepository';
import { categoryRepository } from '@/database/repositories/categoryRepository';
import { ownershipRepository } from '@/database/repositories/ownershipRepository';
import { syncService } from '@/services/syncService';
import { syncGate } from '@/services/syncSingleFlight';
import { captureSyncContext } from '@/services/syncSession';

const T0 = '2026-10-01T08:00:00.000Z';
const base = { createdAt: T0, updatedAt: T0, deletedAt: '' };

const local = {
  account: (id: string, userId: string, extra: Record<string, unknown> = {}) => ({
    id, userId, name: `Account ${id}`, type: 'bank', institutionName: '', currency: 'INR',
    openingBalance: 100000, creditLimit: 0, isActive: true, ...base, ...extra,
  }),
  category: (id: string, userId: string, extra: Record<string, unknown> = {}) => ({
    id, userId, name: `Category ${id}`, icon: 'cart', color: '#123456', type: 'expense', isDefault: false, ...base, ...extra,
  }),
  transaction: (id: string, userId: string, extra: Record<string, unknown> = {}) => ({
    id, userId, type: 'expense', amount: 4500, categoryId: 'cat-local', title: 'Groceries', description: '',
    date: '2026-10-01', paymentMethod: 'upi', notes: '', isRecurring: false, recurringId: '', accountId: 'acc-local',
    isTransfer: false, transferGroupId: '', transferRole: '', ...base, ...extra,
  }),
  budget: (id: string, userId: string) => ({ id, userId, categoryId: 'cat-local', amount: 20000, month: 10, year: 2026, ...base }),
  recurring: (id: string, userId: string) => ({
    id, userId, title: 'Rent', amount: 15000, type: 'expense', categoryId: 'cat-local', frequency: 'monthly',
    startDate: '2026-11-01', nextDate: '2026-11-01', paymentMethod: 'bank_transfer', isActive: true, accountId: 'acc-local', ...base,
  }),
  investment: (id: string, userId: string) => ({
    id, userId, name: 'Index fund', type: 'mutual_fund', investedAmount: 50000, currentValue: 52000,
    investmentDate: '2026-09-01', accountId: 'acc-local', notes: '', ...base,
  }),
};

/** Everything a signed-out user can create, plus a row deleted before signing in. */
async function seedSignedOutWork() {
  const db = await getRxDatabase();
  await db.accounts.insert(local.account('acc-local', ''));
  await db.categories.insert(local.category('cat-local', ''));
  await db.transactions.bulkInsert([
    local.transaction('tx-local', ''),
    local.transaction('tx-deleted', '', { deletedAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-10-01T09:00:00.000Z' }),
  ]);
  await db.budgets.insert(local.budget('bud-local', ''));
  await db.recurring.insert(local.recurring('rec-local', ''));
  await db.investments.insert(local.investment('inv-local', ''));
}

/** Account B already has data in the cloud, none of it sharing ids with the device. */
function seedCloudAccount() {
  server.seed('account', { ...local.account('acc-cloud', 'user-b'), deletedAt: null });
  server.seed('category', { ...local.category('cat-cloud', 'user-b'), deletedAt: null });
  server.seed('transaction', { ...local.transaction('tx-cloud', 'user-b', { categoryId: 'cat-cloud', accountId: 'acc-cloud' }), deletedAt: null });
}

const SIGNED_OUT_IDS: Array<[keyof Awaited<ReturnType<typeof getRxDatabase>>['collections'] & string, Entity, string]> = [
  ['accounts', 'account', 'acc-local'],
  ['categories', 'category', 'cat-local'],
  ['transactions', 'transaction', 'tx-local'],
  ['budgets', 'budget', 'bud-local'],
  ['recurring', 'recurring', 'rec-local'],
  ['investments', 'investment', 'inv-local'],
];

async function localRow(collection: string, id: string) {
  const db = await getRxDatabase();
  const row = await (db as unknown as Record<string, { findOne(id: string): { exec(): Promise<{ toMutableJSON(): Row } | null> } }>)[collection]
    .findOne(id)
    .exec();
  return row ? row.toMutableJSON() : null;
}

/** Owner of each signed-out row locally and whether the server has it. */
async function signedOutState() {
  const state: Record<string, { local: unknown; uploaded: boolean }> = {};
  for (const [collection, entity, id] of SIGNED_OUT_IDS) {
    state[id] = { local: (await localRow(collection, id))?.userId ?? 'MISSING', uploaded: server.has(entity, id) };
  }
  return state;
}

const PRESERVED_AND_UPLOADED = Object.fromEntries(SIGNED_OUT_IDS.map(([, , id]) => [id, { local: 'user-b', uploaded: true }]));

describe('first cloud sync after working signed out', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    server.reset();
    mockOnline = true;
    resetSessionForTests();
    syncGate.reset();
    await resetDatabaseConnection();
  });

  afterAll(async () => {
    resetSessionForTests();
    await resetDatabaseConnection();
  });

  it('keeps and uploads signed-out work when signing in to an account that already has cloud data', async () => {
    await seedSignedOutWork();
    seedCloudAccount();

    // What useAuthStore.signIn does, followed by the launch/after-login full sync.
    setCurrentUserId('user-b');
    await syncService.claimLocalData(captureSyncContext()!);
    const queuedBeforeSync = (await syncQueueRepository.list('user-b')).length;
    await syncService.performFullSync();

    expect({
      rows: await signedOutState(),
      tombstone: (await localRow('transactions', 'tx-deleted'))?.deletedAt ?? 'MISSING',
      queuedBeforeSync: queuedBeforeSync > 0,
    }).toEqual({ rows: PRESERVED_AND_UPLOADED, tombstone: '2026-10-01T09:00:00.000Z', queuedBeforeSync: true });
    expect((await localRow('transactions', 'tx-cloud'))?.userId).toBe('user-b');
    expect((await localRow('accounts', 'acc-cloud'))?.userId).toBe('user-b');
    expect(await syncQueueRepository.list('user-b')).toEqual([]);
    expect((await syncStateRepository.get()).status).toBe('synced');
  });

  it('keeps and uploads signed-out work when the session is restored without the sign-in claim', async () => {
    await seedSignedOutWork();
    seedCloudAccount();

    setCurrentUserId('user-b');
    await syncService.performFullSync();

    expect(await signedOutState()).toEqual(PRESERVED_AND_UPLOADED);
  });

  it.each(SIGNED_OUT_IDS)('keeps and uploads a lone signed-out %s row', async (collection, entity, id) => {
    const db = await getRxDatabase();
    const factory = { accounts: local.account, categories: local.category, transactions: local.transaction, budgets: local.budget, recurring: local.recurring, investments: local.investment }[collection as 'accounts'];
    await (db as unknown as Record<string, { insert(doc: object): Promise<unknown> }>)[collection].insert(factory(id, ''));
    seedCloudAccount();

    setCurrentUserId('user-b');
    await syncService.claimLocalData(captureSyncContext()!);
    await syncService.performFullSync();

    expect((await localRow(collection, id))?.userId).toBe('user-b');
    expect(server.has(entity, id)).toBe(true);
    expect((await localRow('accounts', 'acc-cloud'))?.userId).toBe('user-b');
  });

  it('is the case the replacement heuristic targets: no shared account ids, so it would replace', async () => {
    await seedSignedOutWork();
    seedCloudAccount();
    setCurrentUserId('user-b');
    await syncService.claimUnassigned(captureSyncContext()!);
    const replaceAll = jest.spyOn(accountRepository, 'replaceAll');

    expect(await syncService.shouldReplaceLocalFromRemote()).toBe(true);
    await syncService.performFullSync();

    expect(replaceAll).not.toHaveBeenCalled();
    expect(await signedOutState()).toEqual(PRESERVED_AND_UPLOADED);
  });

  it('keeps every local row: nothing is hard-deleted and the signed-out tombstone is never uploaded', async () => {
    await seedSignedOutWork();
    seedCloudAccount();
    const db = await getRxDatabase();
    const collections = ['accounts', 'categories', 'transactions', 'budgets', 'recurring', 'investments'] as const;
    const before = await Promise.all(collections.map((name) => db[name].count().exec()));

    setCurrentUserId('user-b');
    await syncService.claimLocalData(captureSyncContext()!);
    await syncService.performFullSync();

    const after = await Promise.all(collections.map((name) => db[name].count().exec()));
    collections.forEach((name, index) => expect({ name, kept: after[index] >= before[index] }).toEqual({ name, kept: true }));
    expect(await localRow('transactions', 'tx-deleted')).toMatchObject({ userId: 'user-b', deletedAt: '2026-10-01T09:00:00.000Z' });
    expect(server.has('transaction', 'tx-deleted')).toBe(false);
    expect(remote.deleteTransaction).not.toHaveBeenCalled();
  });

  it('never replaces while the account has pending changes, even signed-in ones', async () => {
    const db = await getRxDatabase();
    setCurrentUserId('user-b');
    await db.accounts.insert(local.account('acc-b-new', 'user-b'));
    await syncQueueRepository.enqueue('account', 'acc-b-new', 'create', local.account('acc-b-new', 'user-b'), { userId: 'user-b' });
    seedCloudAccount();
    const replaceAll = jest.spyOn(accountRepository, 'replaceAll');

    await syncService.performFullSync();

    expect(replaceAll).not.toHaveBeenCalled();
    expect((await localRow('accounts', 'acc-b-new'))?.userId).toBe('user-b');
    expect(server.has('account', 'acc-b-new')).toBe(true);
    expect((await localRow('accounts', 'acc-cloud'))?.userId).toBe('user-b');
  });

  it('still uses the replacement path when the account has no local work', async () => {
    seedCloudAccount();
    const db = await getRxDatabase();
    const builtIns = await db.categories.find({ selector: { isDefault: true } }).exec();
    expect(builtIns.length).toBeGreaterThan(0);
    const replaceAll = jest.spyOn(accountRepository, 'replaceAll');

    setCurrentUserId('user-b');
    await syncService.performFullSync();

    expect(replaceAll).toHaveBeenCalledWith([expect.objectContaining({ id: 'acc-cloud' })], { ownerId: 'user-b' });
    expect(await localRow('categories', builtIns[0].id)).toBeNull();
    expect((await localRow('categories', 'cat-cloud'))?.userId).toBe('user-b');
    expect((await localRow('transactions', 'tx-cloud'))?.userId).toBe('user-b');
    expect(remote.upsertCategory).not.toHaveBeenCalled();
    expect((await syncStateRepository.get()).status).toBe('synced');
  });

  it('abandons the replacement when a change is made while the server data downloads', async () => {
    seedCloudAccount();
    const db = await getRxDatabase();
    const replaceAll = jest.spyOn(accountRepository, 'replaceAll');
    remote.pullTransactions.mockImplementationOnce(async () => {
      const during = local.transaction('tx-during', 'user-b', { categoryId: 'cat-cloud', accountId: 'acc-cloud' });
      await db.transactions.insert(during);
      await syncQueueRepository.enqueue('transaction', 'tx-during', 'create', during, { userId: 'user-b' });
      return server.rows('transaction');
    });

    setCurrentUserId('user-b');
    await syncService.performFullSync();

    expect(replaceAll).not.toHaveBeenCalled();
    expect((await localRow('transactions', 'tx-during'))?.userId).toBe('user-b');
    expect(server.has('transaction', 'tx-during')).toBe(true);
    expect((await localRow('transactions', 'tx-cloud'))?.userId).toBe('user-b');
  });

  it('leaves another account’s rows and outbox untouched on both paths', async () => {
    const db = await getRxDatabase();
    await db.accounts.insert(local.account('acc-a', 'user-a'));
    await db.transactions.insert(local.transaction('tx-a', 'user-a', { accountId: 'acc-a' }));
    await syncQueueRepository.enqueue('transaction', 'tx-a', 'update', { id: 'tx-a' }, { userId: 'user-a' });
    seedCloudAccount();

    // Replacement path (B has no local work).
    setCurrentUserId('user-b');
    await syncService.performFullSync();
    // Merge path (B now has a signed-out row to upload).
    setCurrentUserId(null);
    await db.categories.insert(local.category('cat-later', ''));
    setCurrentUserId('user-b');
    await syncService.performFullSync();

    expect(await localRow('accounts', 'acc-a')).toMatchObject({ userId: 'user-a', deletedAt: '' });
    expect(await localRow('transactions', 'tx-a')).toMatchObject({ userId: 'user-a', deletedAt: '' });
    expect((await syncQueueRepository.list('user-a')).map((item) => item.entityId)).toEqual(['tx-a']);
    expect(server.has('account', 'acc-a') || server.has('transaction', 'tx-a')).toBe(false);
    expect(server.has('category', 'cat-later')).toBe(true);
  });

  it('keeps ownerless outbox entries it cannot attribute', async () => {
    const db = await getRxDatabase();
    await db.syncQueue.insert({
      id: 'q-garbage', userId: '', entityType: 'transaction', entityId: 'tx-unknown', operation: 'update',
      payload: '{not json', createdAt: T0, retryCount: 0, lastError: '',
    });
    seedCloudAccount();

    setCurrentUserId('user-b');
    await syncService.performFullSync();

    expect(await db.syncQueue.findOne('q-garbage').exec()).toMatchObject({ userId: '', payload: '{not json' });
    expect(remote.upsertTransaction).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'tx-unknown' }));
  });

  it('retries after claiming fails part-way, without deleting or replacing anything', async () => {
    await seedSignedOutWork();
    seedCloudAccount();
    const replaceAll = jest.spyOn(accountRepository, 'replaceAll');
    jest.spyOn(ownershipRepository, 'claim').mockRejectedValueOnce(new Error('storage unavailable'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    setCurrentUserId('user-b');
    await syncService.performFullSync();

    expect((await syncStateRepository.get()).status).toBe('error');
    expect(replaceAll).not.toHaveBeenCalled();
    for (const [collection, , id] of SIGNED_OUT_IDS) expect(await localRow(collection, id)).not.toBeNull();

    await syncService.performFullSync();

    expect(await signedOutState()).toEqual(PRESERVED_AND_UPLOADED);
    expect((await syncStateRepository.get()).status).toBe('synced');
  });

  it('keeps the queue and the local row when an upload fails, and uploads on the next sync', async () => {
    await seedSignedOutWork();
    seedCloudAccount();
    remote.upsertTransaction.mockRejectedValueOnce(new Error('network down'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    setCurrentUserId('user-b');
    await syncService.claimLocalData(captureSyncContext()!);
    await syncService.performFullSync();

    expect((await localRow('transactions', 'tx-local'))?.userId).toBe('user-b');
    expect(server.has('transaction', 'tx-local')).toBe(false);
    expect(await syncQueueRepository.list('user-b')).toEqual([
      expect.objectContaining({ entityId: 'tx-local', retryCount: 1, lastError: 'network down' }),
    ]);

    await syncService.performFullSync();

    expect(server.has('transaction', 'tx-local')).toBe(true);
    expect(await syncQueueRepository.list('user-b')).toEqual([]);
  });

  it('recovers when the app restarts between claiming and uploading', async () => {
    await seedSignedOutWork();
    seedCloudAccount();
    setCurrentUserId('user-b');
    await syncService.claimLocalData(captureSyncContext()!);

    // Process restart: in-memory session and gate state are gone, the local database is not.
    resetSessionForTests();
    syncGate.reset();
    setCurrentUserId('user-b');
    await syncService.performFullSync();

    expect(await signedOutState()).toEqual(PRESERVED_AND_UPLOADED);
  });

  it('changes nothing while offline after restoring a session, then uploads once online', async () => {
    await seedSignedOutWork();
    seedCloudAccount();
    mockOnline = false;

    setCurrentUserId('user-b');
    await syncService.claimUnassigned(captureSyncContext()!);
    await syncService.performFullSync();

    expect((await syncStateRepository.get()).status).toBe('offline');
    expect(remote.pullAccounts).not.toHaveBeenCalled();
    for (const [collection, , id] of SIGNED_OUT_IDS) expect((await localRow(collection, id))?.userId).toBe('user-b');

    mockOnline = true;
    await syncService.performFullSync();

    expect(await signedOutState()).toEqual(PRESERVED_AND_UPLOADED);
  });
});

describe('replacement scope', () => {
  beforeEach(async () => {
    resetSessionForTests();
    await resetDatabaseConnection();
  });

  async function seedOwners() {
    const db = await getRxDatabase();
    await db.categories.bulkInsert([
      local.category('cat-b-old', 'user-b'),
      local.category('cat-unassigned', ''),
      local.category('cat-a', 'user-a'),
    ]);
  }
  const incoming = [{ id: 'cat-new', name: 'From server', icon: 'cart', color: '#111111', type: 'expense' as const, isDefault: false, createdAt: T0 }];

  it('an account replacement removes only that account’s rows, never unassigned ones', async () => {
    await seedOwners();

    await categoryRepository.replaceAll(incoming, { ownerId: 'user-b' });

    expect(await localRow('categories', 'cat-b-old')).toBeNull();
    expect((await localRow('categories', 'cat-unassigned'))?.userId).toBe('');
    expect((await localRow('categories', 'cat-a'))?.userId).toBe('user-a');
    expect((await localRow('categories', 'cat-new'))?.userId).toBe('user-b');
  });

  it('a backup restore still replaces every row on the device', async () => {
    await seedOwners();

    await categoryRepository.replaceAll(incoming);

    const db = await getRxDatabase();
    expect((await db.categories.find().exec()).map((row) => row.id)).toEqual(['cat-new']);
  });
});
