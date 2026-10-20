import { amountBucket } from '@/services/financialIntelligence/amountBuckets';
import type { AiSafeFinancialSnapshot, AmountBucket } from '@/services/financialIntelligence';
import type { PaymentMethod } from '@/types';
import { createId } from '@/utils/id';
import { cloneAiSafeSnapshotForRequest } from './cloneAiSafeSnapshot';
import type { CloudAiConsentWire } from './consent';
import {
  AI_DESCRIPTION_MAX_CHARS,
  AI_MERCHANT_MAX_CHARS,
  AI_REQUEST_MAX_UTF8_BYTES,
} from './constants';
import { AiClientError } from './errors';
import { redactFinancialText, utf8ByteLength } from './redactFinancialText';

const PAYMENT_METHODS = new Set<PaymentMethod>([
  'cash',
  'upi',
  'credit_card',
  'debit_card',
  'bank_transfer',
  'wallet',
  'other',
]);

const AMOUNT_BUCKETS = new Set<AmountBucket>(['b0_500', 'b500_2k', 'b2k_10k', 'b10k_plus']);

export type SnapshotCapabilityRequest = {
  schemaVersion: 1;
  requestId: string;
  capability: 'monthly_summary' | 'budget_suggestions';
  locale: string;
  currency: string;
  consent: CloudAiConsentWire;
  snapshot: AiSafeFinancialSnapshot;
};

export type CategorizeMerchantRequest = {
  schemaVersion: 1;
  requestId: string;
  capability: 'categorize_merchant';
  locale: string;
  currency: string;
  consent: CloudAiConsentWire;
  snapshotId: string;
  snapshotComputedAt: string;
  payload: {
    merchantLabelRedacted: string;
    descriptionRedacted?: string;
    paymentMethod?: PaymentMethod;
    amountBucket: AmountBucket;
    candidates: Array<{ categoryId: string; categoryName: string }>;
  };
};

export type FinancialAssistantClientRequest = SnapshotCapabilityRequest | CategorizeMerchantRequest;

function assertLocale(locale: string): string {
  if (typeof locale !== 'string' || locale.length === 0 || locale.length > 32) {
    throw new AiClientError('invalid_request', 'locale invalid', { retryable: false });
  }
  return locale;
}

function assertCurrency(currency: string): string {
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
    throw new AiClientError('invalid_request', 'currency must be a 3-letter ISO code', {
      retryable: false,
    });
  }
  return currency;
}

function assertConsent(consent: CloudAiConsentWire): CloudAiConsentWire {
  if (!consent || consent.cloudAi !== true || consent.policyVersion !== 1) {
    throw new AiClientError('opt_in_required', 'consent.cloudAi and policyVersion 1 required', {
      retryable: false,
    });
  }
  return { cloudAi: true, policyVersion: 1 };
}

/** Deterministic JSON for size checks (stable key order via allowlisted construction). */
export function serializeAiRequest(body: FinancialAssistantClientRequest): string {
  return JSON.stringify(body);
}

function assertWithinSizeLimit(body: FinancialAssistantClientRequest): void {
  const serialized = serializeAiRequest(body);
  if (utf8ByteLength(serialized) > AI_REQUEST_MAX_UTF8_BYTES) {
    throw new AiClientError(
      'invalid_request',
      `Request exceeds ${AI_REQUEST_MAX_UTF8_BYTES} UTF-8 bytes`,
      { retryable: false }
    );
  }
}

function buildSnapshotCapability(
  capability: 'monthly_summary' | 'budget_suggestions',
  input: {
    snapshot: AiSafeFinancialSnapshot;
    locale: string;
    consent: CloudAiConsentWire;
    requestId?: string;
  }
): SnapshotCapabilityRequest {
  const snapshot = cloneAiSafeSnapshotForRequest(input.snapshot);
  const body: SnapshotCapabilityRequest = {
    schemaVersion: 1,
    requestId: input.requestId ?? createId(),
    capability,
    locale: assertLocale(input.locale),
    currency: assertCurrency(snapshot.currency),
    consent: assertConsent(input.consent),
    snapshot,
  };
  assertWithinSizeLimit(body);
  return body;
}

export function buildMonthlySummaryRequest(input: {
  snapshot: AiSafeFinancialSnapshot;
  locale: string;
  consent: CloudAiConsentWire;
  requestId?: string;
}): SnapshotCapabilityRequest {
  return buildSnapshotCapability('monthly_summary', input);
}

export function buildBudgetSuggestionsRequest(input: {
  snapshot: AiSafeFinancialSnapshot;
  locale: string;
  consent: CloudAiConsentWire;
  requestId?: string;
}): SnapshotCapabilityRequest {
  return buildSnapshotCapability('budget_suggestions', input);
}

export function buildCategorizeMerchantRequest(input: {
  merchantText: string;
  descriptionText?: string | null;
  paymentMethod?: PaymentMethod | null;
  /** Prefer amountBucket; amountMinor is bucketed deterministically when provided instead. */
  amountBucket?: AmountBucket;
  amountMinor?: number;
  candidates: Array<{ categoryId: string; categoryName: string }>;
  locale: string;
  currency: string;
  consent: CloudAiConsentWire;
  snapshotId: string;
  snapshotComputedAt: string;
  requestId?: string;
}): CategorizeMerchantRequest {
  const merchant = redactFinancialText(input.merchantText, {
    maxChars: AI_MERCHANT_MAX_CHARS,
    maxUtf8Bytes: 240,
  });
  if (!merchant.ok) {
    throw new AiClientError('invalid_request', 'merchant text could not be redacted safely', {
      retryable: false,
    });
  }

  let descriptionRedacted: string | undefined;
  if (input.descriptionText != null && String(input.descriptionText).trim() !== '') {
    const description = redactFinancialText(input.descriptionText, {
      maxChars: AI_DESCRIPTION_MAX_CHARS,
      maxUtf8Bytes: 240,
    });
    if (!description.ok) {
      // Omit unsafe/empty optional description rather than inventing text.
      descriptionRedacted = undefined;
    } else {
      descriptionRedacted = description.text;
    }
  }

  let bucket: AmountBucket;
  if (input.amountBucket != null) {
    if (!AMOUNT_BUCKETS.has(input.amountBucket)) {
      throw new AiClientError('invalid_request', 'amountBucket invalid', { retryable: false });
    }
    bucket = input.amountBucket;
  } else if (input.amountMinor != null) {
    if (typeof input.amountMinor !== 'number' || !Number.isSafeInteger(input.amountMinor) || input.amountMinor < 0) {
      throw new AiClientError('invalid_request', 'amountMinor invalid', { retryable: false });
    }
    bucket = amountBucket(input.amountMinor);
  } else {
    throw new AiClientError('invalid_request', 'amountBucket or amountMinor required', {
      retryable: false,
    });
  }

  let paymentMethod: PaymentMethod | undefined;
  if (input.paymentMethod != null) {
    if (!PAYMENT_METHODS.has(input.paymentMethod)) {
      throw new AiClientError('invalid_request', 'paymentMethod invalid', { retryable: false });
    }
    paymentMethod = input.paymentMethod;
  }

  if (!Array.isArray(input.candidates) || input.candidates.length < 1 || input.candidates.length > 40) {
    throw new AiClientError('invalid_request', 'candidates must have 1–40 entries', { retryable: false });
  }

  const candidates = [...input.candidates]
    .map((row) => ({
      categoryId: String(row.categoryId ?? ''),
      categoryName: String(row.categoryName ?? ''),
    }))
    .filter((row) => row.categoryId.length > 0 && row.categoryName.length > 0)
    .sort(
      (a, b) =>
        a.categoryId.localeCompare(b.categoryId) || a.categoryName.localeCompare(b.categoryName)
    );

  if (candidates.length < 1) {
    throw new AiClientError('invalid_request', 'candidates must have 1–40 entries', { retryable: false });
  }

  const payload: CategorizeMerchantRequest['payload'] = {
    merchantLabelRedacted: merchant.text,
    amountBucket: bucket,
    candidates,
  };
  if (descriptionRedacted) {
    payload.descriptionRedacted = descriptionRedacted;
  }
  if (paymentMethod) {
    payload.paymentMethod = paymentMethod;
  }

  const body: CategorizeMerchantRequest = {
    schemaVersion: 1,
    requestId: input.requestId ?? createId(),
    capability: 'categorize_merchant',
    locale: assertLocale(input.locale),
    currency: assertCurrency(input.currency),
    consent: assertConsent(input.consent),
    snapshotId: String(input.snapshotId),
    snapshotComputedAt: String(input.snapshotComputedAt),
    payload,
  };
  assertWithinSizeLimit(body);
  return body;
}
