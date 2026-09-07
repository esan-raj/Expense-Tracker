import { getRxDatabase } from '@/database';
import { createId } from '@/utils/id';
import { nowIso } from '@/utils/dates';
import { coalesceQueue } from '@/utils/syncLogic';
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

export const syncQueueRepository = {
  async list(): Promise<SyncQueueItem[]> {
    const db = await getRxDatabase();
    const userId = getCurrentUserId();
    const rows = await db.syncQueue
      .find({
        selector: { userId: userId ?? '' },
        sort: [{ createdAt: 'asc' }],
      })
      .exec();
    return rows.map(toItem);
  },

  async enqueue(
    entityType: SyncEntityType,
    entityId: string,
    operation: SyncOperation,
    payload: unknown
  ): Promise<void> {
    const existing = await this.list();
    const next = coalesceQueue(existing, {
      entityType,
      entityId,
      operation,
      payload: JSON.stringify(payload),
      createdAt: nowIso(),
    });

    const db = await getRxDatabase();
    const userId = ownerId();
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
