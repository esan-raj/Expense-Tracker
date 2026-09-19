import { create } from 'zustand';
import NetInfo from '@react-native-community/netinfo';
import { syncService, subscribeSyncStatus } from '@/services/syncService';
import { syncQueueRepository, syncStateRepository } from '@/database/repositories/syncQueueRepository';
import { getCurrentUserId } from '@/database/session';
import type { SyncStatus } from '@/types/sync';

interface SyncStoreState {
  status: SyncStatus;
  lastSyncedAt: string | null;
  pendingCount: number;
  isOnline: boolean;
  hydrate: () => Promise<void>;
  syncNow: () => Promise<void>;
}

export const useSyncStore = create<SyncStoreState>((set, get) => ({
  status: 'idle',
  lastSyncedAt: null,
  pendingCount: 0,
  isOnline: true,
  hydrate: async () => {
    const state = await syncStateRepository.get();
    const pendingCount = await syncQueueRepository.count();
    const network = await NetInfo.fetch();
    const isOnline = Boolean(network.isConnected && network.isInternetReachable !== false);
    set({
      lastSyncedAt: state.lastSyncedAt,
      pendingCount,
      isOnline,
      status: isOnline ? (state.status as SyncStatus) || 'idle' : 'offline',
    });
    subscribeSyncStatus((status, lastSyncedAt, pending) => {
      set({ status, lastSyncedAt, pendingCount: pending });
    });
    NetInfo.addEventListener((next) => {
      const online = Boolean(next.isConnected && next.isInternetReachable !== false);
      set({ isOnline: online, status: online ? get().status : 'offline' });
      if (online && getCurrentUserId()) {
        void get().syncNow();
      }
    });
  },
  syncNow: async () => {
    await syncService.performFullSync();
    const pendingCount = await syncQueueRepository.count();
    const state = await syncStateRepository.get();
    set({ pendingCount, lastSyncedAt: state.lastSyncedAt });
  },
}));
