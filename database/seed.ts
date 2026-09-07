import { DEFAULT_CATEGORIES } from '@/constants/categories';
import { DEFAULT_CURRENCY } from '@/constants/currencies';
import { SETTINGS_ID } from '@/utils/constants';
import { createId } from '@/utils/id';
import { nowIso, toDateKey, currentMonthYear } from '@/utils/dates';
import { toMinorUnits } from '@/utils/currency';
import { ownerId } from './query';
import type { SpendWiseDatabase } from './types';

export async function seedDefaults(db: SpendWiseDatabase): Promise<void> {
  const categoryCount = await db.categories.count().exec();
  if (categoryCount === 0) {
    const createdAt = nowIso();
    await db.categories.bulkInsert(
      DEFAULT_CATEGORIES.map((category) => ({
        id: createId(),
        userId: '',
        name: category.name,
        icon: category.icon,
        color: category.color,
        type: category.type,
        isDefault: true,
        createdAt,
        updatedAt: createdAt,
        deletedAt: '',
      }))
    );
  }

  const settings = await db.settings.findOne(SETTINGS_ID).exec();
  if (!settings) {
    await db.settings.insert({
      id: SETTINGS_ID,
      currency: DEFAULT_CURRENCY.code,
      currencySymbol: DEFAULT_CURRENCY.symbol,
      theme: 'system',
      firstDayOfWeek: 1,
      monthlyBudget: 0,
      onboardingComplete: false,
    });
  }
}

export async function seedSampleData(db: SpendWiseDatabase): Promise<void> {
  const categories = await db.categories.find().exec();
  const byName = Object.fromEntries(categories.map((item) => [item.name, item.id]));
  const createdAt = nowIso();
  const userId = ownerId();
  const { month, year } = currentMonthYear();
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;

  const samples: Array<{
    title: string;
    amount: number;
    type: 'expense' | 'income';
    category: string;
    date: string;
    paymentMethod: string;
    notes?: string;
  }> = [
    { title: 'Monthly salary', amount: 55000, type: 'income', category: 'Salary', date: `${monthPrefix}-01`, paymentMethod: 'bank_transfer' },
    { title: 'House rent', amount: 15000, type: 'expense', category: 'Rent', date: `${monthPrefix}-01`, paymentMethod: 'bank_transfer' },
    { title: 'Weekly groceries', amount: 2350, type: 'expense', category: 'Groceries', date: `${monthPrefix}-02`, paymentMethod: 'upi', notes: 'Vegetables and staples' },
    { title: 'Lunch at Cafe', amount: 850, type: 'expense', category: 'Food', date: `${monthPrefix}-03`, paymentMethod: 'upi' },
    { title: 'Uber to office', amount: 420, type: 'expense', category: 'Transport', date: `${monthPrefix}-03`, paymentMethod: 'wallet' },
    { title: 'Netflix', amount: 649, type: 'expense', category: 'Subscriptions', date: `${monthPrefix}-04`, paymentMethod: 'credit_card' },
    { title: 'Weekend shopping', amount: 2100, type: 'expense', category: 'Shopping', date: `${monthPrefix}-04`, paymentMethod: 'debit_card' },
    { title: 'Pharmacy', amount: 680, type: 'expense', category: 'Health', date: `${monthPrefix}-05`, paymentMethod: 'upi' },
    { title: 'Electricity bill', amount: 1450, type: 'expense', category: 'Bills', date: `${monthPrefix}-05`, paymentMethod: 'upi' },
    { title: 'Freelance design', amount: 8000, type: 'income', category: 'Freelance', date: `${monthPrefix}-05`, paymentMethod: 'bank_transfer' },
  ];

  await db.transactions.bulkInsert(
    samples.flatMap((sample) => {
      const categoryId = byName[sample.category];
      if (!categoryId) return [];
      return [
        {
          id: createId(),
          userId,
          type: sample.type,
          amount: toMinorUnits(sample.amount, 2),
          categoryId,
          title: sample.title,
          description: '',
          date: sample.date,
          paymentMethod: sample.paymentMethod,
          notes: sample.notes ?? '',
          isRecurring: false,
          recurringId: '',
          createdAt,
          updatedAt: createdAt,
          deletedAt: '',
          accountId: '',
          isTransfer: false,
          transferGroupId: '',
          transferRole: '',
        },
      ];
    })
  );

  const budgets = [
    { categoryId: '', amount: 30000 },
    { categoryId: byName.Food ?? '', amount: 6000 },
    { categoryId: byName.Transport ?? '', amount: 3000 },
    { categoryId: byName.Shopping ?? '', amount: 5000 },
    { categoryId: byName.Rent ?? '', amount: 15000 },
  ].filter((item) => item.categoryId !== undefined);

  await db.budgets.bulkInsert(
    budgets.map((budget) => ({
      id: createId(),
      userId,
      categoryId: budget.categoryId,
      amount: toMinorUnits(budget.amount, 2),
      month,
      year,
      createdAt,
      updatedAt: createdAt,
      deletedAt: '',
    }))
  );

  if (byName.Subscriptions) {
    await db.recurring.insert({
      id: createId(),
      userId,
      title: 'Netflix',
      amount: toMinorUnits(649, 2),
      type: 'expense',
      categoryId: byName.Subscriptions,
      frequency: 'monthly',
      startDate: `${monthPrefix}-04`,
      nextDate: toDateKey(new Date(year, month, 4)),
      paymentMethod: 'credit_card',
      isActive: true,
      createdAt,
      updatedAt: createdAt,
      deletedAt: '',
      accountId: '',
    });
  }

  const settings = await db.settings.findOne(SETTINGS_ID).exec();
  if (settings) {
    await settings.incrementalPatch({ monthlyBudget: toMinorUnits(30000, 2) });
  }
}
