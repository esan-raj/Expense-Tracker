import { calculateBudgetUsage, getBudgetWarningLevel } from '@/utils/calculations';
import {
  aggregateCategorySpend,
  aggregatePeriodTotals,
  spentForBudget,
} from './aggregateSpending';
import { detectAnomalies } from './detectAnomalies';
import { detectRecurringPatterns } from './detectRecurringPatterns';
import { detectTrends } from './detectTrends';
import { generateBudgetBaseline } from './generateBudgetBaseline';
import { previousPeriod } from './periodBounds';
import { resolveOverallBudgetMinor } from './resolveOverallBudget';
import { buildSnapshotId, computeContentRevision, resolveFinanceRevision } from './snapshotRevision';
import type { BudgetUsageRow, FinancialSnapshot, FinancialSnapshotInput } from './types';

function usageRow(args: {
  categoryId: string | null;
  label: string;
  budgetMinor: number;
  spentMinor: number;
  source: BudgetUsageRow['source'];
}): BudgetUsageRow {
  const usage = calculateBudgetUsage(args.spentMinor, args.budgetMinor);
  return {
    categoryId: args.categoryId,
    label: args.label,
    budgetMinor: args.budgetMinor,
    spentMinor: args.spentMinor,
    percent: usage.percent,
    warningLevel: getBudgetWarningLevel(usage.percent),
    source: args.source,
  };
}

export function buildFinancialSnapshot(input: FinancialSnapshotInput): FinancialSnapshot {
  const now = input.now ?? new Date();
  const financeRevision = resolveFinanceRevision(input.financeRevision);
  const contentRevision = computeContentRevision(input);
  const snapshotId = buildSnapshotId(contentRevision, financeRevision, input.snapshotId);

  const totals = aggregatePeriodTotals(input.transactions, input.period);
  const previousTotals = aggregatePeriodTotals(input.transactions, previousPeriod(input.period));
  const previousHasData = previousTotals.incomeMinor > 0 || previousTotals.expenseMinor > 0;

  const overall = resolveOverallBudgetMinor({
    period: input.period,
    budgets: input.budgets,
    settingsMonthlyBudget: input.settingsMonthlyBudget,
  });

  const topCategories = aggregateCategorySpend(input.transactions, input.period, input.categories, 8);
  const categoryNames = new Map(input.categories.map((category) => [category.id, category.name]));

  const periodBudgets = input.budgets.filter(
    (budget) => budget.month === input.period.month && budget.year === input.period.year
  );

  const budgets: BudgetUsageRow[] = [];

  if (overall.amountMinor != null && overall.source !== 'none') {
    budgets.push(
      usageRow({
        categoryId: null,
        label: 'Overall',
        budgetMinor: overall.amountMinor,
        spentMinor: spentForBudget(input.transactions, input.period, null),
        source: overall.source,
      })
    );
  }

  for (const budget of periodBudgets.filter((item) => item.categoryId != null)) {
    budgets.push(
      usageRow({
        categoryId: budget.categoryId,
        label: categoryNames.get(budget.categoryId!) ?? 'Category',
        budgetMinor: budget.amount,
        spentMinor: spentForBudget(input.transactions, input.period, budget.categoryId),
        source: 'category_row',
      })
    );
  }

  return {
    schemaVersion: 1,
    snapshotId,
    snapshotComputedAt: now.toISOString(),
    financeRevision,
    contentRevision,
    currency: input.currency,
    period: input.period,
    overallBudget: overall,
    totals,
    previousPeriod: previousHasData ? previousTotals : null,
    topCategories,
    budgets,
    trends: detectTrends(input.transactions, input.period, input.categories),
    recurringPatterns: detectRecurringPatterns(input.transactions, input.period, input.lookbackMonths ?? 3),
    anomalies: detectAnomalies(input.transactions, input.period, input.categories),
    budgetBaseline: generateBudgetBaseline({
      period: input.period,
      transactions: input.transactions,
      budgets: input.budgets,
      categories: input.categories,
      settingsMonthlyBudget: input.settingsMonthlyBudget,
      lookbackMonths: input.lookbackMonths,
    }),
    flags: {
      hasIncome: totals.incomeMinor > 0,
      hasExpenses: totals.expenseMinor > 0,
      transferExcluded: true,
      insufficientData: totals.expenseDayCount === 0 && totals.incomeMinor === 0,
    },
  };
}
