import { create } from 'zustand';
import NetInfo, { type NetInfoSubscription } from '@react-native-community/netinfo';
import { syncService, subscribeSyncStatus } from '@/services/syncService';
import { syncQueueRepository, syncStateRepository } from '@/database/repositories/syncQueueRepository';
import { getCurrentUserId } from '@/database/session';
import type { SyncStatus } from '@/types/sync';

interface SyncStoreState {
  status: SyncStatus;
  lastSyncedAt: string | null;
  pendingCount: number;
  isOnline: boolean;
  /** Local queue/status only — no NetInfo or Supabase. */
  hydrate: () => Promise<void>;
  /** After UI is ready: watch connectivity and sync with Supabase. */
  startNetworkSync: () => Promise<void>;
  syncNow: () => Promise<void>;
}

let statusSubscribed = false;
let networkSubscription: NetInfoSubscription | null = null;

export const useSyncStore = create<SyncStoreState>((set, get) => ({
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
    if (networkSubscription) {
      if (getCurrentUserId() && get().isOnline) {
        void get().syncNow();
      }
      return;
    }

    const network = await NetInfo.fetch();
    const isOnline = Boolean(network.isConnected && network.isInternetReachable !== false);
    set({
      isOnline,
      status: isOnline ? get().status : 'offline',
    });

    networkSubscription = NetInfo.addEventListener((next) => {
      const online = Boolean(next.isConnected && next.isInternetReachable !== false);
      set({ isOnline: online, status: online ? (get().status === 'offline' ? 'idle' : get().status) : 'offline' });
      if (online && getCurrentUserId()) {
        void get().syncNow();
      }
    });

    if (isOnline && getCurrentUserId()) {
      await get().syncNow();
    }
  },
  syncNow: async () => {
    await syncService.performFullSync();
    const pendingCount = await syncQueueRepository.count();
    const state = await syncStateRepository.get();
    set({ pendingCount, lastSyncedAt: state.lastSyncedAt });
  },
}));
