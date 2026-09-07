import type { Budget, Transaction, TransactionWithCategory } from '@/types';

export interface CategorySpend {
  categoryId: string;
  categoryName: string;
  categoryIcon: string;
  categoryColor: string;
  amount: number;
  percent: number;
}

function isReportable(item: { isTransfer?: boolean }): boolean {
  return !item.isTransfer;
}

export function calculateTotalIncome(
  transactions: Array<Pick<Transaction, 'type' | 'amount'> & { isTransfer?: boolean }>
): number {
  return transactions.reduce(
    (sum, item) => (item.type === 'income' && isReportable(item) ? sum + item.amount : sum),
    0
  );
}

export function calculateTotalExpenses(
  transactions: Array<Pick<Transaction, 'type' | 'amount'> & { isTransfer?: boolean }>
): number {
  return transactions.reduce(
    (sum, item) => (item.type === 'expense' && isReportable(item) ? sum + item.amount : sum),
    0
  );
}

export function calculateBalance(transactions: Pick<Transaction, 'type' | 'amount'>[]): number {
  return calculateTotalIncome(transactions) - calculateTotalExpenses(transactions);
}

export function calculateMonthlyExpenses(
  transactions: Array<Pick<Transaction, 'type' | 'amount' | 'date'> & { isTransfer?: boolean }>,
  month: number,
  year: number
): number {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return transactions
    .filter((item) => item.type === 'expense' && isReportable(item) && item.date.startsWith(prefix))
    .reduce((sum, item) => sum + item.amount, 0);
}

export function calculateCategoryExpenses(
  transactions: Array<Pick<Transaction, 'type' | 'amount' | 'categoryId'> & { isTransfer?: boolean }>
): Record<string, number> {
  return transactions.reduce<Record<string, number>>((acc, item) => {
    if (item.type !== 'expense' || !isReportable(item)) {
      return acc;
    }
    acc[item.categoryId] = (acc[item.categoryId] ?? 0) + item.amount;
    return acc;
  }, {});
}

export function calculateBudgetUsage(spent: number, budgetAmount: number): {
  spent: number;
  remaining: number;
  percent: number;
  overBudget: boolean;
} {
  if (budgetAmount <= 0) {
    return { spent, remaining: 0, percent: spent > 0 ? 100 : 0, overBudget: spent > 0 };
  }
  const percent = Math.round((spent / budgetAmount) * 100);
  return {
    spent,
    remaining: budgetAmount - spent,
    percent,
    overBudget: spent > budgetAmount,
  };
}

export function getBudgetWarningLevel(percent: number): 50 | 75 | 90 | 100 | null {
  if (percent >= 100) return 100;
  if (percent >= 90) return 90;
  if (percent >= 75) return 75;
  if (percent >= 50) return 50;
  return null;
}

export function calculateSavingsRate(income: number, expenses: number): number {
  if (income <= 0) {
    return 0;
  }
  return Math.round(((income - expenses) / income) * 100);
}

export function calculateAverageDailySpending(totalExpenses: number, days: number): number {
  const safeDays = Math.max(1, days);
  return Math.round(totalExpenses / safeDays);
}

export function getTopCategories(
  transactions: Array<
    Pick<TransactionWithCategory, 'type' | 'amount' | 'categoryId' | 'categoryName' | 'categoryIcon' | 'categoryColor'> & {
      isTransfer?: boolean;
    }
  >,
  limit = 4
): CategorySpend[] {
  const totals = new Map<string, CategorySpend>();
  let expenseTotal = 0;

  for (const item of transactions) {
    if (item.type !== 'expense' || !isReportable(item)) continue;
    expenseTotal += item.amount;
    const existing = totals.get(item.categoryId);
    if (existing) {
      existing.amount += item.amount;
    } else {
      totals.set(item.categoryId, {
        categoryId: item.categoryId,
        categoryName: item.categoryName,
        categoryIcon: item.categoryIcon,
        categoryColor: item.categoryColor,
        amount: item.amount,
        percent: 0,
      });
    }
  }

  return [...totals.values()]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit)
    .map((item) => ({
      ...item,
      percent: expenseTotal > 0 ? Math.round((item.amount / expenseTotal) * 100) : 0,
    }));
}

export function getHighestExpense(
  transactions: Array<
    Pick<TransactionWithCategory, 'type' | 'amount' | 'title' | 'categoryName' | 'date'> & { isTransfer?: boolean }
  >
): Pick<TransactionWithCategory, 'amount' | 'title' | 'categoryName' | 'date'> | null {
  const expenses = transactions.filter((item) => item.type === 'expense' && isReportable(item));
  if (expenses.length === 0) {
    return null;
  }
  return expenses.reduce((highest, item) => (item.amount > highest.amount ? item : highest));
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) {
    return current === 0 ? 0 : null;
  }
  return Math.round(((current - previous) / previous) * 100);
}

export function findOverallBudget(budgets: Budget[], month: number, year: number): Budget | undefined {
  return budgets.find((item) => item.month === month && item.year === year && item.categoryId === null);
}
