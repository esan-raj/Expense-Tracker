/// <reference types="jest" />
import { createSpendWiseDatabase } from '@/database/database';
import { resetSessionForTests, setCurrentUserId, isInScope } from '@/database/session';

describe('RxDB local database', () => {
  afterEach(() => {
    resetSessionForTests();
  });

  it('initializes collections and supports transaction CRUD', async () => {
    const db = await createSpendWiseDatabase(`test-crud-${Date.now()}`);
    expect(db.transactions).toBeDefined();
    expect(db.accounts).toBeDefined();
    expect(db.syncQueue).toBeDefined();

    await db.transactions.insert({
      id: 't1',
      userId: 'user-a',
      type: 'expense',
      amount: 250,
      categoryId: 'food',
      title: 'Coffee',
      description: '',
      date: '2026-09-06',
      paymentMethod: 'upi',
      notes: '',
      isRecurring: false,
      recurringId: '',
      createdAt: '2026-09-06T00:00:00.000Z',
      updatedAt: '2026-09-06T00:00:00.000Z',
      deletedAt: '',
      accountId: '',
      isTransfer: false,
      transferGroupId: '',
      transferRole: '',
    });

    const found = await db.transactions.findOne('t1').exec();
    expect(found?.title).toBe('Coffee');
    await found!.incrementalPatch({ amount: 300 });
    expect((await db.transactions.findOne('t1').exec())?.amount).toBe(300);
    await db.remove();
  });

  it('rejects a duplicate primary key', async () => {
    const db = await createSpendWiseDatabase(`test-dup-${Date.now()}`);
    const doc = {
      id: 'same',
      userId: '',
      name: 'Food',
      icon: 'fast-food',
      color: '#000',
      type: 'expense',
      isDefault: false,
      createdAt: '2026-09-06T00:00:00.000Z',
      updatedAt: '2026-09-06T00:00:00.000Z',
      deletedAt: '',
    };
    await db.categories.insert(doc);
    await expect(db.categories.insert(doc)).rejects.toBeTruthy();
    await db.remove();
  });

  it('keeps transfers out of expense totals and isolates users', async () => {
    setCurrentUserId('user-a');
    expect(isInScope({ userId: 'user-a', deletedAt: '' })).toBe(true);
    expect(isInScope({ userId: 'user-b', deletedAt: '' })).toBe(false);
    expect(isInScope({ userId: '', deletedAt: '' })).toBe(true);

    const db = await createSpendWiseDatabase(`test-scope-${Date.now()}`);
    await db.transactions.bulkInsert([
      {
        id: 'exp',
        userId: 'user-a',
        type: 'expense',
        amount: 100,
        categoryId: 'food',
        title: 'Lunch',
        description: '',
        date: '2026-09-06',
        paymentMethod: 'upi',
        notes: '',
        isRecurring: false,
        recurringId: '',
        createdAt: '2026-09-06T00:00:00.000Z',
        updatedAt: '2026-09-06T00:00:00.000Z',
        deletedAt: '',
        accountId: 'bank',
        isTransfer: false,
        transferGroupId: '',
        transferRole: '',
      },
      {
        id: 'xfer',
        userId: 'user-a',
        type: 'expense',
        amount: 50,
        categoryId: 'transfer',
        title: 'Card payment',
        description: '',
        date: '2026-09-06',
        paymentMethod: 'bank_transfer',
        notes: '',
        isRecurring: false,
        recurringId: '',
        createdAt: '2026-09-06T00:00:00.000Z',
        updatedAt: '2026-09-06T00:00:00.000Z',
        deletedAt: '',
        accountId: 'bank',
        isTransfer: true,
        transferGroupId: 'g1',
        transferRole: 'source',
      },
    ]);
    const rows = await db.transactions.find({ selector: { userId: 'user-a', deletedAt: '' } }).exec();
    const expenses = rows.filter((row) => row.type === 'expense' && !row.isTransfer).reduce((sum, row) => row.amount + sum, 0);
    expect(expenses).toBe(100);
    const byCategory = await db.transactions.count({ selector: { categoryId: 'food', deletedAt: '' } }).exec();
    const byAccount = await db.transactions.count({ selector: { accountId: 'bank', deletedAt: '' } }).exec();
    expect(byCategory).toBe(1);
    expect(byAccount).toBe(2);
    await db.remove();
  });
});
