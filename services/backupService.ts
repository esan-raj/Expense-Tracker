import { transactionRepository } from '@/database/repositories/transactionRepository';
import { categoryRepository } from '@/database/repositories/categoryRepository';
import { budgetRepository } from '@/database/repositories/budgetRepository';
import { recurringRepository } from '@/database/repositories/recurringRepository';
import { settingsRepository } from '@/database/repositories/settingsRepository';
import { accountRepository } from '@/database/repositories/accountRepository';
import { investmentRepository } from '@/database/repositories/investmentRepository';
import { flushPersistentStorage, getRxDatabase } from '@/database';
import { BACKUP_VERSION } from '@/utils/constants';
import { AppError, logError } from '@/utils/errors';
import { safeValidateBackup, type BackupPayload } from '@/utils/validation';
import { syncService } from '@/services/syncService';
import { resolveRestoredAccountId } from '@/utils/accountLogic';
import { pickTextFile, saveAndShare } from '@/services/platform/files';

export const backupService = {
  async createBackup(): Promise<void> {
    try {
      const payload: BackupPayload = {
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        transactions: await transactionRepository.exportAll(),
        categories: await categoryRepository.list(),
        budgets: await budgetRepository.exportAll(),
        recurringTransactions: await recurringRepository.exportAll(),
        accounts: await accountRepository.list(true),
        investments: await investmentRepository.list(),
        settings: await settingsRepository.get(),
      };
      await saveAndShare('spendwise-backup.json', JSON.stringify(payload, null, 2), 'application/json');
    } catch (error) {
      logError('backup.create', error);
      if (error instanceof AppError) throw error;
      throw new AppError('We could not create a backup.', error);
    }
  },

  async pickBackup(): Promise<BackupPayload> {
    const content = await pickTextFile(['application/json', '.json']);
    if (!content) {
      throw new AppError('No backup file was selected.');
    }
    try {
      const parsed = JSON.parse(content);
      const validated = safeValidateBackup(parsed);
      if (!validated.success) {
        throw new AppError('This backup file is invalid or from an unsupported version.');
      }
      return validated.data;
    } catch (error) {
      logError('backup.pick', error);
      if (error instanceof AppError) throw error;
      throw new AppError('This backup file could not be read.', error);
    }
  },

  async restore(payload: BackupPayload): Promise<void> {
    try {
      await getRxDatabase();
      await transactionRepository.replaceAll([]);
      await budgetRepository.replaceAll([]);
      await recurringRepository.replaceAll([]);
      const accountIds = new Set((payload.accounts ?? []).map((item) => item.id));
      await accountRepository.replaceAll(payload.accounts ?? []);
      await investmentRepository.replaceAll(payload.investments ?? []);
      await categoryRepository.replaceAll(payload.categories);
      await recurringRepository.replaceAll(
        payload.recurringTransactions.map((item) => ({
          ...item,
          accountId: resolveRestoredAccountId(item.accountId, accountIds),
        }))
      );
      await transactionRepository.replaceAll(
        payload.transactions.map((item) => ({
          ...item,
          accountId: resolveRestoredAccountId(item.accountId, accountIds),
          isTransfer: item.isTransfer ?? false,
          transferGroupId: item.transferGroupId ?? null,
          transferRole: item.transferRole ?? null,
        }))
      );
      await budgetRepository.replaceAll(payload.budgets);
      await settingsRepository.replace(payload.settings);
      await syncService.queueExistingLocal();
      await flushPersistentStorage();
    } catch (error) {
      logError('backup.restore', error);
      throw new AppError('We could not restore this backup. Your existing data was kept.', error);
    }
  },
};
