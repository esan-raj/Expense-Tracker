import {
  calculateAverageDailySpending,
  calculateSavingsRate,
  calculateTotalExpenses,
  calculateTotalIncome,
} from '@/utils/calculations';
import { inPeriod, periodBounds } from './periodBounds';
import type {
  CategorySpendRow,
  Period,
  PeriodTotals,
  SnapshotCategory,
  SnapshotTransaction,
} from './types';

function operational(transactions: SnapshotTransaction[]): SnapshotTransaction[] {
  return transactions.filter((row) => !row.isTransfer);
}

export function filterPeriodTransactions(
  transactions: SnapshotTransaction[],
  period: Period
): SnapshotTransaction[] {
  return operational(transactions).filter((row) => inPeriod(row.date, period));
}

export function aggregatePeriodTotals(
  transactions: SnapshotTransaction[],
  period: Period
): PeriodTotals {
  const rows = filterPeriodTransactions(transactions, period);
  const { dayCount } = periodBounds(period);
  const incomeMinor = calculateTotalIncome(rows);
  const expenseMinor = calculateTotalExpenses(rows);
  const expenseDates = new Set(rows.filter((row) => row.type === 'expense').map((row) => row.date));
  return {
    incomeMinor,
    expenseMinor,
    netMinor: incomeMinor - expenseMinor,
    savingsRatePercent: calculateSavingsRate(incomeMinor, expenseMinor),
    averageDailyExpenseMinor: calculateAverageDailySpending(expenseMinor, dayCount),
    expenseDayCount: expenseDates.size,
  };
}

export function aggregateCategorySpend(
  transactions: SnapshotTransaction[],
  period: Period,
  categories: SnapshotCategory[],
  limit = 8
): CategorySpendRow[] {
  const rows = filterPeriodTransactions(transactions, period).filter((row) => row.type === 'expense');
  const names = new Map(categories.map((category) => [category.id, category.name]));
  const totals = new Map<string, { amountMinor: number; transactionCount: number }>();
  let expenseTotal = 0;

  for (const row of rows) {
    expenseTotal += row.amount;
    const current = totals.get(row.categoryId) ?? { amountMinor: 0, transactionCount: 0 };
    current.amountMinor += row.amount;
    current.transactionCount += 1;
    totals.set(row.categoryId, current);
  }

  return [...totals.entries()]
    .map(([categoryId, value]) => ({
      categoryId,
      categoryName: names.get(categoryId) ?? 'Unknown',
      amountMinor: value.amountMinor,
      percent: expenseTotal > 0 ? Math.round((value.amountMinor / expenseTotal) * 100) : 0,
      transactionCount: value.transactionCount,
    }))
    .sort((a, b) => b.amountMinor - a.amountMinor)
    .slice(0, limit);
}

export function spentForBudget(
  transactions: SnapshotTransaction[],
  period: Period,
  categoryId: string | null
): number {
  const rows = filterPeriodTransactions(transactions, period).filter((row) => row.type === 'expense');
  if (categoryId == null) {
    return rows.reduce((sum, row) => sum + row.amount, 0);
  }
  return rows.filter((row) => row.categoryId === categoryId).reduce((sum, row) => sum + row.amount, 0);
}
