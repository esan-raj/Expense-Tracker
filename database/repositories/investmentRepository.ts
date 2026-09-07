import { getRxDatabase } from '@/database';
import { compareValues } from '@/database/helpers';
import { emptyToNull, nullToEmpty, ownerId, scopeSelector } from '@/database/query';
import type { Investment, InvestmentInput, InvestmentType } from '@/types';
import { createId } from '@/utils/id';
import { nowIso } from '@/utils/dates';
import type { InvestmentDoc } from '@/database/types';

function mapInvestment(row: InvestmentDoc): Investment {
  return {
    id: row.id,
    name: row.name,
    type: row.type as InvestmentType,
    investedAmount: row.investedAmount,
    currentValue: row.currentValue,
    investmentDate: row.investmentDate,
    accountId: emptyToNull(row.accountId),
    notes: emptyToNull(row.notes),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: emptyToNull(row.deletedAt),
  };
}

export const investmentRepository = {
  async list(): Promise<Investment[]> {
    const db = await getRxDatabase();
    const rows = await db.investments.find({ selector: scopeSelector() }).exec();
    return rows
      .map((row) => mapInvestment(row.toMutableJSON()))
      .sort((a, b) => b.investmentDate.localeCompare(a.investmentDate) || compareValues(a.name, b.name));
  },

  async getById(id: string): Promise<Investment | null> {
    const db = await getRxDatabase();
    const row = await db.investments.findOne(id).exec();
    return row && !row.deletedAt ? mapInvestment(row.toMutableJSON()) : null;
  },

  async create(input: InvestmentInput): Promise<Investment> {
    const db = await getRxDatabase();
    const id = createId();
    const timestamp = nowIso();
    const investedAmount = input.investedAmount;
    await db.investments.insert({
      id,
      name: input.name.trim(),
      type: input.type,
      investedAmount,
      currentValue: input.currentValue ?? investedAmount,
      investmentDate: input.investmentDate,
      accountId: nullToEmpty(input.accountId?.trim() || null),
      notes: nullToEmpty(input.notes?.trim() || null),
      createdAt: timestamp,
      updatedAt: timestamp,
      userId: ownerId(),
      deletedAt: '',
    });
    return (await this.getById(id))!;
  },

  async update(id: string, input: InvestmentInput): Promise<Investment> {
    const db = await getRxDatabase();
    const row = await db.investments.findOne(id).exec();
    if (!row) throw new Error('Investment not found');
    const investedAmount = input.investedAmount;
    await row.incrementalPatch({
      name: input.name.trim(),
      type: input.type,
      investedAmount,
      currentValue: input.currentValue ?? investedAmount,
      investmentDate: input.investmentDate,
      accountId: nullToEmpty(input.accountId?.trim() || null),
      notes: nullToEmpty(input.notes?.trim() || null),
      updatedAt: nowIso(),
    });
    const updated = await this.getById(id);
    if (!updated) throw new Error('Investment not found');
    return updated;
  },

  async delete(id: string): Promise<void> {
    const db = await getRxDatabase();
    const row = await db.investments.findOne(id).exec();
    if (!row) return;
    const timestamp = nowIso();
    await row.incrementalPatch({ deletedAt: timestamp, updatedAt: timestamp });
  },

  async getByIdIncludingDeleted(id: string): Promise<Investment | null> {
    const db = await getRxDatabase();
    const row = await db.investments.findOne(id).exec();
    return row ? mapInvestment(row.toMutableJSON()) : null;
  },

  async upsertFromRemote(item: Investment & { userId?: string | null }): Promise<void> {
    const db = await getRxDatabase();
    await db.investments.upsert({
      id: item.id,
      name: item.name,
      type: item.type,
      investedAmount: item.investedAmount,
      currentValue: item.currentValue,
      investmentDate: item.investmentDate,
      accountId: nullToEmpty(item.accountId),
      notes: nullToEmpty(item.notes),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      userId: ownerId(item.userId),
      deletedAt: nullToEmpty(item.deletedAt),
    });
  },

  async claimUnassigned(userId: string): Promise<void> {
    const db = await getRxDatabase();
    const rows = await db.investments.find({ selector: { userId: '' } }).exec();
    await Promise.all(rows.map((row) => row.incrementalPatch({ userId })));
  },

  async replaceAll(items: Investment[]): Promise<void> {
    const db = await getRxDatabase();
    const current = await db.investments.find().exec();
    await Promise.all(current.map((row) => row.remove()));
    if (!items.length) return;
    const userId = ownerId();
    await db.investments.bulkInsert(
      items.map((item) => ({
        id: item.id,
        name: item.name,
        type: item.type,
        investedAmount: item.investedAmount,
        currentValue: item.currentValue,
        investmentDate: item.investmentDate,
        accountId: nullToEmpty(item.accountId),
        notes: nullToEmpty(item.notes),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        userId,
        deletedAt: '',
      }))
    );
  },
};
