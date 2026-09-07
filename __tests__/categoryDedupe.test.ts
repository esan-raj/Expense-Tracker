/// <reference types="jest" />
import { chooseCanonicalCategory, categoryIdentityKey, planCategoryDedupe } from '@/utils/categoryDedupe';
import type { Category } from '@/types';

function category(partial: Partial<Category> & Pick<Category, 'id' | 'name' | 'type' | 'createdAt'>): Category {
  return {
    icon: 'ellipse',
    color: '#64748B',
    isDefault: false,
    ...partial,
  };
}

describe('category dedupe planner', () => {
  it('treats expense and income with the same name as distinct', () => {
    expect(categoryIdentityKey('Bills', 'expense')).not.toBe(categoryIdentityKey('Bills', 'income'));
    const plan = planCategoryDedupe([
      category({ id: 'a', name: 'Bills', type: 'expense', createdAt: '2026-01-01T00:00:00.000Z' }),
      category({ id: 'b', name: 'Bills', type: 'income', createdAt: '2026-01-02T00:00:00.000Z' }),
    ]);
    expect(plan.groups).toHaveLength(0);
  });

  it('groups same name and type, keeping the oldest id as canonical', () => {
    const plan = planCategoryDedupe([
      category({ id: 'newer', name: 'Education', type: 'expense', createdAt: '2026-03-01T00:00:00.000Z' }),
      category({ id: 'older', name: 'Education', type: 'expense', createdAt: '2026-01-01T00:00:00.000Z' }),
      category({ id: 'mid', name: 'Education', type: 'expense', createdAt: '2026-02-01T00:00:00.000Z' }),
    ]);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].canonicalId).toBe('older');
    expect(plan.groups[0].duplicateIds).toEqual(['mid', 'newer']);
  });

  it('ignores soft-deleted rows and uses deterministic id order on ties', () => {
    expect(chooseCanonicalCategory([
      { id: 'b', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'a', createdAt: '2026-01-01T00:00:00.000Z' },
    ]).id).toBe('a');

    const plan = planCategoryDedupe([
      category({ id: 'live-1', name: 'Food', type: 'expense', createdAt: '2026-01-01T00:00:00.000Z' }),
      category({
        id: 'gone',
        name: 'Food',
        type: 'expense',
        createdAt: '2025-01-01T00:00:00.000Z',
        deletedAt: '2026-01-02T00:00:00.000Z',
      }),
    ]);
    expect(plan.groups).toHaveLength(0);
  });
});
