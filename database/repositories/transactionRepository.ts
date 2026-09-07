import { getRxDatabase } from '@/database';
import { compareValues, enrichTransaction, loadLookups, matchesSearch } from '@/database/helpers';
import { emptyToNull, nullToEmpty, ownerId, scopeSelector } from '@/database/query';
import type {
  Transaction,
  TransactionInput,
  TransactionQuery,
  TransactionWithCategory,
} from '@/types';
import { createId } from '@/utils/id';
import { nowIso } from '@/utils/dates';
import { mapTransaction, mapTransactionWithCategory } from './mappers';
import type { TransactionDoc } from '@/database/types';

function matchesQuery(row: TransactionDoc, query: TransactionQuery, categoryName?: string): boolean {
  const filters = query.filters ?? {};
  if (filters.isTransfer === true && !row.isTransfer) return false;
  if (filters.isTransfer === false && row.isTransfer) return false;
  if (filters.type && filters.type !== 'all') {
    if (row.isTransfer || row.type !== filters.type) return false;
  }
  if (filters.categoryId && row.categoryId !== filters.categoryId) return false;
  if (filters.categoryIds?.length && !filters.categoryIds.includes(row.categoryId)) return false;
  if (filters.paymentMethod && row.paymentMethod !== filters.paymentMethod) return false;
  if (filters.startDate && row.date < filters.startDate) return false;
  if (filters.endDate && row.date > filters.endDate) return false;
  if (filters.minAmount !== undefined && row.amount < filters.minAmount) return false;
  if (filters.maxAmount !== undefined && row.amount > filters.maxAmount) return false;
  if (filters.accountId && row.accountId !== filters.accountId) return false;
  if (filters.search?.trim()) {
    const term = filters.search.trim().toLowerCase();
    const haystack = [row.title, row.description, row.notes, categoryName, row.paymentMethod.replace(/_/g, ' ')];
    if (!haystack.some((value) => matchesSearch(value, term))) return false;
  }
  return true;
}

function sortTransactions(rows: TransactionDoc[], sort: TransactionQuery['sort']) {
  const next = [...rows];
  next.sort((a, b) => {
    if (sort === 'oldest') return compareValues(a.date, b.date) || compareValues(a.createdAt, b.createdAt);
    if (sort === 'highest') return compareValues(b.amount, a.amount) || compareValues(b.date, a.date);
    if (sort === 'lowest') return compareValues(a.amount, b.amount) || compareValues(b.date, a.date);
    return compareValues(b.date, a.date) || compareValues(b.createdAt, a.createdAt);
  });
  return next;
}

function toDoc(input: TransactionInput, id: string, createdAt: string, updatedAt: string, userId: string): TransactionDoc {
  return {
    id,
    userId,
    type: input.type,
    amount: input.amount,
    categoryId: input.categoryId,
    title: input.title.trim(),
    description: nullToEmpty(input.description),
    date: input.date,
    paymentMethod: input.paymentMethod,
    notes: input.notes?.trim() ? input.notes.trim() : '',
    isRecurring: Boolean(input.isRecurring),
    recurringId: nullToEmpty(input.recurringId),
    createdAt,
    updatedAt,
    deletedAt: '',
    accountId: nullToEmpty(input.accountId),
    isTransfer: Boolean(input.isTransfer),
    transferGroupId: nullToEmpty(input.transferGroupId),
    transferRole: nullToEmpty(input.transferRole),
  };
}

export const transactionRepository = {
  async create(input: TransactionInput): Promise<Transaction> {
    const db = await getRxDatabase();
    const id = createId();
    const timestamp = nowIso();
    await db.transactions.insert(toDoc(input, id, timestamp, timestamp, ownerId()));
    return this.getById(id) as Promise<Transaction>;
  },

  async update(id: string, input: TransactionInput): Promise<Transaction> {
    const db = await getRxDatabase();
    const existing = await db.transactions.findOne(id).exec();
    if (!existing) throw new Error('Transaction not found');
    await db.transactions.upsert(toDoc(input, id, existing.createdAt, nowIso(), existing.userId));
    const updated = await this.getById(id);
    if (!updated) throw new Error('Transaction not found');
    return updated;
  },

  async delete(id: string): Promise<void> {
    const db = await getRxDatabase();
    const row = await db.transactions.findOne(id).exec();
    if (!row) return;
    const timestamp = nowIso();
    await row.incrementalPatch({ deletedAt: timestamp, updatedAt: timestamp });
  },

  async getById(id: string): Promise<TransactionWithCategory | null> {
    const db = await getRxDatabase();
    const row = await db.transactions.findOne(id).exec();
    if (!row || row.deletedAt) return null;
    const lookups = await loadLookups(db);
    return mapTransactionWithCategory(enrichTransaction(lookups.categories, lookups.accounts, row.toMutableJSON()));
  },

  async query(query: TransactionQuery = {}): Promise<TransactionWithCategory[]> {
    const db = await getRxDatabase();
    const lookups = await loadLookups(db);
    const rows = await db.transactions.find({ selector: scopeSelector() }).exec();
    const filtered = rows
      .map((row) => row.toMutableJSON())
      .filter((row) =>
        matchesQuery(row, query, lookups.categories.find((item) => item.id === row.categoryId)?.name)
      );
    const limit = query.limit ?? 40;
    const offset = query.offset ?? 0;
    return sortTransactions(filtered, query.sort ?? 'newest')
      .slice(offset, offset + limit)
      .map((row) => mapTransactionWithCategory(enrichTransaction(lookups.categories, lookups.accounts, row)));
  },

  async count(query: TransactionQuery = {}): Promise<number> {
    const db = await getRxDatabase();
    const lookups = await loadLookups(db);
    const rows = await db.transactions.find({ selector: scopeSelector() }).exec();
    return rows
      .map((row) => row.toMutableJSON())
      .filter((row) =>
        matchesQuery(row, query, lookups.categories.find((item) => item.id === row.categoryId)?.name)
      ).length;
  },

  async listBetween(startDate: string, endDate: string): Promise<TransactionWithCategory[]> {
    return this.query({ filters: { startDate, endDate }, sort: 'newest', limit: 10000, offset: 0 });
  },

  async recent(limit = 5): Promise<TransactionWithCategory[]> {
    return this.query({ sort: 'newest', limit, offset: 0 });
  },

  async listByTransferGroup(groupId: string): Promise<TransactionWithCategory[]> {
    const db = await getRxDatabase();
    const lookups = await loadLookups(db);
    const rows = await db.transactions.find({ selector: { transferGroupId: groupId, deletedAt: '' } }).exec();
    return rows.map((row) =>
      mapTransactionWithCategory(enrichTransaction(lookups.categories, lookups.accounts, row.toMutableJSON()))
    );
  },

  async existsForRecurringOnDate(recurringId: string, date: string): Promise<boolean> {
    const db = await getRxDatabase();
    const row = await db.transactions
      .findOne({ selector: { recurringId, date, deletedAt: '' } })
      .exec();
    return Boolean(row);
  },

  async totals(startDate?: string, endDate?: string): Promise<{ income: number; expenses: number }> {
    const db = await getRxDatabase();
    const rows = await db.transactions.find({ selector: scopeSelector() }).exec();
    return rows
      .map((row) => row.toMutableJSON())
      .filter((row) => {
        if (row.isTransfer) return false;
        if (startDate && row.date < startDate) return false;
        if (endDate && row.date > endDate) return false;
        return true;
      })
      .reduce(
        (acc, row) => {
          if (row.type === 'income') acc.income += row.amount;
          if (row.type === 'expense') acc.expenses += row.amount;
          return acc;
        },
        { income: 0, expenses: 0 }
      );
  },

  async categoryTotals(
    type: 'expense' | 'income',
    startDate: string,
    endDate: string
  ): Promise<{ categoryId: string; name: string; icon: string; color: string; amount: number }[]> {
    const db = await getRxDatabase();
    const lookups = await loadLookups(db);
    const rows = await db.transactions.find({ selector: scopeSelector() }).exec();
    const totals = new Map<string, { categoryId: string; name: string; icon: string; color: string; amount: number }>();
    for (const doc of rows) {
      const row = doc.toMutableJSON();
      if (row.isTransfer || row.type !== type || row.date < startDate || row.date > endDate) continue;
      const category = lookups.categories.find((item) => item.id === row.categoryId);
      if (!category) continue;
      const current = totals.get(category.id) ?? {
        categoryId: category.id,
        name: category.name,
        icon: category.icon,
        color: category.color,
        amount: 0,
      };
      current.amount += row.amount;
      totals.set(category.id, current);
    }
    return [...totals.values()].sort((a, b) => b.amount - a.amount);
  },

  async dailyTotals(
    type: 'expense' | 'income',
    startDate: string,
    endDate: string
  ): Promise<{ date: string; amount: number }[]> {
    const db = await getRxDatabase();
    const rows = await db.transactions.find({ selector: scopeSelector() }).exec();
    const totals = new Map<string, number>();
    for (const doc of rows) {
      const row = doc.toMutableJSON();
      if (row.isTransfer || row.type !== type || row.date < startDate || row.date > endDate) continue;
      totals.set(row.date, (totals.get(row.date) ?? 0) + row.amount);
    }
    return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => ({ date, amount }));
  },

  async highestExpense(startDate: string, endDate: string): Promise<TransactionWithCategory | null> {
    const db = await getRxDatabase();
    const lookups = await loadLookups(db);
    const rows = await db.transactions.find({ selector: { ...scopeSelector(), type: 'expense' } }).exec();
    const best = sortTransactions(
      rows
        .map((row) => row.toMutableJSON())
        .filter((item) => item.date >= startDate && item.date <= endDate && !item.isTransfer),
      'highest'
    )[0];
    return best ? mapTransactionWithCategory(enrichTransaction(lookups.categories, lookups.accounts, best)) : null;
  },

  async reassignCategory(fromId: string, toId: string): Promise<void> {
    const db = await getRxDatabase();
    const rows = await db.transactions.find({ selector: { categoryId: fromId, deletedAt: '' } }).exec();
    const timestamp = nowIso();
    await Promise.all(rows.map((row) => row.incrementalPatch({ categoryId: toId, updatedAt: timestamp })));
  },

  async getByIdIncludingDeleted(id: string): Promise<(Transaction & { deletedAt?: string | null; userId?: string | null }) | null> {
    const db = await getRxDatabase();
    const row = await db.transactions.findOne(id).exec();
    if (!row) return null;
    const json = row.toMutableJSON();
    return {
      ...mapTransaction(enrichTransaction([], [], json)),
      deletedAt: emptyToNull(json.deletedAt),
      userId: emptyToNull(json.userId),
    };
  },

  async upsertFromRemote(item: Transaction & { deletedAt?: string | null; userId?: string | null }): Promise<void> {
    const db = await getRxDatabase();
    await db.transactions.upsert({
      id: item.id,
      type: item.type,
      amount: item.amount,
      categoryId: item.categoryId,
      title: item.title,
      description: nullToEmpty(item.description),
      date: item.date,
      paymentMethod: item.paymentMethod,
      notes: nullToEmpty(item.notes),
      isRecurring: item.isRecurring,
      recurringId: nullToEmpty(item.recurringId),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      userId: ownerId(item.userId),
      deletedAt: nullToEmpty(item.deletedAt),
      accountId: nullToEmpty(item.accountId),
      isTransfer: Boolean(item.isTransfer),
      transferGroupId: nullToEmpty(item.transferGroupId),
      transferRole: nullToEmpty(item.transferRole),
    });
  },

  async claimUnassigned(userId: string): Promise<void> {
    const db = await getRxDatabase();
    const rows = await db.transactions.find({ selector: { userId: '' } }).exec();
    await Promise.all(rows.map((row) => row.incrementalPatch({ userId })));
  },

  async listIdsByCategory(fromId: string): Promise<string[]> {
    const db = await getRxDatabase();
    const rows = await db.transactions.find({ selector: { categoryId: fromId, deletedAt: '' } }).exec();
    return rows.map((row) => row.id);
  },

  async countByCategory(categoryId: string): Promise<number> {
    const db = await getRxDatabase();
    return db.transactions.count({ selector: { categoryId, deletedAt: '' } }).exec();
  },

  async exportAll(): Promise<Transaction[]> {
    const db = await getRxDatabase();
    const rows = await db.transactions.find({ selector: scopeSelector() }).exec();
    return sortTransactions(
      rows.map((row) => row.toMutableJSON()),
      'newest'
    ).map((row) => mapTransaction(enrichTransaction([], [], row)));
  },

  async replaceAll(items: Transaction[]): Promise<void> {
    const db = await getRxDatabase();
    const current = await db.transactions.find().exec();
    await Promise.all(current.map((row) => row.remove()));
    if (!items.length) return;
    const userId = ownerId();
    await db.transactions.bulkInsert(
      items.map((item) => ({
        id: item.id,
        type: item.type,
        amount: item.amount,
        categoryId: item.categoryId,
        title: item.title,
        description: nullToEmpty(item.description),
        date: item.date,
        paymentMethod: item.paymentMethod,
        notes: nullToEmpty(item.notes),
        isRecurring: item.isRecurring,
        recurringId: nullToEmpty(item.recurringId),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        userId,
        deletedAt: '',
        accountId: nullToEmpty(item.accountId),
        isTransfer: Boolean(item.isTransfer),
        transferGroupId: nullToEmpty(item.transferGroupId),
        transferRole: nullToEmpty(item.transferRole),
      }))
    );
  },

  async clear(): Promise<void> {
    const db = await getRxDatabase();
    const rows = await db.transactions.find({ selector: scopeSelector() }).exec();
    const timestamp = nowIso();
    await Promise.all(rows.map((row) => row.incrementalPatch({ deletedAt: timestamp, updatedAt: timestamp })));
  },
};
