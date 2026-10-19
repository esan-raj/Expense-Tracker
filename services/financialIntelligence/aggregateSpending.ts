import {
  calculateAverageDailySpending,
  calculateSavingsRate,
  calculateTotalExpenses,
  calculateTotalIncome,
} from '@/utils/calculations';
import { FinancialSnapshotValidationError, safeAdd } from './integerSafety';
import {
  averageDivisorDays,
  classifyPeriod,
  inPeriod,
  periodBounds,
} from './periodBounds';
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

function emptyTotals(method: PeriodTotals['averageDailyMethod']): PeriodTotals {
  return {
    incomeMinor: 0,
    expenseMinor: 0,
    netMinor: 0,
    savingsRatePercent: 0,
    averageDailyExpenseMinor: null,
    averageDailyMethod: method,
    projectedMonthEndExpenseMinor: null,
    projectedMonthEndMethod: 'unavailable',
    expenseDayCount: 0,
    divisorDays: null,
  };
}

/**
 * Period totals with active/completed/future average and projection rules.
 * Uses injected `now` for local calendar semantics (YYYY-MM-DD).
 */
export function aggregatePeriodTotals(
  transactions: SnapshotTransaction[],
  period: Period,
  now: Date
): PeriodTotals {
  const status = classifyPeriod(period, now);
  const rows = filterPeriodTransactions(transactions, period);
  const { dayCount } = periodBounds(period);
  const divisorDays = averageDivisorDays(period, now);
  const incomeMinor = calculateTotalIncome(rows);
  const expenseMinor = calculateTotalExpenses(rows);

  if (!Number.isSafeInteger(incomeMinor) || !Number.isSafeInteger(expenseMinor)) {
    throw new FinancialSnapshotValidationError('Period totals are not safe integers');
  }

  const expenseDates = new Set(rows.filter((row) => row.type === 'expense').map((row) => row.date));

  if (status === 'future') {
    return {
      ...emptyTotals('unavailable'),
      incomeMinor,
      expenseMinor,
      netMinor: incomeMinor - expenseMinor,
      savingsRatePercent: calculateSavingsRate(incomeMinor, expenseMinor),
      expenseDayCount: expenseDates.size,
      divisorDays: null,
    };
  }

  const averageDailyMethod = status === 'active' ? 'elapsed_days' : 'full_month';
  const averageDailyExpenseMinor =
    divisorDays != null && expenseMinor > 0
      ? calculateAverageDailySpending(expenseMinor, divisorDays)
      : expenseMinor === 0 && divisorDays != null
        ? 0
        : null;

  let projectedMonthEndExpenseMinor: number | null = null;
  let projectedMonthEndMethod: PeriodTotals['projectedMonthEndMethod'] = 'unavailable';

  if (status === 'active' && expenseMinor > 0 && divisorDays != null && divisorDays > 0) {
    const projected = Math.round((expenseMinor * dayCount) / divisorDays);
    if (!Number.isSafeInteger(projected)) {
      throw new FinancialSnapshotValidationError('Projected month-end overflowed safe integer');
    }
    projectedMonthEndExpenseMinor = projected;
    projectedMonthEndMethod = 'linear_elapsed';
  }

  return {
    incomeMinor,
    expenseMinor,
    netMinor: incomeMinor - expenseMinor,
    savingsRatePercent: calculateSavingsRate(incomeMinor, expenseMinor),
    averageDailyExpenseMinor,
    averageDailyMethod,
    projectedMonthEndExpenseMinor,
    projectedMonthEndMethod,
    expenseDayCount: expenseDates.size,
    divisorDays,
  };
}

export function aggregateCategorySpend(
  transactions: SnapshotTransaction[],
  period: Period,
  categories: SnapshotCategory[],
  limit = 8
): { rows: CategorySpendRow[]; unknownCategoryBuckets: number } {
  const rows = filterPeriodTransactions(transactions, period).filter((row) => row.type === 'expense');
  const names = new Map(categories.map((category) => [category.id, category.name]));
  const totals = new Map<string, { amountMinor: number; transactionCount: number }>();
  let expenseTotal = 0;
  let unknownCategoryBuckets = 0;

  for (const row of rows) {
    expenseTotal = safeAdd(expenseTotal, row.amount, 'category spend');
    const current = totals.get(row.categoryId) ?? { amountMinor: 0, transactionCount: 0 };
    current.amountMinor = safeAdd(current.amountMinor, row.amount, 'category spend');
    current.transactionCount += 1;
    totals.set(row.categoryId, current);
    if (!names.has(row.categoryId)) unknownCategoryBuckets += 1;
  }

  const sorted = [...totals.entries()]
    .map(([categoryId, value]) => ({
      categoryId,
      categoryName: names.get(categoryId) ?? 'Unknown',
      amountMinor: value.amountMinor,
      percent: expenseTotal > 0 ? Math.round((value.amountMinor / expenseTotal) * 100) : 0,
      transactionCount: value.transactionCount,
    }))
    .sort(
      (a, b) =>
        b.amountMinor - a.amountMinor ||
        a.categoryId.localeCompare(b.categoryId) ||
        a.categoryName.localeCompare(b.categoryName)
    )
    .slice(0, limit);

  return { rows: sorted, unknownCategoryBuckets };
}

export function spentForBudget(
  transactions: SnapshotTransaction[],
  period: Period,
  categoryId: string | null
): number {
  const rows = filterPeriodTransactions(transactions, period).filter((row) => row.type === 'expense');
  if (categoryId == null) {
    return rows.reduce((sum, row) => safeAdd(sum, row.amount, 'budget spend'), 0);
  }
  return rows
    .filter((row) => row.categoryId === categoryId)
    .reduce((sum, row) => safeAdd(sum, row.amount, 'budget spend'), 0);
}
