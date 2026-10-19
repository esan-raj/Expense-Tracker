import { RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS } from './constants.ts';
import { FinancialAssistantError } from './errors.ts';

type Bucket = { windowStart: number; count: number };

/** Best-effort per-isolate rate limiter. Not durable across Edge isolates. */
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
