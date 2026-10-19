import { resolveOverallBudgetMinor } from './resolveOverallBudget';
import { aggregatePeriodTotals, spentForBudget } from './aggregateSpending';
import { lookbackPeriods } from './periodBounds';
import type {
  BudgetBaseline,
  BudgetBaselineCategory,
  Period,
  SnapshotBudget,
  SnapshotCategory,
  SnapshotTransaction,
  Volatility,
} from './types';

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function volatilityOf(values: number[]): Volatility {
  if (values.length < 2) return 'low';
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean <= 0) return 'low';
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const cv = Math.sqrt(variance) / mean;
  if (cv > 0.4) return 'high';
  if (cv > 0.2) return 'medium';
  return 'low';
}

export function generateBudgetBaseline(args: {
  period: Period;
  transactions: SnapshotTransaction[];
  budgets: SnapshotBudget[];
  categories: SnapshotCategory[];
  settingsMonthlyBudget: number | null;
  lookbackMonths?: number;
  now: Date;
}): BudgetBaseline {
  const lookbackMonths = Math.min(6, Math.max(1, args.lookbackMonths ?? 3));
  const periods = lookbackPeriods(args.period, lookbackMonths);
  const overallSpends = periods.map(
    (item) => aggregatePeriodTotals(args.transactions, item, args.now).expenseMinor
  );
  const monthsWithOverallSpend = overallSpends.filter((value) => value > 0);
  const overallResolution = resolveOverallBudgetMinor({
    period: args.period,
    budgets: args.budgets,
    settingsMonthlyBudget: args.settingsMonthlyBudget,
  });

  const expenseCategories = [...args.categories]
    .filter((category) => category.type === 'expense' || category.type === 'both')
    .sort((a, b) => a.id.localeCompare(b.id));

  const categories: BudgetBaselineCategory[] = expenseCategories
    .map((category) => {
      const monthly = periods.map((item) => spentForBudget(args.transactions, item, category.id));
      const withSpend = monthly.filter((value) => value > 0);
      const current = args.budgets.find(
        (budget) =>
          budget.categoryId === category.id &&
          budget.month === args.period.month &&
          budget.year === args.period.year
      );
      return {
        categoryId: category.id,
        categoryName: category.name,
        averageSpendMinor: average(withSpend),
        medianSpendMinor: median(withSpend),
        currentBudgetMinor: current?.amount ?? null,
        volatility: volatilityOf(withSpend),
        monthsWithSpend: withSpend.length,
      };
    })
    .filter((row) => row.monthsWithSpend > 0)
    .sort(
      (a, b) =>
        b.averageSpendMinor - a.averageSpendMinor || a.categoryId.localeCompare(b.categoryId)
    )
    .slice(0, 30);

  return {
    lookbackMonths,
    overall: {
      currentBudgetMinor: overallResolution.amountMinor,
      averageSpendMinor: average(monthsWithOverallSpend),
      medianSpendMinor: median(monthsWithOverallSpend),
      source: overallResolution.source,
    },
    categories,
  };
}
