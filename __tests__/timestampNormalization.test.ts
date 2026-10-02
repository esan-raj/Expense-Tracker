/// <reference types="jest" />
let mockIdCounter = 0;
jest.mock('@/utils/id', () => ({ createId: () => `id-${(mockIdCounter += 1)}` }));

const rpc = jest.fn();
jest.mock('@/services/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
  isSupabaseConfigured: () => true,
}));

import { getRxDatabase } from '@/database';
import { syncCursorRepository } from '@/database/repositories/syncQueueRepository';
import { remoteApi } from '@/services/supabase/remote';
import {
  FULL_RESYNC_INTERVAL_MS,
  PULL_CURSOR_OVERLAP_MS,
  normalizeServerTimestamp,
  parseTimestampMs,
  planPull,
} from '@/utils/syncLogic';

const INSTANT = Date.UTC(2026, 9, 1, 12, 34, 56, 789);

describe('parseTimestampMs', () => {
  it.each([
    ['ISO with milliseconds', '2026-10-01T12:34:56.789Z'],
    ['PostgreSQL microseconds and +00:00', '2026-10-01 12:34:56.789123+00:00'],
    ['nanosecond digits', '2026-10-01T12:34:56.789999999Z'],
    ['positive offset with colon', '2026-10-01T18:04:56.789+05:30'],
    ['negative offset without colon', '2026-10-01T05:34:56.789-0700'],
    ['hour-only offset', '2026-10-01T14:34:56.789+02'],
    ['lower-case separators', '2026-10-01t12:34:56.789z'],
    ['surrounding whitespace', '  2026-10-01T12:34:56.789Z  '],
  ])('reads %s', (_label, value) => {
    expect(parseTimestampMs(value)).toBe(INSTANT);
  });

  it('reads whole seconds and short fractions', () => {
    expect(parseTimestampMs('2026-10-01T12:34:56Z')).toBe(INSTANT - 789);
    expect(parseTimestampMs('2026-10-01T12:34:56.7Z')).toBe(INSTANT - 89);
  });

  it('truncates sub-millisecond digits instead of rounding into the next millisecond', () => {
    expect(parseTimestampMs('2026-10-01T23:59:59.999999+00:00')).toBe(Date.UTC(2026, 9, 1, 23, 59, 59, 999));
  });

  it('accepts a real leap day', () => {
    expect(parseTimestampMs('2028-02-29T00:00:00Z')).toBe(Date.UTC(2028, 1, 29));
  });

  it.each([
    ['no timezone', '2026-10-01T12:34:56.789'],
    ['date only', '2026-10-01'],
    ['empty string', ''],
    ['free text', 'yesterday'],
    ['impossible day', '2026-02-30T00:00:00Z'],
    ['non-leap 29 February', '2026-02-29T00:00:00Z'],
    ['month 13', '2026-13-01T00:00:00Z'],
    ['hour 24', '2026-10-01T24:00:00Z'],
    ['minute 60', '2026-10-01T12:60:00Z'],
    ['leap second', '2026-10-01T12:34:60Z'],
    ['offset hour 24', '2026-10-01T12:34:56+24:00'],
    ['offset minute 60', '2026-10-01T12:34:56+05:60'],
    ['three-digit year', '0999-10-01T12:34:56Z'],
    ['ten fractional digits', '2026-10-01T12:34:56.0123456789Z'],
  ])('rejects %s', (_label, value) => {
    expect(parseTimestampMs(value)).toBeNaN();
  });

  it.each([[null], [undefined], [1696163696789], [{}]])('rejects the non-string %p', (value) => {
    expect(parseTimestampMs(value)).toBeNaN();
  });
});

describe('normalizeServerTimestamp', () => {
  it('maps every spelling of one instant to the same ISO string', () => {
    const spellings = [
      '2026-10-01T12:34:56.789Z',
      '2026-10-01 12:34:56.789456+00:00',
      '2026-10-01T18:04:56.789+05:30',
    ];
    expect(new Set(spellings.map(normalizeServerTimestamp))).toEqual(new Set(['2026-10-01T12:34:56.789Z']));
  });

  it('returns null for missing or malformed input', () => {
    expect(normalizeServerTimestamp(null)).toBeNull();
    expect(normalizeServerTimestamp('')).toBeNull();
    expect(normalizeServerTimestamp('2026-10-01T12:34:56')).toBeNull();
  });
});

describe('planPull with server timestamps', () => {
  const serverNow = '2026-10-01 12:00:00.123456+00:00';
  const serverMs = Date.UTC(2026, 9, 1, 12, 0, 0, 123);

  it('pulls incrementally from a PostgreSQL-format cursor', () => {
    const plan = planPull({
      serverNow,
      cursor: '2026-10-01 11:00:00.5+00:00',
      lastFullPullAt: '2026-10-01 06:00:00+00:00',
      legacySince: null,
    });
    expect(plan).toEqual({
      column: 'server_updated_at',
      since: new Date(Date.UTC(2026, 9, 1, 11, 0, 0, 500) - PULL_CURSOR_OVERLAP_MS).toISOString(),
      full: false,
    });
  });

  it.each([
    ['a corrupt cursor', { cursor: 'garbage', lastFullPullAt: '2026-10-01T06:00:00Z' }],
    ['a cursor without timezone', { cursor: '2026-10-01T11:00:00', lastFullPullAt: '2026-10-01T06:00:00Z' }],
    ['a cursor ahead of the server', { cursor: '2026-10-01T12:05:00Z', lastFullPullAt: '2026-10-01T06:00:00Z' }],
    ['a full-pull stamp ahead of the server', { cursor: '2026-10-01T11:00:00Z', lastFullPullAt: '2026-10-02T00:00:00Z' }],
    [
      'a full pull older than the interval',
      { cursor: '2026-10-01T11:00:00Z', lastFullPullAt: new Date(serverMs - FULL_RESYNC_INTERVAL_MS).toISOString() },
    ],
  ])('forces a full pull for %s', (_label, stamps) => {
    expect(planPull({ serverNow, legacySince: null, ...stamps })).toEqual({
      column: 'server_updated_at',
      since: null,
      full: true,
    });
  });

  it('normalizes the legacy cursor and falls back to a full pull when it is unreadable', () => {
    expect(planPull({ serverNow: null, cursor: null, lastFullPullAt: null, legacySince: '2026-10-01 10:00:00+00:00' })).toEqual({
      column: 'updated_at',
      since: '2026-10-01T10:00:00.000Z',
      full: false,
    });
    expect(planPull({ serverNow: null, cursor: null, lastFullPullAt: null, legacySince: 'not a date' })).toEqual({
      column: 'updated_at',
      since: null,
      full: true,
    });
  });
});

describe('syncCursorRepository', () => {
  it('stores the normalized server time per account', async () => {
    await syncCursorRepository.save('user-a', '2026-10-01 12:00:00.123456+00:00', true);
    await syncCursorRepository.save('user-b', '2026-10-01T09:00:00Z', false);

    expect(await syncCursorRepository.get('user-a')).toEqual({
      cursor: '2026-10-01T12:00:00.123Z',
      lastFullPullAt: '2026-10-01T12:00:00.123Z',
    });
    expect(await syncCursorRepository.get('user-b')).toEqual({ cursor: '2026-10-01T09:00:00.000Z', lastFullPullAt: null });
  });

  it('refuses to store an invalid cursor or one without an account, keeping the previous value', async () => {
    await syncCursorRepository.save('user-c', '2026-10-01T08:00:00Z', true);

    await expect(syncCursorRepository.save('user-c', 'garbage', false)).rejects.toThrow('invalid pull cursor');
    await expect(syncCursorRepository.save('', '2026-10-01T09:00:00Z', false)).rejects.toThrow('needs a user');

    expect((await syncCursorRepository.get('user-c')).cursor).toBe('2026-10-01T08:00:00.000Z');
  });

  it('treats an unreadable stored cursor as missing so the next pull is full', async () => {
    const db = await getRxDatabase();
    await db.syncState.upsert({ id: 'pull-cursor:user-d', userId: 'user-d', lastSyncedAt: 'corrupt', status: '', lastError: '' });

    expect(await syncCursorRepository.get('user-d')).toEqual({ cursor: null, lastFullPullAt: null });
  });
});

describe('remoteApi.serverTime', () => {
  beforeEach(() => rpc.mockReset());

  it('normalizes the PostgreSQL timestamp returned by sync_server_time()', async () => {
    rpc.mockResolvedValue({ data: '2026-10-01 12:00:00.123456+00:00', error: null });
    await expect(remoteApi.serverTime()).resolves.toBe('2026-10-01T12:00:00.123Z');
    expect(rpc).toHaveBeenCalledWith('sync_server_time');
  });

  it('returns null only while the function is not deployed', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    await expect(remoteApi.serverTime()).resolves.toBeNull();
  });

  it('fails on permission errors instead of silently using the legacy pull', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(remoteApi.serverTime()).rejects.toMatchObject({ code: '42501' });
  });

  it.each([['garbage'], [null], ['2026-10-01T12:00:00']])('fails on an unusable value %p', async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(remoteApi.serverTime()).rejects.toThrow('invalid timestamp');
  });
});
