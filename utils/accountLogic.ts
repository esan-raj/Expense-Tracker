import type { Account, AccountBalances, AccountType, TransferRole } from '@/types/account';
import type { TransactionType } from '@/types/transaction';

export interface AccountLedgerEntry {
  type: TransactionType;
  amount: number;
  accountId?: string | null;
  isTransfer?: boolean;
  transferRole?: TransferRole | null;
}

export function isAssetAccount(type: AccountType): boolean {
  return type === 'bank' || type === 'cash' || type === 'wallet' || type === 'investment' || type === 'other';
}

export function isLiabilityAccount(type: AccountType): boolean {
  return type === 'credit_card' || type === 'loan';
}

export function isTransferEntry(entry: Pick<AccountLedgerEntry, 'isTransfer'>): boolean {
  return Boolean(entry.isTransfer);
}

export function signedAccountDelta(accountType: AccountType, entry: AccountLedgerEntry, accountId?: string): number {
  if (accountId && entry.accountId && entry.accountId !== accountId) {
    return 0;
  }
  const amount = entry.amount;
  if (isLiabilityAccount(accountType)) {
    if (entry.isTransfer) {
      if (entry.transferRole === 'destination') return -amount;
      if (entry.transferRole === 'source') return amount;
      return 0;
    }
    if (entry.type === 'expense') return amount;
    if (entry.type === 'income') return -amount;
    return 0;
  }
  if (entry.isTransfer) {
    if (entry.transferRole === 'source') return -amount;
    if (entry.transferRole === 'destination') return amount;
    return 0;
  }
  if (entry.type === 'income') return amount;
  if (entry.type === 'expense') return -amount;
  return 0;
}

export function calculateAssetExpenditure(entries: AccountLedgerEntry[]): number {
  return entries.reduce((sum, entry) => {
    if (entry.isTransfer || entry.type !== 'expense') return sum;
    return sum + Math.max(0, entry.amount);
  }, 0);
}

export function accountOverviewSlices(
  account: Pick<Account, 'type' | 'creditLimit'> & AccountBalances,
  expenditure: number
): { used: number; remaining: number; usedLabel: string; remainingLabel: string; centerLabel: string } {
  if (isLiabilityAccount(account.type)) {
    const used = Math.max(0, account.outstanding);
    const remaining = Math.max(0, account.availableCredit ?? Math.max(0, (account.creditLimit ?? 0) - used));
    return { used, remaining, usedLabel: 'Used', remainingLabel: 'Left', centerLabel: 'Limit' };
  }
  return {
    used: Math.max(0, expenditure),
    remaining: Math.max(0, account.currentBalance),
    usedLabel: 'Spent',
    remainingLabel: 'Left',
    centerLabel: 'Balance',
  };
}

export function calculateAccountBalances(
  account: Pick<Account, 'type' | 'openingBalance' | 'creditLimit'>,
  entries: AccountLedgerEntry[]
): AccountBalances {
  const movement = entries.reduce((sum, entry) => sum + signedAccountDelta(account.type, entry), 0);
  if (isLiabilityAccount(account.type)) {
    const outstanding = Math.max(0, account.openingBalance + movement);
    const availableCredit = account.creditLimit == null ? null : account.creditLimit - outstanding;
    return { currentBalance: -outstanding, outstanding, availableCredit };
  }
  const currentBalance = account.openingBalance + movement;
  return { currentBalance, outstanding: 0, availableCredit: null };
}

export interface CreditCardSummary {
  creditLimit: number | null;
  currentOutstanding: number;
  availableCredit: number | null;
  utilizationPercent: number | null;
  cycleSpending: number;
}

export function getCreditCardSummary(
  account: Pick<Account, 'type' | 'openingBalance' | 'creditLimit'>,
  entries: AccountLedgerEntry[]
): CreditCardSummary {
  const balances = calculateAccountBalances(account, entries);
  const cycleSpending = calculateAssetExpenditure(entries);
  const limit = account.creditLimit;
  return {
    creditLimit: limit ?? null,
    currentOutstanding: balances.outstanding,
    availableCredit: balances.availableCredit,
    utilizationPercent:
      limit && limit > 0 ? Math.round((balances.outstanding / limit) * 10000) / 100 : null,
    cycleSpending,
  };
}

export function summarizeAccounts(accounts: Array<Account & { entries: AccountLedgerEntry[] }>) {
  return accounts.reduce(
    (acc, account) => {
      const balances = calculateAccountBalances(account, account.entries);
      if (isLiabilityAccount(account.type)) {
        acc.creditOutstanding += balances.outstanding;
        acc.availableCredit += balances.availableCredit ?? 0;
      } else {
        acc.bankBalance += balances.currentBalance;
      }
      return acc;
    },
    { bankBalance: 0, creditOutstanding: 0, availableCredit: 0 }
  );
}

export function accountTypeLabel(type: AccountType): string {
  switch (type) {
    case 'bank':
      return 'Bank Account';
    case 'credit_card':
      return 'Credit Card';
    case 'cash':
      return 'Cash';
    case 'wallet':
      return 'Wallet';
    case 'investment':
      return 'Investment';
    case 'loan':
      return 'Loan';
    default:
      return 'Other';
  }
}

export function accountIcon(type: AccountType): 'card' | 'cash' | 'wallet' | 'trending-up' | 'business' {
  if (type === 'credit_card') return 'card';
  if (type === 'cash') return 'cash';
  if (type === 'wallet') return 'wallet';
  if (type === 'investment') return 'trending-up';
  return 'business';
}

export function excludeTransfers<T extends { isTransfer?: boolean }>(items: T[]): T[] {
  return items.filter((item) => !item.isTransfer);
}

export function resolveRestoredAccountId(
  accountId: string | null | undefined,
  knownIds: Iterable<string>
): string | null {
  if (!accountId) return null;
  return new Set(knownIds).has(accountId) ? accountId : null;
}

export function matchesAccountFilter(accountId: string | null | undefined, filter?: string | null): boolean {
  if (!filter) return true;
  return accountId === filter;
}
