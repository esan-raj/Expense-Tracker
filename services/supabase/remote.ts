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

  async pullInvestments(since?: string | null): Promise<ReturnType<typeof fromRemoteInvestment>[]> {
    const userId = await requireUserId();
    let query = supabase.from('investments').select('*').eq('user_id', userId);
    if (since) query = query.gte('updated_at', since);
    const { data, error } = await query;
    if (error) {
      if (isMissingTable(error)) return [];
      throw error;
    }
    return ((data ?? []) as RemoteInvestment[]).map(fromRemoteInvestment);
  },

  async pullAccounts(since?: string | null): Promise<ReturnType<typeof fromRemoteAccount>[]> {
    const userId = await requireUserId();
    let query = supabase.from('accounts').select('*').eq('user_id', userId);
    if (since) query = query.gte('updated_at', since);
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

  async pullTransactions(since?: string | null): Promise<ReturnType<typeof fromRemoteTransaction>[]> {
    const userId = await requireUserId();
    let query = supabase.from('transactions').select('*').eq('user_id', userId);
    if (since) query = query.gte('updated_at', since);
    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as RemoteTransaction[]).map(fromRemoteTransaction);
  },

  async pullCategories(since?: string | null): Promise<ReturnType<typeof fromRemoteCategory>[]> {
    const userId = await requireUserId();
    let query = supabase.from('categories').select('*').eq('user_id', userId);
    if (since) query = query.gte('updated_at', since);
    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as RemoteCategory[]).map(fromRemoteCategory);
  },

  async pullBudgets(since?: string | null): Promise<ReturnType<typeof fromRemoteBudget>[]> {
    const userId = await requireUserId();
    let query = supabase.from('budgets').select('*').eq('user_id', userId);
    if (since) query = query.gte('updated_at', since);
    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as RemoteBudget[]).map(fromRemoteBudget);
  },

  async pullRecurring(since?: string | null): Promise<ReturnType<typeof fromRemoteRecurring>[]> {
    const userId = await requireUserId();
    let query = supabase.from('recurring_transactions').select('*').eq('user_id', userId);
    if (since) query = query.gte('updated_at', since);
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
