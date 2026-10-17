import { accountRepository } from '@/database/repositories/accountRepository';
import { transactionRepository, type TransactionLedgerEntry } from '@/database/repositories/transactionRepository';
import { queueChange } from '@/services/outbox';
import type { Account, AccountInput, AccountWithBalances } from '@/types';
import { calculateAccountBalances, calculateAssetExpenditure, getCreditCardSummary, isLiabilityAccount } from '@/utils/accountLogic';
import { accountBalanceSeries } from '@/utils/accountSeries';
import { AppError, logError } from '@/utils/errors';
import { nowIso } from '@/utils/dates';

function entriesForAccount(entries: TransactionLedgerEntry[], accountId: string): TransactionLedgerEntry[] {
  return entries.filter((item) => item.accountId === accountId);
}

export function hydrateAccountBalances(account: Account, entries: TransactionLedgerEntry[]): AccountWithBalances {
  const scoped = entriesForAccount(entries, account.id);
  const balances = calculateAccountBalances(account, scoped);
  const card = isLiabilityAccount(account.type) ? getCreditCardSummary(account, scoped) : null;
  return {
    ...account,
    ...balances,
    expenditure: calculateAssetExpenditure(scoped),
    utilizationPercent: card?.utilizationPercent ?? null,
    balanceSeries: accountBalanceSeries(account, scoped, 30),
  };
}

export function hydrateAccounts(accounts: Account[], entries: TransactionLedgerEntry[]): AccountWithBalances[] {
  return accounts.map((account) => hydrateAccountBalances(account, entries));
}

async function withBalances(account: Account): Promise<AccountWithBalances> {
  const entries = await transactionRepository.listLedgerEntries(account.id);
  return hydrateAccountBalances(account, entries);
}

export const accountService = {
  async list(includeInactive = true): Promise<AccountWithBalances[]> {
    const [accounts, entries] = await Promise.all([
      accountRepository.list(includeInactive),
      transactionRepository.listLedgerEntries(),
    ]);
    return hydrateAccounts(accounts, entries);
  },

  async getById(id: string): Promise<AccountWithBalances> {
    const account = await accountRepository.getById(id);
    if (!account) throw new AppError('This account could not be found.');
    return withBalances(account);
  },

  async create(input: AccountInput): Promise<Account> {
    try {
      if (input.type === 'credit_card' && (input.creditLimit == null || input.creditLimit < 0)) {
        throw new AppError('Credit cards need a credit limit of 0 or more.');
      }
      const created = await accountRepository.create(input);
      await queueChange('account', created.id, 'create', created);
      return created;
    } catch (error) {
      logError('account.create', error);
      if (error instanceof AppError) throw error;
      throw new AppError('We could not save this account.', error);
    }
  },

  async update(id: string, input: AccountInput): Promise<Account> {
    try {
      if (input.type === 'credit_card' && (input.creditLimit == null || input.creditLimit < 0)) {
        throw new AppError('Credit cards need a credit limit of 0 or more.');
      }
      const updated = await accountRepository.update(id, input);
      await queueChange('account', updated.id, 'update', updated);
      return updated;
    } catch (error) {
      logError('account.update', error);
      if (error instanceof AppError) throw error;
      throw new AppError('We could not update this account.', error);
    }
  },

  async archive(id: string): Promise<void> {
    const updated = await accountRepository.setActive(id, false);
    await queueChange('account', updated.id, 'update', updated);
  },

  async reactivate(id: string): Promise<void> {
    const updated = await accountRepository.setActive(id, true);
    await queueChange('account', updated.id, 'update', updated);
  },

  async remove(id: string): Promise<void> {
    const used = await accountRepository.countTransactions(id);
    if (used > 0) {
      await this.archive(id);
      return;
    }
    await accountRepository.delete(id);
    await queueChange('account', id, 'delete', { id, deletedAt: nowIso() });
  },
};
