/**
 * Deterministic local financial analytics (Phase 2 corrective).
 *
 * - LocalFinancialSnapshot: on-device diagnostics; may retain title-derived evidence.
 * - AiSafeFinancialSnapshot: only aggregate/redacted fields; never send LocalFinancialSnapshot
 *   to an AI provider. See buildAiSafeFinancialSnapshot + docs/AI_FINANCIAL_ASSISTANT.md.
 *
 * Amounts are integer minor units. Currency is app-global (settings), not per-transaction.
 */

export type Period = { month: number; year: number };

export type PeriodStatus = 'active' | 'completed' | 'future';

export type OverallBudgetSource = 'budget_row' | 'settings_fallback' | 'none';

export type Volatility = 'low' | 'medium' | 'high';

export type AmountBucket = 'b0_500' | 'b500_2k' | 'b2k_10k' | 'b10k_plus';

export type AverageDailyMethod = 'elapsed_days' | 'full_month' | 'unavailable';

export type ProjectionMethod = 'linear_elapsed' | 'unavailable';

/** Realised ledger row for analytics (not a recurring template). */
export type SnapshotTransaction = {
  type: 'expense' | 'income';
  amount: number;
  categoryId: string;
  title: string;
  date: string;
  /** Defaults to false when omitted. */
  isTransfer?: boolean;
  /** Ledger flag on a realised row; not a recurring template. Defaults to false. */
  isRecurring?: boolean;
  paymentMethod?: string;
  /** Soft-delete marker; non-empty means deleted. Repositories normally omit these. */
  deletedAt?: string | null;
};

export type SnapshotBudget = {
  id: string;
  categoryId: string | null;
  amount: number;
  month: number;
  year: number;
  deletedAt?: string | null;
};

export type SnapshotCategory = {
  id: string;
  name: string;
  type: 'expense' | 'income' | 'both';
  deletedAt?: string | null;
};

/**
 * Inputs for pure builders. Prefer `adaptFinancialSnapshotInput` from repository DTOs.
 * Soft-deleted / invalid rows must be removed before aggregation (adapter does this).
 */
export type FinancialSnapshotInput = {
  period: Period;
  /** Global display/settings currency (ISO-like code, e.g. INR). */
  currency: string;
  settingsMonthlyBudget: number | null;
  budgets: SnapshotBudget[];
  categories: SnapshotCategory[];
  transactions: SnapshotTransaction[];
  /** Optional scope label for revision only; aggregation remains caller-scoped. */
  accountScopeId?: string | null;
  lookbackMonths?: number;
  now?: Date;
  snapshotId?: string;
  financeRevision?: number;
};

export type PeriodTotals = {
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
  savingsRatePercent: number;
  /** null when period is future or average cannot be formed. */
  averageDailyExpenseMinor: number | null;
  averageDailyMethod: AverageDailyMethod;
  /** null unless active month with expenses and elapsed days ≥ 1. */
  projectedMonthEndExpenseMinor: number | null;
  projectedMonthEndMethod: ProjectionMethod;
  expenseDayCount: number;
  divisorDays: number | null;
};

export type CategorySpendRow = {
  categoryId: string;
  categoryName: string;
  amountMinor: number;
  percent: number;
  transactionCount: number;
};

export type BudgetUsageRow = {
  categoryId: string | null;
  label: string;
  budgetMinor: number;
  spentMinor: number;
  percent: number;
  warningLevel: 50 | 75 | 90 | 100 | null;
  source: OverallBudgetSource | 'category_row';
};

export type TrendSignal = {
  kind: 'expense_change' | 'income_change' | 'net_change' | 'category_change';
  label: string;
  currentMinor: number;
  previousMinor: number;
  percentChange: number | null;
  categoryId?: string;
};

/** Local-only recurring evidence (may include title keys). */
export type LocalRecurringPattern = {
  titleKey: string;
  sampleTitle: string;
  occurrenceCount: number;
  averageAmountMinor: number;
  categoryId: string | null;
  categoryName: string | null;
  markedRecurring: boolean;
};

/** Local-only anomaly evidence (may include titles/dates). */
export type LocalAnomalySignal = {
  title: string;
  date: string;
  amountMinor: number;
  categoryId: string;
  categoryName: string;
  baselineAverageMinor: number;
  multipleOfBaseline: number;
};

export type BudgetBaselineCategory = {
  categoryId: string;
  categoryName: string;
  averageSpendMinor: number;
  medianSpendMinor: number;
  currentBudgetMinor: number | null;
  volatility: Volatility;
  monthsWithSpend: number;
};

export type BudgetBaseline = {
  lookbackMonths: number;
  overall: {
    currentBudgetMinor: number | null;
    averageSpendMinor: number;
    medianSpendMinor: number;
    source: OverallBudgetSource;
  };
  categories: BudgetBaselineCategory[];
};

export type DataQualityFlags = {
  skippedDeletedTransactions: number;
  skippedInvalidTransactions: number;
  skippedDeletedBudgets: number;
  skippedInvalidBudgets: number;
  skippedDeletedCategories: number;
  unknownCategoryBuckets: number;
  /** Repositories already scope by user; adapter does not mix owners. */
  assumedSingleCurrency: true;
  assumedUserScopedInputs: true;
};

export type LocalFinancialSnapshot = {
  schemaVersion: 1;
  kind: 'local';
  snapshotId: string;
  snapshotComputedAt: string;
  financeRevision: number;
  /** Cache/staleness fingerprint only — not a security hash. */
  contentRevision: string;
  currency: string;
  period: Period;
  periodStatus: PeriodStatus;
  overallBudget: {
    amountMinor: number | null;
    source: OverallBudgetSource;
  };
  totals: PeriodTotals;
  previousPeriod: PeriodTotals | null;
  topCategories: CategorySpendRow[];
  budgets: BudgetUsageRow[];
  trends: TrendSignal[];
  recurringPatterns: LocalRecurringPattern[];
  anomalies: LocalAnomalySignal[];
  budgetBaseline: BudgetBaseline;
  flags: {
    hasIncome: boolean;
    hasExpenses: boolean;
    transferExcluded: true;
    insufficientData: boolean;
  };
  dataQuality: DataQualityFlags;
};

/** Aggregate recurring evidence safe for an AI envelope. */
export type AiSafeRecurringPattern = {
  categoryId: string | null;
  categoryName: string | null;
  occurrenceCount: number;
  averageAmountBucket: AmountBucket;
  markedRecurring: boolean;
};

/** Aggregate anomaly evidence safe for an AI envelope. */
export type AiSafeAnomalySignal = {
  categoryId: string;
  categoryName: string;
  amountBucket: AmountBucket;
  baselineAverageBucket: AmountBucket;
  multipleOfBaseline: number;
  periodAnomalyCount: number;
};

export type AiSafeTruncation = {
  truncated: boolean;
  utf8Bytes: number;
  maxUtf8Bytes: number;
  dropped: Partial<
    Record<
      'topCategories' | 'budgets' | 'trends' | 'recurringPatterns' | 'anomalies' | 'baselineCategories',
      number
    >
  >;
  exceededLimit: boolean;
  reason: string | null;
};

export type AiSafeFinancialSnapshot = {
  schemaVersion: 1;
  kind: 'ai_safe';
  snapshotId: string;
  snapshotComputedAt: string;
  financeRevision: number;
  contentRevision: string;
  currency: string;
  period: Period;
  periodStatus: PeriodStatus;
  overallBudget: LocalFinancialSnapshot['overallBudget'];
  totals: PeriodTotals;
  previousPeriod: PeriodTotals | null;
  topCategories: CategorySpendRow[];
  budgets: BudgetUsageRow[];
  trends: TrendSignal[];
  recurringPatterns: AiSafeRecurringPattern[];
  anomalies: AiSafeAnomalySignal[];
  budgetBaseline: BudgetBaseline;
  flags: LocalFinancialSnapshot['flags'];
  dataQuality: DataQualityFlags;
  truncation: AiSafeTruncation;
};

/** @deprecated Use LocalFinancialSnapshot — never treat as AI-safe. */
export type FinancialSnapshot = LocalFinancialSnapshot;

/** @deprecated Use LocalRecurringPattern. */
export type RecurringPattern = LocalRecurringPattern;

/** @deprecated Use LocalAnomalySignal. */
export type AnomalySignal = LocalAnomalySignal;

export const AI_SAFE_MAX_UTF8_BYTES = 8192;
