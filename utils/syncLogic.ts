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
  recurring: 3,
  budget: 4,
  transaction: 5,
};

const DELETE_RANK: Record<string, number> = {
  transaction: 10,
  budget: 11,
  recurring: 12,
  account: 13,
  category: 14,
  profile: 15,
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
