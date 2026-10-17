/// <reference types="jest" />

jest.mock('@/utils/id', () => ({ createId: () => 'group-1' }));
jest.mock('@/services/outbox', () => ({ queueChange: jest.fn() }));
jest.mock('@/database/repositories/transactionRepository', () => ({
  transactionRepository: {
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    getById: jest.fn(),
    listByTransferGroup: jest.fn(),
    countByCategory: jest.fn(),
    listIdsByCategory: jest.fn(),
    reassignCategory: jest.fn(),
  },
}));
jest.mock('@/database/repositories/accountRepository', () => ({
  accountRepository: { getById: jest.fn() },
}));
jest.mock('@/database/repositories/categoryRepository', () => ({
  categoryRepository: {
    list: jest.fn(),
    create: jest.fn(),
    findActiveByIdentity: jest.fn(),
    getById: jest.fn(),
  },
}));
jest.mock('@/database/repositories/recurringRepository', () => ({
  recurringRepository: {
    create: jest.fn(),
    countByCategory: jest.fn(),
    reassignCategory: jest.fn(),
  },
}));
jest.mock('@/database/repositories/budgetRepository', () => ({
  budgetRepository: { reassignCategory: jest.fn() },
}));

import { accountRepository } from '@/database/repositories/accountRepository';
import { categoryRepository } from '@/database/repositories/categoryRepository';
import { transactionRepository } from '@/database/repositories/transactionRepository';
import { categoryService } from '@/services/categoryService';
import { queueChange } from '@/services/outbox';
import { transactionService } from '@/services/transactionService';
import type { Account, Category, TransactionWithCategory } from '@/types';
import {
  calculateAccountBalances,
  excludeTransfers,
  isCashHolding,
  signedAccountDelta,
  summarizeAccounts,
} from '@/utils/accountLogic';
import { calculateTotalExpenses, calculateTotalIncome } from '@/utils/calculations';
import { isInScope, resetSessionForTests, setCurrentUserId } from '@/database/session';
import { sortQueueForPush } from '@/utils/syncLogic';
import { transferLegTitles, transferPaymentMethod } from '@/utils/transfers';
import { accountFormSchema, transactionFormSchema } from '@/utils/validation';
import { AppError } from '@/utils/errors';
import type { SyncQueueItem } from '@/types/sync';

const mockedAccounts = accountRepository as unknown as {
  getById: jest.Mock;
};
const mockedTransactions = transactionRepository as unknown as {
  create: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  getById: jest.Mock;
  listByTransferGroup: jest.Mock;
};
const mockedCategories = categoryRepository as unknown as {
  list: jest.Mock;
  create: jest.Mock;
  findActiveByIdentity: jest.Mock;
};
const mockedQueue = queueChange as unknown as jest.Mock;

const bank: Account = {
  id: 'bank-1',
  name: 'HDFC Bank',
  type: 'bank',
  institutionName: 'HDFC',
  currency: 'INR',
  openingBalance: 1000000,
  creditLimit: null,
  isActive: true,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const cash: Account = {
  ...bank,
  id: 'cash-1',
  name: 'Cash in hand',
  type: 'cash',
  institutionName: '',
  openingBalance: 500000,
};

const wallet: Account = {
  ...cash,
  id: 'wallet-1',
  name: 'Travel wallet',
  type: 'wallet',
  openingBalance: 200000,
};

const card: Account = {
  ...bank,
  id: 'card-1',
  name: 'HDFC Credit Card',
  type: 'credit_card',
  openingBalance: 0,
  creditLimit: 7000000,
};

function tx(
  partial: Partial<TransactionWithCategory> & Pick<TransactionWithCategory, 'id' | 'type' | 'amount' | 'accountId'>
): TransactionWithCategory {
  return {
    categoryId: 'cat-1',
    title: 'Entry',
    description: null,
    date: '2026-09-10',
    paymentMethod: 'cash',
    notes: null,
    isRecurring: false,
    recurringId: null,
    isTransfer: false,
    transferGroupId: null,
    transferRole: null,
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
    categoryName: 'Food',
    categoryIcon: 'fast-food',
    categoryColor: '#000',
    ...partial,
  };
}

describe('cash as a first-class account', () => {
  it('treats cash and wallet types as cash holdings', () => {
    expect(isCashHolding('cash')).toBe(true);
    expect(isCashHolding('wallet')).toBe(true);
    expect(isCashHolding('bank')).toBe(false);
  });

  it('computes cash balance as opening + income + inbound transfers − expenses − outbound transfers', () => {
    const balances = calculateAccountBalances(cash, [
      { type: 'income', amount: 20000, accountId: cash.id },
      { type: 'expense', amount: 8000, accountId: cash.id },
      { type: 'income', amount: 15000, accountId: cash.id, isTransfer: true, transferRole: 'destination' },
      { type: 'expense', amount: 5000, accountId: cash.id, isTransfer: true, transferRole: 'source' },
    ]);
    expect(balances.currentBalance).toBe(522000);
  });

  it('keeps opening cash out of income and expenditure totals', () => {
    const rows = [
      { type: 'income' as const, amount: 20000 },
      { type: 'expense' as const, amount: 8000 },
    ];
    expect(calculateTotalIncome(rows)).toBe(20000);
    expect(calculateTotalExpenses(rows)).toBe(8000);
    expect(cash.openingBalance).toBe(500000);
  });

  it('counts cash expenses and income once and excludes cash withdrawals from P&L', () => {
    const rows = [
      { type: 'expense' as const, amount: 8000, isTransfer: false },
      { type: 'income' as const, amount: 20000, isTransfer: false },
      { type: 'expense' as const, amount: 15000, isTransfer: true },
      { type: 'income' as const, amount: 15000, isTransfer: true },
    ];
    expect(calculateTotalExpenses(rows)).toBe(8000);
    expect(calculateTotalIncome(rows)).toBe(20000);
    expect(calculateTotalExpenses(excludeTransfers(rows))).toBe(8000);
  });

  it('separates cash holdings from bank balances and credit available', () => {
    const summary = summarizeAccounts([
      { ...bank, entries: [{ type: 'expense', amount: 100000, isTransfer: true, transferRole: 'source' }] },
      { ...cash, entries: [{ type: 'income', amount: 100000, isTransfer: true, transferRole: 'destination' }] },
      { ...card, entries: [{ type: 'expense', amount: 432201 }] },
    ]);
    expect(summary.bankBalance).toBe(900000);
    expect(summary.cashBalance).toBe(600000);
    expect(summary.creditOutstanding).toBe(432201);
    expect(summary.availableCredit).toBe(6567799);
  });

  it('conserves total holdings on a bank-to-cash transfer', () => {
    const amount = 25000;
    const afterBank = calculateAccountBalances(bank, [
      { type: 'expense', amount, isTransfer: true, transferRole: 'source' },
    ]);
    const afterCash = calculateAccountBalances(cash, [
      { type: 'income', amount, isTransfer: true, transferRole: 'destination' },
    ]);
    expect(afterBank.currentBalance + afterCash.currentBalance).toBe(bank.openingBalance + cash.openingBalance);
    expect(signedAccountDelta('bank', { type: 'expense', amount, isTransfer: true, transferRole: 'source' })).toBe(-amount);
    expect(signedAccountDelta('cash', { type: 'income', amount, isTransfer: true, transferRole: 'destination' })).toBe(amount);
  });

  it('allows creating a cash wallet with a name and opening balance', () => {
    expect(
      accountFormSchema.safeParse({
        type: 'cash',
        name: 'Cash in hand',
        openingBalance: 1250.5,
      }).success
    ).toBe(true);
  });
});

describe('cash transfer titles and payment methods', () => {
  it('labels bank to cash as a withdrawal and cash to bank as a deposit', () => {
    expect(transferLegTitles(bank, cash).sourceTitle).toContain('Cash withdrawal');
    expect(transferLegTitles(cash, bank).sourceTitle).toContain('Cash deposit');
    expect(transferLegTitles(cash, wallet).sourceTitle).toContain('Move cash');
    expect(transferPaymentMethod('bank', 'cash')).toBe('cash');
    expect(transferPaymentMethod('cash', 'bank')).toBe('cash');
  });

  it('does not treat a credit-card cash movement as an ordinary withdrawal', () => {
    const titles = transferLegTitles(card, cash);
    expect(titles.sourceTitle).toBe('Transfer to Cash in hand');
    expect(titles.sourceTitle).not.toContain('Cash withdrawal');
    expect(transferPaymentMethod('credit_card', 'cash')).toBe('bank_transfer');
  });

  it('rejects same-account transfers in the form', () => {
    const result = transactionFormSchema.safeParse({
      entryType: 'transfer',
      type: 'expense',
      amount: 100,
      title: 'Move',
      date: '2026-09-10',
      paymentMethod: 'cash',
      isRecurring: false,
      sourceAccountId: 'cash-1',
      destinationAccountId: 'cash-1',
    });
    expect(result.success).toBe(false);
  });
});

describe('linked transfer persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCategories.list.mockResolvedValue([{ id: 'transfer-cat', name: 'Transfer' }]);
    mockedAccounts.getById.mockImplementation(async (id: string) => {
      if (id === bank.id) return bank;
      if (id === cash.id) return cash;
      if (id === wallet.id) return wallet;
      return null;
    });
  });

  it('creates both bank-to-cash legs, then queues them together', async () => {
    mockedTransactions.create
      .mockResolvedValueOnce(tx({ id: 'src', type: 'expense', amount: 15000, accountId: bank.id, isTransfer: true, transferRole: 'source', transferGroupId: 'group-1' }))
      .mockResolvedValueOnce(tx({ id: 'dst', type: 'income', amount: 15000, accountId: cash.id, isTransfer: true, transferRole: 'destination', transferGroupId: 'group-1' }));

    const result = await transactionService.transfer({
      sourceAccountId: bank.id,
      destinationAccountId: cash.id,
      amount: 15000,
      date: '2026-09-10',
    });

    expect(result.transferGroupId).toBe('group-1');
    expect(mockedTransactions.create).toHaveBeenCalledTimes(2);
    expect(mockedQueue).toHaveBeenCalledTimes(2);
    expect(mockedQueue.mock.calls[0][0]).toBe('transaction');
    expect(mockedQueue.mock.calls[1][0]).toBe('transaction');
  });

  it('rolls back the source leg if the destination create fails', async () => {
    mockedTransactions.create
      .mockResolvedValueOnce(tx({ id: 'src', type: 'expense', amount: 15000, accountId: bank.id, isTransfer: true }))
      .mockRejectedValueOnce(new Error('write failed'));
    mockedTransactions.delete.mockResolvedValue(undefined);

    await expect(
      transactionService.transfer({
        sourceAccountId: cash.id,
        destinationAccountId: bank.id,
        amount: 15000,
        date: '2026-09-10',
      })
    ).rejects.toBeInstanceOf(AppError);

    expect(mockedTransactions.delete).toHaveBeenCalledWith('src');
    expect(mockedQueue).not.toHaveBeenCalled();
  });

  it('rejects same-account transfers before writing', async () => {
    await expect(
      transactionService.transfer({
        sourceAccountId: cash.id,
        destinationAccountId: cash.id,
        amount: 1000,
        date: '2026-09-10',
      })
    ).rejects.toThrow('Choose two different accounts for a transfer.');
    expect(mockedTransactions.create).not.toHaveBeenCalled();
  });

  it('updates both linked legs and restores them if the second write fails', async () => {
    const source = tx({
      id: 'src',
      type: 'expense',
      amount: 10000,
      accountId: bank.id,
      isTransfer: true,
      transferGroupId: 'group-1',
      transferRole: 'source',
      title: 'Cash withdrawal · Cash in hand',
    });
    const dest = tx({
      id: 'dst',
      type: 'income',
      amount: 10000,
      accountId: cash.id,
      isTransfer: true,
      transferGroupId: 'group-1',
      transferRole: 'destination',
      title: 'Cash from HDFC Bank',
    });
    mockedTransactions.getById.mockResolvedValue(source);
    mockedTransactions.listByTransferGroup.mockResolvedValue([source, dest]);
    mockedTransactions.update
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('dest failed'))
      .mockResolvedValue(undefined);

    await expect(
      transactionService.updateTransfer('src', {
        sourceAccountId: cash.id,
        destinationAccountId: bank.id,
        amount: 18000,
        date: '2026-09-11',
      })
    ).rejects.toBeInstanceOf(AppError);

    expect(mockedTransactions.update).toHaveBeenCalledTimes(4);
    expect(mockedQueue).not.toHaveBeenCalled();
  });

  it('deletes both linked transfer legs', async () => {
    const source = tx({
      id: 'src',
      type: 'expense',
      amount: 10000,
      accountId: bank.id,
      isTransfer: true,
      transferGroupId: 'group-1',
      transferRole: 'source',
    });
    const dest = tx({
      id: 'dst',
      type: 'income',
      amount: 10000,
      accountId: cash.id,
      isTransfer: true,
      transferGroupId: 'group-1',
      transferRole: 'destination',
    });
    mockedTransactions.getById.mockResolvedValue(source);
    mockedTransactions.listByTransferGroup.mockResolvedValue([source, dest]);
    mockedTransactions.delete.mockResolvedValue(undefined);

    await transactionService.delete('src');

    expect(mockedTransactions.delete).toHaveBeenCalledWith('src');
    expect(mockedTransactions.delete).toHaveBeenCalledWith('dst');
    expect(mockedQueue).toHaveBeenCalledTimes(2);
  });
});

describe('custom option creation and sync order', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    resetSessionForTests();
  });

  it('returns an existing category instead of creating a duplicate', async () => {
    const existing = { id: 'cat-food', name: 'Food', type: 'expense' } as Category;
    mockedCategories.findActiveByIdentity.mockResolvedValue(existing);

    const created = await categoryService.createOrFind({
      name: ' food ',
      icon: 'ellipse',
      color: '#64748B',
      type: 'expense',
    });

    expect(created.id).toBe('cat-food');
    expect(mockedCategories.create).not.toHaveBeenCalled();
  });

  it('rechecks identity when a concurrent create wins', async () => {
    const raced = { id: 'cat-food', name: 'Food', type: 'expense' } as Category;
    mockedCategories.findActiveByIdentity.mockResolvedValueOnce(null).mockResolvedValueOnce(raced);
    mockedCategories.create.mockRejectedValue(new Error('A expense category named "Food" already exists.'));

    const created = await categoryService.createOrFind({
      name: 'Food',
      icon: 'ellipse',
      color: '#64748B',
      type: 'expense',
    });

    expect(created.id).toBe('cat-food');
  });

  it('queues a newly created category before a dependent transaction', () => {
    const ordered = sortQueueForPush([
      {
        id: 'tx',
        entityType: 'transaction',
        entityId: 'tx-1',
        operation: 'create',
        payload: '{}',
        createdAt: '2026-09-10T10:00:00.000Z',
        retryCount: 0,
        lastError: null,
      },
      {
        id: 'cat',
        entityType: 'category',
        entityId: 'cat-1',
        operation: 'create',
        payload: '{}',
        createdAt: '2026-09-10T10:00:01.000Z',
        retryCount: 0,
        lastError: null,
      },
    ] as SyncQueueItem[]);
    expect(ordered.map((item) => item.entityType)).toEqual(['category', 'transaction']);
  });

  it('isolates cash records and options by signed-in user', () => {
    setCurrentUserId('user-a');
    expect(isInScope({ userId: 'user-a', deletedAt: '' })).toBe(true);
    expect(isInScope({ userId: 'user-b', deletedAt: '' })).toBe(false);
    expect(isInScope({ userId: 'user-a', deletedAt: '2026-09-10T00:00:00.000Z' })).toBe(false);
  });
});
