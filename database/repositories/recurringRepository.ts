import { getRxDatabase } from '@/database';
import { enrichRecurring, loadLookups } from '@/database/helpers';
import { emptyToNull, nullToEmpty, ownerId, scopeSelector } from '@/database/query';
import type { RecurringInput, RecurringTransaction, RecurringTransactionWithCategory } from '@/types';
import { createId } from '@/utils/id';
import { nowIso } from '@/utils/dates';
import { mapRecurring, mapRecurringWithCategory } from './mappers';

export const recurringRepository = {
  async list(): Promise<RecurringTransactionWithCategory[]> {
    const db = await getRxDatabase();
    const { categories } = await loadLookups(db);
    const rows = await db.recurring.find({ selector: scopeSelector() }).exec();
    return rows
      .map((row) => {
        const json = row.toMutableJSON();
        return mapRecurringWithCategory(
          enrichRecurring(categories, {
            ...json,
            accountId: emptyToNull(json.accountId),
          })
        );
      })
      .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.nextDate.localeCompare(b.nextDate));
  },

  async getById(id: string): Promise<RecurringTransactionWithCategory | null> {
    const db = await getRxDatabase();
    const row = await db.recurring.findOne(id).exec();
    if (!row || row.deletedAt) return null;
    const { categories } = await loadLookups(db);
    const json = row.toMutableJSON();
    return mapRecurringWithCategory(enrichRecurring(categories, { ...json, accountId: emptyToNull(json.accountId) }));
  },

  async listDue(today: string): Promise<RecurringTransaction[]> {
    const db = await getRxDatabase();
    const rows = await db.recurring
      .find({
        selector: {
          ...scopeSelector(),
          isActive: true,
          nextDate: { $lte: today },
        },
      })
      .exec();
    return rows.map((row) => mapRecurring({ ...row.toMutableJSON(), accountId: emptyToNull(row.accountId) }));
  },

  async create(input: RecurringInput, nextDate: string): Promise<RecurringTransaction> {
    const db = await getRxDatabase();
    const id = createId();
    const timestamp = nowIso();
    await db.recurring.insert({
      id,
      title: input.title.trim(),
      amount: input.amount,
      type: input.type,
      categoryId: input.categoryId,
      frequency: input.frequency,
      startDate: input.startDate,
      nextDate,
      paymentMethod: input.paymentMethod,
      isActive: input.isActive !== false,
      createdAt: timestamp,
      updatedAt: timestamp,
      userId: ownerId(),
      deletedAt: '',
      accountId: nullToEmpty(input.accountId),
    });
    return (await this.getById(id))!;
  },

  async update(id: string, input: RecurringInput, nextDate: string): Promise<RecurringTransaction> {
    const db = await getRxDatabase();
    const row = await db.recurring.findOne(id).exec();
    if (!row) throw new Error('Recurring transaction not found');
    await row.incrementalPatch({
      title: input.title.trim(),
      amount: input.amount,
      type: input.type,
      categoryId: input.categoryId,
      frequency: input.frequency,
      startDate: input.startDate,
      nextDate,
      paymentMethod: input.paymentMethod,
      isActive: input.isActive !== false,
      updatedAt: nowIso(),
      accountId: nullToEmpty(input.accountId),
    });
    return (await this.getById(id))!;
  },

  async setActive(id: string, isActive: boolean): Promise<void> {
    const db = await getRxDatabase();
    const row = await db.recurring.findOne(id).exec();
    if (!row) return;
    await row.incrementalPatch({ isActive, updatedAt: nowIso() });
  },

  async setNextDate(id: string, nextDate: string): Promise<void> {
    const db = await getRxDatabase();
    const row = await db.recurring.findOne(id).exec();
    if (!row) return;
    await row.incrementalPatch({ nextDate, updatedAt: nowIso() });
  },

  async delete(id: string): Promise<void> {
    const db = await getRxDatabase();
    const linked = await db.transactions.find({ selector: { recurringId: id } }).exec();
    await Promise.all(linked.map((row) => row.incrementalPatch({ recurringId: '' })));
    const row = await db.recurring.findOne(id).exec();
    if (!row) return;
    const timestamp = nowIso();
    await row.incrementalPatch({ deletedAt: timestamp, updatedAt: timestamp, isActive: false });
  },

  async exportAll(): Promise<RecurringTransaction[]> {
    const db = await getRxDatabase();
    const rows = await db.recurring.find({ selector: scopeSelector() }).exec();
    return rows.map((row) => mapRecurring({ ...row.toMutableJSON(), accountId: emptyToNull(row.accountId) }));
  },

  async replaceAll(items: RecurringTransaction[]): Promise<void> {
    const db = await getRxDatabase();
    const current = await db.recurring.find().exec();
    await Promise.all(current.map((row) => row.remove()));
    if (!items.length) return;
    const userId = ownerId();
    await db.recurring.bulkInsert(
      items.map((item) => ({
        ...item,
        accountId: nullToEmpty(item.accountId),
        userId,
        deletedAt: '',
      }))
    );
  },

  async clear(): Promise<void> {
    const db = await getRxDatabase();
    const rows = await db.recurring.find({ selector: scopeSelector() }).exec();
    const timestamp = nowIso();
    await Promise.all(rows.map((row) => row.incrementalPatch({ deletedAt: timestamp, updatedAt: timestamp })));
  },

  async reassignCategory(fromId: string, toId: string): Promise<void> {
    const db = await getRxDatabase();
    const rows = await db.recurring.find({ selector: { categoryId: fromId, deletedAt: '' } }).exec();
    const timestamp = nowIso();
    await Promise.all(rows.map((row) => row.incrementalPatch({ categoryId: toId, updatedAt: timestamp })));
  },

  async countByCategory(categoryId: string): Promise<number> {
    const db = await getRxDatabase();
    return db.recurring.count({ selector: { categoryId, deletedAt: '' } }).exec();
  },

  async getByIdIncludingDeleted(
    id: string
  ): Promise<(RecurringTransaction & { deletedAt?: string | null }) | null> {
    const db = await getRxDatabase();
    const row = await db.recurring.findOne(id).exec();
    if (!row) return null;
    return {
      ...mapRecurring({ ...row.toMutableJSON(), accountId: emptyToNull(row.accountId) }),
      deletedAt: emptyToNull(row.deletedAt),
    };
  },

  async upsertFromRemote(
    item: RecurringTransaction & { deletedAt?: string | null; userId?: string | null }
  ): Promise<void> {
    const db = await getRxDatabase();
    await db.recurring.upsert({
      id: item.id,
      title: item.title,
      amount: item.amount,
      type: item.type,
      categoryId: item.categoryId,
      frequency: item.frequency,
      startDate: item.startDate,
      nextDate: item.nextDate,
      paymentMethod: item.paymentMethod,
      isActive: item.isActive,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      userId: ownerId(item.userId),
      deletedAt: nullToEmpty(item.deletedAt),
      accountId: nullToEmpty(item.accountId),
    });
  },

  async claimUnassigned(userId: string): Promise<void> {
    const db = await getRxDatabase();
    const rows = await db.recurring.find({ selector: { userId: '' } }).exec();
    await Promise.all(rows.map((row) => row.incrementalPatch({ userId })));
  },
};
