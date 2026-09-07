import { getRxDatabase } from '@/database';
import { compareValues } from '@/database/helpers';
import { emptyToNull, nullToEmpty, ownerId, scopeSelector } from '@/database/query';
import type { Account, AccountInput } from '@/types';
import { createId } from '@/utils/id';
import { nowIso } from '@/utils/dates';
import type { AccountDoc } from '@/database/types';

function mapAccount(row: AccountDoc): Account {
  return {
    id: row.id,
    name: row.name,
    type: row.type as Account['type'],
    institutionName: emptyToNull(row.institutionName),
    currency: row.currency as Account['currency'],
    openingBalance: row.openingBalance,
    creditLimit: row.creditLimit || null,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: emptyToNull(row.deletedAt),
  };
}

export const accountRepository = {
  async list(includeInactive = true): Promise<Account[]> {
    const db = await getRxDatabase();
    const rows = await db.accounts.find({ selector: scopeSelector() }).exec();
    return rows
      .map((row) => mapAccount(row.toMutableJSON()))
      .filter((item) => includeInactive || item.isActive)
      .sort((a, b) => compareValues(a.type, b.type) || compareValues(a.name, b.name));
  },

  async getById(id: string): Promise<Account | null> {
    const db = await getRxDatabase();
    const row = await db.accounts.findOne(id).exec();
    return row && !row.deletedAt ? mapAccount(row.toMutableJSON()) : null;
  },

  async create(input: AccountInput): Promise<Account> {
    const db = await getRxDatabase();
    const id = createId();
    const timestamp = nowIso();
    await db.accounts.insert({
      id,
      name: input.name.trim(),
      type: input.type,
      institutionName: nullToEmpty(input.institutionName?.trim() || null),
      currency: input.currency,
      openingBalance: input.openingBalance,
      creditLimit: input.creditLimit ?? 0,
      isActive: input.isActive !== false,
      createdAt: timestamp,
      updatedAt: timestamp,
      userId: ownerId(),
      deletedAt: '',
    });
    return (await this.getById(id))!;
  },

  async update(id: string, input: AccountInput): Promise<Account> {
    const db = await getRxDatabase();
    const row = await db.accounts.findOne(id).exec();
    if (!row) throw new Error('Account not found');
    await row.incrementalPatch({
      name: input.name.trim(),
      type: input.type,
      institutionName: nullToEmpty(input.institutionName?.trim() || null),
      currency: input.currency,
      openingBalance: input.openingBalance,
      creditLimit: input.creditLimit ?? 0,
      isActive: input.isActive !== false,
      updatedAt: nowIso(),
    });
    const updated = await this.getById(id);
    if (!updated) throw new Error('Account not found');
    return updated;
  },

  async setActive(id: string, isActive: boolean): Promise<Account> {
    const db = await getRxDatabase();
    const row = await db.accounts.findOne(id).exec();
    if (!row) throw new Error('Account not found');
    await row.incrementalPatch({ isActive, updatedAt: nowIso() });
    const updated = await this.getById(id);
    if (!updated) throw new Error('Account not found');
    return updated;
  },

  async delete(id: string): Promise<void> {
    const db = await getRxDatabase();
    const row = await db.accounts.findOne(id).exec();
    if (!row) return;
    const timestamp = nowIso();
    await row.incrementalPatch({ deletedAt: timestamp, isActive: false, updatedAt: timestamp });
  },

  async countTransactions(id: string): Promise<number> {
    const db = await getRxDatabase();
    return db.transactions.count({ selector: { accountId: id, deletedAt: '' } }).exec();
  },

  async getByIdIncludingDeleted(id: string): Promise<Account | null> {
    const db = await getRxDatabase();
    const row = await db.accounts.findOne(id).exec();
    return row ? mapAccount(row.toMutableJSON()) : null;
  },

  async upsertFromRemote(item: Account & { userId?: string | null }): Promise<void> {
    const db = await getRxDatabase();
    await db.accounts.upsert({
      id: item.id,
      name: item.name,
      type: item.type,
      institutionName: nullToEmpty(item.institutionName),
      currency: item.currency,
      openingBalance: item.openingBalance,
      creditLimit: item.creditLimit ?? 0,
      isActive: item.isActive,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      userId: ownerId(item.userId),
      deletedAt: nullToEmpty(item.deletedAt),
    });
  },

  async claimUnassigned(userId: string): Promise<void> {
    const db = await getRxDatabase();
    const rows = await db.accounts.find({ selector: { userId: '' } }).exec();
    await Promise.all(rows.map((row) => row.incrementalPatch({ userId })));
  },

  async replaceAll(items: Account[]): Promise<void> {
    const db = await getRxDatabase();
    const current = await db.accounts.find().exec();
    await Promise.all(current.map((row) => row.remove()));
    if (!items.length) return;
    const userId = ownerId();
    await db.accounts.bulkInsert(
      items.map((item) => ({
        id: item.id,
        name: item.name,
        type: item.type,
        institutionName: nullToEmpty(item.institutionName),
        currency: item.currency,
        openingBalance: item.openingBalance,
        creditLimit: item.creditLimit ?? 0,
        isActive: item.isActive,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        userId,
        deletedAt: '',
      }))
    );
  },
};
