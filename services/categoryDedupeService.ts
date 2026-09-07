import { categoryRepository } from '@/database/repositories/categoryRepository';
import { transactionRepository } from '@/database/repositories/transactionRepository';
import { recurringRepository } from '@/database/repositories/recurringRepository';
import { budgetRepository } from '@/database/repositories/budgetRepository';
import { queueChange } from '@/services/outbox';
import { formatCategoryDedupeReport, planCategoryDedupe, type CategoryDedupePlan } from '@/utils/categoryDedupe';
import { rxLog } from '@/database/logger';
import { nowIso } from '@/utils/dates';

export interface CategoryDedupeReport extends CategoryDedupePlan {
  transactionIds: string[];
  recurringIds: string[];
  budgetIds: string[];
  summary: string;
}

export const categoryDedupeService = {
  async report(): Promise<CategoryDedupeReport> {
    const categories = await categoryRepository.list();
    const plan = planCategoryDedupe(categories);
    const transactionIds: string[] = [];
    const recurringIds: string[] = [];
    const budgetIds: string[] = [];

    const [transactions, recurring, budgets] = await Promise.all([
      transactionRepository.exportAll(),
      recurringRepository.exportAll(),
      budgetRepository.exportAll(),
    ]);
    const duplicateIds = new Set(plan.groups.flatMap((group) => group.duplicateIds));
    for (const item of transactions) {
      if (item.categoryId && duplicateIds.has(item.categoryId)) transactionIds.push(item.id);
    }
    for (const item of recurring) {
      if (item.categoryId && duplicateIds.has(item.categoryId)) recurringIds.push(item.id);
    }
    for (const item of budgets) {
      if (item.categoryId && duplicateIds.has(item.categoryId)) budgetIds.push(item.id);
    }

    return {
      ...plan,
      transactionIds,
      recurringIds,
      budgetIds,
      summary: formatCategoryDedupeReport(plan, {
        transactions: transactionIds.length,
        recurring: recurringIds.length,
        budgets: budgetIds.length,
      }),
    };
  },

  async apply(): Promise<CategoryDedupeReport> {
    const report = await this.report();
    rxLog('categories', report.summary);
    if (report.groups.length === 0) return report;

    for (const group of report.groups) {
      for (const duplicateId of group.duplicateIds) {
        const movedTransactions = await transactionRepository.listIdsByCategory(duplicateId);
        const movedRecurring = (await recurringRepository.exportAll())
          .filter((item) => item.categoryId === duplicateId)
          .map((item) => item.id);
        const movedBudgets = (await budgetRepository.exportAll())
          .filter((item) => item.categoryId === duplicateId)
          .map((item) => item.id);

        await transactionRepository.reassignCategory(duplicateId, group.canonicalId);
        await recurringRepository.reassignCategory(duplicateId, group.canonicalId);
        await budgetRepository.reassignCategory(duplicateId, group.canonicalId);

        for (const id of movedTransactions) {
          const item = await transactionRepository.getById(id);
          if (item) await queueChange('transaction', item.id, 'update', item);
        }
        for (const id of movedRecurring) {
          const item = await recurringRepository.getById(id);
          if (item) await queueChange('recurring', item.id, 'update', item);
        }
        for (const id of movedBudgets) {
          const item = await budgetRepository.getById(id);
          if (item) await queueChange('budget', item.id, 'update', item);
        }

        await categoryRepository.hide(duplicateId);
        await queueChange('category', duplicateId, 'delete', { id: duplicateId, deletedAt: nowIso() });
      }
    }

    rxLog('categories', `dedupe applied groups=${report.groups.length} transactions=${report.transactionIds.length}`);
    return report;
  },
};
