import {
  CAPABILITIES,
  CLOUD_AI_CONSENT_POLICY_VERSION,
  FUTURE_TIMESTAMP_SKEW_MS,
  MAX_REQUEST_UTF8_BYTES,
} from './constants.ts';
import { FinancialAssistantError } from './errors.ts';
import { collectProhibitedPaths, looksUnredacted, utf8ByteLength } from './privacy.ts';
import { assertExactKeys, assertObject, assertOptionalExactKeys, assertString } from './schema.ts';
import type {
  CategorizeMerchantPayload,
  CloudAiConsent,
  FinancialAssistantRequest,
  PaymentMethod,
} from './types.ts';
import { validateAiSafeSnapshot } from './validateSnapshot.ts';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURRENCY_RE = /^[A-Z]{3}$/;
const AMOUNT_BUCKETS = new Set(['b0_500', 'b500_2k', 'b2k_10k', 'b10k_plus']);
const PAYMENT_METHODS = new Set<PaymentMethod>([
  'cash',
  'upi',
  'credit_card',
  'debit_card',
  'bank_transfer',
  'wallet',
  'other',
]);

function assertCurrency(value: unknown, label: string): string {
  const text = assertString(value, label, 3);
  if (!CURRENCY_RE.test(text)) {
    throw new FinancialAssistantError('invalid_request', `${label} must be a 3-letter ISO code`, 400);
  }
  return text;
}

function assertUuid(value: unknown, label: string): string {
  const text = assertString(value, label, 80);
  if (UUID_RE.test(text) || /^snap_[0-9a-f]+_\d+$/i.test(text)) return text;
  throw new FinancialAssistantError('invalid_request', `${label} must be a uuid or snap_* id`, 400);
}

function assertIsoNotFuture(value: unknown, label: string, nowMs: number): string {
  const text = assertString(value, label, 64);
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) {
    throw new FinancialAssistantError('invalid_request', `${label} must be ISO-8601`, 400);
  }
  if (ms > nowMs + FUTURE_TIMESTAMP_SKEW_MS) {
    throw new FinancialAssistantError('invalid_request', `${label} must not be in the future`, 400);
  }
  return text;
}

function validateConsent(raw: unknown): CloudAiConsent {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new FinancialAssistantError('opt_in_required', 'consent is required', 400);
  }
  const consent = raw as Record<string, unknown>;
  assertExactKeys(consent, ['cloudAi', 'policyVersion'], 'consent');
  if (consent.cloudAi !== true) {
    throw new FinancialAssistantError('opt_in_required', 'consent.cloudAi must be true', 400);
  }
  if (consent.policyVersion !== CLOUD_AI_CONSENT_POLICY_VERSION) {
    throw new FinancialAssistantError(
      'opt_in_required',
      `consent.policyVersion must be ${CLOUD_AI_CONSENT_POLICY_VERSION}`,
      400
    );
  }
  return { cloudAi: true, policyVersion: 1 };
}

function validateCategorizePayload(raw: unknown): CategorizeMerchantPayload {
  const payload = assertObject(raw, 'payload');
  assertOptionalExactKeys(
    payload,
    ['merchantLabelRedacted', 'amountBucket', 'candidates'],
    ['descriptionRedacted', 'paymentMethod'],
    'payload'
  );

  const merchantLabelRedacted = assertString(payload.merchantLabelRedacted, 'merchantLabelRedacted', 80);
  if (looksUnredacted(merchantLabelRedacted)) {
    throw new FinancialAssistantError(
      'invalid_request',
      'merchantLabelRedacted failed server redaction checks',
      400
    );
  }

  let descriptionRedacted: string | undefined;
  if (payload.descriptionRedacted != null) {
    descriptionRedacted = assertString(payload.descriptionRedacted, 'descriptionRedacted', 80);
    if (looksUnredacted(descriptionRedacted)) {
      throw new FinancialAssistantError(
        'invalid_request',
        'descriptionRedacted failed server redaction checks',
        400
      );
    }
  }

  if (typeof payload.amountBucket !== 'string' || !AMOUNT_BUCKETS.has(payload.amountBucket)) {
    throw new FinancialAssistantError('invalid_request', 'amountBucket invalid', 400);
  }

  let paymentMethod: PaymentMethod | undefined;
  if (payload.paymentMethod != null) {
    if (
      typeof payload.paymentMethod !== 'string' ||
      !PAYMENT_METHODS.has(payload.paymentMethod as PaymentMethod)
    ) {
      throw new FinancialAssistantError('invalid_request', 'paymentMethod invalid', 400);
    }
    paymentMethod = payload.paymentMethod as PaymentMethod;
  }

  if (!Array.isArray(payload.candidates) || payload.candidates.length < 1 || payload.candidates.length > 40) {
    throw new FinancialAssistantError('invalid_request', 'candidates must have 1–40 entries', 400);
  }

  const candidates = payload.candidates.map((item, index) => {
    const row = assertObject(item, `candidates[${index}]`);
    assertOptionalExactKeys(row, ['categoryId', 'categoryName'], [], `candidates[${index}]`);
    return {
      categoryId: assertString(row.categoryId, `candidates[${index}].categoryId`, 128),
      categoryName: assertString(row.categoryName, `candidates[${index}].categoryName`, 80),
    };
  });

  return {
    merchantLabelRedacted,
    descriptionRedacted,
    paymentMethod,
    amountBucket: payload.amountBucket as CategorizeMerchantPayload['amountBucket'],
    candidates,
  };
}

/**
 * Parse and validate the raw HTTP body.
 * Policy: structural invalidity → reject (throw). No silent skip of wire fields.
 */
export function parseAndValidateRequest(rawBody: string, nowMs: number): FinancialAssistantRequest {
  if (utf8ByteLength(rawBody) > MAX_REQUEST_UTF8_BYTES) {
    throw new FinancialAssistantError(
      'invalid_request',
      `Request exceeds ${MAX_REQUEST_UTF8_BYTES} UTF-8 bytes`,
      400
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new FinancialAssistantError('invalid_request', 'Request body must be JSON', 400);
  }

  const prohibited = collectProhibitedPaths(parsed);
  if (prohibited.length > 0) {
    throw new FinancialAssistantError(
      'invalid_request',
      `Prohibited fields present: ${prohibited.slice(0, 5).join(', ')}`,
      400
    );
  }

  const body = assertObject(parsed, 'body');
  if (body.schemaVersion !== 1) {
    throw new FinancialAssistantError('invalid_request', 'schemaVersion must be 1', 400);
  }

  const requestId = assertUuid(body.requestId, 'requestId');
  const capability = body.capability;
  if (typeof capability !== 'string' || !CAPABILITIES.includes(capability as (typeof CAPABILITIES)[number])) {
    throw new FinancialAssistantError('invalid_request', 'capability invalid', 400);
  }

  const locale = assertString(body.locale, 'locale', 32);
  const currency = assertCurrency(body.currency, 'currency');

  if (!Object.prototype.hasOwnProperty.call(body, 'consent')) {
    throw new FinancialAssistantError('opt_in_required', 'consent is required', 400);
  }

  if (capability === 'monthly_summary' || capability === 'budget_suggestions') {
    assertOptionalExactKeys(
      body,
      ['schemaVersion', 'requestId', 'capability', 'locale', 'currency', 'consent', 'snapshot'],
      [],
      'body'
    );
    if ('payload' in body) {
      throw new FinancialAssistantError(
        'invalid_request',
        `${capability} must send snapshot (AiSafeFinancialSnapshot), not payload`,
        400
      );
    }
    const consent = validateConsent(body.consent);
    const snapshot = validateAiSafeSnapshot(body.snapshot, nowMs);
    if (snapshot.currency !== currency) {
      throw new FinancialAssistantError('invalid_request', 'currency must match snapshot.currency', 400);
    }
    return {
      schemaVersion: 1,
      requestId,
      capability,
      locale,
      currency,
      consent,
      snapshot,
    };
  }

  assertOptionalExactKeys(
    body,
    [
      'schemaVersion',
      'requestId',
      'capability',
      'locale',
      'currency',
      'consent',
      'snapshotId',
      'snapshotComputedAt',
      'payload',
    ],
    [],
    'body'
  );

  if ('snapshot' in body) {
    throw new FinancialAssistantError(
      'invalid_request',
      'categorize_merchant must not include a financial snapshot',
      400
    );
  }

  const consent = validateConsent(body.consent);

  return {
    schemaVersion: 1,
    requestId,
    capability: 'categorize_merchant',
    locale,
    currency,
    consent,
    snapshotId: assertUuid(body.snapshotId, 'snapshotId'),
    snapshotComputedAt: assertIsoNotFuture(body.snapshotComputedAt, 'snapshotComputedAt', nowMs),
    payload: validateCategorizePayload(body.payload),
  };
}

export function isSnapshotStale(snapshotComputedAt: string, nowMs: number): boolean {
  const computed = Date.parse(snapshotComputedAt);
  if (Number.isNaN(computed)) return true;
  return nowMs - computed > 24 * 60 * 60 * 1000;
}

export function assertJsonContentType(contentType: string | null): void {
  if (!contentType) {
    throw new FinancialAssistantError('invalid_request', 'Content-Type must be application/json', 415);
  }
  const media = contentType.split(';')[0].trim().toLowerCase();
  if (media !== 'application/json') {
    throw new FinancialAssistantError('invalid_request', 'Content-Type must be application/json', 415);
  }
}
