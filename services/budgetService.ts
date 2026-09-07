import { budgetRepository } from '@/database/repositories/budgetRepository';
import { transactionRepository } from '@/database/repositories/transactionRepository';
import { categoryRepository } from '@/database/repositories/categoryRepository';
import { queueChange } from '@/services/outbox';
import type { BudgetInput, BudgetWithUsage } from '@/types';
import { nowIso } from '@/utils/dates';
import { AppError, logError } from '@/utils/errors';
import { calculateBudgetUsage, getBudgetWarningLevel } from '@/utils/calculations';
import { currentMonthYear, toDateKey } from '@/utils/dates';
import { endOfMonth } from 'date-fns';

export const budgetService = {
  async listWithUsage(month?: number, year?: number): Promise<BudgetWithUsage[]> {
    const period = month && year ? { month, year } : currentMonthYear();
    const [budgets, categories] = await Promise.all([
      budgetRepository.listByPeriod(period.month, period.year),
      categoryRepository.list(),
    ]);
    const startDate = toDateKey(new Date(period.year, period.month - 1, 1));
    const endDate = toDateKey(endOfMonth(new Date(period.year, period.month - 1, 1)));
    const categoryTotals = await transactionRepository.categoryTotals('expense', startDate, endDate);
    const overall = await transactionRepository.totals(startDate, endDate);
    const categoryMap = Object.fromEntries(categories.map((item) => [item.id, item]));
    const spentByCategory = Object.fromEntries(
      categoryTotals.map((item) => [item.categoryId, item.amount])
    );

    return budgets.map((budget) => {
      const spent = budget.categoryId ? (spentByCategory[budget.categoryId] ?? 0) : overall.expenses;
      const usage = calculateBudgetUsage(spent, budget.amount);
      const category = budget.categoryId ? categoryMap[budget.categoryId] : null;
      return {
        ...budget,
        ...usage,
        categoryName: category?.name ?? null,
        categoryIcon: category?.icon ?? null,
        categoryColor: category?.color ?? null,
      };
    });
  },

  async create(input: BudgetInput) {
    try {
      const existing = await budgetRepository.find(input.categoryId ?? null, input.month, input.year);
      if (existing) {
        throw new AppError('A budget for this category and month already exists.');
      }
      const created = await budgetRepository.create(input);
      await queueChange('budget', created.id, 'create', created);
      return created;
    } catch (error) {
      logError('budget.create', error);
      if (error instanceof AppError) throw error;
      throw new AppError('We could not create this budget.', error);
    }
  },

  async update(id: string, input: BudgetInput) {
    try {
      const existing = await budgetRepository.find(input.categoryId ?? null, input.month, input.year);
      if (existing && existing.id !== id) {
        throw new AppError('A budget for this category and month already exists.');
      }
      const updated = await budgetRepository.update(id, input);
      await queueChange('budget', updated.id, 'update', updated);
      return updated;
    } catch (error) {
      logError('budget.update', error);
      if (error instanceof AppError) throw error;
      throw new AppError('We could not update this budget.', error);
    }
  },

  async delete(id: string) {
    try {
      await budgetRepository.delete(id);
      await queueChange('budget', id, 'delete', { id, deletedAt: nowIso() });
    } catch (error) {
      logError('budget.delete', error);
      throw new AppError('We could not delete this budget.', error);
    }
  },

  async warnings(month?: number, year?: number) {
    const items = await this.listWithUsage(month, year);
    return items
      .map((item) => {
        const level = getBudgetWarningLevel(item.percent);
        return level ? { ...item, level } : null;
      })
      .filter((item): item is BudgetWithUsage & { level: 50 | 75 | 90 | 100 } => item !== null)
      .filter((item) => item.level >= 75);
  },
};
