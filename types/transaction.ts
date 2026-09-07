import type { RecurringFrequency } from './recurring';
import type { TransferRole } from './account';

export type TransactionType = 'expense' | 'income';

export type PaymentMethod =
  | 'cash'
  | 'upi'
  | 'credit_card'
  | 'debit_card'
  | 'bank_transfer'
  | 'wallet'
  | 'other';

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  categoryId: string;
  title: string;
  description: string | null;
  date: string;
  paymentMethod: PaymentMethod;
  notes: string | null;
  isRecurring: boolean;
  recurringId: string | null;
  accountId: string | null;
  isTransfer: boolean;
  transferGroupId: string | null;
  transferRole: TransferRole | null;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionWithCategory extends Transaction {
  categoryName: string;
  categoryIcon: string;
  categoryColor: string;
  accountName?: string | null;
  accountType?: string | null;
}

export interface TransactionFilters {
  type?: TransactionType | 'all';
  categoryId?: string;
  paymentMethod?: PaymentMethod;
  startDate?: string;
  endDate?: string;
  minAmount?: number;
  maxAmount?: number;
  search?: string;
  accountId?: string;
}

export type TransactionSort = 'newest' | 'oldest' | 'highest' | 'lowest';

export interface TransactionQuery {
  filters?: TransactionFilters;
  sort?: TransactionSort;
  limit?: number;
  offset?: number;
}

export interface TransactionInput {
  type: TransactionType;
  amount: number;
  categoryId: string;
  title: string;
  description?: string | null;
  date: string;
  paymentMethod: PaymentMethod;
  notes?: string | null;
  isRecurring?: boolean;
  recurringId?: string | null;
  frequency?: RecurringFrequency;
  recurringStartDate?: string;
  accountId?: string | null;
  isTransfer?: boolean;
  transferGroupId?: string | null;
  transferRole?: TransferRole | null;
}
