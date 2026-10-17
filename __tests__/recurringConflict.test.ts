/// <reference types="jest" />
import type { Transaction } from '@/types';

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

/**
 * In-memory stand-in for the Supabase transactions table. Timestamps are returned the way
 * PostgREST returns timestamptz (microseconds, +00:00) so parsing and compare-and-set use
 * the real server format.
 */
class FakeTable {
  rows = new Map<string, Row>();
  /** Apply the next write but lose its response, like a dropped connection. */
  dropNextResponse = false;
  /** Runs once right before the next compare-and-set update executes. */
  beforeNextUpdate: (() => void) | null = null;
  writes: Array<{ op: string; id: string }> = [];

  seed(row: Row) {
    this.rows.set(String(row.id), toPostgres(row));
  }
}

function toPostgres(row: Row): Row {
  const out: Row = { ...row };
  for (const key of ['created_at', 'updated_at', 'deleted_at']) {
    const value = out[key];
    if (typeof value === 'string' && value.endsWith('Z')) out[key] = value.replace(/\.(\d{3})Z$/, '.$1000+00:00');
  }
  return out;
}

class FakeQuery {
  private op: 'select' | 'upsert' | 'update' | null = null;
  private payload: Row = {};
  private ignoreDuplicates = false;
  private single = false;
  private filters: Filter[] = [];

  constructor(private table: FakeTable) {}

  upsert(row: Row, options: { ignoreDuplicates?: boolean } = {}) {
    this.op = 'upsert';
    this.payload = row;
    this.ignoreDuplicates = Boolean(options.ignoreDuplicates);
    return this;
  }
  update(changes: Row) {
    this.op = 'update';
    this.payload = changes;
    return this;
  }
  select() {
    if (!this.op) this.op = 'select';
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  is(column: string, value: unknown) {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }

  then<A, B>(onFulfilled?: (value: { data: unknown; error: null }) => A, onRejected?: (reason: unknown) => B) {
    return Promise.resolve()
      .then(() => this.execute())
      .then(onFulfilled, onRejected);
  }

  private execute(): { data: unknown; error: null } {
    const { table } = this;
    if (this.op === 'upsert') {
      const id = String(this.payload.id);
      let data: Row[] = [];
      if (!table.rows.has(id)) {
        table.rows.set(id, toPostgres(this.payload));
        table.writes.push({ op: 'insert', id });
        data = [{ ...table.rows.get(id) }];
      } else if (!this.ignoreDuplicates) {
        table.rows.set(id, toPostgres(this.payload));
        table.writes.push({ op: 'overwrite', id });
        data = [{ ...table.rows.get(id) }];
      }
      return this.respond(data);
    }
    if (this.op === 'update') {
      if (table.beforeNextUpdate) {
        const hook = table.beforeNextUpdate;
        table.beforeNextUpdate = null;
        hook();
      }
      const matched = [...table.rows.values()].filter((row) => this.filters.every((filter) => filter(row)));
      for (const row of matched) {
        Object.assign(row, toPostgres(this.payload));
        table.writes.push({ op: 'update', id: String(row.id) });
      }
      return this.respond(matched.map((row) => ({ ...row })));
    }
    const matched = [...table.rows.values()].filter((row) => this.filters.every((filter) => filter(row)));
    return { data: this.single ? (matched[0] ? { ...matched[0] } : null) : matched.map((row) => ({ ...row })), error: null };
  }

  private respond(data: Row[]): { data: Row[]; error: null } {
    if (this.table.dropNextResponse) {
      this.table.dropNextResponse = false;
      throw new Error('Network request failed');
    }
    return { data, error: null };
  }
}

const table = new FakeTable();
const fakeSupabase = {
  auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
  from: () => new FakeQuery(table),
  rpc: jest.fn(),
};

jest.mock('@/services/supabase', () => ({
  get supabase() {
    return fakeSupabase;
  },
  isSupabaseConfigured: () => true,
}));

import { remoteApi } from '@/services/supabase/remote';
import { decideGeneratedOccurrence } from '@/utils/recurringConflict';
import { recurringOccurrenceId } from '@/utils/deterministicId';

const ID = recurringOccurrenceId('rule-1', '2026-10-01');
const GENERATED_AT = '2026-10-01T06:00:00.000Z';

function occurrence(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: ID,
    type: 'expense',
    amount: 1500,
    categoryId: 'cat-rent',
    title: 'Rent',
    description: null,
    date: '2026-10-01',
    paymentMethod: 'upi',
    notes: 'Generated from recurring transaction',
    isRecurring: true,
    recurringId: 'rule-1',
    accountId: 'acc-bank',
    isTransfer: false,
    transferGroupId: null,
    transferRole: null,
    createdAt: GENERATED_AT,
    updatedAt: GENERATED_AT,
    ...overrides,
  };
}

function serverRow(overrides: Row = {}): Row {
  return {
    id: ID,
    user_id: 'user-1',
    type: 'expense',
    amount: 1500,
    category_id: 'cat-rent',
    title: 'Rent',
    description: null,
    date: '2026-10-01T00:00:00.000Z',
    payment_method: 'upi',
    notes: 'Generated from recurring transaction',
    is_recurring: true,
    recurring_id: 'rule-1',
    account_id: 'acc-bank',
    is_transfer: false,
    transfer_group_id: null,
    transfer_role: null,
    created_at: '2026-10-01T05:00:00.000Z',
    updated_at: '2026-10-01T05:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

describe('decideGeneratedOccurrence', () => {
  const untouched = { createdAt: GENERATED_AT, updatedAt: GENERATED_AT };
  const edited = { createdAt: GENERATED_AT, updatedAt: '2026-10-01T09:00:00.000Z' };

  it('lets a server tombstone win even over a newer local edit', () => {
    expect(
      decideGeneratedOccurrence(edited, { updatedAt: '2026-10-01T07:00:00.000Z', deletedAt: '2026-10-01T07:00:00.000Z' })
    ).toBe('deleted_remotely');
  });

  it('never lets an untouched local copy overwrite the server, even if generated later', () => {
    expect(decideGeneratedOccurrence(untouched, { updatedAt: '2026-10-01T05:00:00.000Z', deletedAt: null })).toBe(
      'keep_remote'
    );
  });

  it('keeps a newer server edit over an older local edit', () => {
    expect(decideGeneratedOccurrence(edited, { updatedAt: '2026-10-01T10:00:00.000Z', deletedAt: null })).toBe('keep_remote');
  });

  it('updates the server when the local edit is strictly newer', () => {
    expect(decideGeneratedOccurrence(edited, { updatedAt: '2026-10-01T08:00:00.000Z', deletedAt: null })).toBe('update_remote');
  });

  it('resolves equal timestamps to the server copy, in either string format', () => {
    expect(decideGeneratedOccurrence(edited, { updatedAt: '2026-10-01T09:00:00.000000+00:00', deletedAt: null })).toBe(
      'keep_remote'
    );
  });

  it('keeps the server copy when a timestamp cannot be read', () => {
    expect(decideGeneratedOccurrence({ createdAt: 'garbage', updatedAt: 'x' }, { updatedAt: '2026-10-01T08:00:00Z', deletedAt: null })).toBe(
      'keep_remote'
    );
  });
});

describe('remoteApi.insertGeneratedTransaction', () => {
  beforeEach(() => {
    table.rows.clear();
    table.writes = [];
    table.dropNextResponse = false;
    table.beforeNextUpdate = null;
  });

  it('inserts the first copy of an occurrence', async () => {
    const result = await remoteApi.insertGeneratedTransaction(occurrence());

    expect(result.outcome).toBe('inserted');
    expect(table.rows.size).toBe(1);
    expect(result.remote).toEqual(expect.objectContaining({ id: ID, amount: 1500, accountId: 'acc-bank' }));
  });

  it('keeps the first device copy when a second device generates the same occurrence', async () => {
    await remoteApi.insertGeneratedTransaction(occurrence());
    const secondDevice = occurrence({ createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z' });

    const result = await remoteApi.insertGeneratedTransaction(secondDevice);

    expect(result.outcome).toBe('kept_remote');
    expect(table.rows.size).toBe(1);
    expect(table.writes).toEqual([{ op: 'insert', id: ID }]);
  });

  it('does not overwrite a newer edit made on the server with an untouched local copy', async () => {
    table.seed(serverRow({ amount: 1750, notes: 'Rent went up', updated_at: '2026-10-01T09:30:00.000Z' }));

    const result = await remoteApi.insertGeneratedTransaction(occurrence());

    expect(result.outcome).toBe('kept_remote');
    expect(table.rows.get(ID)).toEqual(expect.objectContaining({ amount: 1750, notes: 'Rent went up' }));
    expect(result.remote).toEqual(
      expect.objectContaining({
        amount: 1750,
        notes: 'Rent went up',
        accountId: 'acc-bank',
        categoryId: 'cat-rent',
        type: 'expense',
        date: '2026-10-01',
        recurringId: 'rule-1',
      })
    );
    expect(table.writes).toEqual([]);
  });

  it('does not overwrite a newer server edit with an older local edit', async () => {
    table.seed(serverRow({ amount: 1750, updated_at: '2026-10-01T10:00:00.000Z' }));

    const result = await remoteApi.insertGeneratedTransaction(occurrence({ amount: 1600, updatedAt: '2026-10-01T09:00:00.000Z' }));

    expect(result.outcome).toBe('kept_remote');
    expect(table.rows.get(ID)?.amount).toBe(1750);
  });

  it('writes a newer local edit with every field intact and the server created_at kept', async () => {
    table.seed(serverRow());
    const edit = occurrence({
      amount: 1800,
      notes: 'Paid with late fee',
      categoryId: 'cat-housing',
      accountId: 'acc-cash',
      type: 'expense',
      updatedAt: '2026-10-01T09:00:00.000Z',
    });

    const result = await remoteApi.insertGeneratedTransaction(edit);

    expect(result.outcome).toBe('updated_remote');
    expect(table.rows.get(ID)).toEqual(
      expect.objectContaining({
        amount: 1800,
        notes: 'Paid with late fee',
        category_id: 'cat-housing',
        account_id: 'acc-cash',
        type: 'expense',
        date: '2026-10-01T00:00:00.000Z',
        recurring_id: 'rule-1',
        created_at: '2026-10-01T05:00:00.000000+00:00',
      })
    );
  });

  it('never resurrects a server tombstone', async () => {
    table.seed(serverRow({ deleted_at: '2026-10-01T07:00:00.000Z', updated_at: '2026-10-01T07:00:00.000Z' }));

    const result = await remoteApi.insertGeneratedTransaction(occurrence({ amount: 2000, updatedAt: '2026-10-01T09:00:00.000Z' }));

    expect(result.outcome).toBe('deleted_remotely');
    expect(result.remote.deletedAt).toBeTruthy();
    expect(table.rows.get(ID)?.deleted_at).toBeTruthy();
    expect(table.writes).toEqual([]);
  });

  it('keeps the server copy when timestamps are equal', async () => {
    table.seed(serverRow({ amount: 1700, updated_at: '2026-10-01T09:00:00.000Z' }));

    const result = await remoteApi.insertGeneratedTransaction(occurrence({ amount: 1600, updatedAt: '2026-10-01T09:00:00.000Z' }));

    expect(result.outcome).toBe('kept_remote');
    expect(table.rows.get(ID)?.amount).toBe(1700);
  });

  it('converges without a second write when retrying an insert whose response was lost', async () => {
    table.dropNextResponse = true;
    await expect(remoteApi.insertGeneratedTransaction(occurrence())).rejects.toThrow('Network request failed');
    expect(table.rows.size).toBe(1);

    const retry = await remoteApi.insertGeneratedTransaction(occurrence());

    expect(retry.outcome).toBe('kept_remote');
    expect(table.writes).toEqual([{ op: 'insert', id: ID }]);
  });

  it('converges when retrying an edit whose update response was lost', async () => {
    table.seed(serverRow());
    const edit = occurrence({ amount: 1900, updatedAt: '2026-10-01T09:00:00.000Z' });
    table.beforeNextUpdate = () => {
      table.dropNextResponse = true;
    };
    await expect(remoteApi.insertGeneratedTransaction(edit)).rejects.toThrow('Network request failed');

    const retry = await remoteApi.insertGeneratedTransaction(edit);

    expect(retry.outcome).toBe('kept_remote');
    expect(table.rows.get(ID)?.amount).toBe(1900);
    expect(table.writes.filter((write) => write.op === 'update')).toHaveLength(1);
  });

  it('stores one row when two devices insert the same occurrence concurrently', async () => {
    const [a, b] = await Promise.all([
      remoteApi.insertGeneratedTransaction(occurrence()),
      remoteApi.insertGeneratedTransaction(occurrence({ createdAt: '2026-10-01T06:00:01.000Z', updatedAt: '2026-10-01T06:00:01.000Z' })),
    ]);

    expect([a.outcome, b.outcome].sort()).toEqual(['inserted', 'kept_remote']);
    expect(table.rows.size).toBe(1);
    expect(table.writes.filter((write) => write.op !== 'insert')).toEqual([]);
  });

  it('re-decides instead of overwriting when another edit lands between read and write', async () => {
    table.seed(serverRow());
    table.beforeNextUpdate = () => {
      Object.assign(table.rows.get(ID) as Row, toPostgres({ amount: 2500, updated_at: '2026-10-01T11:00:00.000Z' }));
    };

    const result = await remoteApi.insertGeneratedTransaction(occurrence({ amount: 1800, updatedAt: '2026-10-01T09:00:00.000Z' }));

    expect(result.outcome).toBe('kept_remote');
    expect(table.rows.get(ID)?.amount).toBe(2500);
  });
});
