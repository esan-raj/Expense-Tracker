import { CAPABILITIES, MAX_REQUEST_UTF8_BYTES } from './constants.ts';
import { FinancialAssistantError } from './errors.ts';
import { collectProhibitedPaths, looksUnredacted, utf8ByteLength } from './privacy.ts';
import type {
  AiSafeSnapshotWire,
  CategorizeMerchantPayload,
  FinancialAssistantRequest,
  PaymentMethod,
} from './types.ts';

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

function assertObject(value: unknown, label: string): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new FinancialAssistantError('invalid_request', `${label} must be an object`, 400);
  }
  return value as Record<string, unknown>;
}

function assertString(value: unknown, label: string, maxLen?: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new FinancialAssistantError('invalid_request', `${label} must be a non-empty string`, 400);
  }
  if (maxLen != null && value.length > maxLen) {
    throw new FinancialAssistantError('invalid_request', `${label} exceeds ${maxLen} characters`, 400);
  }
  return value;
}

function assertUuid(value: unknown, label: string): string {
  const text = assertString(value, label, 80);
  // Allow RFC UUID or Phase 2 snapshot ids (`snap_<rev>_<n>`).
  if (UUID_RE.test(text) || /^snap_[0-9a-f]+_\d+$/i.test(text)) {
    return text;
  }
  throw new FinancialAssistantError('invalid_request', `${label} must be a uuid or snap_* id`, 400);
}

function assertIsoDate(value: unknown, label: string): string {
  const text = assertString(value, label, 64);
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) {
    throw new FinancialAssistantError('invalid_request', `${label} must be ISO-8601`, 400);
  }
  return text;
}

function assertCurrency(value: unknown, label: string): string {
  const text = assertString(value, label, 3);
  if (!CURRENCY_RE.test(text)) {
    throw new FinancialAssistantError('invalid_request', `${label} must be a 3-letter ISO code`, 400);
  }
  return text;
}

function validateAiSafeSnapshot(raw: unknown): AiSafeSnapshotWire {
  const snap = assertObject(raw, 'snapshot');

  if (snap.kind === 'local') {
    throw new FinancialAssistantError(
      'invalid_request',
      'LocalFinancialSnapshot is not permitted on the wire',
      400
    );
  }
  if (snap.kind !== 'ai_safe') {
    throw new FinancialAssistantError('invalid_request', 'snapshot.kind must be ai_safe', 400);
  }
  if (snap.schemaVersion !== 1) {
    throw new FinancialAssistantError('invalid_request', 'snapshot.schemaVersion must be 1', 400);
  }

  const period = assertObject(snap.period, 'snapshot.period');
  const month = period.month;
  const year = period.year;
  if (typeof month !== 'number' || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new FinancialAssistantError('invalid_request', 'snapshot.period.month invalid', 400);
  }
  if (typeof year !== 'number' || !Number.isInteger(year) || year < 1970 || year > 2100) {
    throw new FinancialAssistantError('invalid_request', 'snapshot.period.year invalid', 400);
  }

  const flags = assertObject(snap.flags, 'snapshot.flags');
  if (flags.transferExcluded !== true) {
    throw new FinancialAssistantError('invalid_request', 'snapshot.flags.transferExcluded must be true', 400);
  }

  const currency = assertCurrency(snap.currency, 'snapshot.currency');
  const snapshotId = assertUuid(snap.snapshotId, 'snapshot.snapshotId');
  const snapshotComputedAt = assertIsoDate(snap.snapshotComputedAt, 'snapshot.snapshotComputedAt');

  if (typeof snap.financeRevision !== 'number' || !Number.isSafeInteger(snap.financeRevision)) {
    throw new FinancialAssistantError('invalid_request', 'snapshot.financeRevision invalid', 400);
  }
  if (typeof snap.contentRevision !== 'string' || snap.contentRevision.length === 0) {
    throw new FinancialAssistantError('invalid_request', 'snapshot.contentRevision invalid', 400);
  }

  const periodStatus = snap.periodStatus;
  if (periodStatus !== 'active' && periodStatus !== 'completed' && periodStatus !== 'future') {
    throw new FinancialAssistantError('invalid_request', 'snapshot.periodStatus invalid', 400);
  }

  return {
    ...(snap as AiSafeSnapshotWire),
    schemaVersion: 1,
    kind: 'ai_safe',
    snapshotId,
    snapshotComputedAt,
    currency,
    period: { month, year },
    periodStatus,
    flags: {
      hasIncome: Boolean(flags.hasIncome),
      hasExpenses: Boolean(flags.hasExpenses),
      transferExcluded: true,
      insufficientData: Boolean(flags.insufficientData),
    },
  };
}

function validateCategorizePayload(raw: unknown): CategorizeMerchantPayload {
  const payload = assertObject(raw, 'payload');
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
    if (typeof payload.paymentMethod !== 'string' || !PAYMENT_METHODS.has(payload.paymentMethod as PaymentMethod)) {
      throw new FinancialAssistantError('invalid_request', 'paymentMethod invalid', 400);
    }
    paymentMethod = payload.paymentMethod as PaymentMethod;
  }

  if (!Array.isArray(payload.candidates) || payload.candidates.length < 1 || payload.candidates.length > 40) {
    throw new FinancialAssistantError('invalid_request', 'candidates must have 1–40 entries', 400);
  }

  const candidates = payload.candidates.map((item, index) => {
    const row = assertObject(item, `candidates[${index}]`);
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
export function parseAndValidateRequest(rawBody: string): FinancialAssistantRequest {
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

  if (capability === 'monthly_summary' || capability === 'budget_suggestions') {
    if ('payload' in body) {
      throw new FinancialAssistantError(
        'invalid_request',
        `${capability} must send snapshot (AiSafeFinancialSnapshot), not payload`,
        400
      );
    }
    const snapshot = validateAiSafeSnapshot(body.snapshot);
    if (snapshot.currency !== currency) {
      throw new FinancialAssistantError(
        'invalid_request',
        'currency must match snapshot.currency',
        400
      );
    }
    return {
      schemaVersion: 1,
      requestId,
      capability,
      locale,
      currency,
      snapshot,
    };
  }

  // categorize_merchant
  if ('snapshot' in body) {
    throw new FinancialAssistantError(
      'invalid_request',
      'categorize_merchant must not include a financial snapshot',
      400
    );
  }

  return {
    schemaVersion: 1,
    requestId,
    capability: 'categorize_merchant',
    locale,
    currency,
    snapshotId: assertUuid(body.snapshotId, 'snapshotId'),
    snapshotComputedAt: assertIsoDate(body.snapshotComputedAt, 'snapshotComputedAt'),
    payload: validateCategorizePayload(body.payload),
  };
}

export function isSnapshotStale(snapshotComputedAt: string, nowMs: number): boolean {
  const computed = Date.parse(snapshotComputedAt);
  if (Number.isNaN(computed)) return true;
  return nowMs - computed > 24 * 60 * 60 * 1000;
}
