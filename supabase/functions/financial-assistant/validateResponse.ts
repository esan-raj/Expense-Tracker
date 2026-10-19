import { MAX_RESPONSE_UTF8_BYTES } from './constants.ts';
import { FinancialAssistantError } from './errors.ts';
import { utf8ByteLength } from './privacy.ts';
import type {
  AiSafeSnapshotWire,
  BudgetSuggestionResult,
  CategorizeMerchantPayload,
  MerchantCategorisationResult,
  MonthlySummaryResult,
  SuggestedActionKind,
} from './types.ts';
import { knownCategoryIds } from './validateSnapshot.ts';

const ACTION_KINDS = new Set<SuggestedActionKind>([
  'navigate_reports',
  'navigate_budgets',
  'review_category',
  'none',
]);

function assertConfidence(value: unknown, label: string): number {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 1) {
    throw new FinancialAssistantError('invalid_model_output', `${label} must be a number in [0,1]`, 502);
  }
  return value;
}

function assertExactLen(text: unknown, max: number, label: string): string {
  if (typeof text !== 'string' || text.length === 0) {
    throw new FinancialAssistantError('invalid_model_output', `${label} missing`, 502);
  }
  if (text.length > max) {
    throw new FinancialAssistantError(
      'invalid_model_output',
      `${label} exceeds ${max} characters`,
      502
    );
  }
  return text;
}

function assertExactKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  label: string
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(obj).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    throw new FinancialAssistantError(
      'invalid_model_output',
      `${label} has unknown fields: ${unknown.join(', ')}`,
      502
    );
  }
}

export function validateMonthlySummaryResult(
  raw: unknown,
  snapshot: AiSafeSnapshotWire
): MonthlySummaryResult {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new FinancialAssistantError('invalid_model_output', 'monthly summary result invalid', 502);
  }
  const obj = raw as Record<string, unknown>;
  assertExactKeys(obj, ['headline', 'bullets', 'interpretations', 'suggestedActions', 'confidence'], 'result');

  if (!Array.isArray(obj.bullets) || obj.bullets.length < 1 || obj.bullets.length > 5) {
    throw new FinancialAssistantError('invalid_model_output', 'bullets must have 1–5 entries', 502);
  }
  if (!Array.isArray(obj.interpretations) || obj.interpretations.length > 3) {
    throw new FinancialAssistantError('invalid_model_output', 'interpretations invalid', 502);
  }
  if (!Array.isArray(obj.suggestedActions) || obj.suggestedActions.length > 3) {
    throw new FinancialAssistantError('invalid_model_output', 'suggestedActions invalid', 502);
  }

  const known = knownCategoryIds(snapshot);

  const interpretations = obj.interpretations.map((item, i) => {
    if (item == null || typeof item !== 'object' || Array.isArray(item)) {
      throw new FinancialAssistantError('invalid_model_output', `interpretations[${i}] invalid`, 502);
    }
    const row = item as Record<string, unknown>;
    const keys = Object.keys(row);
    for (const key of keys) {
      if (key !== 'text' && key !== 'relatedCategoryIds') {
        throw new FinancialAssistantError(
          'invalid_model_output',
          `interpretations[${i}] has unknown fields: ${key}`,
          502
        );
      }
    }
    if (!('text' in row)) {
      throw new FinancialAssistantError('invalid_model_output', `interpretations[${i}].text missing`, 502);
    }
    let relatedCategoryIds: string[] | undefined;
    if (row.relatedCategoryIds != null) {
      if (!Array.isArray(row.relatedCategoryIds) || row.relatedCategoryIds.length > 8) {
        throw new FinancialAssistantError(
          'invalid_model_output',
          `interpretations[${i}].relatedCategoryIds invalid`,
          502
        );
      }
      relatedCategoryIds = row.relatedCategoryIds.map((id, j) => {
        if (typeof id !== 'string' || !known.has(id)) {
          throw new FinancialAssistantError(
            'invalid_model_output',
            `interpretations[${i}].relatedCategoryIds[${j}] not in snapshot`,
            502
          );
        }
        return id;
      });
    }
    return {
      text: assertExactLen(row.text, 200, `interpretations[${i}].text`),
      relatedCategoryIds,
    };
  });

  const suggestedActions = obj.suggestedActions.map((item, i) => {
    if (item == null || typeof item !== 'object' || Array.isArray(item)) {
      throw new FinancialAssistantError('invalid_model_output', `suggestedActions[${i}] invalid`, 502);
    }
    const row = item as Record<string, unknown>;
    const keys = Object.keys(row);
    for (const key of keys) {
      if (key !== 'id' && key !== 'label' && key !== 'kind' && key !== 'categoryId') {
        throw new FinancialAssistantError(
          'invalid_model_output',
          `suggestedActions[${i}] has unknown fields: ${key}`,
          502
        );
      }
    }
    if (typeof row.kind !== 'string' || !ACTION_KINDS.has(row.kind as SuggestedActionKind)) {
      throw new FinancialAssistantError('invalid_model_output', `suggestedActions[${i}].kind invalid`, 502);
    }
    let categoryId: string | undefined;
    if (row.categoryId != null) {
      if (typeof row.categoryId !== 'string' || !known.has(row.categoryId)) {
        throw new FinancialAssistantError(
          'invalid_model_output',
          `suggestedActions[${i}].categoryId not in snapshot`,
          502
        );
      }
      categoryId = row.categoryId;
    }
    if (row.kind === 'review_category' && !categoryId) {
      throw new FinancialAssistantError(
        'invalid_model_output',
        `suggestedActions[${i}] review_category requires categoryId`,
        502
      );
    }
    return {
      id: assertExactLen(row.id, 64, `suggestedActions[${i}].id`),
      label: assertExactLen(row.label, 80, `suggestedActions[${i}].label`),
      kind: row.kind as SuggestedActionKind,
      categoryId,
    };
  });

  return {
    headline: assertExactLen(obj.headline, 120, 'headline'),
    bullets: obj.bullets.map((item, i) => assertExactLen(item, 160, `bullets[${i}]`)),
    interpretations,
    suggestedActions,
    confidence: assertConfidence(obj.confidence, 'confidence'),
  };
}

export function validateBudgetSuggestionResult(
  raw: unknown,
  snapshot: AiSafeSnapshotWire
): BudgetSuggestionResult {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new FinancialAssistantError('invalid_model_output', 'budget suggestion result invalid', 502);
  }
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj);
  for (const key of keys) {
    if (key !== 'requiresConfirmation' && key !== 'overall' && key !== 'categories' && key !== 'caveats') {
      throw new FinancialAssistantError('invalid_model_output', `result has unknown fields: ${key}`, 502);
    }
  }
  if (obj.requiresConfirmation !== true) {
    throw new FinancialAssistantError(
      'invalid_model_output',
      'requiresConfirmation must be true',
      502
    );
  }
  if (!Array.isArray(obj.categories) || obj.categories.length > 15) {
    throw new FinancialAssistantError('invalid_model_output', 'categories invalid', 502);
  }
  if (!Array.isArray(obj.caveats) || obj.caveats.length > 3) {
    throw new FinancialAssistantError('invalid_model_output', 'caveats invalid', 502);
  }

  const known = knownCategoryIds(snapshot);

  const categories = obj.categories.map((item, i) => {
    if (item == null || typeof item !== 'object' || Array.isArray(item)) {
      throw new FinancialAssistantError('invalid_model_output', `categories[${i}] invalid`, 502);
    }
    const row = item as Record<string, unknown>;
    assertExactKeys(row, ['categoryId', 'recommendedMinor', 'rationale', 'confidence'], `categories[${i}]`);
    if (typeof row.categoryId !== 'string' || !known.has(row.categoryId)) {
      throw new FinancialAssistantError(
        'invalid_model_output',
        `categories[${i}].categoryId not in snapshot`,
        502
      );
    }
    if (!Number.isSafeInteger(row.recommendedMinor) || (row.recommendedMinor as number) <= 0) {
      throw new FinancialAssistantError(
        'invalid_model_output',
        `categories[${i}].recommendedMinor invalid`,
        502
      );
    }
    return {
      categoryId: row.categoryId,
      recommendedMinor: row.recommendedMinor as number,
      rationale: assertExactLen(row.rationale, 200, `categories[${i}].rationale`),
      confidence: assertConfidence(row.confidence, `categories[${i}].confidence`),
    };
  });

  const seenBudgetIds = new Set<string>();
  for (const row of categories) {
    if (seenBudgetIds.has(row.categoryId)) {
      throw new FinancialAssistantError(
        'invalid_model_output',
        `duplicate categoryId ${row.categoryId}`,
        502
      );
    }
    seenBudgetIds.add(row.categoryId);
  }
  categories.sort(
    (a, b) => b.confidence - a.confidence || a.categoryId.localeCompare(b.categoryId)
  );

  let overall: BudgetSuggestionResult['overall'];
  if (obj.overall != null) {
    if (typeof obj.overall !== 'object' || Array.isArray(obj.overall)) {
      throw new FinancialAssistantError('invalid_model_output', 'overall invalid', 502);
    }
    const row = obj.overall as Record<string, unknown>;
    assertExactKeys(row, ['recommendedMinor', 'rationale', 'confidence'], 'overall');
    if (!Number.isSafeInteger(row.recommendedMinor) || (row.recommendedMinor as number) <= 0) {
      throw new FinancialAssistantError('invalid_model_output', 'overall.recommendedMinor invalid', 502);
    }
    overall = {
      recommendedMinor: row.recommendedMinor as number,
      rationale: assertExactLen(row.rationale, 200, 'overall.rationale'),
      confidence: assertConfidence(row.confidence, 'overall.confidence'),
    };
  }

  return {
    requiresConfirmation: true,
    overall,
    categories,
    caveats: obj.caveats.map((item, i) => assertExactLen(item, 160, `caveats[${i}]`)),
  };
}

export function validateMerchantCategorisationResult(
  raw: unknown,
  payload: CategorizeMerchantPayload
): MerchantCategorisationResult {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new FinancialAssistantError('invalid_model_output', 'categorize result invalid', 502);
  }
  const obj = raw as Record<string, unknown>;
  assertExactKeys(obj, ['suggestions'], 'result');
  if (!Array.isArray(obj.suggestions) || obj.suggestions.length < 1 || obj.suggestions.length > 3) {
    throw new FinancialAssistantError('invalid_model_output', 'suggestions must have 1–3 entries', 502);
  }

  const allowed = new Set(payload.candidates.map((item) => item.categoryId));
  const suggestions = obj.suggestions.map((item, i) => {
    if (item == null || typeof item !== 'object' || Array.isArray(item)) {
      throw new FinancialAssistantError('invalid_model_output', `suggestions[${i}] invalid`, 502);
    }
    const row = item as Record<string, unknown>;
    assertExactKeys(row, ['categoryId', 'confidence', 'reason'], `suggestions[${i}]`);
    if (typeof row.categoryId !== 'string' || !allowed.has(row.categoryId)) {
      throw new FinancialAssistantError(
        'invalid_model_output',
        `suggestions[${i}].categoryId not in candidates`,
        502
      );
    }
    return {
      categoryId: row.categoryId,
      confidence: assertConfidence(row.confidence, `suggestions[${i}].confidence`),
      reason: assertExactLen(row.reason, 120, `suggestions[${i}].reason`),
    };
  });

  const seen = new Set<string>();
  for (const row of suggestions) {
    if (seen.has(row.categoryId)) {
      throw new FinancialAssistantError(
        'invalid_model_output',
        `duplicate categoryId ${row.categoryId}`,
        502
      );
    }
    seen.add(row.categoryId);
  }

  suggestions.sort(
    (a, b) => b.confidence - a.confidence || a.categoryId.localeCompare(b.categoryId)
  );
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
