import { categoryRepository } from '@/database/repositories/categoryRepository';
import { transactionRepository } from '@/database/repositories/transactionRepository';
import { budgetRepository } from '@/database/repositories/budgetRepository';
import { recurringRepository } from '@/database/repositories/recurringRepository';
import { queueChange } from '@/services/outbox';
import type { Category, CategoryInput } from '@/types';
import { AppError, logError } from '@/utils/errors';
import { nowIso } from '@/utils/dates';

export const categoryService = {
  list() {
    return categoryRepository.list();
  },

  async create(input: CategoryInput): Promise<Category> {
    try {
      const created = await categoryRepository.create(input);
      await queueChange('category', created.id, 'create', created);
      return created;
    } catch (error) {
      logError('category.create', error);
      throw new AppError('We could not create this category.', error);
    }
  },

  async update(id: string, input: CategoryInput): Promise<Category> {
    try {
      const updated = await categoryRepository.update(id, input);
      await queueChange('category', updated.id, 'update', updated);
      return updated;
    } catch (error) {
      logError('category.update', error);
      throw new AppError('We could not update this category.', error);
    }
  },

  async usage(id: string) {
    const [transactions, recurring] = await Promise.all([
      transactionRepository.countByCategory(id),
      recurringRepository.countByCategory(id),
    ]);
    return { transactions, recurring, total: transactions + recurring };
  },

  async delete(id: string, reassignToId?: string): Promise<void> {
    try {
      const category = await categoryRepository.getById(id);
      if (!category) {
        throw new AppError('This category could not be found.');
      }
      if (category.isDefault) {
        throw new AppError('Default categories cannot be deleted.');
      }

      const usage = await this.usage(id);
      if (usage.total > 0) {
        if (!reassignToId) {
          throw new AppError(
            'This category is used by existing records. Choose another category to move them to.'
          );
        }
        if (reassignToId === id) {
          throw new AppError('Choose a different category for the existing records.');
        }
        const moved = await transactionRepository.listIdsByCategory(id);
        await transactionRepository.reassignCategory(id, reassignToId);
        await recurringRepository.reassignCategory(id, reassignToId);
        await budgetRepository.reassignCategory(id, reassignToId);
        for (const transactionId of moved) {
          const item = await transactionRepository.getById(transactionId);
          if (item) await queueChange('transaction', item.id, 'update', item);
        }
      }

      await categoryRepository.delete(id);
      await queueChange('category', id, 'delete', { id, deletedAt: nowIso() });
    } catch (error) {
      logError('category.delete', error);
      if (error instanceof AppError) throw error;
      throw new AppError('We could not delete this category.', error);
    }
  },
};
