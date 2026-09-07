/// <reference types="jest" />
import {
  coalesceQueue,
  compareUpdatedAt,
  formatLastSynced,
  mapAuthError,
  nextRetryDelayMs,
  resolveConflict,
  shouldRetry,
  sortQueueForPush,
} from '@/utils/syncLogic';
import type { SyncQueueItem } from '@/types/sync';

function item(
  overrides: Partial<SyncQueueItem> & Pick<SyncQueueItem, 'entityId' | 'operation'>
): SyncQueueItem {
  return {
    id: overrides.id ?? overrides.entityId,
    entityType: overrides.entityType ?? 'transaction',
    entityId: overrides.entityId,
    operation: overrides.operation,
    payload: overrides.payload ?? '{}',
    createdAt: overrides.createdAt ?? '2026-09-05T10:00:00.000Z',
    retryCount: overrides.retryCount ?? 0,
    lastError: overrides.lastError ?? null,
  };
}

describe('conflict resolution', () => {
  it('uses last-write-wins on updated_at', () => {
    expect(compareUpdatedAt('2026-09-05T10:00:00.000Z', '2026-09-05T11:00:00.000Z')).toBe('remote');
    expect(compareUpdatedAt('2026-09-05T12:00:00.000Z', '2026-09-05T11:00:00.000Z')).toBe('local');
    expect(compareUpdatedAt('2026-09-05T10:00:00.000Z', '2026-09-05T10:00:00.000Z')).toBe('equal');
  });

  it('keeps the newer side when one record is soft-deleted', () => {
    expect(
      resolveConflict({
        localUpdatedAt: '2026-09-05T12:00:00.000Z',
        remoteUpdatedAt: '2026-09-05T11:00:00.000Z',
        localDeletedAt: '2026-09-05T12:00:00.000Z',
        remoteDeletedAt: null,
      })
    ).toBe('local');

    expect(
      resolveConflict({
        localUpdatedAt: '2026-09-05T10:00:00.000Z',
        remoteUpdatedAt: '2026-09-05T11:00:00.000Z',
        localDeletedAt: null,
        remoteDeletedAt: '2026-09-05T11:00:00.000Z',
      })
    ).toBe('remote');
  });
});

describe('sync queue coalesce', () => {
  it('folds an update into a pending create', () => {
    const next = coalesceQueue(
      [item({ entityId: 'abc', operation: 'create', payload: '{"title":"A"}' })],
      {
        entityType: 'transaction',
        entityId: 'abc',
        operation: 'update',
        payload: '{"title":"B"}',
        createdAt: '2026-09-05T10:01:00.000Z',
      }
    );
    expect(next).toHaveLength(1);
    expect(next[0].operation).toBe('create');
    expect(next[0].payload).toBe('{"title":"B"}');
  });

  it('drops create+delete so a never-uploaded row is not synced', () => {
    const next = coalesceQueue(
      [item({ entityId: 'abc', operation: 'create' })],
      {
        entityType: 'transaction',
        entityId: 'abc',
        operation: 'delete',
        payload: '{"id":"abc"}',
        createdAt: '2026-09-05T10:01:00.000Z',
      }
    );
    expect(next.find((entry) => entry.entityId === 'abc')).toBeUndefined();
  });

  it('replaces a pending update with a delete', () => {
    const next = coalesceQueue(
      [item({ entityId: 'abc', operation: 'update' })],
      {
        entityType: 'transaction',
        entityId: 'abc',
        operation: 'delete',
        payload: '{"id":"abc","deletedAt":"now"}',
        createdAt: '2026-09-05T10:01:00.000Z',
      }
    );
    expect(next).toHaveLength(1);
    expect(next[0].operation).toBe('delete');
  });
});

describe('retry strategy', () => {
  it('uses exponential backoff and stops after three retries', () => {
    expect(nextRetryDelayMs(0)).toBe(1000);
    expect(nextRetryDelayMs(1)).toBe(2000);
    expect(nextRetryDelayMs(2)).toBe(4000);
    expect(shouldRetry(0)).toBe(true);
    expect(shouldRetry(2)).toBe(true);
    expect(shouldRetry(3)).toBe(false);
  });
});

describe('auth error mapping', () => {
  it('never returns raw supabase messages', () => {
    expect(mapAuthError('Invalid login credentials')).toBe('Incorrect email or password.');
    expect(mapAuthError('User already registered')).toBe('An account with this email already exists.');
    expect(mapAuthError('Email not confirmed')).toBe('Please confirm your email address before logging in.');
    expect(mapAuthError('Failed to fetch')).toBe('We could not reach the server. Check your connection and try again.');
    expect(mapAuthError('something obscure from supabase')).toBe('Something went wrong. Please try again.');
  });
});

describe('queue push order', () => {
  it('uploads categories before transactions and deletes children first', () => {
    const ordered = sortQueueForPush([
      item({ entityId: 'tx', entityType: 'transaction', operation: 'create', createdAt: '2026-09-05T10:00:00.000Z' }),
      item({ entityId: 'cat', entityType: 'category', operation: 'create', createdAt: '2026-09-05T10:00:01.000Z' }),
      item({ entityId: 'old-tx', entityType: 'transaction', operation: 'delete', createdAt: '2026-09-05T10:00:02.000Z' }),
      item({ entityId: 'old-cat', entityType: 'category', operation: 'delete', createdAt: '2026-09-05T10:00:03.000Z' }),
    ]);
    expect(ordered.map((entry) => `${entry.operation}:${entry.entityType}`)).toEqual([
      'create:category',
      'create:transaction',
      'delete:transaction',
      'delete:category',
    ]);
  });

  it('uploads accounts before transactions and deletes accounts after child transactions', () => {
    const ordered = sortQueueForPush([
      item({ entityId: 'tx', entityType: 'transaction', operation: 'create', createdAt: '2026-09-05T10:00:00.000Z' }),
      item({ entityId: 'acc', entityType: 'account', operation: 'create', createdAt: '2026-09-05T10:00:02.000Z' }),
      item({ entityId: 'cat', entityType: 'category', operation: 'create', createdAt: '2026-09-05T10:00:03.000Z' }),
      item({ entityId: 'old-tx', entityType: 'transaction', operation: 'delete', createdAt: '2026-09-05T10:00:04.000Z' }),
      item({ entityId: 'old-acc', entityType: 'account', operation: 'delete', createdAt: '2026-09-05T10:00:05.000Z' }),
    ]);
    expect(ordered.map((entry) => `${entry.operation}:${entry.entityType}`)).toEqual([
      'create:category',
      'create:account',
      'create:transaction',
      'delete:transaction',
      'delete:account',
    ]);
  });
});

describe('last synced label', () => {
  const now = Date.parse('2026-09-05T12:00:00.000Z');

  it('formats relative times', () => {
    expect(formatLastSynced('2026-09-05T11:59:30.000Z', now)).toBe('just now');
    expect(formatLastSynced('2026-09-05T11:58:00.000Z', now)).toBe('2 minutes ago');
    expect(formatLastSynced('2026-09-05T10:00:00.000Z', now)).toBe('2 hours ago');
    expect(formatLastSynced(null, now)).toBe('Not synced yet');
  });
});
