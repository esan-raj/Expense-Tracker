/// <reference types="jest" />
import { resetFinanceRevisionForTests } from '@/services/financeRevision';
import {
  aggregatePeriodTotals,
  buildFinancialSnapshot,
  detectAnomalies,
  detectRecurringPatterns,
  resolveOverallBudgetMinor,
} from '@/services/financialIntelligence';
import type { FinancialSnapshotInput, SnapshotBudget, SnapshotCategory, SnapshotTransaction } from '@/services/financialIntelligence';

const period = { month: 9, year: 2026 };

const categories: SnapshotCategory[] = [
  { id: 'food', name: 'Food', type: 'expense' },
  { id: 'rent', name: 'Rent', type: 'expense' },
  { id: 'salary', name: 'Salary', type: 'income' },
];

function budget(partial: Partial<SnapshotBudget> & Pick<SnapshotBudget, 'categoryId' | 'amount'>): SnapshotBudget {
  return {
    id: partial.id ?? `b-${partial.categoryId ?? 'overall'}-${partial.month ?? period.month}`,
    categoryId: partial.categoryId,
    amount: partial.amount,
    month: partial.month ?? period.month,
    year: partial.year ?? period.year,
  };
}

const baseTransactions: SnapshotTransaction[] = [
  { type: 'income', amount: 8_000_000, categoryId: 'salary', title: 'Salary', date: '2026-09-01' },
  { type: 'expense', amount: 2_000_000, categoryId: 'rent', title: 'Rent', date: '2026-09-02' },
  { type: 'expense', amount: 400_000, categoryId: 'food', title: 'CITY CAFE', date: '2026-09-03' },
  { type: 'expense', amount: 420_000, categoryId: 'food', title: 'CITY CAFE', date: '2026-09-10' },
  { type: 'expense', amount: 390_000, categoryId: 'food', title: 'CITY CAFE', date: '2026-09-17', isRecurring: true },
  { type: 'expense', amount: 50_000, categoryId: 'food', title: 'Snack', date: '2026-09-05' },
  { type: 'expense', amount: 2_500_000, categoryId: 'food', title: 'Catering', date: '2026-09-20' },
  { type: 'expense', amount: 500_000, categoryId: 'food', title: 'Transfer out', date: '2026-09-08', isTransfer: true },
  { type: 'income', amount: 500_000, categoryId: 'salary', title: 'Transfer in', date: '2026-09-08', isTransfer: true },
  // prior months for baseline / trends
  { type: 'expense', amount: 1_800_000, categoryId: 'rent', title: 'Rent', date: '2026-08-02' },
  { type: 'expense', amount: 350_000, categoryId: 'food', title: 'CITY CAFE', date: '2026-08-05' },
  { type: 'income', amount: 8_000_000, categoryId: 'salary', title: 'Salary', date: '2026-08-01' },
  { type: 'expense', amount: 1_800_000, categoryId: 'rent', title: 'Rent', date: '2026-07-02' },
  { type: 'expense', amount: 300_000, categoryId: 'food', title: 'CITY CAFE', date: '2026-07-05' },
];

function input(overrides: Partial<FinancialSnapshotInput> = {}): FinancialSnapshotInput {
  return {
    period,
    currency: 'INR',
    settingsMonthlyBudget: null,
    budgets: [],
    categories,
    transactions: baseTransactions,
    lookbackMonths: 3,
    now: new Date('2026-10-01T12:00:00.000Z'),
    financeRevision: 0,
    ...overrides,
  };
}

beforeEach(() => {
  resetFinanceRevisionForTests();
});

describe('resolveOverallBudgetMinor', () => {
  it('uses settings when only settings value exists', () => {
    expect(
      resolveOverallBudgetMinor({
        period,
        budgets: [],
        settingsMonthlyBudget: 7_000_000,
      })
    ).toEqual({ amountMinor: 7_000_000, source: 'settings_fallback' });
  });

  it('uses the null-category budget row when only that exists', () => {
    expect(
      resolveOverallBudgetMinor({
        period,
        budgets: [budget({ categoryId: null, amount: 6_500_000 })],
        settingsMonthlyBudget: null,
      })
    ).toEqual({ amountMinor: 6_500_000, source: 'budget_row' });
  });

  it('prefers the budget row when both exist with different values', () => {
    expect(
      resolveOverallBudgetMinor({
        period,
        budgets: [budget({ categoryId: null, amount: 6_500_000 })],
        settingsMonthlyBudget: 9_999_999,
      })
    ).toEqual({ amountMinor: 6_500_000, source: 'budget_row' });
  });

  it('returns none when neither exists', () => {
    expect(
      resolveOverallBudgetMinor({
        period,
        budgets: [],
        settingsMonthlyBudget: null,
      })
    ).toEqual({ amountMinor: null, source: 'none' });
    expect(
      resolveOverallBudgetMinor({
        period,
        budgets: [],
        settingsMonthlyBudget: 0,
      })
    ).toEqual({ amountMinor: null, source: 'none' });
  });

  it('ignores category budgets when resolving overall and still returns none/fallback', () => {
    expect(
      resolveOverallBudgetMinor({
        period,
        budgets: [budget({ categoryId: 'food', amount: 500_000 })],
        settingsMonthlyBudget: null,
      })
    ).toEqual({ amountMinor: null, source: 'none' });

    expect(
      resolveOverallBudgetMinor({
        period,
        budgets: [budget({ categoryId: 'food', amount: 500_000 })],
        settingsMonthlyBudget: 7_000_000,
      })
    ).toEqual({ amountMinor: 7_000_000, source: 'settings_fallback' });
  });
});

describe('aggregatePeriodTotals', () => {
  it('excludes transfers from income and expenses', () => {
    const totals = aggregatePeriodTotals(baseTransactions, period);
    expect(totals.incomeMinor).toBe(8_000_000);
    expect(totals.expenseMinor).toBe(2_000_000 + 400_000 + 420_000 + 390_000 + 50_000 + 2_500_000);
  });
});

describe('detectRecurringPatterns / detectAnomalies', () => {
  it('detects repeated merchant titles and recurring flags', () => {
    const patterns = detectRecurringPatterns(baseTransactions, period, 3);
    const cafe = patterns.find((item) => item.titleKey === 'city cafe');
    expect(cafe).toEqual(
      expect.objectContaining({
        occurrenceCount: expect.any(Number),
        markedRecurring: true,
      })
    );
    expect(cafe!.occurrenceCount).toBeGreaterThanOrEqual(3);
  });

  it('flags an expense far above the category baseline', () => {
    const anomalies = detectAnomalies(baseTransactions, period, categories);
    expect(anomalies.some((item) => item.title === 'Catering')).toBe(true);
  });
});

describe('buildFinancialSnapshot', () => {
  it('builds a deterministic snapshot with transferExcluded and budget_row overall', () => {
    const snapshot = buildFinancialSnapshot(
      input({
        budgets: [
          budget({ categoryId: null, amount: 7_000_000 }),
          budget({ categoryId: 'food', amount: 1_000_000 }),
        ],
        settingsMonthlyBudget: 9_000_000,
      })
    );

    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.overallBudget).toEqual({ amountMinor: 7_000_000, source: 'budget_row' });
    expect(snapshot.flags.transferExcluded).toBe(true);
    expect(snapshot.flags.hasExpenses).toBe(true);
    expect(snapshot.totals.expenseMinor).toBe(5_760_000);
    expect(snapshot.budgets.find((item) => item.categoryId === null)?.source).toBe('budget_row');
    expect(snapshot.budgets.some((item) => item.categoryId === 'food')).toBe(true);
    expect(snapshot.previousPeriod).not.toBeNull();
    expect(snapshot.budgetBaseline.overall.source).toBe('budget_row');
    expect(snapshot.contentRevision).toMatch(/^[0-9a-f]{8}$/);
  });

  it('falls back to settings overall budget and keeps category budgets', () => {
    const snapshot = buildFinancialSnapshot(
      input({
        budgets: [budget({ categoryId: 'food', amount: 1_000_000 })],
        settingsMonthlyBudget: 6_000_000,
      })
    );
    expect(snapshot.overallBudget.source).toBe('settings_fallback');
    expect(snapshot.budgets.find((item) => item.categoryId === null)?.budgetMinor).toBe(6_000_000);
    expect(snapshot.budgets.find((item) => item.categoryId === 'food')).toBeTruthy();
  });

  it('marks insufficient data when the period is empty', () => {
    const snapshot = buildFinancialSnapshot(
      input({
        transactions: [{ type: 'expense', amount: 100, categoryId: 'food', title: 'Old', date: '2025-01-01' }],
      })
    );
    expect(snapshot.flags.insufficientData).toBe(true);
    expect(snapshot.flags.hasExpenses).toBe(false);
  });

  it('is stable for the same inputs', () => {
    const a = buildFinancialSnapshot(input({ snapshotId: 'fixed' }));
    const b = buildFinancialSnapshot(input({ snapshotId: 'fixed' }));
    expect(a.contentRevision).toBe(b.contentRevision);
    expect(a.totals).toEqual(b.totals);
    expect(a.snapshotId).toBe('fixed');
  });
});
