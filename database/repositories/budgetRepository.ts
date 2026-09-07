import { getRxDatabase } from '@/database';
import { emptyToNull, nullToEmpty, ownerId, scopeSelector } from '@/database/query';
import type { Budget, BudgetInput } from '@/types';
import { createId } from '@/utils/id';
import { nowIso } from '@/utils/dates';
import { mapBudget } from './mappers';

function toBudget(row: { toMutableJSON: () => import('@/database/types').BudgetDoc }): Budget {
  const json = row.toMutableJSON();
  return mapBudget({
    ...json,
    categoryId: emptyToNull(json.categoryId),
  });
}

export const budgetRepository = {
  async listByPeriod(month: number, year: number): Promise<Budget[]> {
    const db = await getRxDatabase();
    const rows = await db.budgets
      .find({
        selector: {
          ...scopeSelector(),
          month,
          year,
        },
      })
      .exec();
    return rows
      .map(toBudget)
      .sort((a, b) => {
        const aEmpty = a.categoryId == null ? 1 : 0;
        const bEmpty = b.categoryId == null ? 1 : 0;
        return bEmpty - aEmpty || a.createdAt.localeCompare(b.createdAt);
      });
  },

  async getById(id: string): Promise<Budget | null> {
    const db = await getRxDatabase();
    const row = await db.budgets.findOne(id).exec();
    return row && !row.deletedAt ? toBudget(row) : null;
  },

  async find(categoryId: string | null, month: number, year: number): Promise<Budget | null> {
    const db = await getRxDatabase();
    const row = await db.budgets
      .findOne({
        selector: {
          month,
          year,
          deletedAt: '',
          categoryId: nullToEmpty(categoryId),
        },
      })
      .exec();
    return row ? toBudget(row) : null;
  },

  async create(input: BudgetInput): Promise<Budget> {
    const db = await getRxDatabase();
    const id = createId();
    const timestamp = nowIso();
    await db.budgets.insert({
      id,
      categoryId: nullToEmpty(input.categoryId),
      amount: input.amount,
      month: input.month,
      year: input.year,
      createdAt: timestamp,
      updatedAt: timestamp,
      userId: ownerId(),
      deletedAt: '',
    });
    return (await this.getById(id))!;
  },

  async update(id: string, input: BudgetInput): Promise<Budget> {
    const db = await getRxDatabase();
    const row = await db.budgets.findOne(id).exec();
    if (!row) throw new Error('Budget not found');
    await row.incrementalPatch({
      categoryId: nullToEmpty(input.categoryId),
      amount: input.amount,
      month: input.month,
      year: input.year,
      updatedAt: nowIso(),
    });
    const updated = await this.getById(id);
    if (!updated) throw new Error('Budget not found');
    return updated;
  },

  async delete(id: string): Promise<void> {
    const db = await getRxDatabase();
    const row = await db.budgets.findOne(id).exec();
    if (!row) return;
    const timestamp = nowIso();
    await row.incrementalPatch({ deletedAt: timestamp, updatedAt: timestamp });
  },

  async exportAll(): Promise<Budget[]> {
    const db = await getRxDatabase();
    const rows = await db.budgets.find({ selector: scopeSelector() }).exec();
    return rows.map(toBudget);
  },

  async replaceAll(items: Budget[]): Promise<void> {
    const db = await getRxDatabase();
    const current = await db.budgets.find().exec();
    await Promise.all(current.map((row) => row.remove()));
    if (!items.length) return;
    const userId = ownerId();
    await db.budgets.bulkInsert(
      items.map((item) => ({
        id: item.id,
        categoryId: nullToEmpty(item.categoryId),
        amount: item.amount,
        month: item.month,
        year: item.year,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        userId,
        deletedAt: '',
      }))
    );
  },

  async clear(): Promise<void> {
    const db = await getRxDatabase();
    const rows = await db.budgets.find({ selector: scopeSelector() }).exec();
    const timestamp = nowIso();
    await Promise.all(rows.map((row) => row.incrementalPatch({ deletedAt: timestamp, updatedAt: timestamp })));
  },

  async reassignCategory(fromId: string, toId: string): Promise<void> {
    const db = await getRxDatabase();
    const rows = await db.budgets.find({ selector: { categoryId: fromId, deletedAt: '' } }).exec();
    const timestamp = nowIso();
    await Promise.all(rows.map((row) => row.incrementalPatch({ categoryId: toId, updatedAt: timestamp })));
  },

  async getByIdIncludingDeleted(id: string): Promise<(Budget & { deletedAt?: string | null }) | null> {
    const db = await getRxDatabase();
    const row = await db.budgets.findOne(id).exec();
    if (!row) return null;
    const mapped = toBudget(row);
    return { ...mapped, deletedAt: emptyToNull(row.deletedAt) };
  },

  async upsertFromRemote(item: Budget & { deletedAt?: string | null; userId?: string | null }): Promise<void> {
    const db = await getRxDatabase();
    await db.budgets.upsert({
      id: item.id,
      categoryId: nullToEmpty(item.categoryId),
      amount: item.amount,
      month: item.month,
      year: item.year,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      userId: ownerId(item.userId),
      deletedAt: nullToEmpty(item.deletedAt),
    });
  },

  async claimUnassigned(userId: string): Promise<void> {
    const db = await getRxDatabase();
    const rows = await db.budgets.find({ selector: { userId: '' } }).exec();
    await Promise.all(rows.map((row) => row.incrementalPatch({ userId })));
  },
};
