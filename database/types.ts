import type { RxCollection, RxDatabase } from 'rxdb';
import type { SyncEntityType, SyncOperation } from '@/types/sync';

export interface TransactionDoc {
  id: string;
  userId: string;
  type: string;
  amount: number;
  categoryId: string;
  title: string;
  description: string;
  date: string;
  paymentMethod: string;
  notes: string;
  isRecurring: boolean;
  recurringId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string;
  accountId: string;
  isTransfer: boolean;
  transferGroupId: string;
  transferRole: string;
}

export interface CategoryDoc {
  id: string;
  userId: string;
  name: string;
  icon: string;
  color: string;
  type: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string;
}

export interface AccountDoc {
  id: string;
  userId: string;
  name: string;
  type: string;
  institutionName: string;
  currency: string;
  openingBalance: number;
  creditLimit: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string;
}

export interface BudgetDoc {
  id: string;
  userId: string;
  categoryId: string;
  amount: number;
  month: number;
  year: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string;
}

export interface RecurringDoc {
  id: string;
  userId: string;
  title: string;
  amount: number;
  type: string;
  categoryId: string;
  frequency: string;
  startDate: string;
  nextDate: string;
  paymentMethod: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string;
  accountId: string;
}

export interface SettingsDoc {
  id: string;
  currency: string;
  currencySymbol: string;
  theme: string;
  firstDayOfWeek: number;
  monthlyBudget: number;
  onboardingComplete: boolean;
}

export interface SyncQueueDoc {
  id: string;
  userId: string;
  entityType: SyncEntityType | string;
  entityId: string;
  operation: SyncOperation | string;
  payload: string;
  createdAt: string;
  retryCount: number;
  lastError: string;
}

export interface SyncStateDoc {
  id: string;
  userId: string;
  lastSyncedAt: string;
  status: string;
  lastError: string;
}

export type SpendWiseCollections = {
  transactions: RxCollection<TransactionDoc>;
  categories: RxCollection<CategoryDoc>;
  accounts: RxCollection<AccountDoc>;
  budgets: RxCollection<BudgetDoc>;
  recurring: RxCollection<RecurringDoc>;
  settings: RxCollection<SettingsDoc>;
  syncQueue: RxCollection<SyncQueueDoc>;
  syncState: RxCollection<SyncStateDoc>;
};

export type SpendWiseDatabase = RxDatabase<SpendWiseCollections>;
