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
  | 'provider_unavailable';

export type AmountBucket = 'b0_500' | 'b500_2k' | 'b2k_10k' | 'b10k_plus';

export type PaymentMethod =
  | 'cash'
  | 'upi'
  | 'credit_card'
  | 'debit_card'
  | 'bank_transfer'
  | 'wallet'
  | 'other';

/** Minimal wire checks — full shape validated structurally for kind + prohibited keys. */
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
  flags: {
    hasIncome: boolean;
    hasExpenses: boolean;
    transferExcluded: true;
    insufficientData: boolean;
  };
  [key: string]: unknown;
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
  snapshot: AiSafeSnapshotWire;
};

export type CategorizeMerchantRequest = {
  schemaVersion: 1;
  requestId: string;
  capability: 'categorize_merchant';
  locale: string;
  currency: string;
  snapshotId: string;
  snapshotComputedAt: string;
  payload: CategorizeMerchantPayload;
};

export type FinancialAssistantRequest = SnapshotCapabilityRequest | CategorizeMerchantRequest;

export type MonthlySummaryResult = {
  headline: string;
  bullets: string[];
  interpretations: Array<{ text: string; relatedCategoryIds?: string[] }>;
  suggestedActions: Array<{
    id: string;
    label: string;
    kind: 'navigate_reports' | 'navigate_budgets' | 'review_category' | 'none';
    categoryId?: string;
  }>;
  confidence: number;
};

export type BudgetSuggestionResult = {
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
  /** Opaque; do not log PII. */
  capability: Capability;
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
