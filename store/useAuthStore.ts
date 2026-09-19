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
  hydrate: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  hydrated: false,
  hydrate: async () => {
    const session = await authService.getSession();
    const user = session?.user ?? null;
    console.info('[supabase][auth] session restored:', Boolean(session));
    console.info('[supabase][auth] user authenticated:', Boolean(user));
    if (user) {
      setCurrentUserId(user.id);
      await syncService.claimUnassigned(user.id);
    } else {
      setCurrentUserId(null);
      const state = await syncStateRepository.get();
      setScopedUserId(state.userId);
    }
    set({ session, user, hydrated: true });
    authService.onAuthStateChange((next) => {
      const nextUser = next?.user ?? null;
      if (nextUser) {
        setCurrentUserId(nextUser.id);
      } else {
        setCurrentUserId(null);
      }
      set({ session: next, user: nextUser });
    });
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
