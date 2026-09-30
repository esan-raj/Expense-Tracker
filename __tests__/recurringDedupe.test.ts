/// <reference types="jest" />

const { createHash } = require('crypto') as {
  createHash: (algorithm: string) => { update: (data: string, encoding: string) => { digest: (encoding: string) => string } };
};

jest.mock('@/services/outbox', () => ({ queueChange: jest.fn(async () => undefined) }));
jest.mock('@/database/repositories/transactionRepository', () => ({
  transactionRepository: {
    create: jest.fn(),
    existsForRecurringOnDate: jest.fn(),
    getByIdIncludingDeleted: jest.fn(),
  },
}));
jest.mock('@/database/repositories/recurringRepository', () => ({
  recurringRepository: {
    listDue: jest.fn(),
    setNextDate: jest.fn(async () => undefined),
    getById: jest.fn(async () => null),
  },
}));

import { transactionRepository } from '@/database/repositories/transactionRepository';
import { recurringRepository } from '@/database/repositories/recurringRepository';
import { recurringService } from '@/services/recurringService';
import { nameBasedUuid, recurringOccurrenceId, sha256Hex } from '@/utils/deterministicId';
import { todayKey } from '@/utils/dates';

const tx = transactionRepository as unknown as {
  create: jest.Mock;
  existsForRecurringOnDate: jest.Mock;
  getByIdIncludingDeleted: jest.Mock;
};
const rec = recurringRepository as unknown as { listDue: jest.Mock };

describe('deterministic ids', () => {
  it('matches the published SHA-256 test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it.each(['', 'abc', 'spendwise:recurring-occurrence:5a7ab4b5:2026-09-30', 'ünïcødé ₹ 😀', 'x'.repeat(200)])(
    'sha256 matches node crypto for %j',
    (input) => {
      expect(sha256Hex(input)).toBe(createHash('sha256').update(input, 'utf8').digest('hex'));
    }
  );

  it('produces a stable RFC 9562 version-8 UUID', () => {
    const id = nameBasedUuid('hello');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(nameBasedUuid('hello')).toBe(id);
  });

  it('gives each recurring occurrence its own id, identical across devices', () => {
    const a = recurringOccurrenceId('rule-1', '2026-09-30');
    expect(recurringOccurrenceId('rule-1', '2026-09-30')).toBe(a);
    expect(recurringOccurrenceId('rule-1', '2026-10-30')).not.toBe(a);
    expect(recurringOccurrenceId('rule-2', '2026-09-30')).not.toBe(a);
  });
});

describe('recurring generation', () => {
  const today = todayKey();
  const rule = {
    id: 'rule-1',
    title: 'Salary',
    amount: 4270000,
    type: 'income',
    categoryId: 'cat-1',
    frequency: 'monthly',
    nextDate: today,
    paymentMethod: 'upi',
    accountId: 'acc-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    rec.listDue.mockResolvedValue([rule]);
    tx.existsForRecurringOnDate.mockResolvedValue(false);
    tx.getByIdIncludingDeleted.mockResolvedValue(null);
    tx.create.mockImplementation(async (input: object, options: { id: string }) => ({ ...input, id: options.id }));
  });

  it('creates the occurrence with the id derived from rule and date', async () => {
    await expect(recurringService.processDue()).resolves.toBe(1);
    expect(tx.create).toHaveBeenCalledWith(
      expect.objectContaining({ recurringId: 'rule-1', date: today }),
      { id: recurringOccurrenceId('rule-1', today) }
    );
  });

  it('does not regenerate an occurrence this device already deleted', async () => {
    tx.getByIdIncludingDeleted.mockResolvedValue({ id: recurringOccurrenceId('rule-1', today), deletedAt: 'x' });
    await expect(recurringService.processDue()).resolves.toBe(0);
    expect(tx.create).not.toHaveBeenCalled();
  });

  it('skips dates already covered by an older random-id occurrence', async () => {
    tx.existsForRecurringOnDate.mockResolvedValue(true);
    await expect(recurringService.processDue()).resolves.toBe(0);
    expect(tx.create).not.toHaveBeenCalled();
  });
});
