import type { SyncEntityType, SyncQueueItem } from '@/types/sync';

export type SyncDependencyRefs = {
  categoryIds: string[];
  accountIds: string[];
};

/** Collect local FK ids referenced by pending outbox payloads. */
export function collectSyncDependencyRefs(
  queue: Array<Pick<SyncQueueItem, 'entityType' | 'operation' | 'payload' | 'entityId'>>
): SyncDependencyRefs {
  const categoryIds = new Set<string>();
  const accountIds = new Set<string>();

  for (const item of queue) {
    if (item.operation === 'delete') continue;
    if (
      item.entityType !== 'transaction' &&
      item.entityType !== 'budget' &&
      item.entityType !== 'recurring' &&
      item.entityType !== 'investment'
    ) {
      continue;
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(item.payload) as Record<string, unknown>;
    } catch {
      continue;
    }

    const categoryId = typeof payload.categoryId === 'string' ? payload.categoryId : '';
    const accountId = typeof payload.accountId === 'string' ? payload.accountId : '';
    if (categoryId) categoryIds.add(categoryId);
    if (accountId) accountIds.add(accountId);
  }

  return {
    categoryIds: [...categoryIds],
    accountIds: [...accountIds],
  };
}

export function missingDependencyIds(
  needed: string[],
  alreadyQueued: Array<Pick<SyncQueueItem, 'entityType' | 'entityId'>>,
  entityType: SyncEntityType
): string[] {
  const queued = new Set(
    alreadyQueued.filter((item) => item.entityType === entityType).map((item) => item.entityId)
  );
  return needed.filter((id) => id && !queued.has(id));
}
