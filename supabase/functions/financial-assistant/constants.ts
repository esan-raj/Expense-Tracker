/** Documented AI request limit (UTF-8 bytes). */
export const MAX_REQUEST_UTF8_BYTES = 8 * 1024;

/** Documented AI response limit (UTF-8 bytes). */
export const MAX_RESPONSE_UTF8_BYTES = 16 * 1024;

/** Snapshot older than this is marked stale (still processed). */
export const STALE_SNAPSHOT_MS = 24 * 60 * 60 * 1000;

/** Reject snapshotComputedAt more than this far ahead of server now. */
export const FUTURE_TIMESTAMP_SKEW_MS = 60 * 1000;

/** Hard timeout around provider calls (fail closed). */
export const PROVIDER_TIMEOUT_MS = 12_000;

/** Best-effort in-memory rate limit (non-durable across isolates). */
export const RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const RATE_LIMIT_MAX_REQUESTS = 20;

export const CAPABILITIES = [
  'monthly_summary',
  'budget_suggestions',
  'categorize_merchant',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Supported per-request cloud AI consent policy version. */
export const CLOUD_AI_CONSENT_POLICY_VERSION = 1 as const;
