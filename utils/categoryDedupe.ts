import type { Category, CategoryType } from '@/types';
import { normalizeOptionLabel } from '@/utils/optionLabel';

export function categoryIdentityKey(name: string, type: CategoryType | string): string {
  return `${normalizeOptionLabel(name)}::${type}`;
}

export function chooseCanonicalCategory<T extends { id: string; createdAt: string }>(items: T[]): T {
  return [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0];
}

export interface CategoryDedupeGroup {
  key: string;
  name: string;
  type: string;
  canonicalId: string;
  duplicateIds: string[];
}

export interface CategoryDedupePlan {
  groups: CategoryDedupeGroup[];
}

export function planCategoryDedupe(categories: Category[]): CategoryDedupePlan {
  const buckets = new Map<string, Category[]>();
  for (const category of categories) {
    if (category.deletedAt) continue;
    const key = categoryIdentityKey(category.name, category.type);
    const bucket = buckets.get(key) ?? [];
    bucket.push(category);
    buckets.set(key, bucket);
  }

  const groups: CategoryDedupeGroup[] = [];
  for (const [key, items] of buckets) {
    if (items.length < 2) continue;
    const canonical = chooseCanonicalCategory(items);
    groups.push({
      key,
      name: canonical.name,
      type: canonical.type,
      canonicalId: canonical.id,
      duplicateIds: items.filter((item) => item.id !== canonical.id).map((item) => item.id).sort(),
    });
  }

  return {
    groups: groups.sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type)),
  };
}

export function formatCategoryDedupeReport(
  plan: CategoryDedupePlan,
  extra?: { transactions?: number; recurring?: number; budgets?: number }
): string {
  if (plan.groups.length === 0) {
    return 'No duplicate categories found.';
  }
  const lines = plan.groups.map((group) => {
    return `${group.name} (${group.type}): keep ${group.canonicalId}; hide ${group.duplicateIds.join(', ')}`;
  });
  if (extra) {
    lines.push(
      `Planned remaps: transactions=${extra.transactions ?? 0} recurring=${extra.recurring ?? 0} budgets=${extra.budgets ?? 0}`
    );
  }
  return lines.join('\n');
}
