import { supabase, isSupabaseConfigured } from '@/services/supabase';
import { getPersistedAuthSession } from '@/services/authLocalSession';
import { getAuthSiteUrl, getPasswordResetRedirectUrl } from '@/utils/authRedirect';
import { AppError, logError } from '@/utils/errors';
import { mapAuthError } from '@/utils/syncLogic';
import type { User, Session } from '@supabase/supabase-js';

export const authService = {
  configured: isSupabaseConfigured,

  getPersistedSession: getPersistedAuthSession,

  async getSession(): Promise<Session | null> {
    if (!isSupabaseConfigured()) return null;
    const { data } = await supabase.auth.getSession();
    return data.session;
  },

  async getUser(): Promise<User | null> {
    if (!isSupabaseConfigured()) return null;
    const { data } = await supabase.auth.getUser();
    return data.user;
  },

  async signUp(email: string, password: string): Promise<User | null> {
    if (!isSupabaseConfigured()) {
      throw new AppError('Cloud sync is not configured yet. You can keep using SpendWise offline.');
    }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: getAuthSiteUrl() ?? undefined },
    });
    if (error) {
      logError('auth.signUp', error);
      throw new AppError(mapAuthError(error.message), error);
    }
    return data.user;
  },

  async signIn(email: string, password: string): Promise<Session> {
    if (!isSupabaseConfigured()) {
      throw new AppError('Cloud sync is not configured yet. You can keep using SpendWise offline.');
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      logError('auth.signIn', error);
      throw new AppError(mapAuthError(error?.message ?? 'Invalid login credentials'), error);
    }
    return data.session;
  },

  async signOut(): Promise<void> {
    if (!isSupabaseConfigured()) return;
    const { error } = await supabase.auth.signOut();
    if (error) {
      logError('auth.signOut', error);
      throw new AppError('We could not log you out. Please try again.', error);
    }
  },

  async resetPassword(email: string): Promise<void> {
    if (!isSupabaseConfigured()) {
      throw new AppError('Cloud sync is not configured yet.');
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getPasswordResetRedirectUrl(),
    });
    if (error) {
      logError('auth.reset', error);
      throw new AppError(mapAuthError(error.message), error);
    }
  },

  onAuthStateChange(callback: (session: Session | null) => void) {
    if (!isSupabaseConfigured()) {
      return { data: { subscription: { unsubscribe() {} } } };
    }
    return supabase.auth.onAuthStateChange((_event, session) => {
      callback(session);
    });
  },
};
