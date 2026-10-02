import { supabase, isSupabaseConfigured } from '@/services/supabase';
import type { Account, AppSettings, Budget, Category, Investment, RecurringTransaction, Transaction } from '@/types';
import {
  fromRemoteAccount,
  fromRemoteBudget,
  fromRemoteCategory,
  fromRemoteInvestment,
  fromRemoteRecurring,
  fromRemoteTransaction,
  toRemoteAccount,
  toRemoteBudget,
  toRemoteCategory,
  toRemoteInvestment,
  toRemoteProfile,
  toRemoteRecurring,
  toRemoteTransaction,
  type RemoteAccount,
  type RemoteBudget,
  type RemoteCategory,
  type RemoteInvestment,
  type RemoteProfile,
  type RemoteRecurring,
  type RemoteTransaction,
} from './mappers';
import { normalizeServerTimestamp, type PullColumn } from '@/utils/syncLogic';
import { decideGeneratedOccurrence } from '@/utils/recurringConflict';

export type ServerTransaction = ReturnType<typeof fromRemoteTransaction>;

export type GeneratedTransactionResult =
  | { outcome: 'inserted'; remote: ServerTransaction }
  | { outcome: 'updated_remote'; remote: ServerTransaction }
  | { outcome: 'kept_remote'; remote: ServerTransaction }
  | { outcome: 'deleted_remotely'; remote: ServerTransaction };

/** Re-reads after a lost compare-and-set before giving up until the next sync. */
const GENERATED_UPDATE_ATTEMPTS = 3;

function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? '');
}

function isMissingTable(error: unknown): boolean {
  const record = error && typeof error === 'object' ? (error as { code?: unknown; message?: unknown }) : null;
  const code = record?.code != null ? String(record.code) : '';
  const message =
    error instanceof Error
      ? error.message
      : record?.message != null
        ? String(record.message)
        : String(error);
  return code === 'PGRST205' || /Could not find the table|relation .* does not exist|PGRST205/i.test(message);
}

async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error('You need to log in again.');
  }
  return data.user.id;
}

export const remoteApi = {
  configured: isSupabaseConfigured,

  async upsertTransaction(item: Transaction): Promise<void> {
    const userId = await requireUserId();
    const { error } = await supabase.from('transactions').upsert(toRemoteTransaction(item, userId));
    if (error) throw error;
  },

  /**
   * Upload a generated recurring occurrence (deterministic id) without overwriting a copy
   * another device already stored, edited or deleted. See decideGeneratedOccurrence for the
   * rules. Every outcome returns the server row so the caller can converge the local copy.
   */
  async insertGeneratedTransaction(item: Transaction): Promise<GeneratedTransactionResult> {
    const userId = await requireUserId();
    const row = toRemoteTransaction(item, userId);
    const inserted = await supabase
      .from('transactions')
      .upsert(row, { onConflict: 'id', ignoreDuplicates: true })
      .select('*');
    if (inserted.error) throw inserted.error;
    const insertedRow = ((inserted.data ?? []) as RemoteTransaction[])[0];
    if (insertedRow) return { outcome: 'inserted', remote: fromRemoteTransaction(insertedRow) };

    for (let attempt = 0; attempt < GENERATED_UPDATE_ATTEMPTS; attempt += 1) {
      const existing = await supabase
        .from('transactions')
        .select('*')
        .eq('id', row.id)
        .eq('user_id', userId)
        .maybeSingle();
      if (existing.error) throw existing.error;
      if (!existing.data) throw new Error('Generated transaction id conflicts with an inaccessible row.');
      const current = existing.data as RemoteTransaction;
      const decision = decideGeneratedOccurrence(item, { updatedAt: current.updated_at, deletedAt: current.deleted_at });
      if (decision === 'deleted_remotely') return { outcome: 'deleted_remotely', remote: fromRemoteTransaction(current) };
      if (decision === 'keep_remote') return { outcome: 'kept_remote', remote: fromRemoteTransaction(current) };

      const changes: Partial<RemoteTransaction> = { ...row };
      delete changes.id;
      delete changes.created_at;
      // Compare-and-set on the server's updated_at: an edit that lands between the read and
      // this write makes it match nothing, and the loop re-decides against the new row.
      const updated = await supabase
        .from('transactions')
        .update(changes)
        .eq('id', row.id)
        .eq('user_id', userId)
        .is('deleted_at', null)
        .eq('updated_at', current.updated_at)
        .select('*');
      if (updated.error) throw updated.error;
      const updatedRow = ((updated.data ?? []) as RemoteTransaction[])[0];
      if (updatedRow) return { outcome: 'updated_remote', remote: fromRemoteTransaction(updatedRow) };
    }
    throw new Error('Generated transaction changed on the server during upload.');
  },

  /**
   * Server clock for the pull cursor, normalized to ISO-8601 UTC.
   * null only while sync_server_time() is not deployed (before migration 008).
   */
  async serverTime(): Promise<string | null> {
    const { data, error } = await supabase.rpc('sync_server_time');
    if (error) {
      if (isMissingFunction(error)) return null;
      throw error;
    }
    const normalized = normalizeServerTimestamp(data);
    if (!normalized) throw new Error('sync_server_time returned an invalid timestamp.');
    return normalized;
  },

  async deleteTransaction(id: string, deletedAt: string): Promise<void> {
    const userId = await requireUserId();
    const { error } = await supabase
      .from('transactions')
      .update({ deleted_at: deletedAt, user_id: userId })
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
  },

  async upsertCategory(item: Category): Promise<void> {
    const userId = await requireUserId();
    const { error } = await supabase.from('categories').upsert(toRemoteCategory(item, userId));
    if (error) throw error;
  },

  async deleteCategory(id: string, deletedAt: string): Promise<void> {
    const userId = await requireUserId();
    const { error } = await supabase
      .from('categories')
      .update({ deleted_at: deletedAt, user_id: userId })
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
  },

  async upsertBudget(item: Budget): Promise<void> {
    const userId = await requireUserId();
    const { error } = await supabase.from('budgets').upsert(toRemoteBudget(item, userId));
    if (error) throw error;
  },

  async deleteBudget(id: string, deletedAt: string): Promise<void> {
    const userId = await requireUserId();
    const { error } = await supabase
      .from('budgets')
      .update({ deleted_at: deletedAt, user_id: userId })
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
  },

  async upsertAccount(item: Account): Promise<void> {
    const userId = await requireUserId();
    const { error } = await supabase.from('accounts').upsert(toRemoteAccount(item, userId));
    if (error) throw error;
  },

  async deleteAccount(id: string, deletedAt: string): Promise<void> {
    const userId = await requireUserId();
    const { error } = await supabase
      .from('accounts')
      .update({ deleted_at: deletedAt, user_id: userId })
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
  },

  async upsertInvestment(item: Investment): Promise<void> {
    const userId = await requireUserId();
    const { error } = await supabase.from('investments').upsert(toRemoteInvestment(item, userId));
    if (error) throw error;
  },

  async deleteInvestment(id: string, deletedAt: string): Promise<void> {
    const userId = await requireUserId();
    const { error } = await supabase
      .from('investments')
      .update({ deleted_at: deletedAt, user_id: userId })
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
  },

  async pullInvestments(since?: string | null, column: PullColumn = 'updated_at'): Promise<ReturnType<typeof fromRemoteInvestment>[]> {
    const userId = await requireUserId();
    let query = supabase.from('investments').select('*').eq('user_id', userId);
    if (since) query = query.gte(column, since);
    const { data, error } = await query;
    if (error) {
      if (isMissingTable(error)) return [];
      throw error;
    }
    return ((data ?? []) as RemoteInvestment[]).map(fromRemoteInvestment);
  },

  async pullAccounts(since?: string | null, column: PullColumn = 'updated_at'): Promise<ReturnType<typeof fromRemoteAccount>[]> {
    const userId = await requireUserId();
    let query = supabase.from('accounts').select('*').eq('user_id', userId);
    if (since) query = query.gte(column, since);
    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as RemoteAccount[]).map(fromRemoteAccount);
  },

  async upsertRecurring(item: RecurringTransaction): Promise<void> {
    const userId = await requireUserId();
    const { error } = await supabase.from('recurring_transactions').upsert(toRemoteRecurring(item, userId));
    if (error) throw error;
  },

  async deleteRecurring(id: string, deletedAt: string): Promise<void> {
    const userId = await requireUserId();
    const { error } = await supabase
      .from('recurring_transactions')
      .update({ deleted_at: deletedAt, user_id: userId })
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
  },

  async upsertProfile(settings: AppSettings): Promise<void> {
    const userId = await requireUserId();
    const { error } = await supabase.from('profiles').upsert(toRemoteProfile(settings, userId));
    if (error) throw error;
  },

  async pullTransactions(since?: string | null, column: PullColumn = 'updated_at'): Promise<ReturnType<typeof fromRemoteTransaction>[]> {
    const userId = await requireUserId();
    let query = supabase.from('transactions').select('*').eq('user_id', userId);
    if (since) query = query.gte(column, since);
    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as RemoteTransaction[]).map(fromRemoteTransaction);
  },

  async pullCategories(since?: string | null, column: PullColumn = 'updated_at'): Promise<ReturnType<typeof fromRemoteCategory>[]> {
    const userId = await requireUserId();
    let query = supabase.from('categories').select('*').eq('user_id', userId);
    if (since) query = query.gte(column, since);
    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as RemoteCategory[]).map(fromRemoteCategory);
  },

  async pullBudgets(since?: string | null, column: PullColumn = 'updated_at'): Promise<ReturnType<typeof fromRemoteBudget>[]> {
    const userId = await requireUserId();
    let query = supabase.from('budgets').select('*').eq('user_id', userId);
    if (since) query = query.gte(column, since);
    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as RemoteBudget[]).map(fromRemoteBudget);
  },

  async pullRecurring(since?: string | null, column: PullColumn = 'updated_at'): Promise<ReturnType<typeof fromRemoteRecurring>[]> {
    const userId = await requireUserId();
    let query = supabase.from('recurring_transactions').select('*').eq('user_id', userId);
    if (since) query = query.gte(column, since);
    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as RemoteRecurring[]).map(fromRemoteRecurring);
  },

  async pullProfile(): Promise<RemoteProfile | null> {
    const userId = await requireUserId();
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (error) throw error;
    return (data as RemoteProfile | null) ?? null;
  },
};
