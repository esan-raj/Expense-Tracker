import { transactionRepository } from '@/database/repositories/transactionRepository';
import { recurringRepository } from '@/database/repositories/recurringRepository';
import { accountRepository } from '@/database/repositories/accountRepository';
import { categoryRepository } from '@/database/repositories/categoryRepository';
import { queueChange } from '@/services/outbox';
import type { TransactionInput, TransactionQuery, TransactionWithCategory, TransferInput } from '@/types';
import { AppError, logError } from '@/utils/errors';
import { addFrequency, fromDateKey, toDateKey } from '@/utils/dates';
import { nowIso } from '@/utils/dates';
import { createId } from '@/utils/id';

export const transactionService = {
  async create(input: TransactionInput): Promise<TransactionWithCategory> {
    try {
      let recurringId = input.recurringId ?? null;
      if (input.isRecurring && input.frequency) {
        const startDate = input.recurringStartDate ?? input.date;
        const created = await recurringRepository.create(
          {
            title: input.title,
            amount: input.amount,
            type: input.type,
            categoryId: input.categoryId,
            frequency: input.frequency,
            startDate,
            paymentMethod: input.paymentMethod,
            accountId: input.accountId ?? null,
            isActive: true,
          },
          toDateKey(addFrequency(fromDateKey(startDate), input.frequency))
        );
        recurringId = created.id;
        await queueChange('recurring', created.id, 'create', created);
      }

      const created = await transactionRepository.create({
        ...input,
        recurringId,
        isRecurring: Boolean(recurringId),
      });
      const full = await transactionRepository.getById(created.id);
      if (!full) {
        throw new AppError('The transaction was saved but could not be loaded.');
      }
      await queueChange('transaction', full.id, 'create', full);
      return full;
    } catch (error) {
      logError('transaction.create', error);
      if (error instanceof AppError) throw error;
      throw new AppError('We could not save this transaction. Please try again.', error);
    }
  },

  async update(id: string, input: TransactionInput): Promise<TransactionWithCategory> {
    try {
      await transactionRepository.update(id, input);
      const full = await transactionRepository.getById(id);
      if (!full) {
        throw new AppError('This transaction could not be found.');
      }
      await queueChange('transaction', full.id, 'update', full);
      return full;
    } catch (error) {
      logError('transaction.update', error);
      if (error instanceof AppError) throw error;
      throw new AppError('We could not update this transaction. Please try again.', error);
    }
  },

  async transfer(input: TransferInput): Promise<void> {
    try {
      if (input.sourceAccountId === input.destinationAccountId) {
        throw new AppError('Choose two different accounts for a transfer.');
      }
      const [source, destination] = await Promise.all([
        accountRepository.getById(input.sourceAccountId),
        accountRepository.getById(input.destinationAccountId),
      ]);
      if (!source || !destination) {
        throw new AppError('One of the selected accounts could not be found.');
      }
      const transferCategoryId = await ensureTransferCategoryId();
      const groupId = createId();
      const title = input.title?.trim() || `Transfer to ${destination.name}`;
      const sourceTx = await transactionRepository.create({
        type: 'expense',
        amount: input.amount,
        categoryId: transferCategoryId,
        title,
        date: input.date,
        paymentMethod: 'bank_transfer',
        notes: input.notes,
        accountId: source.id,
        isTransfer: true,
        transferGroupId: groupId,
        transferRole: 'source',
      });
      const destTx = await transactionRepository.create({
        type: 'income',
        amount: input.amount,
        categoryId: transferCategoryId,
        title: input.title?.trim() || `Transfer from ${source.name}`,
        date: input.date,
        paymentMethod: 'bank_transfer',
        notes: input.notes,
        accountId: destination.id,
        isTransfer: true,
        transferGroupId: groupId,
        transferRole: 'destination',
      });
      await queueChange('transaction', sourceTx.id, 'create', sourceTx);
      await queueChange('transaction', destTx.id, 'create', destTx);
    } catch (error) {
      logError('transaction.transfer', error);
      if (error instanceof AppError) throw error;
      throw new AppError('We could not save this transfer.', error);
    }
  },

  async delete(id: string): Promise<void> {
    try {
      const current = await transactionRepository.getById(id);
      const related =
        current?.isTransfer && current.transferGroupId
          ? await transactionRepository.listByTransferGroup(current.transferGroupId)
          : current
            ? [current]
            : [];
      const ids = new Set<string>([id, ...related.map((item) => item.id)]);
      const deletedAt = nowIso();
      for (const relatedId of ids) {
        await transactionRepository.delete(relatedId);
        await queueChange('transaction', relatedId, 'delete', { id: relatedId, deletedAt });
      }
    } catch (error) {
      logError('transaction.delete', error);
      throw new AppError('We could not delete this transaction. Please try again.', error);
    }
  },

  async getById(id: string): Promise<TransactionWithCategory> {
    const item = await transactionRepository.getById(id);
    if (!item) {
      throw new AppError('This transaction could not be found.');
    }
    return item;
  },

  query(query: TransactionQuery) {
    return transactionRepository.query(query);
  },

  count(query: TransactionQuery) {
    return transactionRepository.count(query);
  },

  recent(limit = 5) {
    return transactionRepository.recent(limit);
  },

  totals(startDate?: string, endDate?: string) {
    return transactionRepository.totals(startDate, endDate);
  },
};

async function ensureTransferCategoryId(): Promise<string> {
  const existing = (await categoryRepository.list()).find((item) => item.name.toLowerCase() === 'transfer');
  if (existing) return existing.id;
  const created = await categoryRepository.create({
    name: 'Transfer',
    icon: 'swap-horizontal',
    color: '#64748B',
    type: 'both',
  });
  await queueChange('category', created.id, 'create', created);
  return created.id;
}
