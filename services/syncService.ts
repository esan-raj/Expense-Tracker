import NetInfo from '@react-native-community/netinfo';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/services/supabase';
import { remoteApi } from '@/services/supabase/remote';
import { transactionRepository } from '@/database/repositories/transactionRepository';
import { categoryRepository } from '@/database/repositories/categoryRepository';
import { budgetRepository } from '@/database/repositories/budgetRepository';
import { recurringRepository } from '@/database/repositories/recurringRepository';
import { accountRepository } from '@/database/repositories/accountRepository';
import { investmentRepository } from '@/database/repositories/investmentRepository';
import { settingsRepository } from '@/database/repositories/settingsRepository';
import { syncQueueRepository, syncStateRepository } from '@/database/repositories/syncQueueRepository';
import { getCurrentUserId, setCurrentUserId } from '@/database/session';
import { resolveConflict, shouldRetry, sortQueueForPush } from '@/utils/syncLogic';
import { logError } from '@/utils/errors';
import { nowIso } from '@/utils/dates';
import type { SyncStatus } from '@/types/sync';

let realtimeChannel: RealtimeChannel | null = null;
let listeners: Array<(status: SyncStatus, lastSyncedAt: string | null, pending: number) => void> = [];

function emit(status: SyncStatus, lastSyncedAt: string | null, pending: number) {
  listeners.forEach((listener) => listener(status, lastSyncedAt, pending));
}

export function subscribeSyncStatus(
  listener: (status: SyncStatus, lastSyncedAt: string | null, pending: number) => void
) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((item) => item !== listener);
  };
}

async function isOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return Boolean(state.isConnected && state.isInternetReachable !== false);
}

async function applyRemoteRecord(
  entity: 'transaction' | 'category' | 'budget' | 'recurring' | 'account' | 'investment',
  remote: { id: string; updatedAt: string; deletedAt?: string | null }
) {
  const local =
    entity === 'transaction'
      ? await transactionRepository.getByIdIncludingDeleted(remote.id)
      : entity === 'category'
        ? await categoryRepository.getByIdIncludingDeleted(remote.id)
        : entity === 'budget'
          ? await budgetRepository.getByIdIncludingDeleted(remote.id)
          : entity === 'recurring'
          ? await recurringRepository.getByIdIncludingDeleted(remote.id)
          : entity === 'investment'
            ? await investmentRepository.getByIdIncludingDeleted(remote.id)
          : await accountRepository.getByIdIncludingDeleted(remote.id);

  if (local) {
    const winner = resolveConflict({
      localUpdatedAt: local.updatedAt ?? local.createdAt,
      remoteUpdatedAt: remote.updatedAt,
      localDeletedAt: (local as { deletedAt?: string | null }).deletedAt,
      remoteDeletedAt: remote.deletedAt,
    });
    if (winner === 'local') return;
  }

  if (entity === 'transaction') await transactionRepository.upsertFromRemote(remote as never);
  if (entity === 'category') await categoryRepository.upsertFromRemote(remote as never);
  if (entity === 'budget') await budgetRepository.upsertFromRemote(remote as never);
  if (entity === 'recurring') await recurringRepository.upsertFromRemote(remote as never);
  if (entity === 'account') await accountRepository.upsertFromRemote(remote as never);
  if (entity === 'investment') await investmentRepository.upsertFromRemote(remote as never);
}

export const syncService = {
  async claimLocalData(userId: string): Promise<void> {
    setCurrentUserId(userId);
    await Promise.all([
      transactionRepository.claimUnassigned(userId),
      categoryRepository.claimUnassigned(userId),
      budgetRepository.claimUnassigned(userId),
      recurringRepository.claimUnassigned(userId),
      accountRepository.claimUnassigned(userId),
      investmentRepository.claimUnassigned(userId),
    ]);
    await syncStateRepository.save({ userId });
    const { categoryDedupeService } = await import('@/services/categoryDedupeService');
    await categoryDedupeService.apply();
    await this.queueExistingLocal();
  },

  async queueExistingLocal(): Promise<void> {
    const userId = getCurrentUserId();
    if (!userId) return;
    const [transactions, categories, budgets, recurring, accounts, investments, settings] = await Promise.all([
      transactionRepository.exportAll(),
      categoryRepository.list(),
      budgetRepository.exportAll(),
      recurringRepository.exportAll(),
      accountRepository.list(true),
      investmentRepository.list(),
      settingsRepository.get(),
    ]);
    await Promise.all([
      ...categories.map((item) => syncQueueRepository.enqueue('category', item.id, 'update', item)),
      ...accounts.map((item) => syncQueueRepository.enqueue('account', item.id, 'update', item)),
      ...investments.map((item) => syncQueueRepository.enqueue('investment', item.id, 'update', item)),
      ...recurring.map((item) => syncQueueRepository.enqueue('recurring', item.id, 'update', item)),
      ...transactions.map((item) => syncQueueRepository.enqueue('transaction', item.id, 'update', item)),
      ...budgets.map((item) => syncQueueRepository.enqueue('budget', item.id, 'update', item)),
      syncQueueRepository.enqueue('profile', userId, 'update', settings),
    ]);
  },

  async pushLocalChanges(): Promise<void> {
    if (!isSupabaseConfigured() || !getCurrentUserId()) return;
    const queue = sortQueueForPush(await syncQueueRepository.list());
    for (const item of queue) {
      try {
        const payload = JSON.parse(item.payload) as { id?: string; deletedAt?: string };
        if (item.operation === 'delete') {
          const deletedAt = payload.deletedAt ?? nowIso();
          if (item.entityType === 'transaction') await remoteApi.deleteTransaction(item.entityId, deletedAt);
          if (item.entityType === 'category') await remoteApi.deleteCategory(item.entityId, deletedAt);
          if (item.entityType === 'budget') await remoteApi.deleteBudget(item.entityId, deletedAt);
          if (item.entityType === 'recurring') await remoteApi.deleteRecurring(item.entityId, deletedAt);
          if (item.entityType === 'account') await remoteApi.deleteAccount(item.entityId, deletedAt);
          if (item.entityType === 'investment') await remoteApi.deleteInvestment(item.entityId, deletedAt);
        } else {
          if (item.entityType === 'transaction') await remoteApi.upsertTransaction(payload as never);
          if (item.entityType === 'category') await remoteApi.upsertCategory(payload as never);
          if (item.entityType === 'budget') await remoteApi.upsertBudget(payload as never);
          if (item.entityType === 'recurring') await remoteApi.upsertRecurring(payload as never);
          if (item.entityType === 'account') await remoteApi.upsertAccount(payload as never);
          if (item.entityType === 'investment') await remoteApi.upsertInvestment(payload as never);
          if (item.entityType === 'profile') await remoteApi.upsertProfile(payload as never);
        }
        await syncQueueRepository.remove(item.id);
      } catch (error) {
        logError(`sync[${item.entityType}][${item.operation}]`, error);
        const nextRetry = item.retryCount + 1;
        await syncQueueRepository.markFailure(
          item.id,
          error instanceof Error ? error.message : 'Sync failed',
          nextRetry
        );
        if (!shouldRetry(nextRetry)) {
          continue;
        }
      }
    }
  },

  async pullRemoteChanges(): Promise<void> {
    if (!isSupabaseConfigured() || !getCurrentUserId()) return;
    const state = await syncStateRepository.get();
    const since = state.lastSyncedAt;
    const [transactions, categories, budgets, recurring, accounts, investments, profile] = await Promise.all([
      remoteApi.pullTransactions(since),
      remoteApi.pullCategories(since),
      remoteApi.pullBudgets(since),
      remoteApi.pullRecurring(since),
      remoteApi.pullAccounts(since),
      remoteApi.pullInvestments(since),
      remoteApi.pullProfile(),
    ]);

    for (const item of accounts) await applyRemoteRecord('account', item);
    for (const item of investments) await applyRemoteRecord('investment', item);
    for (const item of categories) await applyRemoteRecord('category', item);
    for (const item of recurring) await applyRemoteRecord('recurring', item);
    for (const item of transactions) await applyRemoteRecord('transaction', item);
    for (const item of budgets) await applyRemoteRecord('budget', item);

    if (categories.length > 0) {
      const keep = new Set(categories.map((item) => item.id));
      const local = await categoryRepository.list();
      for (const category of local) {
        if (!category.isDefault || keep.has(category.id)) continue;
        const [usedByTransactions, usedByRecurring] = await Promise.all([
          transactionRepository.countByCategory(category.id),
          recurringRepository.countByCategory(category.id),
        ]);
        if (usedByTransactions + usedByRecurring === 0) {
          await categoryRepository.hide(category.id);
        }
      }
      const { categoryDedupeService } = await import('@/services/categoryDedupeService');
      await categoryDedupeService.apply();
    }

    if (profile) {
      await settingsRepository.update({
        currency: profile.currency,
        currencySymbol: profile.currency_symbol,
        theme: profile.theme,
        firstDayOfWeek: profile.first_day_of_week,
        monthlyBudget: profile.monthly_budget,
        onboardingComplete: profile.onboarding_completed,
      });
    }
  },

  async shouldReplaceLocalFromRemote(): Promise<boolean> {
    const remotes = (await remoteApi.pullAccounts(null)).filter((item) => !item.deletedAt);
    if (!remotes.length) return false;
    const locals = await accountRepository.list(true);
    if (!locals.length) return true;
    const remoteIds = new Set(remotes.map((item) => item.id));
    return !locals.some((item) => remoteIds.has(item.id));
  },

  async replaceLocalFromRemote(): Promise<void> {
    const [transactions, categories, budgets, recurring, accounts, investments] = await Promise.all([
      remoteApi.pullTransactions(null),
      remoteApi.pullCategories(null),
      remoteApi.pullBudgets(null),
      remoteApi.pullRecurring(null),
      remoteApi.pullAccounts(null),
      remoteApi.pullInvestments(null),
    ]);
    await accountRepository.replaceAll(accounts.filter((item) => !item.deletedAt));
    await investmentRepository.replaceAll(investments.filter((item) => !item.deletedAt));
    await categoryRepository.replaceAll(categories.filter((item) => !item.deletedAt));
    await recurringRepository.replaceAll(recurring.filter((item) => !item.deletedAt));
    await transactionRepository.replaceAll(transactions.filter((item) => !item.deletedAt));
    await budgetRepository.replaceAll(budgets.filter((item) => !item.deletedAt));
    await syncQueueRepository.clear();
    const { categoryDedupeService } = await import('@/services/categoryDedupeService');
    await categoryDedupeService.apply();
  },

  async syncPendingChanges(): Promise<void> {
    await this.pushLocalChanges();
  },

  async performFullSync(): Promise<void> {
    if (!isSupabaseConfigured() || !getCurrentUserId()) {
      emit('offline', null, await syncQueueRepository.count());
      return;
    }
    const online = await isOnline();
    const pending = await syncQueueRepository.count();
    if (!online) {
      await syncStateRepository.save({ status: 'offline' });
      emit('offline', (await syncStateRepository.get()).lastSyncedAt, pending);
      return;
    }

    emit('syncing', (await syncStateRepository.get()).lastSyncedAt, pending);
    await syncStateRepository.save({ status: 'syncing', lastError: null });
    try {
      if (await this.shouldReplaceLocalFromRemote()) {
        await this.replaceLocalFromRemote();
      } else {
        await this.pushLocalChanges();
        await this.pullRemoteChanges();
      }
      const syncedAt = nowIso();
      await syncStateRepository.save({ lastSyncedAt: syncedAt, status: 'synced', lastError: null });
      emit('synced', syncedAt, await syncQueueRepository.count());
    } catch (error) {
      logError('sync.full', error);
      await syncStateRepository.save({
        status: 'error',
        lastError: error instanceof Error ? error.message : 'Sync failed',
      });
      emit('error', (await syncStateRepository.get()).lastSyncedAt, await syncQueueRepository.count());
    }
  },

  async startRealtime(userId: string, onChange: () => void): Promise<void> {
    this.stopRealtime();
    if (!isSupabaseConfigured()) return;
    realtimeChannel = supabase
      .channel(`spendwise-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `user_id=eq.${userId}` }, () => {
        void this.pullRemoteChanges().then(onChange);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'budgets', filter: `user_id=eq.${userId}` }, () => {
        void this.pullRemoteChanges().then(onChange);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories', filter: `user_id=eq.${userId}` }, () => {
        void this.pullRemoteChanges().then(onChange);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts', filter: `user_id=eq.${userId}` }, () => {
        void this.pullRemoteChanges().then(onChange);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'investments', filter: `user_id=eq.${userId}` }, () => {
        void this.pullRemoteChanges().then(onChange);
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'recurring_transactions', filter: `user_id=eq.${userId}` },
        () => {
          void this.pullRemoteChanges().then(onChange);
        }
      )
      .subscribe();
  },

  stopRealtime(): void {
    if (realtimeChannel) {
      void supabase.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
  },
};
