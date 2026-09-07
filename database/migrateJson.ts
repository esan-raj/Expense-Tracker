import AsyncStorage from '@react-native-async-storage/async-storage';
import { SETTINGS_ID } from '@/utils/constants';
import { rxError, rxLog } from './logger';
import { nullToEmpty } from './query';
import type { SpendWiseDatabase } from './types';

const LEGACY_KEY = 'spendwise.local.v1';

interface LegacySnapshot {
  categories?: Array<Record<string, unknown>>;
  transactions?: Array<Record<string, unknown>>;
  accounts?: Array<Record<string, unknown>>;
  budgets?: Array<Record<string, unknown>>;
  recurring?: Array<Record<string, unknown>>;
  settings?: Array<Record<string, unknown>>;
  syncQueue?: Array<Record<string, unknown>>;
  syncState?: Record<string, unknown> | null;
}

function text(value: unknown): string {
  return value == null ? '' : String(value);
}

function flag(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export async function migrateJsonSnapshot(db: SpendWiseDatabase): Promise<void> {
  try {
    const existing = await db.categories.count().exec();
    if (existing > 0) return;

    const raw = await AsyncStorage.getItem(LEGACY_KEY);
    if (!raw) return;

    const snapshot = JSON.parse(raw) as LegacySnapshot;
    rxLog('migration', 'importing JSON snapshot into RxDB');

    if (snapshot.categories?.length) {
      await db.categories.bulkInsert(
        snapshot.categories.map((item) => ({
          id: text(item.id),
          userId: nullToEmpty(item.userId as string | null),
          name: text(item.name),
          icon: text(item.icon),
          color: text(item.color),
          type: text(item.type),
          isDefault: flag(item.isDefault),
          createdAt: text(item.createdAt),
          updatedAt: text(item.updatedAt ?? item.createdAt),
          deletedAt: text(item.deletedAt),
        }))
      );
    }

    if (snapshot.accounts?.length) {
      await db.accounts.bulkInsert(
        snapshot.accounts.map((item) => ({
          id: text(item.id),
          userId: nullToEmpty(item.userId as string | null),
          name: text(item.name),
          type: text(item.type),
          institutionName: text(item.institutionName),
          currency: text(item.currency),
          openingBalance: numberValue(item.openingBalance),
          creditLimit: numberValue(item.creditLimit),
          isActive: item.isActive !== false && item.isActive !== 0,
          createdAt: text(item.createdAt),
          updatedAt: text(item.updatedAt),
          deletedAt: text(item.deletedAt),
        }))
      );
    }

    if (snapshot.transactions?.length) {
      await db.transactions.bulkInsert(
        snapshot.transactions.map((item) => ({
          id: text(item.id),
          userId: nullToEmpty(item.userId as string | null),
          type: text(item.type),
          amount: numberValue(item.amount),
          categoryId: text(item.categoryId),
          title: text(item.title),
          description: text(item.description),
          date: text(item.date),
          paymentMethod: text(item.paymentMethod),
          notes: text(item.notes),
          isRecurring: flag(item.isRecurring),
          recurringId: text(item.recurringId),
          createdAt: text(item.createdAt),
          updatedAt: text(item.updatedAt),
          deletedAt: text(item.deletedAt),
          accountId: text(item.accountId),
          isTransfer: flag(item.isTransfer),
          transferGroupId: text(item.transferGroupId),
          transferRole: text(item.transferRole),
        }))
      );
    }

    if (snapshot.budgets?.length) {
      await db.budgets.bulkInsert(
        snapshot.budgets.map((item) => ({
          id: text(item.id),
          userId: nullToEmpty(item.userId as string | null),
          categoryId: text(item.categoryId),
          amount: numberValue(item.amount, 1),
          month: numberValue(item.month, 1),
          year: numberValue(item.year, 2026),
          createdAt: text(item.createdAt),
          updatedAt: text(item.updatedAt),
          deletedAt: text(item.deletedAt),
        }))
      );
    }

    if (snapshot.recurring?.length) {
      await db.recurring.bulkInsert(
        snapshot.recurring.map((item) => ({
          id: text(item.id),
          userId: nullToEmpty(item.userId as string | null),
          title: text(item.title),
          amount: numberValue(item.amount, 1),
          type: text(item.type),
          categoryId: text(item.categoryId),
          frequency: text(item.frequency),
          startDate: text(item.startDate),
          nextDate: text(item.nextDate),
          paymentMethod: text(item.paymentMethod),
          isActive: item.isActive !== false && item.isActive !== 0,
          createdAt: text(item.createdAt),
          updatedAt: text(item.updatedAt),
          deletedAt: text(item.deletedAt),
          accountId: text(item.accountId),
        }))
      );
    }

    if (snapshot.settings?.[0]) {
      const settings = snapshot.settings[0];
      await db.settings.upsert({
        id: text(settings.id || SETTINGS_ID),
        currency: text(settings.currency),
        currencySymbol: text(settings.currencySymbol),
        theme: text(settings.theme || 'system'),
        accentPreset: text((settings.accentPreset as string) || 'emerald'),
        accentColor: text((settings.accentColor as string) || '#0E7C66'),
        firstDayOfWeek: numberValue(settings.firstDayOfWeek, 1),
        monthlyBudget: numberValue(settings.monthlyBudget),
        onboardingComplete: flag(settings.onboardingComplete),
      });
    }

    if (snapshot.syncQueue?.length) {
      await db.syncQueue.bulkInsert(
        snapshot.syncQueue.map((item) => ({
          id: text(item.id),
          userId: nullToEmpty(item.userId as string | null),
          entityType: text(item.entityType),
          entityId: text(item.entityId),
          operation: text(item.operation),
          payload: text(item.payload),
          createdAt: text(item.createdAt),
          retryCount: numberValue(item.retryCount),
          lastError: text(item.lastError),
        }))
      );
    }

    if (snapshot.syncState) {
      await db.syncState.upsert({
        id: 'default',
        userId: nullToEmpty(snapshot.syncState.userId as string | null),
        lastSyncedAt: text(snapshot.syncState.lastSyncedAt),
        status: text(snapshot.syncState.status),
        lastError: text(snapshot.syncState.lastError),
      });
    }

    await AsyncStorage.removeItem(LEGACY_KEY);
    rxLog('migration', 'JSON snapshot imported');
  } catch (error) {
    rxError('migration', error);
  }
}
