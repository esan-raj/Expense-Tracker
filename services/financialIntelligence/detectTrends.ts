import { percentChange } from '@/utils/calculations';
import { aggregateCategorySpend, aggregatePeriodTotals } from './aggregateSpending';
import { previousPeriod } from './periodBounds';
import type { Period, SnapshotCategory, SnapshotTransaction, TrendSignal } from './types';

export function detectTrends(
  transactions: SnapshotTransaction[],
  period: Period,
  categories: SnapshotCategory[]
): TrendSignal[] {
  const previous = previousPeriod(period);
  const currentTotals = aggregatePeriodTotals(transactions, period);
  const previousTotals = aggregatePeriodTotals(transactions, previous);
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

  const currentCats = aggregateCategorySpend(transactions, period, categories, 5);
  const previousCats = new Map(
    aggregateCategorySpend(transactions, previous, categories, 50).map((row) => [row.categoryId, row.amountMinor])
  );

  for (const row of currentCats.slice(0, 3)) {
    const prevAmount = previousCats.get(row.categoryId) ?? 0;
    signals.push({
      kind: 'category_change',
      label: `${row.categoryName} vs prior month`,
      currentMinor: row.amountMinor,
      previousMinor: prevAmount,
      percentChange: percentChange(row.amountMinor, prevAmount),
      categoryId: row.categoryId,
    });
  }

  return signals;
}
