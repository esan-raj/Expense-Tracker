import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useBudgetStore } from '@/store/useBudgetStore';
import {
  createDashboardLoader,
  dashboardUserKey,
  loadHomeDashboardSnapshot,
  type DashboardLoadState,
} from '@/services/dashboardSnapshot';

type SnapshotFetch = (args: { userKey: string; month: number; year: number }) => ReturnType<typeof loadHomeDashboardSnapshot>;

export function useDashboardSnapshot(month: number, year: number) {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const userKey = dashboardUserKey(userId);
  const loadBudgets = useBudgetStore((state) => state.load);

  const fetchRef = useRef<SnapshotFetch>((args) => loadHomeDashboardSnapshot({ ...args, loadBudgets }));
  fetchRef.current = (args) => loadHomeDashboardSnapshot({ ...args, loadBudgets });

  const loaderRef = useRef<ReturnType<typeof createDashboardLoader> | null>(null);
  if (!loaderRef.current) {
    loaderRef.current = createDashboardLoader({
      fetchSnapshot: (args) => fetchRef.current(args),
    });
  }
  const loader = loaderRef.current;

  const state = useSyncExternalStore(loader.subscribe, loader.getSnapshot, loader.getSnapshot);

  useEffect(() => {
    loader.setUserKey(userKey);
    void loader.load('initial', month, year);
  }, [loader, userKey, month, year]);

  const reload = useCallback(() => loader.load('initial', month, year), [loader, month, year]);

  const refresh = useCallback(() => loader.load('refresh', month, year), [loader, month, year]);

  return { ...(state as DashboardLoadState), userKey, reload, refresh };
}
