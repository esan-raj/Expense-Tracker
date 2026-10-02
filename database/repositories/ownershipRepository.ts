import { getRxDatabase } from '@/database';
import type { SpendWiseDatabase } from '@/database/types';
import type { SyncEntityType } from '@/types/sync';

export type OwnedEntityType = Exclude<SyncEntityType, 'profile'>;

export const OWNED_ENTITY_TYPES: readonly OwnedEntityType[] = [
  'category',
  'account',
  'investment',
  'recurring',
  'transaction',
  'budget',
];

export interface UnassignedRow {
  id: string;
  deletedAt: string;
  isDefault: boolean;
}

interface OwnedRow {
  id: string;
  userId: string;
  deletedAt: string;
  isDefault?: boolean;
  incrementalPatch(patch: { userId: string }): Promise<unknown>;
}

interface OwnedCollection {
  find(query: { selector: Record<string, unknown> }): { exec(): Promise<OwnedRow[]> };
  findOne(id: string): { exec(): Promise<OwnedRow | null> };
}

function collection(db: SpendWiseDatabase, entityType: OwnedEntityType): OwnedCollection {
  const collections: Record<OwnedEntityType, unknown> = {
    transaction: db.transactions,
    category: db.categories,
    budget: db.budgets,
    recurring: db.recurring,
    account: db.accounts,
    investment: db.investments,
  };
  return collections[entityType] as OwnedCollection;
}

/** Ownership reads and transfers shared by every user-owned collection. */
export const ownershipRepository = {
  /** Rows written while no account was signed in (userId ''), including soft-deleted ones. */
  async listUnassigned(entityType: OwnedEntityType): Promise<UnassignedRow[]> {
    const db = await getRxDatabase();
    const rows = await collection(db, entityType).find({ selector: { userId: '' } }).exec();
    return rows.map((row) => ({ id: row.id, deletedAt: row.deletedAt, isDefault: Boolean(row.isDefault) }));
  },

  /** Assign the given rows to `userId`, skipping any row that already has an owner. Returns claimed ids. */
  async claim(entityType: OwnedEntityType, ids: readonly string[], userId: string): Promise<string[]> {
    if (!userId || !ids.length) return [];
    const db = await getRxDatabase();
    const rows = await collection(db, entityType)
      .find({ selector: { id: { $in: [...ids] }, userId: '' } })
      .exec();
    await Promise.all(rows.map((row) => row.incrementalPatch({ userId })));
    return rows.map((row) => row.id);
  },

  /** Owner of a local row ('' when unassigned), or null when the row does not exist. */
  async ownerOf(entityType: OwnedEntityType, id: string): Promise<string | null> {
    const db = await getRxDatabase();
    const row = await collection(db, entityType).findOne(id).exec();
    return row ? row.userId : null;
  },
};
