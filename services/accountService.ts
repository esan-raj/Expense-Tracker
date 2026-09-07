import { accountRepository } from '@/database/repositories/accountRepository';
import { transactionRepository } from '@/database/repositories/transactionRepository';
import { queueChange } from '@/services/outbox';
import type { Account, AccountInput, AccountWithBalances } from '@/types';
import { calculateAccountBalances, calculateAssetExpenditure, getCreditCardSummary, isLiabilityAccount } from '@/utils/accountLogic';
import { accountBalanceSeries } from '@/utils/accountSeries';
import { AppError, logError } from '@/utils/errors';
import { nowIso } from '@/utils/dates';

async function withBalances(account: Account): Promise<AccountWithBalances> {
  const txs = await transactionRepository.query({
    filters: { accountId: account.id },
    limit: 10000,
    offset: 0,
  });
  const entries = txs.map((item) => ({
    type: item.type,
    amount: item.amount,
    accountId: item.accountId,
    isTransfer: item.isTransfer,
    transferRole: item.transferRole,
    date: item.date,
  }));
  const balances = calculateAccountBalances(account, entries);
  const card = isLiabilityAccount(account.type) ? getCreditCardSummary(account, entries) : null;
  return {
    ...account,
    ...balances,
    expenditure: calculateAssetExpenditure(entries),
    utilizationPercent: card?.utilizationPercent ?? null,
    balanceSeries: accountBalanceSeries(account, entries, 30),
  };
}

export const accountService = {
  async list(includeInactive = true): Promise<AccountWithBalances[]> {
    const accounts = await accountRepository.list(includeInactive);
    return Promise.all(accounts.map(withBalances));
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
