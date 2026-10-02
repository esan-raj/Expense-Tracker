import type { ConflictInput, ConflictWinner, SyncOperation, SyncQueueItem } from '@/types/sync';

/**
 * Conflict strategy (last-write-wins)
 *
 * Every synced row has `updated_at`. When the same id exists locally and remotely:
 * - Compare ISO timestamps lexicographically (they are UTC).
 * - The newer `updated_at` wins.
 * - Soft deletes (`deleted_at`) participate in the same comparison so a later
 *   delete or undelete is preserved.
 * - Equal timestamps keep the local copy to avoid flicker while a push is pending.
 * - Upserts use the existing primary key, so the same transaction is never
 *   inserted twice.
 */

export function compareUpdatedAt(local: string, remote: string): ConflictWinner {
  if (local === remote) return 'equal';
  return local > remote ? 'local' : 'remote';
}

export function resolveConflict(input: ConflictInput): ConflictWinner {
  if (input.remoteDeletedAt && !input.localDeletedAt) {
    return input.localUpdatedAt > input.remoteUpdatedAt ? 'local' : 'remote';
  }
  if (input.localDeletedAt && !input.remoteDeletedAt) {
    return input.remoteUpdatedAt > input.localUpdatedAt ? 'remote' : 'local';
  }
  return compareUpdatedAt(input.localUpdatedAt, input.remoteUpdatedAt);
}

export function coalesceQueue(
  existing: SyncQueueItem[],
  incoming: Pick<SyncQueueItem, 'entityType' | 'entityId' | 'operation' | 'payload' | 'createdAt'>
): SyncQueueItem[] {
  const sameEntity = existing.filter(
    (item) => item.entityType === incoming.entityType && item.entityId === incoming.entityId
  );
  const others = existing.filter(
    (item) => !(item.entityType === incoming.entityType && item.entityId === incoming.entityId)
  );

  const pendingCreate = sameEntity.find((item) => item.operation === 'create');
  const pendingUpdate = sameEntity.find((item) => item.operation === 'update');

  if (incoming.operation === 'delete') {
    if (pendingCreate) {
      return others.concat(sameEntity.filter((item) => item.operation !== 'create' && item.operation !== 'update'));
    }
    return [
      ...others,
      {
        id: pendingUpdate?.id ?? incoming.entityId,
        entityType: incoming.entityType,
        entityId: incoming.entityId,
        operation: 'delete',
        payload: incoming.payload,
        createdAt: incoming.createdAt,
        retryCount: 0,
        lastError: null,
      },
    ];
  }

  if (incoming.operation === 'update' && pendingCreate) {
    return [
      ...others,
      {
        ...pendingCreate,
        payload: incoming.payload,
        createdAt: incoming.createdAt,
        lastError: null,
      },
    ];
  }

  const replaced = sameEntity.find((item) => item.operation === incoming.operation);
  const remainder = sameEntity.filter((item) => item.operation !== incoming.operation);
  return [
    ...others,
    ...remainder,
    {
      id: replaced?.id ?? incoming.entityId,
      entityType: incoming.entityType,
      entityId: incoming.entityId,
      operation: incoming.operation,
      payload: incoming.payload,
      createdAt: incoming.createdAt,
      retryCount: replaced?.retryCount ?? 0,
      lastError: null,
    },
  ];
}

export const FULL_RESYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
/**
 * Re-reads rows stamped just before the cursor whose transaction committed after the last pull.
 * A server transaction open longer than this can still be skipped by incremental pulls; the
 * periodic full pull recovers it.
 */
export const PULL_CURSOR_OVERLAP_MS = 60 * 1000;

const TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|z|[+-]\d{2}(?::?\d{2})?)$/;

/**
 * Epoch milliseconds of an ISO-8601 / PostgreSQL timestamptz string, or NaN.
 * A timezone is required. Parsed explicitly rather than with Date.parse because Postgres
 * returns microseconds and `+00:00` offsets, which JS engines (including Hermes) do not
 * all parse the same way. Sub-millisecond digits are truncated.
 */
export function parseTimestampMs(value: unknown): number {
  if (typeof value !== 'string') return NaN;
  const match = TIMESTAMP_PATTERN.exec(value.trim());
  if (!match) return NaN;
  const [, y, mo, d, h, mi, s, fraction = '', zone] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return NaN;
  const utc = Date.UTC(year, month - 1, day, hour, minute, second, Number(fraction.slice(0, 3).padEnd(3, '0')));
  // Date.UTC rolls invalid days (2026-02-30) into the next month.
  if (new Date(utc).getUTCDate() !== day) return NaN;
  if (zone === 'Z' || zone === 'z') return utc;
  const digits = zone.slice(1).replace(':', '');
  const offsetHours = Number(digits.slice(0, 2));
  const offsetMinutes = digits.length > 2 ? Number(digits.slice(2)) : 0;
  if (offsetHours > 23 || offsetMinutes > 59) return NaN;
  const sign = zone.startsWith('-') ? -1 : 1;
  return utc - sign * (offsetHours * 60 + offsetMinutes) * 60_000;
}

/** `toISOString()` form of a valid timestamp, or null for empty or malformed input. */
export function normalizeServerTimestamp(value: unknown): string | null {
  const ms = parseTimestampMs(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export type PullColumn = 'updated_at' | 'server_updated_at';

export interface PullPlanInput {
  /** Server clock read right before pulling; null when the server cursor migration is missing. */
  serverNow: string | null;
  cursor: string | null;
  lastFullPullAt: string | null;
  /** Client-clock lastSyncedAt used before the server cursor existed. */
  legacySince: string | null;
}

export interface PullPlan {
  column: PullColumn;
  since: string | null;
  full: boolean;
}

export function planPull(input: PullPlanInput): PullPlan {
  if (!input.serverNow) {
    const legacySince = normalizeServerTimestamp(input.legacySince);
    return { column: 'updated_at', since: legacySince, full: !legacySince };
  }
  const serverMs = parseTimestampMs(input.serverNow);
  const cursorMs = parseTimestampMs(input.cursor);
  const lastFullMs = parseTimestampMs(input.lastFullPullAt);
  // Stamps ahead of the server clock (restored database, clock reversal, corrupt value)
  // would skip rows or postpone the periodic full pull, so they force a full pull, which
  // then stores the current server time.
  const fullDue =
    !Number.isFinite(serverMs) ||
    !Number.isFinite(cursorMs) ||
    !Number.isFinite(lastFullMs) ||
    cursorMs > serverMs ||
    lastFullMs > serverMs ||
    serverMs - lastFullMs >= FULL_RESYNC_INTERVAL_MS;
  if (fullDue) {
    return { column: 'server_updated_at', since: null, full: true };
  }
  return {
    column: 'server_updated_at',
    since: new Date(cursorMs - PULL_CURSOR_OVERLAP_MS).toISOString(),
    full: false,
  };
}

export function nextRetryDelayMs(retryCount: number): number {
  const capped = Math.min(Math.max(retryCount, 0), 3);
  return 1000 * 2 ** capped;
}

export function shouldRetry(retryCount: number, maxRetries = 3): boolean {
  return retryCount < maxRetries;
}

export function mapAuthError(message: string): string {
  const value = message.toLowerCase();
  if (value.includes('invalid login') || value.includes('invalid credentials')) {
    return 'Incorrect email or password.';
  }
  if (value.includes('already registered') || value.includes('already been registered')) {
    return 'An account with this email already exists.';
  }
  if (value.includes('email not confirmed')) {
    return 'Please confirm your email address before logging in.';
  }
  if (value.includes('rate limit') || value.includes('too many')) {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  if (value.includes('network') || value.includes('fetch')) {
    return 'We could not reach the server. Check your connection and try again.';
  }
  return 'Something went wrong. Please try again.';
}

export function formatLastSynced(iso: string | null, now = Date.now()): string {
  if (!iso) return 'Not synced yet';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'Not synced yet';
  const delta = Math.max(0, now - then);
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export function parseQueuePayload<T>(item: SyncQueueItem): T {
  return JSON.parse(item.payload) as T;
}

export function operationLabel(operation: SyncOperation): string {
  return operation;
}

const UPSERT_RANK: Record<string, number> = {
  profile: 0,
  category: 1,
  account: 2,
  investment: 3,
  recurring: 4,
  budget: 5,
  transaction: 6,
};

const DELETE_RANK: Record<string, number> = {
  transaction: 10,
  budget: 11,
  recurring: 12,
  investment: 13,
  account: 14,
  category: 15,
  profile: 16,
};

export function sortQueueForPush<T extends Pick<SyncQueueItem, 'entityType' | 'operation' | 'createdAt'>>(
  items: T[]
): T[] {
  return [...items].sort((a, b) => {
    const rankA = (a.operation === 'delete' ? DELETE_RANK : UPSERT_RANK)[a.entityType] ?? 50;
    const rankB = (b.operation === 'delete' ? DELETE_RANK : UPSERT_RANK)[b.entityType] ?? 50;
    if (rankA !== rankB) return rankA - rankB;
    return a.createdAt.localeCompare(b.createdAt);
  });
}
