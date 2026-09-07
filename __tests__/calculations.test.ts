/// <reference types="jest" />
import {
  calculateAverageDailySpending,
  calculateBalance,
  calculateBudgetUsage,
  calculateCategoryExpenses,
  calculateMonthlyExpenses,
  calculateSavingsRate,
  calculateTotalExpenses,
  calculateTotalIncome,
  getBudgetWarningLevel,
  getHighestExpense,
  getTopCategories,
  percentChange,
} from '@/utils/calculations';

const sample = [
  { type: 'income' as const, amount: 5500000, categoryId: 'salary', date: '2026-09-01' },
  { type: 'expense' as const, amount: 1500000, categoryId: 'rent', date: '2026-09-01' },
  { type: 'expense' as const, amount: 45000, categoryId: 'food', date: '2026-09-03' },
  { type: 'expense' as const, amount: 21000, categoryId: 'transport', date: '2026-08-28' },
];

describe('money calculations', () => {
  it('calculates income, expenses, and balance in minor units', () => {
    expect(calculateTotalIncome(sample)).toBe(5500000);
    expect(calculateTotalExpenses(sample)).toBe(1566000);
    expect(calculateBalance(sample)).toBe(3934000);
  });

  it('filters monthly expenses by year-month prefix', () => {
    expect(calculateMonthlyExpenses(sample, 9, 2026)).toBe(1545000);
    expect(calculateMonthlyExpenses(sample, 8, 2026)).toBe(21000);
  });

  it('aggregates category expenses', () => {
    expect(calculateCategoryExpenses(sample)).toEqual({
      rent: 1500000,
      food: 45000,
      transport: 21000,
    });
  });

  it('calculates budget usage and warning levels', () => {
    const usage = calculateBudgetUsage(540000, 600000);
    expect(usage.percent).toBe(90);
    expect(usage.remaining).toBe(60000);
    expect(usage.overBudget).toBe(false);
    expect(getBudgetWarningLevel(50)).toBe(50);
    expect(getBudgetWarningLevel(75)).toBe(75);
    expect(getBudgetWarningLevel(90)).toBe(90);
    expect(getBudgetWarningLevel(116)).toBe(100);
    expect(getBudgetWarningLevel(10)).toBeNull();
  });

  it('calculates savings rate and daily average', () => {
    expect(calculateSavingsRate(10000, 2500)).toBe(75);
    expect(calculateSavingsRate(0, 100)).toBe(0);
    expect(calculateAverageDailySpending(3100, 31)).toBe(100);
  });

  it('ranks top categories and finds the highest expense', () => {
    const detailed = [
      { type: 'expense' as const, amount: 420000, categoryId: 'food', categoryName: 'Food', categoryIcon: 'restaurant', categoryColor: '#F97316', title: 'Dinner', date: '2026-09-03' },
      { type: 'expense' as const, amount: 210000, categoryId: 'transport', categoryName: 'Transport', categoryIcon: 'car', categoryColor: '#3B82F6', title: 'Uber', date: '2026-09-02' },
      { type: 'expense' as const, amount: 185000, categoryId: 'shopping', categoryName: 'Shopping', categoryIcon: 'bag-handle', categoryColor: '#EC4899', title: 'Clothes', date: '2026-09-01' },
      { type: 'income' as const, amount: 5500000, categoryId: 'salary', categoryName: 'Salary', categoryIcon: 'cash', categoryColor: '#059669', title: 'Salary', date: '2026-09-01' },
    ];
    const top = getTopCategories(detailed, 2);
    expect(top[0].categoryName).toBe('Food');
    expect(top[0].percent).toBe(52);
    expect(getHighestExpense(detailed)?.title).toBe('Dinner');
  });

  it('excludes transfers from income and expense totals', () => {
    const mixed = [
      ...sample,
      { type: 'expense' as const, amount: 500000, categoryId: 'transfer', date: '2026-09-05', isTransfer: true },
      { type: 'income' as const, amount: 500000, categoryId: 'transfer', date: '2026-09-05', isTransfer: true },
    ];
    expect(calculateTotalIncome(mixed)).toBe(5500000);
    expect(calculateTotalExpenses(mixed)).toBe(1566000);
  });

  it('computes percent change safely', () => {
    expect(percentChange(120, 100)).toBe(20);
    expect(percentChange(0, 0)).toBe(0);
    expect(percentChange(50, 0)).toBeNull();
  });
});
