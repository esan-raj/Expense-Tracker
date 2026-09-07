/// <reference types="jest" />
import {
  calculateAccountBalances,
  excludeTransfers,
  matchesAccountFilter,
  resolveRestoredAccountId,
  signedAccountDelta,
  summarizeAccounts,
} from '@/utils/accountLogic';
import { accountFormSchema, transactionFormSchema } from '@/utils/validation';
import { calculateTotalExpenses, calculateTotalIncome } from '@/utils/calculations';

const bank = {
  id: 'bank-1',
  name: 'HDFC Bank',
  type: 'bank' as const,
  institutionName: 'HDFC',
  currency: 'INR' as const,
  openingBalance: 5025000,
  creditLimit: null,
  isActive: true,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const card = {
  ...bank,
  id: 'card-1',
  name: 'HDFC Credit Card',
  type: 'credit_card' as const,
  openingBalance: 0,
  creditLimit: 5000000,
};

describe('account validation', () => {
  it('requires a name and a credit limit for cards', () => {
    expect(
      accountFormSchema.safeParse({
        type: 'bank',
        name: 'HDFC Bank',
        institutionName: 'HDFC',
        openingBalance: 50000,
      }).success
    ).toBe(true);
    expect(
      accountFormSchema.safeParse({
        type: 'credit_card',
        name: 'HDFC Credit Card',
        openingBalance: 0,
      }).success
    ).toBe(false);
    expect(
      accountFormSchema.safeParse({
        type: 'credit_card',
        name: 'HDFC Credit Card',
        openingBalance: 0,
        creditLimit: -1,
      }).success
    ).toBe(false);
  });
});

describe('bank and card balances', () => {
  it('increases a bank on income and decreases it on expense', () => {
    const balances = calculateAccountBalances(bank, [
      { type: 'income', amount: 100000, accountId: bank.id },
      { type: 'expense', amount: 25000, accountId: bank.id },
    ]);
    expect(balances.currentBalance).toBe(5100000);
    expect(balances.outstanding).toBe(0);
  });

  it('treats a credit-card purchase as outstanding, not cash', () => {
    const balances = calculateAccountBalances(card, [{ type: 'expense', amount: 1240000, accountId: card.id }]);
    expect(balances.outstanding).toBe(1240000);
    expect(balances.availableCredit).toBe(3760000);
    expect(balances.currentBalance).toBe(-1240000);
  });

  it('reduces card outstanding on refund and payment transfer', () => {
    const afterPurchase = calculateAccountBalances(card, [
      { type: 'expense', amount: 1240000, accountId: card.id },
      { type: 'income', amount: 40000, accountId: card.id },
      { type: 'expense', amount: 500000, accountId: card.id, isTransfer: true, transferRole: 'destination' },
    ]);
    expect(afterPurchase.outstanding).toBe(700000);
    expect(afterPurchase.availableCredit).toBe(4300000);
  });

  it('moves money on a bank-to-card transfer without treating it as spending', () => {
    const source = signedAccountDelta('bank', {
      type: 'expense',
      amount: 500000,
      isTransfer: true,
      transferRole: 'source',
    });
    const dest = signedAccountDelta('credit_card', {
      type: 'income',
      amount: 500000,
      isTransfer: true,
      transferRole: 'destination',
    });
    expect(source).toBe(-500000);
    expect(dest).toBe(-500000);
    const reportable = excludeTransfers([
      { type: 'expense' as const, amount: 500000, isTransfer: true },
      { type: 'expense' as const, amount: 3250000, isTransfer: false },
    ]);
    expect(calculateTotalExpenses(reportable)).toBe(3250000);
    expect(calculateTotalIncome([{ type: 'income', amount: 500000, isTransfer: true }])).toBe(0);
  });

  it('keeps bank cash and card debt separate in the dashboard summary', () => {
    const summary = summarizeAccounts([
      {
        ...bank,
        entries: [{ type: 'expense', amount: 500000, isTransfer: true, transferRole: 'source' }],
      },
      {
        ...card,
        entries: [
          { type: 'expense', amount: 1240000 },
          { type: 'expense', amount: 500000, isTransfer: true, transferRole: 'destination' },
        ],
      },
    ]);
    expect(summary.bankBalance).toBe(4525000);
    expect(summary.creditOutstanding).toBe(740000);
    expect(summary.availableCredit).toBe(4260000);
  });
});

describe('legacy transactions and filters', () => {
  it('leaves transactions without an account unassigned', () => {
    expect(resolveRestoredAccountId(null, ['acc-1'])).toBeNull();
    expect(resolveRestoredAccountId('missing', ['acc-1'])).toBeNull();
    expect(resolveRestoredAccountId('acc-1', ['acc-1'])).toBe('acc-1');
  });

  it('filters by account without dropping unfiltered rows', () => {
    expect(matchesAccountFilter(null)).toBe(true);
    expect(matchesAccountFilter('acc-1', 'acc-1')).toBe(true);
    expect(matchesAccountFilter('acc-2', 'acc-1')).toBe(false);
    expect(matchesAccountFilter(null, 'acc-1')).toBe(false);
  });
});

describe('transaction form transfers', () => {
  it('does not require a category for transfers and does require two accounts', () => {
    const transfer = transactionFormSchema.safeParse({
      entryType: 'transfer',
      type: 'expense',
      amount: 5000,
      title: 'Card payment',
      date: '2026-09-05',
      paymentMethod: 'bank_transfer',
      isRecurring: false,
      sourceAccountId: 'bank-1',
      destinationAccountId: 'card-1',
    });
    expect(transfer.success).toBe(true);

    const missingCategory = transactionFormSchema.safeParse({
      entryType: 'expense',
      type: 'expense',
      amount: 2500,
      title: 'Dinner',
      date: '2026-09-05',
      paymentMethod: 'upi',
      isRecurring: false,
      accountId: 'card-1',
    });
    expect(missingCategory.success).toBe(false);
  });
});
