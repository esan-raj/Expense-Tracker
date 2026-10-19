import type { Capability } from './constants.ts';

export type AiAssistantErrorCode =
  | 'offline'
  | 'timeout'
  | 'auth'
  | 'rate_limit'
  | 'invalid_request'
  | 'invalid_model_output'
  | 'stale_snapshot'
  | 'opt_in_required'
  | 'origin_not_allowed'
  | 'provider_unavailable';

/** Per-request cloud AI consent (server gate). Persistent UI opt-in is a later client phase. */
export type CloudAiConsent = {
  cloudAi: true;
  policyVersion: 1;
};

export type AmountBucket = 'b0_500' | 'b500_2k' | 'b2k_10k' | 'b10k_plus';

export type PaymentMethod =
  | 'cash'
  | 'upi'
  | 'credit_card'
  | 'debit_card'
  | 'bank_transfer'
  | 'wallet'
  | 'other';

export type PeriodTotalsWire = {
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
  savingsRatePercent: number;
  averageDailyExpenseMinor: number | null;
  averageDailyMethod: 'elapsed_days' | 'full_month' | 'unavailable';
  projectedMonthEndExpenseMinor: number | null;
  projectedMonthEndMethod: 'linear_elapsed' | 'unavailable';
  expenseDayCount: number;
  divisorDays: number | null;
};

export type CategorySpendWire = {
  categoryId: string;
  categoryName: string;
  amountMinor: number;
  percent: number;
  transactionCount: number;
};

export type BudgetUsageWire = {
  categoryId: string | null;
  label: string;
  budgetMinor: number;
  spentMinor: number;
  percent: number;
  warningLevel: 50 | 75 | 90 | 100 | null;
  source: 'budget_row' | 'settings_fallback' | 'none' | 'category_row';
};

export type TrendWire = {
  kind: 'expense_change' | 'income_change' | 'net_change' | 'category_change';
  label: string;
  currentMinor: number;
  previousMinor: number;
  percentChange: number | null;
  categoryId?: string;
};

export type AiSafeRecurringWire = {
  categoryId: string | null;
  categoryName: string | null;
  occurrenceCount: number;
  averageAmountBucket: AmountBucket;
  markedRecurring: boolean;
};

export type AiSafeAnomalyWire = {
  categoryId: string;
  categoryName: string;
  amountBucket: AmountBucket;
  baselineAverageBucket: AmountBucket;
  multipleOfBaseline: number;
  periodAnomalyCount: number;
};

export type BudgetBaselineWire = {
  lookbackMonths: number;
  overall: {
    currentBudgetMinor: number | null;
    averageSpendMinor: number;
    medianSpendMinor: number;
    source: 'budget_row' | 'settings_fallback' | 'none';
  };
  categories: Array<{
    categoryId: string;
    categoryName: string;
    averageSpendMinor: number;
    medianSpendMinor: number;
    currentBudgetMinor: number | null;
    volatility: 'low' | 'medium' | 'high';
    monthsWithSpend: number;
  }>;
};

export type DataQualityWire = {
  skippedDeletedTransactions: number;
  skippedInvalidTransactions: number;
  skippedDeletedBudgets: number;
  skippedInvalidBudgets: number;
  skippedDeletedCategories: number;
  unknownCategoryBuckets: number;
  assumedSingleCurrency: true;
  assumedUserScopedInputs: true;
};

export type TruncationWire = {
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

/** Strict wire shape — no index signature; unknown keys rejected at parse time. */
export type AiSafeSnapshotWire = {
  schemaVersion: 1;
  kind: 'ai_safe';
  snapshotId: string;
  snapshotComputedAt: string;
  financeRevision: number;
  contentRevision: string;
  currency: string;
  period: { month: number; year: number };
  periodStatus: 'active' | 'completed' | 'future';
  overallBudget: {
    amountMinor: number | null;
    source: 'budget_row' | 'settings_fallback' | 'none';
  };
  totals: PeriodTotalsWire;
  previousPeriod: PeriodTotalsWire | null;
  topCategories: CategorySpendWire[];
  budgets: BudgetUsageWire[];
  trends: TrendWire[];
  recurringPatterns: AiSafeRecurringWire[];
  anomalies: AiSafeAnomalyWire[];
  budgetBaseline: BudgetBaselineWire;
  flags: {
    hasIncome: boolean;
    hasExpenses: boolean;
    transferExcluded: true;
    insufficientData: boolean;
  };
  dataQuality: DataQualityWire;
  truncation: TruncationWire;
};

export type CategorizeMerchantPayload = {
  merchantLabelRedacted: string;
  descriptionRedacted?: string;
  paymentMethod?: PaymentMethod;
  amountBucket: AmountBucket;
  candidates: Array<{ categoryId: string; categoryName: string }>;
};

export type SnapshotCapabilityRequest = {
  schemaVersion: 1;
  requestId: string;
  capability: 'monthly_summary' | 'budget_suggestions';
  locale: string;
  currency: string;
  consent: CloudAiConsent;
  snapshot: AiSafeSnapshotWire;
};

export type CategorizeMerchantRequest = {
  schemaVersion: 1;
  requestId: string;
  capability: 'categorize_merchant';
  locale: string;
  currency: string;
  consent: CloudAiConsent;
  snapshotId: string;
  snapshotComputedAt: string;
  payload: CategorizeMerchantPayload;
};

export type FinancialAssistantRequest = SnapshotCapabilityRequest | CategorizeMerchantRequest;

export type SuggestedActionKind =
  | 'navigate_reports'
  | 'navigate_budgets'
  | 'review_category'
  | 'none';

export type MonthlySummaryResult = {
  headline: string;
  bullets: string[];
  interpretations: Array<{ text: string; relatedCategoryIds?: string[] }>;
  suggestedActions: Array<{
    id: string;
    label: string;
    kind: SuggestedActionKind;
    categoryId?: string;
  }>;
  confidence: number;
};

export type BudgetSuggestionResult = {
  /** Must be true — recommendations are never auto-applied. */
  requiresConfirmation: true;
  overall?: {
    recommendedMinor: number;
    rationale: string;
    confidence: number;
  };
  categories: Array<{
    categoryId: string;
    recommendedMinor: number;
    rationale: string;
    confidence: number;
  }>;
  caveats: string[];
};

export type MerchantCategorisationResult = {
  suggestions: Array<{
    categoryId: string;
    confidence: number;
    reason: string;
  }>;
};

export type AiAssistantSuccess<R> = {
  schemaVersion: 1;
  requestId: string;
  snapshotId: string;
  generatedAt: string;
  stale: boolean;
  capability: Capability;
  result: R;
};

export type AiAssistantFailure = {
  schemaVersion: 1;
  requestId: string;
  error: { code: AiAssistantErrorCode; message: string };
};

export type AiAssistantResponse<R = unknown> = AiAssistantSuccess<R> | AiAssistantFailure;

export type ProviderRequestContext = {
  requestId: string;
  userId: string;
  locale: string;
  currency: string;
  capability: Capability;
  /**
   * Cooperative cancellation. Adapters MUST pass `signal` to `fetch`/SDK calls.
   * JavaScript cannot forcibly terminate arbitrary sync work — honor the signal.
   */
  signal: AbortSignal;
  /** Absolute epoch-ms deadline for this invocation. */
  deadlineMs: number;
};

export type MonthlySummaryProviderInput = {
  snapshot: AiSafeSnapshotWire;
};

export type BudgetSuggestionProviderInput = {
  snapshot: AiSafeSnapshotWire;
};

export type MerchantCategorisationProviderInput = {
  payload: CategorizeMerchantPayload;
};
