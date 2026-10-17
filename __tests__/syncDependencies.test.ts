/// <reference types="jest" />
import { collectSyncDependencyRefs, missingDependencyIds } from '@/utils/syncDependencies';
import type { SyncQueueItem } from '@/types/sync';

function item(
  overrides: Partial<SyncQueueItem> & Pick<SyncQueueItem, 'entityType' | 'entityId' | 'operation' | 'payload'>
): SyncQueueItem {
  return {
    id: overrides.id ?? overrides.entityId,
    entityType: overrides.entityType,
    entityId: overrides.entityId,
    operation: overrides.operation,
    payload: overrides.payload,
    createdAt: overrides.createdAt ?? '2026-09-19T10:00:00.000Z',
    retryCount: overrides.retryCount ?? 0,
    lastError: overrides.lastError ?? null,
  };
}

describe('sync dependency collection', () => {
  it('finds category and account ids referenced by pending transactions', () => {
    const refs = collectSyncDependencyRefs([
      item({
        entityType: 'transaction',
        entityId: 'tx-1',
        operation: 'create',
        payload: JSON.stringify({ categoryId: 'cat-food', accountId: 'acct-1' }),
      }),
      item({
        entityType: 'budget',
        entityId: 'bud-1',
        operation: 'update',
        payload: JSON.stringify({ categoryId: 'cat-food' }),
      }),
      item({
        entityType: 'category',
        entityId: 'cat-other',
        operation: 'update',
        payload: JSON.stringify({ id: 'cat-other' }),
      }),
    ]);

    expect(refs.categoryIds).toEqual(['cat-food']);
    expect(refs.accountIds).toEqual(['acct-1']);
  });

  it('reports categories that are referenced but not yet queued', () => {
    const queue = [
      item({
        entityType: 'transaction',
        entityId: 'tx-1',
        operation: 'create',
        payload: JSON.stringify({ categoryId: 'cat-missing' }),
      }),
      item({
        entityType: 'category',
        entityId: 'cat-present',
        operation: 'update',
        payload: '{}',
      }),
    ];
    const refs = collectSyncDependencyRefs(queue);
    expect(missingDependencyIds(refs.categoryIds, queue, 'category')).toEqual(['cat-missing']);
  });

  it('ignores delete operations and empty foreign keys', () => {
    const refs = collectSyncDependencyRefs([
      item({
        entityType: 'transaction',
        entityId: 'tx-1',
        operation: 'delete',
        payload: JSON.stringify({ categoryId: 'cat-x', deletedAt: '2026-09-19T10:00:00.000Z' }),
      }),
      item({
        entityType: 'transaction',
        entityId: 'tx-2',
        operation: 'create',
        payload: JSON.stringify({ categoryId: '', accountId: null }),
      }),
    ]);
    expect(refs.categoryIds).toEqual([]);
    expect(refs.accountIds).toEqual([]);
  });
});
