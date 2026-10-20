import type { AiSafeFinancialSnapshot } from '@/services/financialIntelligence';
import { AiClientError } from './errors';

function assertSafeInt(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new AiClientError('invalid_request', `${label} must be a safe integer`, { retryable: false });
  }
  return value;
}

function assertFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AiClientError('invalid_request', `${label} must be a finite number`, { retryable: false });
  }
  return value;
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AiClientError('invalid_request', `${label} must be a non-empty string`, { retryable: false });
  }
  return value;
}

function cloneTotals(totals: AiSafeFinancialSnapshot['totals']) {
  return {
    incomeMinor: assertSafeInt(totals.incomeMinor, 'totals.incomeMinor'),
    expenseMinor: assertSafeInt(totals.expenseMinor, 'totals.expenseMinor'),
    netMinor: assertSafeInt(totals.netMinor, 'totals.netMinor'),
    savingsRatePercent: assertSafeInt(totals.savingsRatePercent, 'totals.savingsRatePercent'),
    averageDailyExpenseMinor:
      totals.averageDailyExpenseMinor === null
        ? null
        : assertSafeInt(totals.averageDailyExpenseMinor, 'totals.averageDailyExpenseMinor'),
    averageDailyMethod: totals.averageDailyMethod,
    projectedMonthEndExpenseMinor:
      totals.projectedMonthEndExpenseMinor === null
        ? null
        : assertSafeInt(totals.projectedMonthEndExpenseMinor, 'totals.projectedMonthEndExpenseMinor'),
    projectedMonthEndMethod: totals.projectedMonthEndMethod,
    expenseDayCount: assertSafeInt(totals.expenseDayCount, 'totals.expenseDayCount'),
    divisorDays: totals.divisorDays === null ? null : assertSafeInt(totals.divisorDays, 'totals.divisorDays'),
  };
}

/**
 * Deep-clone an AiSafeFinancialSnapshot via an allowlist (no object spread of untrusted roots).
 */
export function cloneAiSafeSnapshotForRequest(snapshot: AiSafeFinancialSnapshot): AiSafeFinancialSnapshot {
  if (!snapshot || snapshot.kind !== 'ai_safe' || snapshot.schemaVersion !== 1) {
    throw new AiClientError('invalid_request', 'snapshot must be kind ai_safe schemaVersion 1', {
      retryable: false,
    });
  }

  const periodStatus = snapshot.periodStatus;
  if (periodStatus !== 'active' && periodStatus !== 'completed' && periodStatus !== 'future') {
    throw new AiClientError('invalid_request', 'periodStatus invalid', { retryable: false });
  }

  return {
    schemaVersion: 1,
    kind: 'ai_safe',
    snapshotId: assertString(snapshot.snapshotId, 'snapshotId'),
    snapshotComputedAt: assertString(snapshot.snapshotComputedAt, 'snapshotComputedAt'),
    financeRevision: assertSafeInt(snapshot.financeRevision, 'financeRevision'),
    contentRevision: assertString(snapshot.contentRevision, 'contentRevision'),
    currency: assertString(snapshot.currency, 'currency'),
    period: {
      month: assertSafeInt(snapshot.period.month, 'period.month'),
      year: assertSafeInt(snapshot.period.year, 'period.year'),
    },
    periodStatus,
    overallBudget: {
      amountMinor:
        snapshot.overallBudget.amountMinor === null
          ? null
          : assertSafeInt(snapshot.overallBudget.amountMinor, 'overallBudget.amountMinor'),
      source: snapshot.overallBudget.source,
    },
    totals: cloneTotals(snapshot.totals),
    previousPeriod: snapshot.previousPeriod ? cloneTotals(snapshot.previousPeriod) : null,
    topCategories: snapshot.topCategories.map((row, index) => ({
      categoryId: assertString(row.categoryId, `topCategories[${index}].categoryId`),
      categoryName: assertString(row.categoryName, `topCategories[${index}].categoryName`),
      amountMinor: assertSafeInt(row.amountMinor, `topCategories[${index}].amountMinor`),
      percent: assertFiniteNumber(row.percent, `topCategories[${index}].percent`),
      transactionCount: assertSafeInt(row.transactionCount, `topCategories[${index}].transactionCount`),
    })),
    budgets: snapshot.budgets.map((row, index) => ({
      categoryId: row.categoryId === null ? null : assertString(row.categoryId, `budgets[${index}].categoryId`),
      label: assertString(row.label, `budgets[${index}].label`),
      budgetMinor: assertSafeInt(row.budgetMinor, `budgets[${index}].budgetMinor`),
      spentMinor: assertSafeInt(row.spentMinor, `budgets[${index}].spentMinor`),
      percent: assertFiniteNumber(row.percent, `budgets[${index}].percent`),
      warningLevel: row.warningLevel,
      source: row.source,
    })),
    trends: snapshot.trends.map((row, index) => {
      const base = {
        kind: row.kind,
        label: assertString(row.label, `trends[${index}].label`),
        currentMinor: assertSafeInt(row.currentMinor, `trends[${index}].currentMinor`),
        previousMinor: assertSafeInt(row.previousMinor, `trends[${index}].previousMinor`),
        percentChange:
          row.percentChange === null || row.percentChange === undefined
            ? null
            : assertFiniteNumber(row.percentChange, `trends[${index}].percentChange`),
      };
      if (row.categoryId != null && row.categoryId !== '') {
        return { ...base, categoryId: assertString(row.categoryId, `trends[${index}].categoryId`) };
      }
      return base;
    }),
    recurringPatterns: snapshot.recurringPatterns.map((row, index) => ({
      categoryId:
        row.categoryId === null ? null : assertString(row.categoryId, `recurring[${index}].categoryId`),
      categoryName:
        row.categoryName === null
          ? null
          : assertString(row.categoryName, `recurring[${index}].categoryName`),
      occurrenceCount: assertSafeInt(row.occurrenceCount, `recurring[${index}].occurrenceCount`),
      averageAmountBucket: row.averageAmountBucket,
      markedRecurring: Boolean(row.markedRecurring),
    })),
    anomalies: snapshot.anomalies.map((row, index) => ({
      categoryId: assertString(row.categoryId, `anomalies[${index}].categoryId`),
      categoryName: assertString(row.categoryName, `anomalies[${index}].categoryName`),
      amountBucket: row.amountBucket,
      baselineAverageBucket: row.baselineAverageBucket,
      multipleOfBaseline: assertFiniteNumber(row.multipleOfBaseline, `anomalies[${index}].multiple`),
      periodAnomalyCount: assertSafeInt(row.periodAnomalyCount, `anomalies[${index}].count`),
    })),
    budgetBaseline: {
      lookbackMonths: assertSafeInt(snapshot.budgetBaseline.lookbackMonths, 'budgetBaseline.lookbackMonths'),
      overall: {
        currentBudgetMinor:
          snapshot.budgetBaseline.overall.currentBudgetMinor === null
            ? null
            : assertSafeInt(
                snapshot.budgetBaseline.overall.currentBudgetMinor,
                'budgetBaseline.overall.currentBudgetMinor'
              ),
        averageSpendMinor: assertSafeInt(
          snapshot.budgetBaseline.overall.averageSpendMinor,
          'budgetBaseline.overall.averageSpendMinor'
        ),
        medianSpendMinor: assertSafeInt(
          snapshot.budgetBaseline.overall.medianSpendMinor,
          'budgetBaseline.overall.medianSpendMinor'
        ),
        source: snapshot.budgetBaseline.overall.source,
      },
      categories: snapshot.budgetBaseline.categories.map((row, index) => ({
        categoryId: assertString(row.categoryId, `baseline[${index}].categoryId`),
        categoryName: assertString(row.categoryName, `baseline[${index}].categoryName`),
        averageSpendMinor: assertSafeInt(row.averageSpendMinor, `baseline[${index}].averageSpendMinor`),
        medianSpendMinor: assertSafeInt(row.medianSpendMinor, `baseline[${index}].medianSpendMinor`),
        currentBudgetMinor:
          row.currentBudgetMinor === null
            ? null
            : assertSafeInt(row.currentBudgetMinor, `baseline[${index}].currentBudgetMinor`),
        volatility: row.volatility,
        monthsWithSpend: assertSafeInt(row.monthsWithSpend, `baseline[${index}].monthsWithSpend`),
      })),
    },
    flags: {
      hasIncome: Boolean(snapshot.flags.hasIncome),
      hasExpenses: Boolean(snapshot.flags.hasExpenses),
      transferExcluded: true as const,
      insufficientData: Boolean(snapshot.flags.insufficientData),
    },
    dataQuality: {
      skippedDeletedTransactions: assertSafeInt(
        snapshot.dataQuality.skippedDeletedTransactions,
        'dataQuality.skippedDeletedTransactions'
      ),
      skippedInvalidTransactions: assertSafeInt(
        snapshot.dataQuality.skippedInvalidTransactions,
        'dataQuality.skippedInvalidTransactions'
      ),
      skippedDeletedBudgets: assertSafeInt(
        snapshot.dataQuality.skippedDeletedBudgets,
        'dataQuality.skippedDeletedBudgets'
      ),
      skippedInvalidBudgets: assertSafeInt(
        snapshot.dataQuality.skippedInvalidBudgets,
        'dataQuality.skippedInvalidBudgets'
      ),
      skippedDeletedCategories: assertSafeInt(
        snapshot.dataQuality.skippedDeletedCategories,
        'dataQuality.skippedDeletedCategories'
      ),
      unknownCategoryBuckets: assertSafeInt(
        snapshot.dataQuality.unknownCategoryBuckets,
        'dataQuality.unknownCategoryBuckets'
      ),
      assumedSingleCurrency: true as const,
      assumedUserScopedInputs: true as const,
    },
    truncation: {
      truncated: Boolean(snapshot.truncation.truncated),
      utf8Bytes: assertSafeInt(snapshot.truncation.utf8Bytes, 'truncation.utf8Bytes'),
      maxUtf8Bytes: assertSafeInt(snapshot.truncation.maxUtf8Bytes, 'truncation.maxUtf8Bytes'),
      dropped: { ...snapshot.truncation.dropped },
      exceededLimit: Boolean(snapshot.truncation.exceededLimit),
      reason: snapshot.truncation.reason === null ? null : String(snapshot.truncation.reason),
    },
  };
}
