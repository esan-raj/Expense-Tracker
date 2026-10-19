/**
 * SpendWise financial assistant Edge Function (Phase 3 foundation).
 *
 * - Auth: user JWT required (platform verify_jwt + auth.getUser)
 * - Provider: FINANCIAL_AI_PROVIDER (default `unavailable`) — no paid calls
 * - Never accept LocalFinancialSnapshot or raw ledger/SMS payloads
 *
 * Deploy is intentionally out of Phase 3 scope.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { handleFinancialAssistantRequest } from './handler.ts';

Deno.serve(async (req: Request) => {
  return handleFinancialAssistantRequest(req, {
    getEnv: (key) => Deno.env.get(key),
    getUserFromJwt: async (jwt) => {
      const url = Deno.env.get('SUPABASE_URL');
      const anon = Deno.env.get('SUPABASE_ANON_KEY');
      if (!url || !anon) return null;

      const client = createClient(url, anon, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { data, error } = await client.auth.getUser(jwt);
      if (error || !data.user?.id) return null;
      return { id: data.user.id };
    },
  });
});
