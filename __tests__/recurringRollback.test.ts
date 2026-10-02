/// <reference types="jest" />
let mockIdCounter = 0;
jest.mock('@/utils/id', () => ({ createId: () => `id-${(mockIdCounter += 1)}` }));

const queueChange = jest.fn(async (..._args: unknown[]): Promise<void> => undefined);
const recurring = {
  listDue: jest.fn(async (..._args: unknown[]): Promise<unknown[]> => []),
  setNextDate: jest.fn(async (..._args: unknown[]) => undefined),
  getById: jest.fn(async (..._args: unknown[]): Promise<unknown> => null),
  exportAll: jest.fn(async (): Promise<unknown[]> => []),
  reassignCategory: jest.fn(async (..._args: unknown[]) => undefined),
};

jest.mock('@/services/outbox', () => ({ queueChange: (...args: unknown[]) => queueChange(...args) }));
jest.mock('@/database/repositories/recurringRepository', () => ({
  get recurringRepository() {
    return recurring;
  },
}));

import { getRxDatabase } from '@/database';
import { resetDatabaseConnection } from '@/database/database';
import { resetSessionForTests } from '@/database/session';
import { transactionRepository } from '@/database/repositories/transactionRepository';
import { recurringService } from '@/services/recurringService';
import { todayKey } from '@/utils/dates';
import { recurringOccurrenceId } from '@/utils/deterministicId';

const today = todayKey();
const RULE = {
  id: 'rule-1',
  title: 'Rent',
  amount: 15000,
  type: 'expense',
  categoryId: 'cat-rent',
  frequency: 'monthly',
  startDate: today,
  nextDate: today,
  paymentMethod: 'bank_transfer',
  isActive: true,
  accountId: null,
};
const OCCURRENCE_ID = recurringOccurrenceId(RULE.id, today);

async function occurrence() {
  const db = await getRxDatabase();
  return db.transactions.findOne(OCCURRENCE_ID).exec();
}

async function generateUnqueued() {
  queueChange.mockRejectedValueOnce(new Error('outbox write failed'));
  await expect(recurringService.processDue()).rejects.toThrow('outbox write failed');
}

async function insertOccurrence(extra: Record<string, unknown> = {}) {
  const db = await getRxDatabase();
  const createdAt = '2026-10-01T06:00:00.000Z';
  await db.transactions.insert({
    id: OCCURRENCE_ID,
    userId: '',
    type: 'expense',
    amount: 15000,
    categoryId: 'cat-rent',
    title: 'Rent',
    description: '',
    date: today,
    paymentMethod: 'bank_transfer',
    notes: '',
    isRecurring: true,
    recurringId: RULE.id,
    createdAt,
    updatedAt: createdAt,
    deletedAt: '',
    accountId: '',
    isTransfer: false,
    transferGroupId: '',
    transferRole: '',
    ...extra,
  });
  return { id: OCCURRENCE_ID, recurringId: RULE.id, date: today, createdAt };
}

describe('rolling back a generated occurrence whose outbox write failed', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    resetSessionForTests();
    await resetDatabaseConnection();
    recurring.listDue.mockResolvedValue([RULE]);
    recurring.getById.mockResolvedValue(RULE);
    queueChange.mockImplementation(async () => undefined);
  });

  afterAll(async () => {
    await resetDatabaseConnection();
  });

  it('removes the row it just created, rethrows, and leaves the rule due', async () => {
    await generateUnqueued();

    expect(queueChange).toHaveBeenCalledWith('transaction', OCCURRENCE_ID, 'create', expect.objectContaining({ id: OCCURRENCE_ID }));
    expect(await occurrence()).toBeNull();
    expect(recurring.setNextDate).not.toHaveBeenCalled();
  });

  it('regenerates and queues the same occurrence on the next run', async () => {
    await generateUnqueued();

    await expect(recurringService.processDue()).resolves.toBe(1);

    expect(await occurrence()).not.toBeNull();
    expect(queueChange).toHaveBeenLastCalledWith('recurring', RULE.id, 'update', RULE);
    expect(queueChange).toHaveBeenCalledWith('transaction', OCCURRENCE_ID, 'create', expect.objectContaining({ id: OCCURRENCE_ID }));
    expect(recurring.setNextDate).toHaveBeenCalledTimes(1);
  });

  it('logs a failed rollback and still rethrows the original outbox error', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(transactionRepository, 'discardUnsyncedGeneratedOccurrence').mockRejectedValueOnce(new Error('storage locked'));

    await generateUnqueued();

    expect(consoleError).toHaveBeenCalledWith('[SpendWise] recurring.rollback: storage locked');
    expect(recurring.setNextDate).not.toHaveBeenCalled();
  });

  it('removes an untouched, unqueued occurrence exactly once', async () => {
    const generated = await insertOccurrence();

    await expect(transactionRepository.discardUnsyncedGeneratedOccurrence(generated)).resolves.toBe(true);
    await expect(transactionRepository.discardUnsyncedGeneratedOccurrence(generated)).resolves.toBe(false);
    expect(await occurrence()).toBeNull();
  });

  it.each([
    ['edited after generation', { updatedAt: '2026-10-01T07:00:00.000Z', amount: 16000 }],
    ['soft-deleted', { deletedAt: '2026-10-01T07:00:00.000Z', updatedAt: '2026-10-01T06:00:00.000Z' }],
    ['created by an earlier attempt', { createdAt: '2026-09-30T06:00:00.000Z', updatedAt: '2026-09-30T06:00:00.000Z' }],
  ])('never removes an occurrence that was %s', async (_label, extra) => {
    const generated = await insertOccurrence();
    const db = await getRxDatabase();
    await (await db.transactions.findOne(OCCURRENCE_ID).exec())!.incrementalPatch(extra);

    await expect(transactionRepository.discardUnsyncedGeneratedOccurrence(generated)).resolves.toBe(false);
    expect(await occurrence()).not.toBeNull();
  });

  it('never removes an occurrence that is in any outbox, signed in or not', async () => {
    const generated = await insertOccurrence();
    const db = await getRxDatabase();
    await db.syncQueue.insert({
      id: 'q-1',
      userId: '',
      entityType: 'transaction',
      entityId: OCCURRENCE_ID,
      operation: 'create',
      payload: JSON.stringify({ id: OCCURRENCE_ID }),
      createdAt: generated.createdAt,
      retryCount: 0,
      lastError: '',
    });

    await expect(transactionRepository.discardUnsyncedGeneratedOccurrence(generated)).resolves.toBe(false);
    expect(await occurrence()).not.toBeNull();
  });

  it('never removes a row whose id is not the derived id for its rule and date', async () => {
    const generated = await insertOccurrence();

    await expect(
      transactionRepository.discardUnsyncedGeneratedOccurrence({ ...generated, recurringId: 'rule-2' })
    ).resolves.toBe(false);
    await expect(
      transactionRepository.discardUnsyncedGeneratedOccurrence({ ...generated, recurringId: null })
    ).resolves.toBe(false);
    expect(await occurrence()).not.toBeNull();
  });
});
