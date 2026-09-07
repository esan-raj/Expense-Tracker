import type {
  AppSettings,
  Budget,
  Category,
  RecurringTransaction,
  Transaction,
  TransactionWithCategory,
  RecurringTransactionWithCategory,
  ThemePreference,
  AccentPreset,
  CurrencyCode,
  TransactionType,
  PaymentMethod,
  RecurringFrequency,
  CategoryType,
} from '@/types';

interface TransactionRow {
  id: string;
  type: TransactionType | string;
  amount: number;
  categoryId: string;
  title: string;
  description: string | null;
  date: string;
  paymentMethod: PaymentMethod | string;
  notes: string | null;
  isRecurring: number | boolean;
  recurringId: string | null;
  createdAt: string;
  updatedAt: string;
  accountId?: string | null;
  isTransfer?: number | boolean | null;
  transferGroupId?: string | null;
  transferRole?: 'source' | 'destination' | null;
  categoryName?: string;
  categoryIcon?: string;
  categoryColor?: string;
  accountName?: string | null;
  accountType?: string | null;
}

interface CategoryRow {
  id: string;
  name: string;
  icon: string;
  color: string;
  type: CategoryType | string;
  isDefault: number | boolean;
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string | null;
}

interface BudgetRow {
  id: string;
  categoryId: string | null;
  amount: number;
  month: number;
  year: number;
  createdAt: string;
  updatedAt: string;
}

interface RecurringRow {
  id: string;
  title: string;
  amount: number;
  type: TransactionType | string;
  categoryId: string;
  frequency: RecurringFrequency | string;
  startDate: string;
  nextDate: string;
  paymentMethod: PaymentMethod | string;
  isActive: number | boolean;
  createdAt: string;
  updatedAt: string;
  categoryName?: string;
  categoryIcon?: string;
  categoryColor?: string;
  accountId?: string | null;
}

interface SettingsRow {
  id: string;
  currency: CurrencyCode | string;
  currencySymbol: string;
  theme: ThemePreference | string;
  accentPreset?: string;
  accentColor?: string;
  firstDayOfWeek: number;
  monthlyBudget: number | null;
  onboardingComplete: number | boolean;
}

export function mapTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    type: row.type as TransactionType,
    amount: row.amount,
    categoryId: row.categoryId,
    title: row.title,
    description: row.description,
    date: row.date,
    paymentMethod: row.paymentMethod as PaymentMethod,
    notes: row.notes,
    isRecurring: Boolean(row.isRecurring),
    recurringId: row.recurringId,
    accountId: row.accountId ?? null,
    isTransfer: Boolean(row.isTransfer),
    transferGroupId: row.transferGroupId ?? null,
    transferRole: row.transferRole ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapTransactionWithCategory(row: TransactionRow): TransactionWithCategory {
  return {
    ...mapTransaction(row),
    categoryName: row.categoryName ?? 'Unknown',
    categoryIcon: row.categoryIcon ?? 'ellipse',
    categoryColor: row.categoryColor ?? '#64748B',
    accountName: row.accountName ?? null,
    accountType: row.accountType ?? null,
  };
}

export function mapCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    type: row.type as CategoryType,
    isDefault: Boolean(row.isDefault),
    createdAt: row.createdAt,
  };
}

export function mapBudget(row: BudgetRow): Budget {
  return row;
}

export function mapRecurring(row: RecurringRow): RecurringTransaction {
  return {
    id: row.id,
    title: row.title,
    amount: row.amount,
    type: row.type as TransactionType,
    categoryId: row.categoryId,
    frequency: row.frequency as RecurringFrequency,
    startDate: row.startDate,
    nextDate: row.nextDate,
    paymentMethod: row.paymentMethod as PaymentMethod,
    isActive: Boolean(row.isActive),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    accountId: row.accountId ?? null,
  };
}

export function mapRecurringWithCategory(row: RecurringRow): RecurringTransactionWithCategory {
  return {
    ...mapRecurring(row),
    categoryName: row.categoryName ?? 'Unknown',
    categoryIcon: row.categoryIcon ?? 'ellipse',
    categoryColor: row.categoryColor ?? '#64748B',
  };
}

export function mapSettings(row: SettingsRow): AppSettings {
  const preset = row.accentPreset === 'custom' || isNamedPreset(row.accentPreset) ? row.accentPreset : 'emerald';
  return {
    id: row.id,
    currency: row.currency as CurrencyCode,
    currencySymbol: row.currencySymbol,
    theme: row.theme as ThemePreference,
    accentPreset: preset,
    accentColor: row.accentColor || '#0E7C66',
    firstDayOfWeek: row.firstDayOfWeek,
    monthlyBudget: row.monthlyBudget,
    onboardingComplete: Boolean(row.onboardingComplete),
  };
}

function isNamedPreset(value?: string): value is AccentPreset {
  return value === 'emerald' || value === 'ocean' || value === 'indigo' || value === 'violet' || value === 'amber' || value === 'rose';
}
