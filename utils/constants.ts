import type { PaymentMethod, RecurringFrequency, TransactionSort } from '@/types';

export const APP_NAME = 'SpendWise';
export const APP_VERSION = '1.0.0';
export const SETTINGS_ID = 'default';
export const DATABASE_NAME = 'spendwise.db';
export const PAGE_SIZE = 40;
export const SEARCH_DEBOUNCE_MS = 300;
export const BACKUP_VERSION = 1;

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'debit_card', label: 'Debit Card' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'wallet', label: 'Wallet' },
  { value: 'other', label: 'Other' },
];

export const FREQUENCIES: { value: RecurringFrequency; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

export const SORT_OPTIONS: { value: TransactionSort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'highest', label: 'Highest amount' },
  { value: 'lowest', label: 'Lowest amount' },
];

export const WEEK_DAYS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
] as const;

export function paymentMethodLabel(method: PaymentMethod): string {
  return PAYMENT_METHODS.find((item) => item.value === method)?.label ?? method;
}

export function frequencyLabel(frequency: RecurringFrequency): string {
  return FREQUENCIES.find((item) => item.value === frequency)?.label ?? frequency;
}
