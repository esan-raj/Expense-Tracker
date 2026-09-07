import { getRxDatabase } from '@/database';
import { compareValues } from '@/database/helpers';
import { emptyToNull, nullToEmpty, ownerId, scopeSelector } from '@/database/query';
import type { Category, CategoryInput, CategoryType } from '@/types';
import { categoryIdentityKey } from '@/utils/categoryDedupe';
import { createId } from '@/utils/id';
import { nowIso } from '@/utils/dates';
import { mapCategory } from './mappers';

function toCategory(row: { toMutableJSON: () => import('@/database/types').CategoryDoc }): Category {
  const json = row.toMutableJSON();
  return mapCategory({
    ...json,
    deletedAt: emptyToNull(json.deletedAt),
    updatedAt: json.updatedAt,
  });
}

export const categoryRepository = {
  async list(): Promise<Category[]> {
    const db = await getRxDatabase();
    const rows = await db.categories.find({ selector: scopeSelector() }).exec();
    return rows
      .map(toCategory)
      .sort((a, b) => compareValues(a.type, b.type) || compareValues(a.name, b.name));
  },

  async getById(id: string): Promise<Category | null> {
    const db = await getRxDatabase();
    const row = await db.categories.findOne(id).exec();
    return row && !row.deletedAt ? toCategory(row) : null;
  },

  async findActiveByIdentity(name: string, type: CategoryType, exceptId?: string): Promise<Category | null> {
    const needle = categoryIdentityKey(name, type);
    const rows = await this.list();
    return rows.find((item) => item.id !== exceptId && categoryIdentityKey(item.name, item.type) === needle) ?? null;
  },

  async create(input: CategoryInput): Promise<Category> {
    const existing = await this.findActiveByIdentity(input.name, input.type);
    if (existing) {
      throw new Error(`A ${input.type} category named "${input.name.trim()}" already exists.`);
    }
    const db = await getRxDatabase();
    const id = createId();
    const timestamp = nowIso();
    await db.categories.insert({
      id,
      name: input.name.trim(),
      icon: input.icon,
      color: input.color,
      type: input.type,
      isDefault: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      userId: ownerId(),
      deletedAt: '',
    });
    return (await this.getById(id))!;
  },

  async update(id: string, input: CategoryInput): Promise<Category> {
    const existing = await this.findActiveByIdentity(input.name, input.type, id);
    if (existing) {
      throw new Error(`A ${input.type} category named "${input.name.trim()}" already exists.`);
    }
    const db = await getRxDatabase();
    const row = await db.categories.findOne(id).exec();
    if (!row) throw new Error('Category not found');
    await row.incrementalPatch({
      name: input.name.trim(),
      icon: input.icon,
      color: input.color,
      type: input.type,
      updatedAt: nowIso(),
    });
    const updated = await this.getById(id);
    if (!updated) throw new Error('Category not found');
    return updated;
  },

  async delete(id: string): Promise<void> {
    const db = await getRxDatabase();
    const row = await db.categories.findOne(id).exec();
    if (!row || row.isDefault) return;
    const timestamp = nowIso();
    await row.incrementalPatch({ deletedAt: timestamp, updatedAt: timestamp });
  },

  async listByType(type: CategoryType | 'expense' | 'income'): Promise<Category[]> {
    const all = await this.list();
    return all.filter((item) => item.type === type || item.type === 'both');
  },

  async replaceAll(items: Category[]): Promise<void> {
    const db = await getRxDatabase();
    const current = await db.categories.find().exec();
    await Promise.all(current.map((row) => row.remove()));
    if (!items.length) return;
    const userId = ownerId();
    await db.categories.bulkInsert(
      items.map((item) => ({
        id: item.id,
        name: item.name,
        icon: item.icon,
        color: item.color,
        type: item.type,
        isDefault: item.isDefault,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt ?? item.createdAt,
        userId,
        deletedAt: '',
      }))
    );
  },

  async getByIdIncludingDeleted(id: string): Promise<(Category & { deletedAt?: string | null; updatedAt?: string }) | null> {
    const db = await getRxDatabase();
    const row = await db.categories.findOne(id).exec();
    if (!row) return null;
    const json = row.toMutableJSON();
    return { ...mapCategory(json), deletedAt: emptyToNull(json.deletedAt), updatedAt: json.updatedAt };
  },

  async upsertFromRemote(item: Category & { deletedAt?: string | null; userId?: string | null; updatedAt?: string }): Promise<void> {
    const db = await getRxDatabase();
    await db.categories.upsert({
      id: item.id,
      name: item.name,
      icon: item.icon,
      color: item.color,
      type: item.type,
      isDefault: item.isDefault,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt ?? item.createdAt,
      userId: ownerId(item.userId),
      deletedAt: nullToEmpty(item.deletedAt),
    });
  },

  async claimUnassigned(userId: string): Promise<void> {
    const db = await getRxDatabase();
    const rows = await db.categories.find({ selector: { userId: '' } }).exec();
    await Promise.all(rows.map((row) => row.incrementalPatch({ userId })));
  },

  async hide(id: string): Promise<void> {
    const db = await getRxDatabase();
    const row = await db.categories.findOne(id).exec();
    if (!row) return;
    const timestamp = nowIso();
    await row.incrementalPatch({ deletedAt: timestamp, updatedAt: timestamp });
  },
};
