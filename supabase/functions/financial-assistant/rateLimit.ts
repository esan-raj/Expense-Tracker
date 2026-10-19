import { RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS } from './constants.ts';
import { FinancialAssistantError } from './errors.ts';

type Bucket = { windowStart: number; count: number };

/**
 * Best-effort per-isolate rate limiter. Not durable across Edge isolates.
 * Production deploy of financial-assistant is blocked until durable per-user
 * rate limiting and provider budget controls are designed (see Phase 3 docs).
 * Multiple instances can bypass this Map. Future fail-open vs fail-closed
 * durable limiter behaviour remains an explicit undecided decision.
 */
const buckets = new Map<string, Bucket>();

export function resetRateLimitForTests(): void {
  buckets.clear();
}

export function assertWithinRateLimit(userId: string, nowMs = Date.now()): void {
  const current = buckets.get(userId);
  if (!current || nowMs - current.windowStart >= RATE_LIMIT_WINDOW_MS) {
    buckets.set(userId, { windowStart: nowMs, count: 1 });
    return;
  }
  if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
    throw new FinancialAssistantError('rate_limit', 'Too many AI assistant requests; try again shortly', 429);
  }
  current.count += 1;
}
