import { transactionRepository } from '@/database/repositories/transactionRepository';
import { recurringRepository } from '@/database/repositories/recurringRepository';
import { accountRepository } from '@/database/repositories/accountRepository';
import { categoryRepository } from '@/database/repositories/categoryRepository';
import { queueChange } from '@/services/outbox';
import type { Transaction, TransactionInput, TransactionQuery, TransactionWithCategory, TransferInput } from '@/types';
import { AppError, logError } from '@/utils/errors';
import { addFrequency, fromDateKey, toDateKey } from '@/utils/dates';
import { nowIso } from '@/utils/dates';
import { createId } from '@/utils/id';
import { transferLegTitles, transferPaymentMethod } from '@/utils/transfers';

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

  async transfer(input: TransferInput): Promise<{ sourceId: string; destinationId: string; transferGroupId: string }> {
    let sourceTx: Transaction | null = null;
    let destTx: Transaction | null = null;
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
      const titles = transferLegTitles(source, destination, input.title);
      const paymentMethod = transferPaymentMethod(source.type, destination.type);
      sourceTx = await transactionRepository.create({
        type: 'expense',
        amount: input.amount,
        categoryId: transferCategoryId,
        title: titles.sourceTitle,
        date: input.date,
        paymentMethod,
        notes: input.notes,
        accountId: source.id,
        isTransfer: true,
        transferGroupId: groupId,
        transferRole: 'source',
      });
      destTx = await transactionRepository.create({
        type: 'income',
        amount: input.amount,
        categoryId: transferCategoryId,
        title: titles.destTitle,
        date: input.date,
        paymentMethod,
        notes: input.notes,
        accountId: destination.id,
        isTransfer: true,
        transferGroupId: groupId,
        transferRole: 'destination',
      });
      await queueChange('transaction', sourceTx.id, 'create', sourceTx);
      await queueChange('transaction', destTx.id, 'create', destTx);
      return { sourceId: sourceTx.id, destinationId: destTx.id, transferGroupId: groupId };
    } catch (error) {
      if (sourceTx && !destTx) {
        await transactionRepository.delete(sourceTx.id).catch((cleanupError) => {
          logError('transaction.transfer.rollback', cleanupError);
        });
      }
      logError('transaction.transfer', error);
      if (error instanceof AppError) throw error;
      throw new AppError('We could not save this transfer.', error);
    }
  },

  async updateTransfer(id: string, input: TransferInput): Promise<void> {
    const current = await transactionRepository.getById(id);
    if (!current?.isTransfer || !current.transferGroupId) {
      throw new AppError('This transfer could not be found.');
    }
    if (input.sourceAccountId === input.destinationAccountId) {
      throw new AppError('Choose two different accounts for a transfer.');
    }
    const [source, destination, related] = await Promise.all([
      accountRepository.getById(input.sourceAccountId),
      accountRepository.getById(input.destinationAccountId),
      transactionRepository.listByTransferGroup(current.transferGroupId),
    ]);
    if (!source || !destination) {
      throw new AppError('One of the selected accounts could not be found.');
    }
    const sourceLeg = related.find((item) => item.transferRole === 'source');
    const destLeg = related.find((item) => item.transferRole === 'destination');
    if (!sourceLeg || !destLeg) {
      throw new AppError('This transfer is missing a linked account.');
    }
    const transferCategoryId = sourceLeg.categoryId || destLeg.categoryId || (await ensureTransferCategoryId());
    const titles = transferLegTitles(source, destination, input.title);
    const paymentMethod = transferPaymentMethod(source.type, destination.type);
    const previous = {
      source: toTransactionInput(sourceLeg),
      dest: toTransactionInput(destLeg),
    };
    try {
      await transactionRepository.update(sourceLeg.id, {
        type: 'expense',
        amount: input.amount,
        categoryId: transferCategoryId,
        title: titles.sourceTitle,
        date: input.date,
        paymentMethod,
        notes: input.notes,
        accountId: source.id,
        isTransfer: true,
        transferGroupId: current.transferGroupId,
        transferRole: 'source',
      });
      await transactionRepository.update(destLeg.id, {
        type: 'income',
        amount: input.amount,
        categoryId: transferCategoryId,
        title: titles.destTitle,
        date: input.date,
        paymentMethod,
        notes: input.notes,
        accountId: destination.id,
        isTransfer: true,
        transferGroupId: current.transferGroupId,
        transferRole: 'destination',
      });
    } catch (error) {
      await transactionRepository.update(sourceLeg.id, previous.source).catch((cleanupError) => {
        logError('transaction.updateTransfer.rollbackSource', cleanupError);
      });
      await transactionRepository.update(destLeg.id, previous.dest).catch((cleanupError) => {
        logError('transaction.updateTransfer.rollbackDest', cleanupError);
      });
      logError('transaction.updateTransfer', error);
      if (error instanceof AppError) throw error;
      throw new AppError('We could not update this transfer.', error);
    }
    const [updatedSource, updatedDest] = await Promise.all([
      transactionRepository.getById(sourceLeg.id),
      transactionRepository.getById(destLeg.id),
    ]);
    if (updatedSource) await queueChange('transaction', updatedSource.id, 'update', updatedSource);
    if (updatedDest) await queueChange('transaction', updatedDest.id, 'update', updatedDest);
  },

  async getTransferPair(id: string): Promise<{ source: TransactionWithCategory; destination: TransactionWithCategory } | null> {
    const current = await transactionRepository.getById(id);
    if (!current?.isTransfer || !current.transferGroupId) return null;
    const related = await transactionRepository.listByTransferGroup(current.transferGroupId);
    const source = related.find((item) => item.transferRole === 'source');
    const destination = related.find((item) => item.transferRole === 'destination');
    if (!source || !destination) return null;
    return { source, destination };
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

function toTransactionInput(item: TransactionWithCategory): TransactionInput {
  return {
    type: item.type,
    amount: item.amount,
    categoryId: item.categoryId,
    title: item.title,
    description: item.description,
    date: item.date,
    paymentMethod: item.paymentMethod,
    notes: item.notes,
    isRecurring: item.isRecurring,
    recurringId: item.recurringId,
    accountId: item.accountId,
    isTransfer: item.isTransfer,
    transferGroupId: item.transferGroupId,
    transferRole: item.transferRole,
  };
}
