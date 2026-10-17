/// <reference types="jest" />

jest.mock('@/utils/id', () => ({
  createId: () => require('crypto').randomUUID(),
}));

import { resetDatabaseConnection, resetSpendWiseDatabase, getRxDatabase } from '@/database';
import { resetSessionForTests, setCurrentUserId } from '@/database/session';
import { categoryRepository } from '@/database/repositories/categoryRepository';
import { accountRepository } from '@/database/repositories/accountRepository';
import { investmentRepository } from '@/database/repositories/investmentRepository';
import { transactionRepository, transactionSelector } from '@/database/repositories/transactionRepository';
import { accountService } from '@/services/accountService';
import { reportService } from '@/services/reportService';
import { queueChange } from '@/services/outbox';
import { getFinanceRevision, resetFinanceRevisionForTests } from '@/services/financeRevision';
import type { TransactionInput } from '@/types';

jest.setTimeout(30000);

async function expenseCategoryId(): Promise<string> {
  const categories = await categoryRepository.list();
  const food = categories.find((item) => item.name === 'Food' && item.type === 'expense');
  if (!food) throw new Error('Seeded Food category missing');
  return food.id;
}

function baseInput(overrides: Partial<TransactionInput> & Pick<TransactionInput, 'amount' | 'title' | 'date'>): TransactionInput {
  return {
    type: 'expense',
    categoryId: overrides.categoryId ?? 'pending',
    paymentMethod: 'upi',
    ...overrides,
  };
}

describe('transaction selector predicates', () => {
  afterEach(() => {
    resetSessionForTests();
  });

  it('pushes indexed filters into the RxDB selector and excludes transfers for type queries', () => {
    setCurrentUserId('user-phase1');
    const selector = transactionSelector({
      accountId: 'acc-1',
      categoryId: 'food',
      type: 'expense',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      minAmount: 100,
      maxAmount: 50000,
    });

    expect(selector.deletedAt).toBe('');
    expect(selector.userId).toEqual({ $in: ['user-phase1', ''] });
    expect(selector.accountId).toBe('acc-1');
    expect(selector.categoryId).toBe('food');
    expect(selector.type).toBe('expense');
    expect(selector.isTransfer).toBe(false);
    expect(selector.date).toEqual({ $gte: '2026-09-01', $lte: '2026-09-30' });
    expect(selector.amount).toEqual({ $gte: 100, $lte: 50000 });
    expect(selector.search).toBeUndefined();
  });

  it('does not put free-text search into the selector', () => {
    const selector = transactionSelector({ search: 'coffee' });
    expect(selector.search).toBeUndefined();
    expect(selector.title).toBeUndefined();
  });
});

describe('transaction repository query behavior', () => {
  let categoryId = '';
  let bankId = '';
  let cardId = '';

  beforeEach(async () => {
    resetSessionForTests();
    resetFinanceRevisionForTests();
    setCurrentUserId('user-phase1');
    await resetSpendWiseDatabase();
    categoryId = await expenseCategoryId();
    const bank = await accountRepository.create({
      name: 'HDFC Bank',
      type: 'bank',
      currency: 'INR',
      openingBalance: 5025000,
    });
    const card = await accountRepository.create({
      name: 'Pixel Play Credit Card',
      type: 'credit_card',
      currency: 'INR',
      openingBalance: 2030288,
      creditLimit: 7000000,
    });
    bankId = bank.id;
    cardId = card.id;
  });

  afterEach(async () => {
    resetSessionForTests();
    await resetDatabaseConnection();
  });

  it('filters, paginates, searches, and excludes deleted/transfer rows with the same sort order', async () => {
    const created = [];
    for (const [index, amount] of [10000, 20000, 30000, 40000, 50000].entries()) {
      created.push(
        await transactionRepository.create(
          baseInput({
            categoryId,
            accountId: bankId,
            amount,
            title: `Coffee ${index + 1}`,
            date: `2026-09-0${index + 1}`,
          })
        )
      );
    }
    await transactionRepository.create(
      baseInput({
        categoryId,
        accountId: cardId,
        amount: 99999,
        title: 'Card dinner',
        date: '2026-09-02',
      })
    );
    const transfer = await transactionRepository.create(
      baseInput({
        categoryId,
        accountId: bankId,
        amount: 2030288,
        title: 'Card payment',
        date: '2026-09-02',
        paymentMethod: 'bank_transfer',
        isTransfer: true,
        transferGroupId: 'g1',
        transferRole: 'source',
      })
    );
    const doomed = await transactionRepository.create(
      baseInput({
        categoryId,
        accountId: bankId,
        amount: 777,
        title: 'Deleted snack',
        date: '2026-09-03',
      })
    );
    await transactionRepository.delete(doomed.id);

    const db = await getRxDatabase();
    const scoped = await db.transactions.find({ selector: { deletedAt: '' } }).exec();
    const accountSelector = transactionSelector({ accountId: bankId });
    const accountRows = await db.transactions.find({ selector: accountSelector }).exec();
    expect(accountRows.length).toBeLessThan(scoped.length);
    expect(accountRows.every((row) => row.accountId === bankId && !row.deletedAt)).toBe(true);

    const newest = await transactionRepository.query({
      filters: { accountId: bankId },
      sort: 'newest',
      limit: 100,
      offset: 0,
    });
    expect(newest.map((item) => item.id)).toEqual(
      [...created, transfer].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).map((item) => item.id)
    );
    expect(newest.some((item) => item.id === doomed.id)).toBe(false);

    const page1 = await transactionRepository.query({
      filters: { accountId: bankId },
      sort: 'newest',
      limit: 2,
      offset: 0,
    });
    const page2 = await transactionRepository.query({
      filters: { accountId: bankId },
      sort: 'newest',
      limit: 2,
      offset: 2,
    });
    expect(page1.map((item) => item.id)).toEqual(newest.slice(0, 2).map((item) => item.id));
    expect(page2.map((item) => item.id)).toEqual(newest.slice(2, 4).map((item) => item.id));

    const searched = await transactionRepository.query({
      filters: { search: 'coffee 3' },
      sort: 'newest',
      limit: 40,
    });
    expect(searched).toHaveLength(1);
    expect(searched[0]?.title).toBe('Coffee 3');

    const expensesOnly = await transactionRepository.query({
      filters: { type: 'expense', accountId: bankId },
      sort: 'newest',
      limit: 100,
    });
    expect(expensesOnly.every((item) => item.type === 'expense' && !item.isTransfer)).toBe(true);
    expect(expensesOnly.some((item) => item.id === transfer.id)).toBe(false);

    const countAllBank = await transactionRepository.count({ filters: { accountId: bankId } });
    expect(countAllBank).toBe(newest.length);
    const countExpenses = await transactionRepository.count({ filters: { type: 'expense', accountId: bankId } });
    expect(countExpenses).toBe(expensesOnly.length);

    const totals = await transactionRepository.totals('2026-09-01', '2026-09-30');
    expect(totals.expenses).toBe(10000 + 20000 + 30000 + 40000 + 50000 + 99999);
    expect(totals.income).toBe(0);

    const categories = await transactionRepository.categoryTotals('expense', '2026-09-01', '2026-09-30');
    expect(categories[0]?.amount).toBe(totals.expenses);

    const daily = await transactionRepository.dailyTotals('expense', '2026-09-01', '2026-09-01');
    expect(daily).toEqual([{ date: '2026-09-01', amount: 10000 }]);

    const highest = await transactionRepository.highestExpense('2026-09-01', '2026-09-30');
    expect(highest?.amount).toBe(99999);
    expect(highest?.isTransfer).toBe(false);
  });

  it('computes account and credit-card balances from one ledger read', async () => {
    await transactionRepository.create(
      baseInput({
        categoryId,
        accountId: cardId,
        amount: 10000,
        title: 'Sept spend 1',
        date: '2026-09-03',
        paymentMethod: 'credit_card',
      })
    );
    await transactionRepository.create(
      baseInput({
        categoryId,
        accountId: cardId,
        amount: 43800,
        title: 'Sept spend 2',
        date: '2026-09-04',
        paymentMethod: 'credit_card',
      })
    );
    await transactionRepository.create(
      baseInput({
        categoryId,
        accountId: cardId,
        amount: 25501,
        title: 'Sept spend 3',
        date: '2026-09-05',
        paymentMethod: 'credit_card',
      })
    );
    await transactionRepository.create(
      baseInput({
        categoryId,
        accountId: cardId,
        amount: 85000,
        title: 'Sept spend 4',
        date: '2026-09-06',
        paymentMethod: 'credit_card',
      })
    );
    await transactionRepository.create(
      baseInput({
        categoryId,
        accountId: cardId,
        amount: 267900,
        title: 'Sept spend 5',
        date: '2026-09-07',
        paymentMethod: 'credit_card',
      })
    );
    await transactionRepository.create(
      baseInput({
        categoryId,
        accountId: cardId,
        type: 'income',
        amount: 2030288,
        title: 'Previous cycle payment',
        date: '2026-09-02',
        paymentMethod: 'bank_transfer',
        isTransfer: true,
        transferGroupId: 'pay-1',
        transferRole: 'destination',
      })
    );
    await transactionRepository.create(
      baseInput({
        categoryId,
        accountId: bankId,
        amount: 2030288,
        title: 'Previous cycle payment source',
        date: '2026-09-02',
        paymentMethod: 'bank_transfer',
        isTransfer: true,
        transferGroupId: 'pay-1',
        transferRole: 'source',
      })
    );

    const [listed, byId] = await Promise.all([accountService.list(true), accountService.getById(cardId)]);
    const card = listed.find((item) => item.id === cardId);
    expect(card).toBeDefined();
    expect(card?.outstanding).toBe(432201);
    expect(card?.availableCredit).toBe(6567799);
    expect(card?.utilizationPercent).toBe(6.17);
    expect(card?.expenditure).toBe(432201);
    expect(byId.outstanding).toBe(card?.outstanding);
    expect(byId.availableCredit).toBe(card?.availableCredit);
    expect(byId.utilizationPercent).toBe(card?.utilizationPercent);

    const bank = listed.find((item) => item.id === bankId);
    expect(bank?.currentBalance).toBe(5025000 - 2030288);
    expect(bank?.expenditure).toBe(0);

    const monthTotals = await transactionRepository.totals('2026-09-01', '2026-09-30');
    expect(monthTotals.expenses).toBe(432201);

    await investmentRepository.create({
      name: 'Index fund',
      type: 'mutual_fund',
      investedAmount: 100000,
      currentValue: 110000,
      investmentDate: '2026-01-15',
    });

    const dashboard = await reportService.dashboard(9, 2026);
    expect(dashboard.expenses).toBe(432201);
    expect(dashboard.income).toBe(0);
    expect(dashboard.previousExpenses).toBe(0);
    expect(dashboard.accounts.creditOutstanding).toBe(432201);
    expect(dashboard.accounts.availableCredit).toBe(6567799);
    expect(dashboard.investmentCount).toBe(1);
    expect(dashboard.investments.totalInvested).toBe(100000);
    expect(dashboard.investments.currentValue).toBe(110000);
    expect(dashboard).not.toHaveProperty('monthSeries');
    expect(dashboard.recent.map((item) => item.title)).toEqual([
      'Sept spend 5',
      'Sept spend 4',
      'Sept spend 3',
      'Sept spend 2',
      'Sept spend 1',
    ]);
    expect(dashboard.recent.every((item) => !item.isTransfer)).toBe(true);
  });
});

describe('finance revision', () => {
  it('bumps when a local mutation is queued', async () => {
    resetFinanceRevisionForTests();
    const before = getFinanceRevision();
    await queueChange('transaction', 't1', 'create', { id: 't1' });
    expect(getFinanceRevision()).toBe(before + 1);
  });
});
