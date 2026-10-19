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
import { classifyPeriod, previousPeriod } from './periodBounds';
import { resolveOverallBudgetMinor } from './resolveOverallBudget';
import { buildSnapshotId, computeContentRevision, resolveFinanceRevision } from './snapshotRevision';
import type {
  BudgetUsageRow,
  DataQualityFlags,
  FinancialSnapshotInput,
  LocalFinancialSnapshot,
} from './types';

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

function defaultDataQuality(): DataQualityFlags {
  return {
    skippedDeletedTransactions: 0,
    skippedInvalidTransactions: 0,
    skippedDeletedBudgets: 0,
    skippedInvalidBudgets: 0,
    skippedDeletedCategories: 0,
    unknownCategoryBuckets: 0,
    assumedSingleCurrency: true,
    assumedUserScopedInputs: true,
  };
}

/**
 * Builds an on-device LocalFinancialSnapshot.
 * Never send this object to an AI provider — use buildAiSafeFinancialSnapshot.
 */
export function buildFinancialSnapshot(
  input: FinancialSnapshotInput,
  dataQuality: DataQualityFlags = defaultDataQuality()
): LocalFinancialSnapshot {
  const now = input.now ?? new Date();
  const financeRevision = resolveFinanceRevision(input.financeRevision);
  const contentRevision = computeContentRevision(input);
  const snapshotId = buildSnapshotId(contentRevision, financeRevision, input.snapshotId);
  const periodStatus = classifyPeriod(input.period, now);

  const totals = aggregatePeriodTotals(input.transactions, input.period, now);
  const previousTotals = aggregatePeriodTotals(
    input.transactions,
    previousPeriod(input.period),
    now
  );
  const previousHasData = previousTotals.incomeMinor > 0 || previousTotals.expenseMinor > 0;

  const overall = resolveOverallBudgetMinor({
    period: input.period,
    budgets: input.budgets,
    settingsMonthlyBudget: input.settingsMonthlyBudget,
  });

  const categoryAgg = aggregateCategorySpend(input.transactions, input.period, input.categories, 8);
  const topCategories = categoryAgg.rows;
  const categoryNames = new Map(input.categories.map((category) => [category.id, category.name]));

  const periodBudgets = [...input.budgets]
    .filter((budget) => budget.month === input.period.month && budget.year === input.period.year)
    .sort(
      (a, b) =>
        (a.categoryId ?? '').localeCompare(b.categoryId ?? '') ||
        a.id.localeCompare(b.id) ||
        a.amount - b.amount
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
        label: categoryNames.get(budget.categoryId!) ?? 'Unknown',
        budgetMinor: budget.amount,
        spentMinor: spentForBudget(input.transactions, input.period, budget.categoryId),
        source: 'category_row',
      })
    );
  }

  budgets.sort(
    (a, b) =>
      (a.categoryId === null ? 0 : 1) - (b.categoryId === null ? 0 : 1) ||
      (a.categoryId ?? '').localeCompare(b.categoryId ?? '') ||
      a.label.localeCompare(b.label)
  );

  return {
    schemaVersion: 1,
    kind: 'local',
    snapshotId,
    snapshotComputedAt: now.toISOString(),
    financeRevision,
    contentRevision,
    currency: input.currency,
    period: input.period,
    periodStatus,
    overallBudget: overall,
    totals,
    previousPeriod: previousHasData ? previousTotals : null,
    topCategories,
    budgets,
    trends: detectTrends(input.transactions, input.period, input.categories, now),
    recurringPatterns: detectRecurringPatterns(
      input.transactions,
      input.period,
      input.lookbackMonths ?? 3,
      input.categories
    ),
    anomalies: detectAnomalies(input.transactions, input.period, input.categories),
    budgetBaseline: generateBudgetBaseline({
      period: input.period,
      transactions: input.transactions,
      budgets: input.budgets,
      categories: input.categories,
      settingsMonthlyBudget: input.settingsMonthlyBudget,
      lookbackMonths: input.lookbackMonths,
      now,
    }),
    flags: {
      hasIncome: totals.incomeMinor > 0,
      hasExpenses: totals.expenseMinor > 0,
      transferExcluded: true,
      insufficientData: totals.expenseDayCount === 0 && totals.incomeMinor === 0,
    },
    dataQuality: {
      ...dataQuality,
      unknownCategoryBuckets: categoryAgg.unknownCategoryBuckets,
      assumedSingleCurrency: true,
      assumedUserScopedInputs: true,
    },
  };
}
