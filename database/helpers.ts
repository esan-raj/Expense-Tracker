import { emptyToNull } from './query';
import type { AccountDoc, CategoryDoc, SpendWiseDatabase, TransactionDoc } from './types';

export function enrichTransaction(
  categories: CategoryDoc[],
  accounts: AccountDoc[],
  row: TransactionDoc
) {
  const category = categories.find((item) => item.id === row.categoryId);
  const account = accounts.find((item) => item.id === row.accountId);
  return {
    ...row,
    description: emptyToNull(row.description),
    notes: emptyToNull(row.notes),
    recurringId: emptyToNull(row.recurringId),
    accountId: emptyToNull(row.accountId),
    transferGroupId: emptyToNull(row.transferGroupId),
    transferRole: emptyToNull(row.transferRole) as 'source' | 'destination' | null,
    deletedAt: emptyToNull(row.deletedAt),
    userId: emptyToNull(row.userId),
    categoryName: category?.name,
    categoryIcon: category?.icon,
    categoryColor: category?.color,
    accountName: account?.name ?? null,
    accountType: account?.type ?? null,
  };
}

export async function loadLookups(db: SpendWiseDatabase) {
  const [categories, accounts] = await Promise.all([db.categories.find().exec(), db.accounts.find().exec()]);
  return {
    categories: categories.map((item) => item.toMutableJSON()),
    accounts: accounts.map((item) => item.toMutableJSON()),
  };
}

export function enrichRecurring<T extends { categoryId: string }>(categories: CategoryDoc[], row: T) {
  const category = categories.find((item) => item.id === row.categoryId);
  return {
    ...row,
    categoryName: category?.name,
    categoryIcon: category?.icon,
    categoryColor: category?.color,
  };
}

export function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

export function matchesSearch(value: string | null | undefined, term: string): boolean {
  return (value ?? '').toLowerCase().includes(term);
}
