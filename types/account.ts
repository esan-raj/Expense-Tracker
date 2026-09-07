import type { CurrencyCode } from './settings';

export const ACCOUNT_TYPES = ['bank', 'credit_card', 'cash', 'wallet', 'investment', 'loan', 'other'] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export type TransferRole = 'source' | 'destination';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  institutionName: string | null;
  currency: CurrencyCode;
  openingBalance: number;
  creditLimit: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface AccountInput {
  name: string;
  type: AccountType;
  institutionName?: string | null;
  currency: CurrencyCode;
  openingBalance: number;
  creditLimit?: number | null;
  isActive?: boolean;
}

export interface AccountBalances {
  currentBalance: number;
  outstanding: number;
  availableCredit: number | null;
}

export interface AccountWithBalances extends Account, AccountBalances {}

export interface TransferInput {
  sourceAccountId: string;
  destinationAccountId: string;
  amount: number;
  date: string;
  notes?: string | null;
  title?: string;
}
