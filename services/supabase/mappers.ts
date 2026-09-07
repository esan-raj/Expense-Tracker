import type { Account, AppSettings, Budget, Category, RecurringTransaction, Transaction } from '@/types';

export interface RemoteTransaction {
  id: string;
  user_id: string;
  type: Transaction['type'];
  amount: number;
  category_id: string | null;
  title: string;
  description: string | null;
  date: string;
  payment_method: Transaction['paymentMethod'] | null;
  notes: string | null;
  is_recurring: boolean;
  recurring_id: string | null;
  account_id: string | null;
  is_transfer: boolean;
  transfer_group_id: string | null;
  transfer_role: 'source' | 'destination' | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface RemoteAccount {
  id: string;
  user_id: string;
  name: string;
  type: Account['type'];
  institution_name: string | null;
  currency: Account['currency'];
  opening_balance: number;
  credit_limit: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface RemoteCategory {
  id: string;
  user_id: string;
  name: string;
  icon: string | null;
  color: string | null;
  type: Category['type'];
  is_default: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface RemoteBudget {
  id: string;
  user_id: string;
  category_id: string | null;
  amount: number;
  month: number;
  year: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface RemoteRecurring {
  id: string;
  user_id: string;
  title: string;
  amount: number;
  type: RecurringTransaction['type'];
  category_id: string | null;
  frequency: RecurringTransaction['frequency'];
  start_date: string;
  next_date: string;
  payment_method: RecurringTransaction['paymentMethod'] | null;
  is_active: boolean;
  account_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface RemoteProfile {
  id: string;
  display_name: string | null;
  currency: AppSettings['currency'];
  currency_symbol: string;
  theme: AppSettings['theme'];
  first_day_of_week: number;
  monthly_budget: number | null;
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

export function toRemoteTransaction(item: Transaction, userId: string): RemoteTransaction {
  return {
    id: item.id,
    user_id: userId,
    type: item.type,
    amount: item.amount,
    category_id: item.categoryId || null,
    title: item.title,
    description: item.description,
    date: `${item.date}T00:00:00.000Z`,
    payment_method: item.paymentMethod,
    notes: item.notes,
    is_recurring: item.isRecurring,
    recurring_id: item.recurringId,
    account_id: item.accountId,
    is_transfer: item.isTransfer,
    transfer_group_id: item.transferGroupId,
    transfer_role: item.transferRole,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    deleted_at: (item as Transaction & { deletedAt?: string | null }).deletedAt ?? null,
  };
}

export function fromRemoteTransaction(row: RemoteTransaction): Transaction & { deletedAt: string | null; userId: string } {
  return {
    id: row.id,
    type: row.type,
    amount: row.amount,
    categoryId: row.category_id ?? '',
    title: row.title,
    description: row.description,
    date: dateOnly(row.date),
    paymentMethod: row.payment_method ?? 'other',
    notes: row.notes,
    isRecurring: row.is_recurring,
    recurringId: row.recurring_id,
    accountId: row.account_id,
    isTransfer: Boolean(row.is_transfer),
    transferGroupId: row.transfer_group_id,
    transferRole: row.transfer_role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    userId: row.user_id,
  };
}

export function toRemoteAccount(item: Account, userId: string): RemoteAccount {
  return {
    id: item.id,
    user_id: userId,
    name: item.name,
    type: item.type,
    institution_name: item.institutionName,
    currency: item.currency,
    opening_balance: item.openingBalance,
    credit_limit: item.creditLimit,
    is_active: item.isActive,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    deleted_at: item.deletedAt ?? null,
  };
}

export function fromRemoteAccount(row: RemoteAccount): Account & { userId: string } {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    institutionName: row.institution_name,
    currency: row.currency,
    openingBalance: row.opening_balance,
    creditLimit: row.credit_limit,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    userId: row.user_id,
  };
}

export function toRemoteCategory(item: Category, userId: string): RemoteCategory {
  return {
    id: item.id,
    user_id: userId,
    name: item.name,
    icon: item.icon,
    color: item.color,
    type: item.type,
    is_default: item.isDefault,
    created_at: item.createdAt,
    updated_at: item.updatedAt ?? item.createdAt,
    deleted_at: item.deletedAt ?? null,
  };
}

export function fromRemoteCategory(row: RemoteCategory): Category & { deletedAt: string | null; userId: string; updatedAt: string } {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon ?? 'ellipse',
    color: row.color ?? '#64748B',
    type: row.type,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    userId: row.user_id,
  };
}

export function toRemoteBudget(item: Budget, userId: string): RemoteBudget {
  return {
    id: item.id,
    user_id: userId,
    category_id: item.categoryId,
    amount: item.amount,
    month: item.month,
    year: item.year,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    deleted_at: (item as Budget & { deletedAt?: string | null }).deletedAt ?? null,
  };
}

export function fromRemoteBudget(row: RemoteBudget): Budget & { deletedAt: string | null; userId: string } {
  return {
    id: row.id,
    categoryId: row.category_id,
    amount: row.amount,
    month: row.month,
    year: row.year,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    userId: row.user_id,
  };
}

export function toRemoteRecurring(item: RecurringTransaction, userId: string): RemoteRecurring {
  return {
    id: item.id,
    user_id: userId,
    title: item.title,
    amount: item.amount,
    type: item.type,
    category_id: item.categoryId,
    frequency: item.frequency,
    start_date: item.startDate,
    next_date: item.nextDate,
    payment_method: item.paymentMethod,
    is_active: item.isActive,
    account_id: item.accountId,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    deleted_at: (item as RecurringTransaction & { deletedAt?: string | null }).deletedAt ?? null,
  };
}

export function fromRemoteRecurring(
  row: RemoteRecurring
): RecurringTransaction & { deletedAt: string | null; userId: string } {
  return {
    id: row.id,
    title: row.title,
    amount: row.amount,
    type: row.type,
    categoryId: row.category_id ?? '',
    frequency: row.frequency,
    startDate: dateOnly(row.start_date),
    nextDate: dateOnly(row.next_date),
    paymentMethod: row.payment_method ?? 'other',
    isActive: row.is_active,
    accountId: row.account_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    userId: row.user_id,
  };
}

export function toRemoteProfile(settings: AppSettings, userId: string): Partial<RemoteProfile> {
  return {
    id: userId,
    currency: settings.currency,
    currency_symbol: settings.currencySymbol,
    theme: settings.theme,
    first_day_of_week: settings.firstDayOfWeek,
    monthly_budget: settings.monthlyBudget,
    onboarding_completed: settings.onboardingComplete,
  };
}
