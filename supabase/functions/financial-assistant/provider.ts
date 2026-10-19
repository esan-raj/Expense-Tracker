import { FinancialAssistantError } from './errors.ts';
import type {
  BudgetSuggestionProviderInput,
  BudgetSuggestionResult,
  MerchantCategorisationProviderInput,
  MerchantCategorisationResult,
  MonthlySummaryProviderInput,
  MonthlySummaryResult,
  ProviderRequestContext,
} from './types.ts';

/**
 * Provider-neutral AI backend. Phase 3 ships only the unavailable stub.
 *
 * Contract: every adapter MUST honor `context.signal` and `context.deadlineMs`
 * by passing `signal` into `fetch` / SDK abort options. Cancellation is cooperative;
 * do not assume the runtime can kill arbitrary synchronous work.
 */
export interface FinancialAiProvider {
  readonly id: string;

  generateMonthlySummary(
    input: MonthlySummaryProviderInput,
    context: ProviderRequestContext
  ): Promise<MonthlySummaryResult>;

  suggestBudgets(
    input: BudgetSuggestionProviderInput,
    context: ProviderRequestContext
  ): Promise<BudgetSuggestionResult>;

  categorizeMerchant(
    input: MerchantCategorisationProviderInput,
    context: ProviderRequestContext
  ): Promise<MerchantCategorisationResult>;
}

function assertSignalOpen(context: ProviderRequestContext): void {
  if (context.signal.aborted) {
    throw new FinancialAssistantError('timeout', 'Provider aborted', 504);
  }
}

/** Default Phase 3 provider — validates the path without contacting a paid model. */
export class UnavailableFinancialAiProvider implements FinancialAiProvider {
  readonly id = 'unavailable';

  async generateMonthlySummary(
    _input: MonthlySummaryProviderInput,
    context: ProviderRequestContext
  ): Promise<MonthlySummaryResult> {
    assertSignalOpen(context);
    throw new FinancialAssistantError(
      'provider_unavailable',
      'No AI provider configured for monthly_summary',
      503
    );
  }

  async suggestBudgets(
    _input: BudgetSuggestionProviderInput,
    context: ProviderRequestContext
  ): Promise<BudgetSuggestionResult> {
    assertSignalOpen(context);
    throw new FinancialAssistantError(
      'provider_unavailable',
      'No AI provider configured for budget_suggestions',
      503
    );
  }

  async categorizeMerchant(
    _input: MerchantCategorisationProviderInput,
    context: ProviderRequestContext
  ): Promise<MerchantCategorisationResult> {
    assertSignalOpen(context);
    throw new FinancialAssistantError(
      'provider_unavailable',
      'No AI provider configured for categorize_merchant',
      503
    );
  }
}

export function resolveProvider(providerId: string | undefined): FinancialAiProvider {
  const id = (providerId ?? 'unavailable').trim().toLowerCase();
  if (id === 'unavailable' || id === '' || id === 'none') {
    return new UnavailableFinancialAiProvider();
  }
  throw new FinancialAssistantError(
    'provider_unavailable',
    `Unsupported FINANCIAL_AI_PROVIDER "${id}"`,
    503
  );
}
