/// <reference types="jest" />
import { resetFinanceRevisionForTests } from '@/services/financeRevision';
import {
  AI_SAFE_MAX_UTF8_BYTES,
  adaptFinancialSnapshotInput,
  aggregatePeriodTotals,
  buildAiSafeFinancialSnapshot,
  buildFinancialSnapshot,
  collectProhibitedPaths,
  computeContentRevision,
  detectAnomalies,
  detectRecurringPatterns,
  FinancialSnapshotValidationError,
  resolveOverallBudgetMinor,
  utf8ByteLength,
} from '@/services/financialIntelligence';
import type {
  FinancialSnapshotInput,
  SnapshotBudget,
  SnapshotCategory,
  SnapshotTransaction,
} from '@/services/financialIntelligence';

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
  { type: 'expense', amount: 25_000, categoryId: 'food', title: 'Cash tea', date: '2026-09-06', paymentMethod: 'cash' },
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
    now: new Date(2026, 9, 1, 12, 0, 0), // local Oct 1 2026 — September completed
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

  it('ignores category budgets when resolving overall', () => {
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

describe('aggregatePeriodTotals period status', () => {
  const septemberExpense =
    2_000_000 + 400_000 + 420_000 + 390_000 + 50_000 + 2_500_000 + 25_000;

  it('excludes transfers and includes cash', () => {
    const totals = aggregatePeriodTotals(baseTransactions, period, new Date(2026, 9, 1));
    expect(totals.incomeMinor).toBe(8_000_000);
    expect(totals.expenseMinor).toBe(septemberExpense);
  });

  it('uses elapsed days for the active month and projects month-end', () => {
    const now = new Date(2026, 8, 15, 12, 0, 0); // Sep 15 local
    const totals = aggregatePeriodTotals(baseTransactions, period, now);
    expect(totals.averageDailyMethod).toBe('elapsed_days');
    expect(totals.divisorDays).toBe(15);
    expect(totals.averageDailyExpenseMinor).toBe(Math.round(septemberExpense / 15));
    expect(totals.projectedMonthEndMethod).toBe('linear_elapsed');
    expect(totals.projectedMonthEndExpenseMinor).toBe(Math.round((septemberExpense * 30) / 15));
  });

  it('uses full month days for a completed month', () => {
    const now = new Date(2026, 9, 1, 12, 0, 0);
    const totals = aggregatePeriodTotals(baseTransactions, period, now);
    expect(totals.averageDailyMethod).toBe('full_month');
    expect(totals.divisorDays).toBe(30);
    expect(totals.averageDailyExpenseMinor).toBe(Math.round(septemberExpense / 30));
    expect(totals.projectedMonthEndMethod).toBe('unavailable');
    expect(totals.projectedMonthEndExpenseMinor).toBeNull();
  });

  it('marks future month averages and projections unavailable', () => {
    const now = new Date(2026, 7, 15, 12, 0, 0); // Aug 15 — September is future
    const totals = aggregatePeriodTotals(baseTransactions, period, now);
    expect(totals.averageDailyMethod).toBe('unavailable');
    expect(totals.averageDailyExpenseMinor).toBeNull();
    expect(totals.projectedMonthEndMethod).toBe('unavailable');
    expect(totals.projectedMonthEndExpenseMinor).toBeNull();
    expect(totals.divisorDays).toBeNull();
  });

  it('handles leap-year February length', () => {
    const leapPeriod = { month: 2, year: 2024 };
    const txs: SnapshotTransaction[] = [
      { type: 'expense', amount: 2_900_000, categoryId: 'food', title: 'Food', date: '2024-02-10' },
    ];
    const completed = aggregatePeriodTotals(txs, leapPeriod, new Date(2024, 2, 1));
    expect(completed.divisorDays).toBe(29);
    expect(completed.averageDailyExpenseMinor).toBe(Math.round(2_900_000 / 29));

    const active = aggregatePeriodTotals(txs, leapPeriod, new Date(2024, 1, 10));
    expect(active.divisorDays).toBe(10);
    expect(active.projectedMonthEndExpenseMinor).toBe(Math.round((2_900_000 * 29) / 10));
  });

  it('handles January/December previous-period transition', () => {
    const jan = { month: 1, year: 2026 };
    const txs: SnapshotTransaction[] = [
      { type: 'expense', amount: 100_000, categoryId: 'food', title: 'A', date: '2026-01-05' },
      { type: 'expense', amount: 200_000, categoryId: 'food', title: 'B', date: '2025-12-05' },
    ];
    const now = new Date(2026, 1, 1);
    const current = aggregatePeriodTotals(txs, jan, now);
    const previous = aggregatePeriodTotals(txs, { month: 12, year: 2025 }, now);
    expect(current.expenseMinor).toBe(100_000);
    expect(previous.expenseMinor).toBe(200_000);
  });
});

describe('detectRecurringPatterns / detectAnomalies', () => {
  it('detects repeated merchant titles locally', () => {
    const patterns = detectRecurringPatterns(baseTransactions, period, 3, categories);
    const cafe = patterns.find((item) => item.titleKey === 'city cafe');
    expect(cafe).toEqual(
      expect.objectContaining({
        occurrenceCount: expect.any(Number),
        markedRecurring: true,
        sampleTitle: expect.any(String),
      })
    );
    expect(cafe!.occurrenceCount).toBeGreaterThanOrEqual(3);
  });

  it('flags an expense far above the category baseline with explainable evidence', () => {
    const anomalies = detectAnomalies(baseTransactions, period, categories);
    const catering = anomalies.find((item) => item.title === 'Catering');
    expect(catering).toBeTruthy();
    expect(catering!.multipleOfBaseline).toBeGreaterThanOrEqual(2.5);
    expect(catering!.baselineAverageMinor).toBeGreaterThan(0);
  });
});

describe('confirmed Phase 2 gaps', () => {
  it('local snapshot may retain titles but AI-safe must not', () => {
    const local = buildFinancialSnapshot(input({ snapshotId: 'fixed' }));
    expect(local.kind).toBe('local');
    expect(JSON.stringify(local)).toMatch(/CITY CAFE|Catering|city cafe/i);

    const ai = buildAiSafeFinancialSnapshot(local);
    expect(ai.kind).toBe('ai_safe');
    expect(collectProhibitedPaths(ai)).toEqual([]);
    expect(JSON.stringify(ai)).not.toMatch(/CITY CAFE|Catering|city cafe|Snack|Cash tea/i);
  });

  it('contentRevision differs for materially different transaction sets', () => {
    const a = computeContentRevision(input());
    const b = computeContentRevision(
      input({
        transactions: [
          ...baseTransactions,
          { type: 'expense', amount: 1, categoryId: 'food', title: 'x', date: '2026-09-21' },
        ],
      })
    );
    expect(a).not.toBe(b);
  });

  it('contentRevision is stable under reordered inputs and ignores now', () => {
    const ordered = input();
    const reordered = input({
      transactions: [...baseTransactions].reverse(),
      budgets: [budget({ categoryId: 'food', amount: 1 }), budget({ categoryId: null, amount: 2 })].reverse(),
      categories: [...categories].reverse(),
      now: new Date(2099, 0, 1),
    });
    // Match budgets for fair comparison
    const withBudgets = input({
      budgets: [budget({ categoryId: 'food', amount: 1 }), budget({ categoryId: null, amount: 2 })],
      now: new Date(2000, 0, 1),
    });
    expect(computeContentRevision(reordered)).toBe(computeContentRevision(withBudgets));
    expect(computeContentRevision(ordered)).toBe(
      computeContentRevision(input({ now: new Date(1999, 5, 5) }))
    );
  });

  it('contentRevision changes when analytics-relevant fields change', () => {
    const base = computeContentRevision(input());
    expect(computeContentRevision(input({ period: { month: 8, year: 2026 } }))).not.toBe(base);
    expect(computeContentRevision(input({ currency: 'USD' }))).not.toBe(base);
    expect(computeContentRevision(input({ settingsMonthlyBudget: 1 }))).not.toBe(base);
    expect(computeContentRevision(input({ lookbackMonths: 4 }))).not.toBe(base);
    expect(computeContentRevision(input({ accountScopeId: 'acc-1' }))).not.toBe(base);
    expect(
      computeContentRevision(
        input({
          transactions: baseTransactions.map((row, index) =>
            index === 1 ? { ...row, amount: row.amount + 1 } : row
          ),
        })
      )
    ).not.toBe(base);
    expect(
      computeContentRevision(
        input({
          transactions: baseTransactions.map((row, index) =>
            index === 1 ? { ...row, date: '2026-09-04' } : row
          ),
        })
      )
    ).not.toBe(base);
    expect(
      computeContentRevision(
        input({
          transactions: baseTransactions.map((row, index) =>
            index === 1 ? { ...row, categoryId: 'food' } : row
          ),
        })
      )
    ).not.toBe(base);
    expect(
      computeContentRevision(
        input({
          transactions: baseTransactions.map((row, index) =>
            index === 1 ? { ...row, isTransfer: true } : row
          ),
        })
      )
    ).not.toBe(base);
    expect(
      computeContentRevision(
        input({
          transactions: baseTransactions.map((row, index) =>
            index === 2 ? { ...row, title: 'OTHER CAFE' } : row
          ),
        })
      )
    ).not.toBe(base);
    expect(
      computeContentRevision(input({ budgets: [budget({ categoryId: null, amount: 1 })] }))
    ).not.toBe(base);
    expect(
      computeContentRevision(
        input({ categories: [...categories, { id: 'travel', name: 'Travel', type: 'expense' }] })
      )
    ).not.toBe(base);
  });

  it('reordered inputs produce byte-equivalent AI-safe JSON except volatile metadata', () => {
    const a = buildAiSafeFinancialSnapshot(
      buildFinancialSnapshot(input({ snapshotId: 'fixed', now: new Date(2026, 9, 1, 12, 0, 0) }))
    );
    const b = buildAiSafeFinancialSnapshot(
      buildFinancialSnapshot(
        input({
          snapshotId: 'fixed',
          now: new Date(2026, 9, 1, 12, 0, 0),
          transactions: [...baseTransactions].reverse(),
          categories: [...categories].reverse(),
        })
      )
    );
    const strip = (snap: typeof a) => {
      const { snapshotComputedAt: _c, truncation, ...rest } = snap;
      return { ...rest, truncation: { ...truncation, utf8Bytes: 0 } };
    };
    expect(JSON.stringify(strip(a))).toBe(JSON.stringify(strip(b)));
  });
});

describe('buildFinancialSnapshot', () => {
  it('builds a local snapshot with transferExcluded and budget_row overall', () => {
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
    expect(snapshot.kind).toBe('local');
    expect(snapshot.periodStatus).toBe('completed');
    expect(snapshot.overallBudget).toEqual({ amountMinor: 7_000_000, source: 'budget_row' });
    expect(snapshot.flags.transferExcluded).toBe(true);
    expect(snapshot.flags.hasExpenses).toBe(true);
    expect(snapshot.totals.expenseMinor).toBe(5_785_000);
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

  it('covers empty, income-only, and expense-only months', () => {
    expect(
      buildFinancialSnapshot(input({ transactions: [] })).flags.insufficientData
    ).toBe(true);

    const incomeOnly = buildFinancialSnapshot(
      input({
        transactions: [
          { type: 'income', amount: 1000, categoryId: 'salary', title: 'Pay', date: '2026-09-01' },
        ],
      })
    );
    expect(incomeOnly.flags.hasIncome).toBe(true);
    expect(incomeOnly.flags.hasExpenses).toBe(false);

    const expenseOnly = buildFinancialSnapshot(
      input({
        transactions: [
          { type: 'expense', amount: 1000, categoryId: 'food', title: 'Food', date: '2026-09-01' },
        ],
      })
    );
    expect(expenseOnly.flags.hasIncome).toBe(false);
    expect(expenseOnly.flags.hasExpenses).toBe(true);
  });

  it('reports budget usage at 0%, below 100%, exactly 100%, and above 100%', () => {
    const spentFood = 400_000;
    const cases = [
      { budgetAmount: 400_000, expectPercent: 100 },
      { budgetAmount: 800_000, expectPercent: 50 },
      { budgetAmount: 200_000, expectPercent: 200 },
      { budgetAmount: 1, expectPercent: 40000000 },
    ];
    for (const item of cases) {
      const snap = buildFinancialSnapshot(
        input({
          transactions: [
            { type: 'expense', amount: spentFood, categoryId: 'food', title: 'Food', date: '2026-09-03' },
          ],
          budgets: [budget({ categoryId: 'food', amount: item.budgetAmount })],
        })
      );
      expect(snap.budgets.find((row) => row.categoryId === 'food')?.percent).toBe(item.expectPercent);
    }

    const zeroSpend = buildFinancialSnapshot(
      input({
        transactions: [],
        budgets: [budget({ categoryId: 'food', amount: 100_000 })],
      })
    );
    expect(zeroSpend.budgets.find((row) => row.categoryId === 'food')?.percent).toBe(0);
  });

  it('sets previousPeriod null when prior month has zero activity', () => {
    const snap = buildFinancialSnapshot(
      input({
        transactions: [
          { type: 'expense', amount: 1000, categoryId: 'food', title: 'Food', date: '2026-09-01' },
        ],
      })
    );
    expect(snap.previousPeriod).toBeNull();
  });

  it('is stable for the same inputs', () => {
    const a = buildFinancialSnapshot(input({ snapshotId: 'fixed' }));
    const b = buildFinancialSnapshot(input({ snapshotId: 'fixed' }));
    expect(a.contentRevision).toBe(b.contentRevision);
    expect(a.totals).toEqual(b.totals);
    expect(a.snapshotId).toBe('fixed');
  });
});

describe('adaptFinancialSnapshotInput', () => {
  it('skips soft-deleted and invalid rows; rejects bad period/currency', () => {
    const { input: adapted, dataQuality } = adaptFinancialSnapshotInput({
      period,
      currency: 'INR',
      settingsMonthlyBudget: 0,
      transactions: [
        {
          type: 'expense',
          amount: 100,
          categoryId: 'food',
          title: 'Ok',
          date: '2026-09-01',
          paymentMethod: 'cash',
          isTransfer: false,
          isRecurring: false,
        },
        {
          type: 'expense',
          amount: 100,
          categoryId: 'food',
          title: 'Gone',
          date: '2026-09-01',
          deletedAt: '2026-09-02T00:00:00.000Z',
        },
        { type: 'expense', amount: -5, categoryId: 'food', title: 'Bad', date: '2026-09-01' },
        { type: 'expense', amount: 1, categoryId: 'food', title: 'BadDate', date: '2026-13-40' },
      ],
      budgets: [
        { id: 'b1', categoryId: null, amount: 100, month: 9, year: 2026 },
        { id: 'b2', categoryId: null, amount: 100, month: 9, year: 2026, deletedAt: 'x' },
      ],
      categories,
    });

    expect(adapted.transactions).toHaveLength(1);
    expect(dataQuality.skippedDeletedTransactions).toBe(1);
    expect(dataQuality.skippedInvalidTransactions).toBe(2);
    expect(dataQuality.skippedDeletedBudgets).toBe(1);

    expect(() =>
      adaptFinancialSnapshotInput({
        period: { month: 13, year: 2026 },
        currency: 'INR',
        settingsMonthlyBudget: null,
        transactions: [],
        budgets: [],
        categories: [],
      })
    ).toThrow(FinancialSnapshotValidationError);

    expect(() =>
      adaptFinancialSnapshotInput({
        period,
        currency: 'rupee',
        settingsMonthlyBudget: null,
        transactions: [],
        budgets: [],
        categories: [],
      })
    ).toThrow(FinancialSnapshotValidationError);
  });

  it('clamps lookback and documents global currency assumption', () => {
    const { input: adapted } = adaptFinancialSnapshotInput({
      period,
      currency: 'INR',
      settingsMonthlyBudget: null,
      lookbackMonths: 99,
      transactions: [],
      budgets: [],
      categories: [],
    });
    expect(adapted.lookbackMonths).toBe(24);
  });

  it('rejects unsafe aggregate overflow near MAX_SAFE_INTEGER', () => {
    const huge = Number.MAX_SAFE_INTEGER - 10;
    expect(() =>
      buildFinancialSnapshot(
        input({
          transactions: [
            { type: 'expense', amount: huge, categoryId: 'food', title: 'A', date: '2026-09-01' },
            { type: 'expense', amount: huge, categoryId: 'food', title: 'B', date: '2026-09-02' },
          ],
        })
      )
    ).toThrow(FinancialSnapshotValidationError);
  });
});

describe('AI-safe size boundary', () => {
  it('keeps representative AI-safe snapshots within 8 KiB UTF-8', () => {
    const local = buildFinancialSnapshot(
      input({
        budgets: [
          budget({ categoryId: null, amount: 7_000_000 }),
          budget({ categoryId: 'food', amount: 1_000_000 }),
        ],
        settingsMonthlyBudget: 9_000_000,
      })
    );
    const ai = buildAiSafeFinancialSnapshot(local);
    expect(ai.truncation.utf8Bytes).toBeLessThanOrEqual(AI_SAFE_MAX_UTF8_BYTES);
    expect(ai.truncation.utf8Bytes).toBe(utf8ByteLength(JSON.stringify(ai)));
    expect(collectProhibitedPaths(ai)).toEqual([]);
  });

  it('truncates deterministically for oversized local-derived payloads', () => {
    const manyCategories: SnapshotCategory[] = Array.from({ length: 40 }, (_, i) => ({
      id: `c${String(i).padStart(2, '0')}`,
      name: `Category-${i}-with-a-fairly-long-label-for-size`,
      type: 'expense' as const,
    }));
    const manyTx: SnapshotTransaction[] = [];
    for (let i = 0; i < 40; i += 1) {
      for (let d = 1; d <= 8; d += 1) {
        manyTx.push({
          type: 'expense',
          amount: 10_000 + i * 100 + d,
          categoryId: manyCategories[i].id,
          title: `Merchant ${i} day ${d} UNIQUE-${i}-${d}`,
          date: `2026-09-${String(d).padStart(2, '0')}`,
          isRecurring: d === 1,
        });
      }
    }
    const local = buildFinancialSnapshot(
      input({
        categories: manyCategories,
        transactions: manyTx,
        budgets: manyCategories.map((category, index) =>
          budget({ id: `b-${category.id}`, categoryId: category.id, amount: 100_000 + index })
        ),
        lookbackMonths: 6,
      })
    );
    const ai = buildAiSafeFinancialSnapshot(local);
    expect(ai.truncation.utf8Bytes).toBeLessThanOrEqual(AI_SAFE_MAX_UTF8_BYTES);
    expect(collectProhibitedPaths(ai)).toEqual([]);
  });
});
