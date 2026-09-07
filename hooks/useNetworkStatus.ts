import { useSyncStore } from '@/store/useSyncStore';

export function useNetworkStatus() {
  const isOnline = useSyncStore((state) => state.isOnline);
  return { isOnline, isOffline: !isOnline };
}
