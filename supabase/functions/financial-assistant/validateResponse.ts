import { MAX_RESPONSE_UTF8_BYTES } from './constants.ts';
import { FinancialAssistantError } from './errors.ts';
import { utf8ByteLength } from './privacy.ts';
import type {
  BudgetSuggestionResult,
  CategorizeMerchantPayload,
  MerchantCategorisationResult,
  MonthlySummaryResult,
} from './types.ts';

function clampConfidence(value: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function assertLen(text: string, max: number, label: string): string {
  if (typeof text !== 'string' || text.length === 0) {
    throw new FinancialAssistantError('invalid_model_output', `${label} missing`, 502);
  }
  return text.length > max ? text.slice(0, max) : text;
}

export function validateMonthlySummaryResult(raw: MonthlySummaryResult): MonthlySummaryResult {
  return {
    headline: assertLen(raw.headline, 120, 'headline'),
    bullets: (raw.bullets ?? []).slice(0, 5).map((item, i) => assertLen(item, 160, `bullets[${i}]`)),
    interpretations: (raw.interpretations ?? []).slice(0, 3).map((item, i) => ({
      text: assertLen(item.text, 200, `interpretations[${i}].text`),
      relatedCategoryIds: item.relatedCategoryIds?.slice(0, 8),
    })),
    suggestedActions: (raw.suggestedActions ?? []).slice(0, 3).map((item, i) => ({
      id: assertLen(item.id, 64, `suggestedActions[${i}].id`),
      label: assertLen(item.label, 80, `suggestedActions[${i}].label`),
      kind: item.kind,
      categoryId: item.categoryId,
    })),
    confidence: clampConfidence(raw.confidence),
  };
}

export function validateBudgetSuggestionResult(raw: BudgetSuggestionResult): BudgetSuggestionResult {
  const categories = (raw.categories ?? []).slice(0, 15).map((item, i) => {
    if (!Number.isSafeInteger(item.recommendedMinor) || item.recommendedMinor <= 0) {
      throw new FinancialAssistantError(
        'invalid_model_output',
        `categories[${i}].recommendedMinor invalid`,
        502
      );
    }
    return {
      categoryId: assertLen(item.categoryId, 128, `categories[${i}].categoryId`),
      recommendedMinor: item.recommendedMinor,
      rationale: assertLen(item.rationale, 200, `categories[${i}].rationale`),
      confidence: clampConfidence(item.confidence),
    };
  });

  let overall = raw.overall;
  if (overall) {
    if (!Number.isSafeInteger(overall.recommendedMinor) || overall.recommendedMinor <= 0) {
      throw new FinancialAssistantError('invalid_model_output', 'overall.recommendedMinor invalid', 502);
    }
    overall = {
      recommendedMinor: overall.recommendedMinor,
      rationale: assertLen(overall.rationale, 200, 'overall.rationale'),
      confidence: clampConfidence(overall.confidence),
    };
  }

  return {
    overall,
    categories,
    caveats: (raw.caveats ?? []).slice(0, 3).map((item, i) => assertLen(item, 160, `caveats[${i}]`)),
  };
}

export function validateMerchantCategorisationResult(
  raw: MerchantCategorisationResult,
  payload: CategorizeMerchantPayload
): MerchantCategorisationResult {
  const allowed = new Set(payload.candidates.map((item) => item.categoryId));
  const suggestions = (raw.suggestions ?? [])
    .filter((item) => allowed.has(item.categoryId))
    .slice(0, 3)
    .map((item, i) => ({
      categoryId: item.categoryId,
      confidence: clampConfidence(item.confidence),
      reason: assertLen(item.reason, 120, `suggestions[${i}].reason`),
    }))
    .sort((a, b) => b.confidence - a.confidence);

  if (suggestions.length === 0) {
    throw new FinancialAssistantError(
      'invalid_model_output',
      'No suggestions remained after candidate filter',
      502
    );
  }

  return { suggestions };
}

export function assertResponseSize(body: string): void {
  if (utf8ByteLength(body) > MAX_RESPONSE_UTF8_BYTES) {
    throw new FinancialAssistantError(
      'invalid_model_output',
      `Response exceeds ${MAX_RESPONSE_UTF8_BYTES} UTF-8 bytes`,
      502
    );
  }
}
