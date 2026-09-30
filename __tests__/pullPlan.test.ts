/// <reference types="jest" />
import { FULL_RESYNC_INTERVAL_MS, PULL_CURSOR_OVERLAP_MS, planPull } from '@/utils/syncLogic';

const serverNow = '2026-09-30T18:00:00.000Z';
const hoursAgo = (h: number) => new Date(Date.parse(serverNow) - h * 3600_000).toISOString();

describe('planPull', () => {
  it('falls back to the client-clock updated_at cursor before migration 008', () => {
    expect(planPull({ serverNow: null, cursor: null, lastFullPullAt: null, legacySince: hoursAgo(1) })).toEqual({
      column: 'updated_at',
      since: hoursAgo(1),
      full: false,
    });
  });

  it('does a full pull the first time the server cursor is available', () => {
    expect(planPull({ serverNow, cursor: null, lastFullPullAt: null, legacySince: hoursAgo(1) })).toEqual({
      column: 'server_updated_at',
      since: null,
      full: true,
    });
  });

  it('pulls incrementally from the server cursor minus the overlap', () => {
    const cursor = hoursAgo(2);
    expect(planPull({ serverNow, cursor, lastFullPullAt: hoursAgo(3), legacySince: null })).toEqual({
      column: 'server_updated_at',
      since: new Date(Date.parse(cursor) - PULL_CURSOR_OVERLAP_MS).toISOString(),
      full: false,
    });
  });

  it('forces a full pull once a day', () => {
    const lastFullPullAt = new Date(Date.parse(serverNow) - FULL_RESYNC_INTERVAL_MS).toISOString();
    expect(planPull({ serverNow, cursor: hoursAgo(1), lastFullPullAt, legacySince: null }).full).toBe(true);
  });
});
