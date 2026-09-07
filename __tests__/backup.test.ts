/// <reference types="jest" />
import { BACKUP_VERSION } from '@/utils/constants';
import { safeValidateBackup } from '@/utils/validation';

const valid = {
  version: BACKUP_VERSION,
  exportedAt: '2026-09-05T00:00:00.000Z',
  transactions: [],
  categories: [
    {
      id: 'cat-1',
      name: 'Food',
      icon: 'restaurant',
      color: '#F97316',
      type: 'expense',
      isDefault: true,
      createdAt: '2026-09-01T00:00:00.000Z',
    },
  ],
  budgets: [],
  recurringTransactions: [],
  settings: {
    id: 'default',
    currency: 'INR',
    currencySymbol: '₹',
    theme: 'system',
    firstDayOfWeek: 1,
    monthlyBudget: 3000000,
    onboardingComplete: true,
  },
};

describe('backup validation', () => {
  it('accepts a well-formed backup', () => {
    expect(safeValidateBackup(valid).success).toBe(true);
  });

  it('rejects missing categories and unknown versions', () => {
    expect(safeValidateBackup({ ...valid, categories: [] }).success).toBe(false);
    expect(safeValidateBackup({ ...valid, version: 99 }).success).toBe(false);
    expect(safeValidateBackup({ hello: 'world' }).success).toBe(false);
  });

  it('accepts pre-account backups and defaults accounts to []', () => {
    const parsed = safeValidateBackup(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.accounts).toEqual([]);
    }
  });

  it('accepts backups that include accounts and transaction account ids', () => {
    const parsed = safeValidateBackup({
      ...valid,
      accounts: [
        {
          id: 'acc-1',
          name: 'HDFC Bank',
          type: 'bank',
          institutionName: 'HDFC',
          currency: 'INR',
          openingBalance: 5000000,
          creditLimit: null,
          isActive: true,
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
      transactions: [
        {
          id: 'tx-1',
          type: 'expense',
          amount: 250000,
          categoryId: 'cat-1',
          title: 'Dinner',
          description: null,
          date: '2026-09-05',
          paymentMethod: 'upi',
          notes: null,
          isRecurring: false,
          recurringId: null,
          accountId: 'acc-1',
          isTransfer: false,
          transferGroupId: null,
          transferRole: null,
          createdAt: '2026-09-05T00:00:00.000Z',
          updatedAt: '2026-09-05T00:00:00.000Z',
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});
