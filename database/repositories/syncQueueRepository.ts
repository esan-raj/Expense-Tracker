import { getRxDatabase } from '@/database';
import { createId } from '@/utils/id';
import { nowIso } from '@/utils/dates';
import { coalesceQueue, normalizeServerTimestamp } from '@/utils/syncLogic';
import { getCurrentUserId } from '@/database/session';
import { emptyToNull, ownerId } from '@/database/query';
import { rxLog } from '@/database/logger';
import type { SyncEntityType, SyncOperation, SyncQueueItem } from '@/types/sync';

function toItem(row: { toMutableJSON: () => import('@/database/types').SyncQueueDoc }): SyncQueueItem {
  const json = row.toMutableJSON();
  return {
    id: json.id,
    entityType: json.entityType as SyncQueueItem['entityType'],
    entityId: json.entityId,
    operation: json.operation as SyncQueueItem['operation'],
    payload: json.payload,
    createdAt: json.createdAt,
    retryCount: json.retryCount,
    lastError: emptyToNull(json.lastError),
  };
}

/** False when the payload names a different owner, or cannot be read at all. */
function payloadOwnedBy(payload: string, userId: string): boolean {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (!parsed || typeof parsed !== 'object') return false;
    const owner = (parsed as { userId?: unknown }).userId;
    return typeof owner !== 'string' || owner === '' || owner === userId;
  } catch {
    return false;
  }
}

export const syncQueueRepository = {
  /** Outbox of `userId`, or of the current session when omitted. */
  async list(userId?: string): Promise<SyncQueueItem[]> {
    const db = await getRxDatabase();
    const owner = userId ?? getCurrentUserId() ?? '';
    const rows = await db.syncQueue
      .find({
        selector: { userId: owner },
        sort: [{ createdAt: 'asc' }],
      })
      .exec();
    return rows.map(toItem);
  },

  async enqueue(
    entityType: SyncEntityType,
    entityId: string,
    operation: SyncOperation,
    payload: unknown,
    options: { userId?: string } = {}
  ): Promise<void> {
    const userId = ownerId(options.userId);
    const existing = await this.list(userId);
    const next = coalesceQueue(existing, {
      entityType,
      entityId,
      operation,
      payload: JSON.stringify(payload),
      createdAt: nowIso(),
    });

    const db = await getRxDatabase();
    const stale = await db.syncQueue
      .find({
        selector: {
          entityType,
          entityId,
          userId,
        },
      })
      .exec();
    await Promise.all(stale.map((row) => row.remove()));
    const fresh = next.filter((entry) => entry.entityType === entityType && entry.entityId === entityId);
    if (fresh.length) {
      await db.syncQueue.bulkInsert(
        fresh.map((item) => ({
          id: item.id || createId(),
          userId,
          entityType: item.entityType,
          entityId: item.entityId,
          operation: item.operation,
          payload: item.payload,
          createdAt: item.createdAt,
          retryCount: item.retryCount ?? 0,
          lastError: item.lastError ?? '',
        }))
      );
    }
    rxLog('sync', operation, { entity: entityType, recordId: entityId });
  },

  async remove(id: string): Promise<void> {
    const db = await getRxDatabase();
    const row = await db.syncQueue.findOne(id).exec();
    if (row) await row.remove();
  },

  /**
   * Remove a pushed entry only if it still holds what was pushed. coalesceQueue reuses the
   * entry id, so an edit queued while the push was in flight must stay for the next push.
   */
  async removeIfUnchanged(item: Pick<SyncQueueItem, 'id' | 'operation' | 'payload'>): Promise<boolean> {
    const db = await getRxDatabase();
    const row = await db.syncQueue.findOne(item.id).exec();
    if (!row || row.payload !== item.payload || row.operation !== item.operation) return false;
    await row.remove();
    return true;
  },

  /** Entity ids of one type still waiting in this account's outbox. */
  async pendingEntityIds(entityType: SyncEntityType, userId: string): Promise<Set<string>> {
    const db = await getRxDatabase();
    const rows = await db.syncQueue.find({ selector: { userId, entityType } }).exec();
    return new Set(rows.map((row) => row.entityId));
  },

  /**
   * Hand outbox entries written without an owner (userId '') to `userId`, but only when the
   * local entity they describe is owned by `userId` (profile entries: entityId is the user id)
   * and the payload names no other owner. Entries for anyone else's data stay untouched.
   * If the account already has an entry for the same entity, the newest one is kept:
   * every entry is a full snapshot or a tombstone, so the newest supersedes older ones.
   * Idempotent; a partial failure is retried by the next call. `assertActive` runs before each
   * entry is changed so a stale session stops without handing over anything more.
   */
  async claimUnowned(
    userId: string,
    ownsEntity: (entityType: SyncEntityType, entityId: string) => Promise<boolean>,
    assertActive?: () => void
  ): Promise<number> {
    if (!userId) return 0;
    const db = await getRxDatabase();
    const unowned = await db.syncQueue.find({ selector: { userId: '' } }).exec();
    let claimed = 0;
    for (const row of unowned) {
      const entityType = row.entityType as SyncEntityType;
      const owned = entityType === 'profile' ? row.entityId === userId : await ownsEntity(entityType, row.entityId);
      if (!owned || !payloadOwnedBy(row.payload, userId)) continue;
      const mine = await db.syncQueue
        .find({ selector: { userId, entityType: row.entityType, entityId: row.entityId } })
        .exec();
      assertActive?.();
      const newest = mine.reduce((best, candidate) => (candidate.createdAt > best.createdAt ? candidate : best), row);
      await Promise.all(mine.filter((candidate) => candidate !== newest).map((candidate) => candidate.remove()));
      if (newest === row) await row.incrementalPatch({ userId });
      else await row.remove();
      claimed += 1;
    }
    if (claimed) rxLog('sync', 'claim', { count: claimed });
    return claimed;
  },

  /** Accounts with an entry queued for this entity ('' for ownerless entries). */
  async queuedOwners(entityType: SyncEntityType, entityId: string): Promise<Set<string>> {
    const db = await getRxDatabase();
    const rows = await db.syncQueue.find({ selector: { entityType, entityId } }).exec();
    return new Set(rows.map((row) => row.userId));
  },

  /** Whether this account still has local changes waiting to upload. Other owners' entries are ignored. */
  async hasPendingForUser(userId: string): Promise<boolean> {
    if (!userId) return false;
    const db = await getRxDatabase();
    return (await db.syncQueue.count({ selector: { userId } }).exec()) > 0;
  },

  async markFailure(id: string, error: string, retryCount: number): Promise<void> {
    const db = await getRxDatabase();
    const row = await db.syncQueue.findOne(id).exec();
    if (!row) return;
    await row.incrementalPatch({ lastError: error, retryCount });
    rxLog('sync', 'retry', { recordId: id, retryCount });
  },

  async count(): Promise<number> {
    const db = await getRxDatabase();
    return db.syncQueue.count().exec();
  },

  async clear(): Promise<void> {
    const db = await getRxDatabase();
    const rows = await db.syncQueue.find().exec();
    await Promise.all(rows.map((row) => row.remove()));
  },
};

export const syncStateRepository = {
  async get(): Promise<{ userId: string | null; lastSyncedAt: string | null; status: string | null; lastError: string | null }> {
    const db = await getRxDatabase();
    const row = await db.syncState.findOne('default').exec();
    if (!row) return { userId: null, lastSyncedAt: null, status: null, lastError: null };
    const json = row.toMutableJSON();
    return {
      userId: emptyToNull(json.userId),
      lastSyncedAt: emptyToNull(json.lastSyncedAt),
      status: emptyToNull(json.status),
      lastError: emptyToNull(json.lastError),
    };
  },

  async save(state: {
    userId?: string | null;
    lastSyncedAt?: string | null;
    status?: string | null;
    lastError?: string | null;
  }): Promise<void> {
    const current = await this.get();
    const db = await getRxDatabase();
    await db.syncState.upsert({
      id: 'default',
      userId: ownerId(state.userId ?? current.userId),
      lastSyncedAt: state.lastSyncedAt ?? current.lastSyncedAt ?? '',
      status: state.status ?? current.status ?? '',
      lastError: state.lastError === undefined ? current.lastError ?? '' : state.lastError ?? '',
    });
  },
};

/**
 * Server-clock pull cursor per user. Stored as extra sync_state documents
 * (value in lastSyncedAt) so no RxDB schema migration is needed.
 */
const PULL_CURSOR_PREFIX = 'pull-cursor:';
const FULL_PULL_PREFIX = 'full-pull:';

async function readStamp(id: string): Promise<string | null> {
  const db = await getRxDatabase();
  const row = await db.syncState.findOne(id).exec();
  return row ? emptyToNull(row.toMutableJSON().lastSyncedAt) : null;
}

async function writeStamp(id: string, userId: string, value: string): Promise<void> {
  const db = await getRxDatabase();
  await db.syncState.upsert({ id, userId, lastSyncedAt: value, status: '', lastError: '' });
}

export const syncCursorRepository = {
  async get(userId: string): Promise<{ cursor: string | null; lastFullPullAt: string | null }> {
    const [cursor, lastFullPullAt] = await Promise.all([
      readStamp(PULL_CURSOR_PREFIX + userId),
      readStamp(FULL_PULL_PREFIX + userId),
    ]);
    // An unreadable stored stamp is treated as missing, which forces a full pull.
    return { cursor: normalizeServerTimestamp(cursor), lastFullPullAt: normalizeServerTimestamp(lastFullPullAt) };
  },

  async save(userId: string, serverTime: string, full: boolean): Promise<void> {
    if (!userId) throw new Error('A pull cursor needs a user.');
    const normalized = normalizeServerTimestamp(serverTime);
    if (!normalized) throw new Error('Refusing to store an invalid pull cursor.');
    await writeStamp(PULL_CURSOR_PREFIX + userId, userId, normalized);
    if (full) await writeStamp(FULL_PULL_PREFIX + userId, userId, normalized);
  },
};
