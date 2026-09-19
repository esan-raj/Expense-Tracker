/// <reference types="jest" />
import {
  createDashboardLoader,
  dashboardPeriodKey,
  dashboardUserKey,
  resolveDashboardPhase,
  shouldAcceptDashboardResult,
  type DashboardData,
  type HomeDashboardSnapshot,
} from '@/services/dashboardSnapshot';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function snapshotFor(userKey: string, month = 9, year = 2026, income = 100): HomeDashboardSnapshot {
  return {
    userKey,
    periodKey: dashboardPeriodKey(month, year),
    revision: 1,
    dashboard: { income } as DashboardData,
  };
}

describe('dashboard snapshot helpers', () => {
  it('scopes anonymous sessions separately from signed-in users', () => {
    expect(dashboardUserKey(undefined)).toBe('local');
    expect(dashboardUserKey('user-a')).toBe('user-a');
  });

  it('does not treat unloaded data as a ready empty dashboard', () => {
    expect(
      resolveDashboardPhase({
        snapshot: null,
        currentUserKey: 'user-a',
        periodKey: '2026-9',
        loading: true,
        error: null,
      })
    ).toBe('initial');
  });

  it('keeps a matching snapshot in refresh rather than returning to initial', () => {
    expect(
      resolveDashboardPhase({
        snapshot: snapshotFor('user-a'),
        currentUserKey: 'user-a',
        periodKey: '2026-9',
        loading: true,
        error: null,
      })
    ).toBe('refreshing');
  });

  it('rejects results that belong to another user or an older request', () => {
    expect(
      shouldAcceptDashboardResult({
        requestId: 1,
        latestRequestId: 2,
        resultUserKey: 'user-a',
        currentUserKey: 'user-a',
      })
    ).toBe(false);
    expect(
      shouldAcceptDashboardResult({
        requestId: 2,
        latestRequestId: 2,
        resultUserKey: 'user-a',
        currentUserKey: 'user-b',
      })
    ).toBe(false);
    expect(
      shouldAcceptDashboardResult({
        requestId: 2,
        latestRequestId: 2,
        resultUserKey: 'user-b',
        currentUserKey: 'user-b',
      })
    ).toBe(true);
  });
});

describe('dashboard loader coordination', () => {
  afterEach(() => {
    jest.useRealTimers();
  });
  it('commits one snapshot and ignores an overlapping older fetch', async () => {
    const first = deferred<HomeDashboardSnapshot>();
    const second = deferred<HomeDashboardSnapshot>();
    let calls = 0;
    const loader = createDashboardLoader({
      fetchSnapshot: async () => {
        calls += 1;
        return calls === 1 ? first.promise : second.promise;
      },
    });
    loader.setUserKey('user-a');
    const older = loader.load('refresh', 9, 2026);
    const newer = loader.load('refresh', 9, 2026);
    first.resolve(snapshotFor('user-a', 9, 2026, 1));
    second.resolve(snapshotFor('user-a', 9, 2026, 2));
    await Promise.all([older, newer]);
    expect(loader.getSnapshot().status).toBe('ready');
    expect(loader.getSnapshot().snapshot?.dashboard.income).toBe(2);
  });

  it('clears the previous user immediately and drops their in-flight snapshot', async () => {
    const first = deferred<HomeDashboardSnapshot>();
    const loader = createDashboardLoader({
      fetchSnapshot: async ({ userKey }) => {
        if (userKey === 'user-a') return first.promise;
        return snapshotFor(userKey, 9, 2026, 50);
      },
    });
    loader.setUserKey('user-a');
    const pending = loader.load('initial', 9, 2026);
    loader.setUserKey('user-b');
    expect(loader.getSnapshot().snapshot).toBeNull();
    expect(loader.getSnapshot().status).toBe('initial');
    first.resolve(snapshotFor('user-a', 9, 2026, 99));
    await pending;
    expect(loader.getSnapshot().snapshot).toBeNull();
    await loader.load('initial', 9, 2026);
    expect(loader.getSnapshot().snapshot?.userKey).toBe('user-b');
    expect(loader.getSnapshot().snapshot?.dashboard.income).toBe(50);
  });

  it('offers a recoverable error on initial failure and can retry', async () => {
    let fail = true;
    const loader = createDashboardLoader({
      fetchSnapshot: async ({ userKey }) => {
        if (fail) throw new Error('disk unavailable');
        return snapshotFor(userKey, 9, 2026, 7);
      },
    });
    loader.setUserKey('user-a');
    await loader.load('initial', 9, 2026);
    expect(loader.getSnapshot().status).toBe('error');
    expect(loader.getSnapshot().snapshot).toBeNull();
    expect(loader.getSnapshot().error).toMatch(/could not load your dashboard/i);
    fail = false;
    await loader.load('initial', 9, 2026);
    expect(loader.getSnapshot().status).toBe('ready');
    expect(loader.getSnapshot().snapshot?.dashboard.income).toBe(7);
  });

  it('keeps already loaded totals visible while a refresh is in flight', async () => {
    const pending = deferred<HomeDashboardSnapshot>();
    let calls = 0;
    const loader = createDashboardLoader({
      fetchSnapshot: async ({ userKey }) => {
        calls += 1;
        if (calls === 1) return snapshotFor(userKey, 9, 2026, 10);
        return pending.promise;
      },
    });
    loader.setUserKey('user-a');
    await loader.load('initial', 9, 2026);
    const refresh = loader.load('refresh', 9, 2026);
    expect(loader.getSnapshot().status).toBe('refreshing');
    expect(loader.getSnapshot().snapshot?.dashboard.income).toBe(10);
    pending.resolve(snapshotFor('user-a', 9, 2026, 20));
    await refresh;
    expect(loader.getSnapshot().status).toBe('ready');
    expect(loader.getSnapshot().snapshot?.dashboard.income).toBe(20);
  });

  it('keeps the visible snapshot when a later refresh fails', async () => {
    let fail = false;
    const loader = createDashboardLoader({
      fetchSnapshot: async ({ userKey }) => {
        if (fail) throw new Error('refresh failed');
        return snapshotFor(userKey, 9, 2026, 12);
      },
    });
    loader.setUserKey('user-a');
    await loader.load('initial', 9, 2026);
    fail = true;
    await loader.load('refresh', 9, 2026);
    expect(loader.getSnapshot().status).toBe('ready');
    expect(loader.getSnapshot().snapshot?.dashboard.income).toBe(12);
    expect(loader.getSnapshot().error).toMatch(/could not load your dashboard/i);
  });

  it('stops the initial spinner after a timeout instead of waiting forever', async () => {
    jest.useFakeTimers();
    const hanging = deferred<HomeDashboardSnapshot>();
    const loader = createDashboardLoader({
      timeoutMs: 40,
      fetchSnapshot: async () => hanging.promise,
    });
    loader.setUserKey('user-a');
    const pending = loader.load('initial', 9, 2026);
    expect(loader.getSnapshot().status).toBe('initial');
    jest.advanceTimersByTime(40);
    expect(loader.getSnapshot().status).toBe('error');
    expect(loader.getSnapshot().snapshot).toBeNull();
    hanging.resolve(snapshotFor('user-a', 9, 2026, 3));
    await pending;
    expect(loader.getSnapshot().status).toBe('ready');
    expect(loader.getSnapshot().snapshot?.dashboard.income).toBe(3);
    jest.useRealTimers();
  });
});
