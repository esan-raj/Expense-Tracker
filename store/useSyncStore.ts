import { create } from 'zustand';
import NetInfo, { type NetInfoState, type NetInfoSubscription } from '@react-native-community/netinfo';
import { syncService, subscribeSyncStatus } from '@/services/syncService';
import { syncQueueRepository, syncStateRepository } from '@/database/repositories/syncQueueRepository';
import { getCurrentUserId } from '@/database/session';
import { setLocalChangeHandler } from '@/services/outbox';
import { logError } from '@/utils/errors';
import type { SyncStatus } from '@/types/sync';

interface SyncStoreState {
  status: SyncStatus;
  lastSyncedAt: string | null;
  pendingCount: number;
  isOnline: boolean;
  /** Local queue/status only — no NetInfo or Supabase. */
  hydrate: () => Promise<void>;
  /** After UI is ready: watch connectivity and sync with Supabase. Safe to call repeatedly. */
  startNetworkSync: () => Promise<void>;
  /** Single-flight: concurrent callers share one full sync and one status refresh. */
  syncNow: () => Promise<void>;
}

let statusSubscribed = false;
/** Resolves once the app-lifetime NetInfo listener and local-change handler are installed. */
let networkStart: Promise<void> | null = null;
let syncNowPromise: Promise<void> | null = null;
/** A local write arrived while syncNow was already past the point of picking it up. */
let localChangeDuringSync = false;

function isReachable(state: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>): boolean {
  return Boolean(state.isConnected && state.isInternetReachable !== false);
}

export const useSyncStore = create<SyncStoreState>((set, get) => {
  const runSync = (label: string) => {
    void get()
      .syncNow()
      .catch((error) => logError(label, error));
  };

  const requestLocalChangeSync = () => {
    if (!get().isOnline || !getCurrentUserId()) return;
    if (syncNowPromise) {
      localChangeDuringSync = true;
      return;
    }
    runSync('sync.local-change');
  };

  async function initializeNetworkSync(): Promise<void> {
    const network = await NetInfo.fetch();
    let subscription: NetInfoSubscription | null = null;
    try {
      subscription = NetInfo.addEventListener((next) => {
        const online = isReachable(next);
        set({ isOnline: online, status: online ? (get().status === 'offline' ? 'idle' : get().status) : 'offline' });
        if (online && getCurrentUserId()) runSync('sync.network-change');
      });
      setLocalChangeHandler(requestLocalChangeSync);
    } catch (error) {
      subscription?.();
      setLocalChangeHandler(null);
      throw error;
    }
    const isOnline = isReachable(network);
    set({ isOnline, status: isOnline ? get().status : 'offline' });
  }

  return {
    status: 'idle',
    lastSyncedAt: null,
    pendingCount: 0,
    isOnline: true,
    hydrate: async () => {
      const state = await syncStateRepository.get();
      const pendingCount = await syncQueueRepository.count();
      set({
        lastSyncedAt: state.lastSyncedAt,
        pendingCount,
        // Assume reachable until post-ready NetInfo says otherwise — never block startup.
        isOnline: true,
        status: (state.status as SyncStatus) || 'idle',
      });
      if (!statusSubscribed) {
        statusSubscribed = true;
        subscribeSyncStatus((status, lastSyncedAt, pending) => {
          set({ status, lastSyncedAt, pendingCount: pending });
        });
      }
    },
    startNetworkSync: async () => {
      if (!networkStart) {
        networkStart = initializeNetworkSync().catch((error: unknown) => {
          networkStart = null;
          throw error;
        });
      }
      await networkStart;

      // Can be called again once the session is known; startup may open the UI before it is.
      if (get().isOnline && getCurrentUserId()) {
        await get().syncNow();
      }
    },
    syncNow: () => {
      if (!syncNowPromise) {
        syncNowPromise = Promise.resolve()
          .then(async () => {
            await syncService.performFullSync();
            const pendingCount = await syncQueueRepository.count();
            const state = await syncStateRepository.get();
            set({ pendingCount, lastSyncedAt: state.lastSyncedAt });
          })
          .finally(() => {
            syncNowPromise = null;
            if (localChangeDuringSync) {
              localChangeDuringSync = false;
              requestLocalChangeSync();
            }
          });
      }
      return syncNowPromise;
    },
  };
});
