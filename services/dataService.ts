import { getRxDatabase } from '@/database';
import { seedSampleData } from '@/database/seed';
import { transactionRepository } from '@/database/repositories/transactionRepository';
import { categoryRepository } from '@/database/repositories/categoryRepository';
import { budgetRepository } from '@/database/repositories/budgetRepository';
import { recurringRepository } from '@/database/repositories/recurringRepository';
import { accountRepository } from '@/database/repositories/accountRepository';
import { syncService } from '@/services/syncService';
import { queueChange } from '@/services/outbox';
import { getCurrentUserId } from '@/database/session';
import { nowIso } from '@/utils/dates';
import { AppError, logError } from '@/utils/errors';

export const dataService = {
  async clearAll(): Promise<void> {
    try {
      const [transactions, budgets, recurring] = await Promise.all([
        transactionRepository.exportAll(),
        budgetRepository.exportAll(),
        recurringRepository.exportAll(),
      ]);
      await transactionRepository.clear();
      await budgetRepository.clear();
      await recurringRepository.clear();
      const deletedAt = nowIso();
      if (getCurrentUserId()) {
        await Promise.all([
          ...transactions.map((item) => queueChange('transaction', item.id, 'delete', { id: item.id, deletedAt })),
          ...budgets.map((item) => queueChange('budget', item.id, 'delete', { id: item.id, deletedAt })),
          ...recurring.map((item) => queueChange('recurring', item.id, 'delete', { id: item.id, deletedAt })),
        ]);
      }
    } catch (error) {
      logError('data.clear', error);
      throw new AppError('We could not clear your data.', error);
    }
  },

  async loadSampleData(): Promise<void> {
    try {
      const db = await getRxDatabase();
      await seedSampleData(db);
      const userId = getCurrentUserId();
      if (userId) {
        await Promise.all([
          transactionRepository.claimUnassigned(userId),
          categoryRepository.claimUnassigned(userId),
          budgetRepository.claimUnassigned(userId),
          recurringRepository.claimUnassigned(userId),
          accountRepository.claimUnassigned(userId),
        ]);
      }
      await syncService.queueExistingLocal();
    } catch (error) {
      logError('data.sample', error);
      throw new AppError('We could not load sample data.', error);
    }
  },
};
