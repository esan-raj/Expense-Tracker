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
 * Do not import vendor SDKs here — add a new class when a provider is chosen.
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

/** Default Phase 3 provider — validates the path without contacting a paid model. */
export class UnavailableFinancialAiProvider implements FinancialAiProvider {
  readonly id = 'unavailable';

  async generateMonthlySummary(
    _input: MonthlySummaryProviderInput,
    _context: ProviderRequestContext
  ): Promise<MonthlySummaryResult> {
    throw new FinancialAssistantError(
      'provider_unavailable',
      'No AI provider configured for monthly_summary',
      503
    );
  }

  async suggestBudgets(
    _input: BudgetSuggestionProviderInput,
    _context: ProviderRequestContext
  ): Promise<BudgetSuggestionResult> {
    throw new FinancialAssistantError(
      'provider_unavailable',
      'No AI provider configured for budget_suggestions',
      503
    );
  }

  async categorizeMerchant(
    _input: MerchantCategorisationProviderInput,
    _context: ProviderRequestContext
  ): Promise<MerchantCategorisationResult> {
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
  // Unknown ids fail closed — never invent a silent fallback that calls a vendor.
  throw new FinancialAssistantError(
    'provider_unavailable',
    `Unsupported FINANCIAL_AI_PROVIDER "${id}"`,
    503
  );
}
