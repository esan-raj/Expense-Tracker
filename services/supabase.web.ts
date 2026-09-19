import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabasePublicEnv, isSupabaseConfigured, logSupabaseConfig } from './supabase/config';

const { url, anonKey } = getSupabasePublicEnv();
logSupabaseConfig();

export { isSupabaseConfigured };

function createUnavailableClient(): SupabaseClient {
  return createClient('https://example.supabase.co', 'public-anon-key', {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export const supabase: SupabaseClient = isSupabaseConfigured()
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  : createUnavailableClient();
