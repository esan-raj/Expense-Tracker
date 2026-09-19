import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { authService } from '@/services/authService';
import { syncService } from '@/services/syncService';
import { syncStateRepository } from '@/database/repositories/syncQueueRepository';
import { setCurrentUserId, setScopedUserId } from '@/database/session';

interface AuthState {
  user: User | null;
  session: Session | null;
  hydrated: boolean;
  /** Local-only restore for startup — no network. */
  hydrate: () => Promise<void>;
  /** After UI is ready: auth listeners, token refresh, local claim. */
  connectCloud: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

let cloudConnected = false;

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  hydrated: false,
  hydrate: async () => {
    const localSync = await syncStateRepository.get();
    const session = await authService.getPersistedSession();
    const user = session?.user ?? null;

    if (user) {
      setCurrentUserId(user.id);
    } else if (localSync.userId) {
      // Keep local finance scope even if the JWT blob is missing/expired.
      setCurrentUserId(localSync.userId);
      setScopedUserId(localSync.userId);
    } else {
      setCurrentUserId(null);
      setScopedUserId(null);
    }

    console.info('[supabase][auth] local session restored:', Boolean(session));
    console.info('[supabase][auth] local user scoped:', Boolean(user ?? localSync.userId));
    set({ session, user, hydrated: true });
  },
  connectCloud: async () => {
    if (cloudConnected) return;
    cloudConnected = true;

    authService.onAuthStateChange((next) => {
      const nextUser = next?.user ?? null;
      if (nextUser) {
        setCurrentUserId(nextUser.id);
      } else {
        setCurrentUserId(null);
      }
      set({ session: next, user: nextUser });
    });

    // May refresh tokens / hit the network — only after first paint.
    let session: Session | null = null;
    try {
      session = await Promise.race([
        authService.getSession(),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), 8_000);
        }),
      ]);
    } catch {
      session = null;
    }

    const user = session?.user ?? get().user;
    if (session?.user) {
      setCurrentUserId(session.user.id);
      set({ session, user: session.user });
    }
    if (user?.id) {
      try {
        await syncService.claimUnassigned(user.id);
      } catch {
        // Local claim can retry on the next sync.
      }
    }
  },
  signIn: async (email, password) => {
    const session = await authService.signIn(email, password);
    setCurrentUserId(session.user.id);
    await syncService.claimLocalData(session.user.id);
    set({ session, user: session.user });
  },
  signUp: async (email, password) => {
    const user = await authService.signUp(email, password);
    const session = await authService.getSession();
    if (session?.user) {
      setCurrentUserId(session.user.id);
      await syncService.claimLocalData(session.user.id);
      set({ session, user: session.user });
      return;
    }
    set({ user, session: null });
  },
  signOut: async () => {
    syncService.stopRealtime();
    await authService.signOut();
    setCurrentUserId(null);
    set({ user: null, session: null });
  },
}));
