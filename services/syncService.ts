import NetInfo from '@react-native-community/netinfo';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/services/supabase';
import { remoteApi, type ServerTransaction } from '@/services/supabase/remote';
import { transactionRepository } from '@/database/repositories/transactionRepository';
import { categoryRepository } from '@/database/repositories/categoryRepository';
import { budgetRepository } from '@/database/repositories/budgetRepository';
import { recurringRepository } from '@/database/repositories/recurringRepository';
import { accountRepository } from '@/database/repositories/accountRepository';
import { investmentRepository } from '@/database/repositories/investmentRepository';
import { settingsRepository } from '@/database/repositories/settingsRepository';
import {
  OWNED_ENTITY_TYPES,
  ownershipRepository,
  type OwnedEntityType,
} from '@/database/repositories/ownershipRepository';
import {
  syncCursorRepository,
  syncQueueRepository,
  syncStateRepository,
} from '@/database/repositories/syncQueueRepository';
import { getCurrentUserId, setCurrentUserId } from '@/database/session';
import { planPull, resolveConflict, shouldRetry, sortQueueForPush } from '@/utils/syncLogic';
import { recurringOccurrenceId } from '@/utils/deterministicId';
import { findStaleCategoryIds } from '@/utils/categoryReconciliation';
import { collectSyncDependencyRefs, missingDependencyIds } from '@/utils/syncDependencies';
import { getErrorMessage, logError } from '@/utils/errors';
import { nowIso } from '@/utils/dates';
import type { SyncStatus } from '@/types/sync';
import { bumpFinanceRevision } from '@/services/financeRevision';
import { syncGate } from '@/services/syncSingleFlight';
import {
  assertSyncSession,
  captureSyncContext,
  SyncSessionChangedError,
  type SyncContext,
} from '@/services/syncSession';

type RemoteEntity = 'transaction' | 'category' | 'budget' | 'recurring' | 'account' | 'investment';

let realtimeChannel: RealtimeChannel | null = null;
let listeners: Array<(status: SyncStatus, lastSyncedAt: string | null, pending: number) => void> = [];

function emit(status: SyncStatus, lastSyncedAt: string | null, pending: number) {
  listeners.forEach((listener) => listener(status, lastSyncedAt, pending));
}

function shortUserId(userId: string): string {
  return `${userId.slice(0, 8)}…`;
}

function isGeneratedOccurrence(payload: { id?: string; recurringId?: string | null; date?: string }): boolean {
  if (!payload.id || !payload.recurringId || !payload.date) return false;
  return payload.id === recurringOccurrenceId(payload.recurringId, payload.date.slice(0, 10));
}

function syncLog(message: string): void {
  console.info(`[sync] ${message}`);
}

function syncEntityLog(entity: string, direction: 'push' | 'pull', message: string): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  console.info(`[sync][${entity}][${direction}] ${message}`);
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
  entity: RemoteEntity,
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
  bumpFinanceRevision();
}

async function applyRemoteRecords(
  context: SyncContext,
  entity: RemoteEntity,
  items: ReadonlyArray<{ id: string; updatedAt: string; deletedAt?: string | null }>
): Promise<void> {
  for (const item of items) {
    assertSyncSession(context);
    await applyRemoteRecord(entity, item);
  }
}

function loadClaimSnapshot(entityType: OwnedEntityType, id: string): Promise<object | null> {
  switch (entityType) {
    case 'transaction':
      return transactionRepository.getByIdIncludingDeleted(id);
    case 'category':
      return categoryRepository.getByIdIncludingDeleted(id);
    case 'budget':
      return budgetRepository.getByIdIncludingDeleted(id);
    case 'recurring':
      return recurringRepository.getByIdIncludingDeleted(id);
    case 'account':
      return accountRepository.getByIdIncludingDeleted(id);
    case 'investment':
      return investmentRepository.getByIdIncludingDeleted(id);
  }
}

/**
 * Converge the local copy of a generated occurrence on the server copy that won, unless the
 * row changed again after this upload was queued: that newer edit has its own outbox entry.
 */
async function adoptServerOccurrence(
  context: SyncContext,
  pushed: { updatedAt?: string; deletedAt?: string | null },
  remote: ServerTransaction
): Promise<void> {
  const local = await transactionRepository.getByIdIncludingDeleted(remote.id);
  if (local && (local.updatedAt !== pushed.updatedAt || (local.deletedAt ?? null) !== (pushed.deletedAt ?? null))) {
    return;
  }
  assertSyncSession(context);
  await transactionRepository.upsertFromRemote(remote);
  bumpFinanceRevision();
}

export const syncService = {
  async claimLocalData(userId: string): Promise<void> {
    await this.claimUnassigned(userId);
    await syncStateRepository.save({ userId });
    const { categoryDedupeService } = await import('@/services/categoryDedupeService');
    await categoryDedupeService.apply();
    await this.queueExistingLocal();
  },

  /**
   * Claim rows written while no account was signed in, without re-enqueueing the whole dataset.
   * queueChange skips the outbox without a session, so each active row is queued for this
   * account before it is claimed: if claiming fails, the row is still unassigned and is queued
   * again (coalesced) next time. Built-in categories are not queued; ensurePushDependencies
   * uploads them once something references them. Outbox entries left without an owner are
   * then handed over only for entities this account now owns.
   */
  async claimUnassigned(userId: string): Promise<void> {
    setCurrentUserId(userId);
    for (const entityType of OWNED_ENTITY_TYPES) {
      const unassigned = await ownershipRepository.listUnassigned(entityType);
      if (!unassigned.length) continue;
      for (const row of unassigned) {
        if (row.deletedAt || row.isDefault) continue;
        const snapshot = await loadClaimSnapshot(entityType, row.id);
        if (!snapshot) continue;
        if (getCurrentUserId() !== userId) throw new SyncSessionChangedError();
        await syncQueueRepository.enqueue(entityType, row.id, 'update', snapshot, { userId });
      }
      await ownershipRepository.claim(
        entityType,
        unassigned.map((row) => row.id),
        userId
      );
    }
    await syncQueueRepository.claimUnowned(
      userId,
      async (entityType, entityId) =>
        entityType !== 'profile' && (await ownershipRepository.ownerOf(entityType, entityId)) === userId
    );
    await syncStateRepository.save({ userId });
  },

  /**
   * Ensure categories/accounts referenced by pending transactions (etc.) are in the outbox
   * before those dependents are pushed — prevents remote FK 23503 failures.
   */
  async ensurePushDependencies(context?: SyncContext): Promise<void> {
    const ctx = context ?? captureSyncContext();
    if (!ctx) return;
    assertSyncSession(ctx);

    await this.claimUnassigned(ctx.userId);

    const queue = await syncQueueRepository.list(ctx.userId);
    const refs = collectSyncDependencyRefs(queue);
    const missingCategories = missingDependencyIds(refs.categoryIds, queue, 'category');
    const missingAccounts = missingDependencyIds(refs.accountIds, queue, 'account');

    for (const categoryId of missingCategories) {
      const category = await categoryRepository.getByIdIncludingDeleted(categoryId);
      if (!category) continue;
      await syncQueueRepository.enqueue('category', categoryId, 'update', category, { userId: ctx.userId });
      syncLog(`queued missing category dependency ${categoryId.slice(0, 8)}…`);
    }

    for (const accountId of missingAccounts) {
      const account = await accountRepository.getByIdIncludingDeleted(accountId);
      if (!account) continue;
      await syncQueueRepository.enqueue('account', accountId, 'update', account, { userId: ctx.userId });
      syncLog(`queued missing account dependency ${accountId.slice(0, 8)}…`);
    }
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

  async pushLocalChanges(context?: SyncContext): Promise<void> {
    const ctx = context ?? captureSyncContext();
    if (!isSupabaseConfigured() || !ctx) return;
    await this.ensurePushDependencies(ctx);
    const queue = sortQueueForPush(await syncQueueRepository.list(ctx.userId));
    syncLog('starting push');
    for (const item of queue) {
      // Remote writes stamp the session's user id, so an entry of a previous account must never be sent.
      assertSyncSession(ctx);
      try {
        syncEntityLog(item.entityType, 'push', item.operation);
        const payload = JSON.parse(item.payload) as { id?: string; deletedAt?: string; updatedAt?: string };
        if (item.operation === 'delete') {
          const deletedAt = payload.deletedAt ?? nowIso();
          if (item.entityType === 'transaction') await remoteApi.deleteTransaction(item.entityId, deletedAt);
          if (item.entityType === 'category') await remoteApi.deleteCategory(item.entityId, deletedAt);
          if (item.entityType === 'budget') await remoteApi.deleteBudget(item.entityId, deletedAt);
          if (item.entityType === 'recurring') await remoteApi.deleteRecurring(item.entityId, deletedAt);
          if (item.entityType === 'account') await remoteApi.deleteAccount(item.entityId, deletedAt);
          if (item.entityType === 'investment') await remoteApi.deleteInvestment(item.entityId, deletedAt);
        } else if (item.entityType === 'transaction' && isGeneratedOccurrence(payload)) {
          const result = await remoteApi.insertGeneratedTransaction(payload as never);
          if (result.outcome === 'kept_remote' || result.outcome === 'deleted_remotely') {
            await adoptServerOccurrence(ctx, payload, result.remote);
          }
        } else {
          if (item.entityType === 'transaction') await remoteApi.upsertTransaction(payload as never);
          if (item.entityType === 'category') await remoteApi.upsertCategory(payload as never);
          if (item.entityType === 'budget') await remoteApi.upsertBudget(payload as never);
          if (item.entityType === 'recurring') await remoteApi.upsertRecurring(payload as never);
          if (item.entityType === 'account') await remoteApi.upsertAccount(payload as never);
          if (item.entityType === 'investment') await remoteApi.upsertInvestment(payload as never);
          if (item.entityType === 'profile') await remoteApi.upsertProfile(payload as never);
        }
        await syncQueueRepository.removeIfUnchanged(item);
        syncEntityLog(item.entityType, 'push', 'complete');
      } catch (error) {
        if (error instanceof SyncSessionChangedError) throw error;
        logError(`sync[${item.entityType}][${item.operation}]`, error);
        const nextRetry = item.retryCount + 1;
        await syncQueueRepository.markFailure(item.id, getErrorMessage(error, 'Sync failed'), nextRetry);
        if (!shouldRetry(nextRetry)) {
          continue;
        }
      }
    }
    syncLog('push complete');
  },

  async pullRemoteChanges(): Promise<void> {
    return syncGate.run('pull', runGatedSync);
  },

  async shouldReplaceLocalFromRemote(): Promise<boolean> {
    const remotes = (await remoteApi.pullAccounts(null)).filter((item) => !item.deletedAt);
    if (!remotes.length) return false;
    const locals = await accountRepository.list(true);
    if (!locals.length) return true;
    const remoteIds = new Set(remotes.map((item) => item.id));
    return !locals.some((item) => remoteIds.has(item.id));
  },

  /**
   * Replace this account's local rows and outbox with the server's. Rows and outboxes of other
   * accounts on the device are untouched, and the cursor is stored only for this account.
   */
  async replaceLocalFromRemote(context?: SyncContext): Promise<void> {
    const ctx = context ?? captureSyncContext();
    if (!ctx) return;
    const serverNow = await remoteApi.serverTime();
    const [transactions, categories, budgets, recurring, accounts, investments] = await Promise.all([
      remoteApi.pullTransactions(null),
      remoteApi.pullCategories(null),
      remoteApi.pullBudgets(null),
      remoteApi.pullRecurring(null),
      remoteApi.pullAccounts(null),
      remoteApi.pullInvestments(null),
    ]);
    assertSyncSession(ctx);
    const scope = { ownerId: ctx.userId };
    await accountRepository.replaceAll(accounts.filter((item) => !item.deletedAt), scope);
    await investmentRepository.replaceAll(investments.filter((item) => !item.deletedAt), scope);
    await categoryRepository.replaceAll(categories.filter((item) => !item.deletedAt), scope);
    await recurringRepository.replaceAll(recurring.filter((item) => !item.deletedAt), scope);
    await transactionRepository.replaceAll(transactions.filter((item) => !item.deletedAt), scope);
    await budgetRepository.replaceAll(budgets.filter((item) => !item.deletedAt), scope);
    await syncQueueRepository.clearForUser(ctx.userId);
    assertSyncSession(ctx);
    const { categoryDedupeService } = await import('@/services/categoryDedupeService');
    await categoryDedupeService.apply();
    if (serverNow) {
      assertSyncSession(ctx);
      await syncCursorRepository.save(ctx.userId, serverNow, true);
    }
    bumpFinanceRevision();
  },

  async syncPendingChanges(): Promise<void> {
    await this.pushLocalChanges();
  },

  async performFullSync(): Promise<void> {
    return syncGate.run('full', runGatedSync);
  },

  async startRealtime(userId: string, onChange: () => void): Promise<void> {
    this.stopRealtime();
    if (!isSupabaseConfigured()) return;
    const onRemoteChange = () => {
      // A previous account's channel can still deliver events until it is removed.
      if (getCurrentUserId() !== userId) return;
      void this.pullRemoteChanges()
        .then(onChange)
        .catch((error) => logError('sync.realtime', error));
    };
    realtimeChannel = supabase
      .channel(`spendwise-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `user_id=eq.${userId}` }, onRemoteChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'budgets', filter: `user_id=eq.${userId}` }, onRemoteChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories', filter: `user_id=eq.${userId}` }, onRemoteChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts', filter: `user_id=eq.${userId}` }, onRemoteChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'investments', filter: `user_id=eq.${userId}` }, onRemoteChange)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'recurring_transactions', filter: `user_id=eq.${userId}` },
        onRemoteChange
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

/**
 * After a complete pull, soft-delete this account's categories the server no longer
 * has at all (hard-deleted remotely). Remote tombstones were already applied through
 * applyRemoteRecord. Throws on failure so the pull cursor is not advanced.
 */
export async function reconcileCategoriesAfterFullPull(
  userId: string,
  remoteCategories: ReadonlyArray<{ id: string }>,
  context?: SyncContext
): Promise<string[]> {
  const [owned, pendingIds] = await Promise.all([
    categoryRepository.listActiveOwnedBy(userId),
    syncQueueRepository.pendingEntityIds('category', userId),
  ]);
  const remoteIds = new Set(remoteCategories.map((item) => item.id));
  const referencedIds = new Set<string>();
  const candidates = findStaleCategoryIds({ owned, remoteIds, pendingIds, referencedIds });
  for (const id of candidates) {
    const [transactions, recurring, budgets] = await Promise.all([
      transactionRepository.countByCategory(id),
      recurringRepository.countByCategory(id),
      budgetRepository.countByCategory(id),
    ]);
    if (transactions + recurring + budgets > 0) referencedIds.add(id);
  }
  const stale = findStaleCategoryIds({ owned, remoteIds, pendingIds, referencedIds });
  for (const id of stale) {
    if (context) assertSyncSession(context);
    await categoryRepository.hide(id);
  }
  if (stale.length) syncLog(`full pull hid ${stale.length} categories missing on the server`);
  return stale;
}

async function runGatedSync(kind: 'pull' | 'full'): Promise<void> {
  try {
    if (kind === 'full') {
      await executeFullSync();
      return;
    }
    const context = captureSyncContext();
    if (context) await executePullRemoteChanges(context);
  } catch (error) {
    if (!(error instanceof SyncSessionChangedError)) throw error;
    await restartAfterSessionChange();
  }
}

/**
 * A run stopped because the account changed. It reports nothing for the new account: one full
 * sync is queued for whoever is signed in now (the gate merges it with any request that
 * account already made), or the status goes offline when nobody is signed in.
 */
async function restartAfterSessionChange(): Promise<void> {
  syncLog('account changed during sync; stale run stopped');
  if (getCurrentUserId()) {
    syncGate.requestFollowUp('full');
    return;
  }
  await syncStateRepository.save({ status: 'offline' });
  emit('offline', (await syncStateRepository.get()).lastSyncedAt, await syncQueueRepository.count());
}

async function executePullRemoteChanges(context: SyncContext): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const { userId } = context;
  const state = await syncStateRepository.get();
  const legacySince = state.lastSyncedAt;
  const serverNow = await remoteApi.serverTime();
  const stored = serverNow ? await syncCursorRepository.get(userId) : { cursor: null, lastFullPullAt: null };
  const plan = planPull({ serverNow, cursor: stored.cursor, lastFullPullAt: stored.lastFullPullAt, legacySince });
  const { since, column } = plan;
  syncLog(`starting pull (${plan.full ? 'full' : 'incremental'}, ${column})`);
  const [transactions, categories, budgets, recurring, accounts, investments, profile] = await Promise.all([
    remoteApi.pullTransactions(since, column),
    remoteApi.pullCategories(since, column),
    remoteApi.pullBudgets(since, column),
    remoteApi.pullRecurring(since, column),
    remoteApi.pullAccounts(since, column),
    remoteApi.pullInvestments(since, column),
    remoteApi.pullProfile(),
  ]);

  await applyRemoteRecords(context, 'account', accounts);
  await applyRemoteRecords(context, 'investment', investments);
  await applyRemoteRecords(context, 'category', categories);
  await applyRemoteRecords(context, 'recurring', recurring);
  await applyRemoteRecords(context, 'transaction', transactions);
  await applyRemoteRecords(context, 'budget', budgets);

  if (plan.full) {
    assertSyncSession(context);
    await reconcileCategoriesAfterFullPull(userId, categories, context);
  }
  if (plan.full || categories.length > 0) {
    assertSyncSession(context);
    const { categoryDedupeService } = await import('@/services/categoryDedupeService');
    await categoryDedupeService.apply();
  }

  syncEntityLog('transaction', 'pull', String(transactions.length));
  syncEntityLog('category', 'pull', String(categories.length));
  syncEntityLog('account', 'pull', String(accounts.length));
  syncEntityLog('budget', 'pull', String(budgets.length));
  syncEntityLog('recurring', 'pull', String(recurring.length));
  syncEntityLog('investment', 'pull', String(investments.length));

  if (profile) {
    assertSyncSession(context);
    await settingsRepository.update({
      currency: profile.currency,
      currencySymbol: profile.currency_symbol,
      theme: profile.theme,
      firstDayOfWeek: profile.first_day_of_week,
      monthlyBudget: profile.monthly_budget,
      onboardingComplete: profile.onboarding_completed,
    });
  }
  if (serverNow) {
    assertSyncSession(context);
    await syncCursorRepository.save(userId, serverNow, plan.full);
  }
  syncLog('pull complete');
}

async function executeFullSync(): Promise<void> {
  syncLog('initializing');
  const userId = getCurrentUserId();
  if (!isSupabaseConfigured()) {
    syncLog('cloud not configured');
    emit('offline', null, await syncQueueRepository.count());
    return;
  }
  if (!userId) {
    syncLog('waiting for authentication');
    emit('offline', null, await syncQueueRepository.count());
    return;
  }
  syncLog(`authenticated user: ${shortUserId(userId)}`);
  const online = await isOnline();
  const pending = await syncQueueRepository.count();
  if (!online) {
    syncLog('offline');
    await syncStateRepository.save({ status: 'offline' });
    emit('offline', (await syncStateRepository.get()).lastSyncedAt, pending);
    return;
  }

  const context: SyncContext = { userId };
  emit('syncing', (await syncStateRepository.get()).lastSyncedAt, pending);
  await syncStateRepository.save({ status: 'syncing', lastError: null });
  try {
    assertSyncSession(context);
    if (await syncService.shouldReplaceLocalFromRemote()) {
      await syncService.replaceLocalFromRemote(context);
    } else {
      await syncService.pushLocalChanges(context);
      await executePullRemoteChanges(context);
    }
    assertSyncSession(context);
    const syncedAt = nowIso();
    await syncStateRepository.save({ lastSyncedAt: syncedAt, status: 'synced', lastError: null });
    emit('synced', syncedAt, await syncQueueRepository.count());
    syncLog('idle');
  } catch (error) {
    if (error instanceof SyncSessionChangedError) throw error;
    logError('sync.full', error);
    await syncStateRepository.save({
      status: 'error',
      lastError: getErrorMessage(error, 'Sync failed'),
    });
    emit('error', (await syncStateRepository.get()).lastSyncedAt, await syncQueueRepository.count());
  }
}

