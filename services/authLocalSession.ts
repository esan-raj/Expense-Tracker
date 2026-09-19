import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabasePublicEnv, isSupabaseConfigured } from '@/services/supabase/config';
import type { Session, User } from '@supabase/supabase-js';

export function authStorageKey(url = getSupabasePublicEnv().url): string {
  try {
    const host = new URL(url).hostname;
    const ref = host.split('.')[0];
    return `sb-${ref}-auth-token`;
  } catch {
    return 'sb-auth-token';
  }
}

export function parseStoredSession(raw: string): Session | null {
  try {
    const parsed = JSON.parse(raw) as {
      currentSession?: Session;
      session?: Session;
      access_token?: string;
      user?: User;
    };
    const candidate = (parsed.currentSession ?? parsed.session ?? parsed) as Session;
    if (candidate?.access_token && candidate?.user?.id) {
      return candidate;
    }
  } catch {
    // Corrupt or unexpected storage shape — treat as signed out locally.
  }
  return null;
}

/**
 * Reads the cached Supabase session from device storage only.
 * Does not refresh tokens or touch the network — safe for offline first paint.
 */
export async function getPersistedAuthSession(): Promise<Session | null> {
  if (!isSupabaseConfigured()) return null;
  const raw = await AsyncStorage.getItem(authStorageKey());
  if (!raw) return null;
  return parseStoredSession(raw);
}
