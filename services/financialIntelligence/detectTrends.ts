import { percentChange } from '@/utils/calculations';
import { aggregateCategorySpend, aggregatePeriodTotals } from './aggregateSpending';
import { previousPeriod } from './periodBounds';
import type { Period, SnapshotCategory, SnapshotTransaction, TrendSignal } from './types';

export function detectTrends(
  transactions: SnapshotTransaction[],
  period: Period,
  categories: SnapshotCategory[],
  now: Date
): TrendSignal[] {
  const previous = previousPeriod(period);
  const currentTotals = aggregatePeriodTotals(transactions, period, now);
  const previousTotals = aggregatePeriodTotals(transactions, previous, now);
  const signals: TrendSignal[] = [
    {
      kind: 'expense_change',
      label: 'Expenses vs prior month',
      currentMinor: currentTotals.expenseMinor,
      previousMinor: previousTotals.expenseMinor,
      percentChange: percentChange(currentTotals.expenseMinor, previousTotals.expenseMinor),
    },
    {
      kind: 'income_change',
      label: 'Income vs prior month',
      currentMinor: currentTotals.incomeMinor,
      previousMinor: previousTotals.incomeMinor,
      percentChange: percentChange(currentTotals.incomeMinor, previousTotals.incomeMinor),
    },
    {
      kind: 'net_change',
      label: 'Net vs prior month',
      currentMinor: currentTotals.netMinor,
      previousMinor: previousTotals.netMinor,
      percentChange: percentChange(currentTotals.netMinor, previousTotals.netMinor),
    },
  ];

  const currentCats = aggregateCategorySpend(transactions, period, categories, 5).rows;
  const previousCats = new Map(
    aggregateCategorySpend(transactions, previous, categories, 50).rows.map((row) => [
      row.categoryId,
      row.amountMinor,
    ])
  );

  const categorySignals: TrendSignal[] = currentCats.slice(0, 3).map((row) => {
    const prevAmount = previousCats.get(row.categoryId) ?? 0;
    return {
      kind: 'category_change' as const,
      label: `${row.categoryName} vs prior month`,
      currentMinor: row.amountMinor,
      previousMinor: prevAmount,
      percentChange: percentChange(row.amountMinor, prevAmount),
      categoryId: row.categoryId,
    };
  });

  categorySignals.sort(
    (a, b) =>
      Math.abs(b.percentChange ?? 0) - Math.abs(a.percentChange ?? 0) ||
      (a.categoryId ?? '').localeCompare(b.categoryId ?? '') ||
      a.label.localeCompare(b.label)
  );

  return [...signals, ...categorySignals];
}
