import type { PaymentMethod, TransactionType } from './transaction';

export type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurringTransaction {
  id: string;
  title: string;
  amount: number;
  type: TransactionType;
  categoryId: string;
  frequency: RecurringFrequency;
  startDate: string;
  nextDate: string;
  paymentMethod: PaymentMethod;
  accountId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringTransactionWithCategory extends RecurringTransaction {
  categoryName: string;
  categoryIcon: string;
  categoryColor: string;
}

export interface RecurringInput {
  title: string;
  amount: number;
  type: TransactionType;
  categoryId: string;
  frequency: RecurringFrequency;
  startDate: string;
  paymentMethod: PaymentMethod;
  accountId?: string | null;
  isActive?: boolean;
}
