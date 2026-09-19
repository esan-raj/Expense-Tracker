import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useBudgetStore } from '@/store/useBudgetStore';
import {
  createDashboardLoader,
  dashboardPeriodKey,
  dashboardUserKey,
  loadHomeDashboardSnapshot,
  type DashboardLoadState,
} from '@/services/dashboardSnapshot';
import { peekDashboardSeed } from '@/services/dashboardSeed';

type SnapshotFetch = (args: { userKey: string; month: number; year: number }) => ReturnType<typeof loadHomeDashboardSnapshot>;

export function useDashboardSnapshot(month: number, year: number) {
  const hydrated = useAuthStore((state) => state.hydrated);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const userKey = dashboardUserKey(userId);
  const loadBudgets = useBudgetStore((state) => state.load);
  const periodKey = dashboardPeriodKey(month, year);

  const fetchRef = useRef<SnapshotFetch>((args) => loadHomeDashboardSnapshot({ ...args, loadBudgets }));
  fetchRef.current = (args) => loadHomeDashboardSnapshot({ ...args, loadBudgets });

  const loaderRef = useRef<ReturnType<typeof createDashboardLoader> | null>(null);
  if (!loaderRef.current) {
    loaderRef.current = createDashboardLoader({
      fetchSnapshot: (args) => fetchRef.current(args),
      seed: peekDashboardSeed(userKey, periodKey),
    });
  }
  const loader = loaderRef.current;

  const state = useSyncExternalStore(loader.subscribe, loader.getSnapshot, loader.getSnapshot);

  useEffect(() => {
    if (!hydrated) return;
    loader.setUserKey(userKey);
    const seeded = peekDashboardSeed(userKey, periodKey);
    if (seeded && !loader.getSnapshot().snapshot) {
      // Seed was for a different key at construction; force a fresh load.
      void loader.load('initial', month, year);
      return;
    }
    if (loader.getSnapshot().snapshot?.userKey === userKey && loader.getSnapshot().snapshot?.periodKey === periodKey) {
      return;
    }
    void loader.load('initial', month, year);
  }, [loader, hydrated, userKey, month, year, periodKey]);

  const reload = useCallback(() => {
    if (!hydrated) return Promise.resolve();
    return loader.load('initial', month, year);
  }, [loader, hydrated, month, year]);

  const refresh = useCallback(() => {
    if (!hydrated) return Promise.resolve();
    return loader.load('refresh', month, year);
  }, [loader, hydrated, month, year]);

  return { ...(state as DashboardLoadState), userKey, reload, refresh };
}
