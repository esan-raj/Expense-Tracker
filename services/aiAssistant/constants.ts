/** Matches Edge Function CLOUD_AI_CONSENT_POLICY_VERSION. */
export const CLOUD_AI_CONSENT_POLICY_VERSION = 1 as const;

/** Matches Edge Function MAX_REQUEST_UTF8_BYTES. */
export const AI_REQUEST_MAX_UTF8_BYTES = 8 * 1024;

/** Bounded client timeout for Edge invocation (ms). */
export const AI_CLIENT_TIMEOUT_MS = 15_000;

export const FINANCIAL_ASSISTANT_FUNCTION = 'financial-assistant' as const;

export const AI_CAPABILITIES = [
  'monthly_summary',
  'budget_suggestions',
  'categorize_merchant',
] as const;

export type AiCapability = (typeof AI_CAPABILITIES)[number];

/** Merchant / description char limits (Edge wire). */
export const AI_MERCHANT_MAX_CHARS = 80;
export const AI_DESCRIPTION_MAX_CHARS = 80;
