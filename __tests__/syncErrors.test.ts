/// <reference types="jest" />
import { getErrorMessage, logError } from '@/utils/errors';
import { toRemoteTransaction } from '@/services/supabase/mappers';
import type { Transaction } from '@/types';

function sampleTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    type: 'expense',
    amount: 100,
    categoryId: '22222222-2222-4222-8222-222222222222',
    title: 'Coffee',
    description: null,
    date: '2026-09-19',
    paymentMethod: 'upi',
    notes: null,
    isRecurring: false,
    recurringId: null,
    accountId: null,
    isTransfer: false,
    transferGroupId: null,
    transferRole: null,
    createdAt: '2026-09-19T10:00:00.000Z',
    updatedAt: '2026-09-19T10:00:00.000Z',
    ...overrides,
  };
}

describe('getErrorMessage', () => {
  it('reads Postgrest-style objects that are not Error instances', () => {
    expect(
      getErrorMessage({
        message: 'invalid input syntax for type uuid',
        details: '""',
        hint: null,
        code: '22P02',
      })
    ).toBe('invalid input syntax for type uuid | "" | 22P02');
  });

  it('falls back when nothing useful is present', () => {
    expect(getErrorMessage(null)).toBe('Unknown error');
    expect(getErrorMessage({})).toBe('Unknown error');
  });

  it('logs the extracted message', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    logError('sync[transaction][create]', { message: 'foreign key violation', code: '23503' });
    expect(spy).toHaveBeenCalledWith('[SpendWise] sync[transaction][create]: foreign key violation | 23503');
    spy.mockRestore();
  });
});

describe('toRemoteTransaction nullability', () => {
  it('converts RxDB empty strings into Postgres nulls', () => {
    const local = {
      ...sampleTransaction(),
      categoryId: '',
      description: '',
      notes: '',
      recurringId: '',
      accountId: '',
      transferGroupId: '',
      transferRole: '',
      deletedAt: '',
    } as unknown as Transaction & { deletedAt: string };
    const remote = toRemoteTransaction(local, '33333333-3333-4333-8333-333333333333');

    expect(remote.category_id).toBeNull();
    expect(remote.description).toBeNull();
    expect(remote.notes).toBeNull();
    expect(remote.recurring_id).toBeNull();
    expect(remote.account_id).toBeNull();
    expect(remote.transfer_group_id).toBeNull();
    expect(remote.transfer_role).toBeNull();
    expect(remote.deleted_at).toBeNull();
  });
});
