/// <reference types="jest" />
let mockIdCounter = 0;
jest.mock('@/utils/id', () => ({ createId: () => `id-${(mockIdCounter += 1)}` }));

import { getRxDatabase } from '@/database';
import { categoryRepository } from '@/database/repositories/categoryRepository';
import { resetSessionForTests } from '@/database/session';

function doc(id: string, userId: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    userId,
    name: `Category ${id}`,
    icon: 'ellipse',
    color: '#000000',
    type: 'expense',
    isDefault: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    deletedAt: '',
    ...extra,
  };
}

describe('categoryRepository.listActiveOwnedBy', () => {
  afterEach(() => {
    resetSessionForTests();
  });

  it('returns only active rows owned by the account, never signed-out local or other-account rows', async () => {
    const db = await getRxDatabase();
    await db.categories.bulkInsert([
      doc('mine', 'user-a'),
      doc('mine-default', 'user-a', { isDefault: true }),
      doc('mine-hidden', 'user-a', { deletedAt: '2026-10-01T01:00:00.000Z' }),
      doc('signed-out', ''),
      doc('other-account', 'user-b'),
    ]);

    const owned = await categoryRepository.listActiveOwnedBy('user-a');

    expect(owned.map((item) => item.id).sort()).toEqual(['mine', 'mine-default']);
    expect(owned.find((item) => item.id === 'mine-default')?.isDefault).toBe(true);
  });
});
