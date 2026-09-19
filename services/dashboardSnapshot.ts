import { toUserMessage } from '@/utils/errors';
import { getFinanceRevision } from '@/services/financeRevision';

export const DASHBOARD_LOAD_TIMEOUT_MS = 15_000;

export type DashboardPhase = 'initial' | 'ready' | 'refreshing' | 'error';
export type DashboardData = Awaited<ReturnType<(typeof import('@/services/reportService'))['reportService']['dashboard']>>;

export type HomeDashboardSnapshot = {
  userKey: string;
  periodKey: string;
  revision: number;
  dashboard: DashboardData;
};

export type DashboardLoadState = {
  snapshot: HomeDashboardSnapshot | null;
  status: DashboardPhase;
  error: string | null;
};

export function dashboardUserKey(userId: string | null | undefined): string {
  return userId ?? 'local';
}

export function dashboardPeriodKey(month: number, year: number): string {
  return `${year}-${month}`;
}

export function resolveDashboardPhase(args: {
  snapshot: HomeDashboardSnapshot | null;
  currentUserKey: string;
  periodKey: string;
  loading: boolean;
  error: string | null;
}): DashboardPhase {
  const matches =
    args.snapshot?.userKey === args.currentUserKey && args.snapshot.periodKey === args.periodKey;
  if (!matches) {
    return args.error ? 'error' : 'initial';
  }
  if (args.loading) return 'refreshing';
  return 'ready';
}

export function shouldAcceptDashboardResult(args: {
  requestId: number;
  latestRequestId: number;
  resultUserKey: string;
  currentUserKey: string;
}): boolean {
  return args.requestId === args.latestRequestId && args.resultUserKey === args.currentUserKey;
}

export async function loadHomeDashboardSnapshot(args: {
  userKey: string;
  month: number;
  year: number;
  loadBudgets: () => Promise<void>;
}): Promise<HomeDashboardSnapshot> {
  const { reportService } = await import('@/services/reportService');
  const [dashboard] = await Promise.all([
    reportService.dashboard(args.month, args.year),
    args.loadBudgets(),
  ]);
  return {
    userKey: args.userKey,
    periodKey: dashboardPeriodKey(args.month, args.year),
    revision: getFinanceRevision(),
    dashboard,
  };
}

type FetchSnapshot = (args: {
  userKey: string;
  month: number;
  year: number;
}) => Promise<HomeDashboardSnapshot>;

export function createDashboardLoader(deps: {
  fetchSnapshot: FetchSnapshot;
  timeoutMs?: number;
}) {
  const timeoutMs = deps.timeoutMs ?? DASHBOARD_LOAD_TIMEOUT_MS;
  let requestId = 0;
  let userKey = 'local';
  let snapshot: HomeDashboardSnapshot | null = null;
  let status: DashboardPhase = 'initial';
  let error: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let published: DashboardLoadState = { snapshot, status, error };
  const listeners = new Set<() => void>();

  const emit = () => {
    published = { snapshot, status, error };
    listeners.forEach((listener) => listener());
  };

  const clearTimer = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const getSnapshot = () => published;

  const setUserKey = (next: string) => {
    if (userKey === next) return;
    userKey = next;
    requestId += 1;
    snapshot = null;
    error = null;
    status = 'initial';
    clearTimer();
    emit();
  };

  const load = async (_mode: 'initial' | 'refresh', month: number, year: number) => {
    const id = ++requestId;
    const key = userKey;
    const periodKey = dashboardPeriodKey(month, year);
    const keepVisible = snapshot?.userKey === key && snapshot.periodKey === periodKey;
    if (keepVisible) {
      status = 'refreshing';
    } else {
      snapshot = null;
      status = 'initial';
    }
    error = null;
    emit();

    clearTimer();
    timer = setTimeout(() => {
      if (id !== requestId) return;
      if (snapshot?.userKey === key && snapshot.periodKey === periodKey) return;
      error = 'Your finances are taking longer than expected. Retry when you are ready.';
      status = 'error';
      emit();
    }, timeoutMs);

    try {
      const next = await deps.fetchSnapshot({ userKey: key, month, year });
      if (
        !shouldAcceptDashboardResult({
          requestId: id,
          latestRequestId: requestId,
          resultUserKey: next.userKey,
          currentUserKey: userKey,
        })
      ) {
        return;
      }
      snapshot = next;
      status = 'ready';
      error = null;
    } catch (err) {
      if (
        !shouldAcceptDashboardResult({
          requestId: id,
          latestRequestId: requestId,
          resultUserKey: key,
          currentUserKey: userKey,
        })
      ) {
        return;
      }
      error = toUserMessage(err, 'We could not load your dashboard.');
      status = keepVisible ? 'ready' : 'error';
    } finally {
      if (id === requestId) clearTimer();
      if (
        shouldAcceptDashboardResult({
          requestId: id,
          latestRequestId: requestId,
          resultUserKey: key,
          currentUserKey: userKey,
        })
      ) {
        emit();
      }
    }
  };

  return {
    subscribe,
    getSnapshot,
    setUserKey,
    load,
    getUserKey: () => userKey,
    getRequestId: () => requestId,
  };
}
