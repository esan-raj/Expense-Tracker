/**
 * Deterministic local financial analytics contracts (Phase 2).
 * Amounts are integer minor units. Transfers are always excluded from spend totals.
 * No AI provider types live here — see docs/AI_FINANCIAL_ASSISTANT.md.
 */

export type Period = { month: number; year: number };

export type OverallBudgetSource = 'budget_row' | 'settings_fallback' | 'none';

export type Volatility = 'low' | 'medium' | 'high';

export type SnapshotTransaction = {
  type: 'expense' | 'income';
  amount: number;
  categoryId: string;
  title: string;
  date: string;
  isTransfer?: boolean;
  isRecurring?: boolean;
  paymentMethod?: string;
};

export type SnapshotBudget = {
  id: string;
  categoryId: string | null;
  amount: number;
  month: number;
  year: number;
};

export type SnapshotCategory = {
  id: string;
  name: string;
  type: 'expense' | 'income' | 'both';
};

/** Inputs already loaded from RxDB/stores — pure builders do not open the database. */
export type FinancialSnapshotInput = {
  period: Period;
  currency: string;
  /** settings.monthlyBudget — used only as fallback when no overall budget row exists. */
  settingsMonthlyBudget: number | null;
  budgets: SnapshotBudget[];
  categories: SnapshotCategory[];
  transactions: SnapshotTransaction[];
  /** Optional lookback length for baselines (1–6). Default 3. */
  lookbackMonths?: number;
  /** Injected clock for tests. */
  now?: Date;
  /** Optional stable id; otherwise derived from content + finance revision. */
  snapshotId?: string;
  financeRevision?: number;
};

export type PeriodTotals = {
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
  savingsRatePercent: number;
  averageDailyExpenseMinor: number;
  expenseDayCount: number;
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

export type RecurringPattern = {
  titleKey: string;
  sampleTitle: string;
  occurrenceCount: number;
  averageAmountMinor: number;
  categoryId: string | null;
  markedRecurring: boolean;
};

export type AnomalySignal = {
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

export type FinancialSnapshot = {
  schemaVersion: 1;
  snapshotId: string;
  snapshotComputedAt: string;
  financeRevision: number;
  contentRevision: string;
  currency: string;
  period: Period;
  overallBudget: {
    amountMinor: number | null;
    source: OverallBudgetSource;
  };
  totals: PeriodTotals;
  previousPeriod: PeriodTotals | null;
  topCategories: CategorySpendRow[];
  budgets: BudgetUsageRow[];
  trends: TrendSignal[];
  recurringPatterns: RecurringPattern[];
  anomalies: AnomalySignal[];
  budgetBaseline: BudgetBaseline;
  flags: {
    hasIncome: boolean;
    hasExpenses: boolean;
    transferExcluded: true;
    insufficientData: boolean;
  };
};
