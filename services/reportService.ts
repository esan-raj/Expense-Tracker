import { getRxDatabase } from '@/database';
import { compareValues, enrichTransaction, loadLookups } from '@/database/helpers';
import { accountRepository } from '@/database/repositories/accountRepository';
import { mapTransactionWithCategory } from '@/database/repositories/mappers';
import { transactionRepository } from '@/database/repositories/transactionRepository';
import { hydrateAccounts } from '@/services/accountService';
import { investmentService, summarizeInvestments } from '@/services/investmentService';
import type { TransferRole, TransactionType } from '@/types';
import { excludeTransfers, isBankHolding, isCashHolding, isLiabilityAccount } from '@/utils/accountLogic';
import {
  calculateAverageDailySpending,
  calculateSavingsRate,
  calculateTotalExpenses,
  calculateTotalIncome,
  getTopCategories,
} from '@/utils/calculations';
import { daysInRange, lastNDaysKeys, rangeToKeys, type DateRange } from '@/utils/dates';
import type { TransactionDoc } from '@/database/types';

function periodTotals(docs: TransactionDoc[], startDate?: string, endDate?: string): { income: number; expenses: number } {
  return docs.reduce(
    (acc, row) => {
      if (row.isTransfer) return acc;
      if (startDate && row.date < startDate) return acc;
      if (endDate && row.date > endDate) return acc;
      if (row.type === 'income') acc.income += row.amount;
      if (row.type === 'expense') acc.expenses += row.amount;
      return acc;
    },
    { income: 0, expenses: 0 }
  );
}

function newestDocs(docs: TransactionDoc[]): TransactionDoc[] {
  return [...docs].sort(
    (a, b) => compareValues(b.date, a.date) || compareValues(b.createdAt, a.createdAt)
  );
}

export const reportService = {
  async dashboard(month: number, year: number) {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const prev = month === 1 ? { month: 12, year: year - 1 } : { month: month - 1, year };
    const prevStart = `${prev.year}-${String(prev.month).padStart(2, '0')}-01`;
    const prevLast = new Date(prev.year, prev.month, 0).getDate();
    const prevEnd = `${prev.year}-${String(prev.month).padStart(2, '0')}-${String(prevLast).padStart(2, '0')}`;
    const weekKeys = lastNDaysKeys(7);
    const weekStart = weekKeys[0];
    const weekEnd = weekKeys[weekKeys.length - 1];

    const db = await getRxDatabase();
    const [docs, accounts, investments, lookups] = await Promise.all([
      transactionRepository.listScopedDocs(),
      accountRepository.list(true),
      investmentService.list(),
      loadLookups(db),
    ]);

    const allTime = periodTotals(docs);
    const current = periodTotals(docs, startDate, endDate);
    const previous = periodTotals(docs, prevStart, prevEnd);
    const recent = newestDocs(docs)
      .slice(0, 5)
      .map((row) => mapTransactionWithCategory(enrichTransaction(lookups.categories, lookups.accounts, row)));

    const monthCategoryRows = docs
      .filter((row) => !row.isTransfer && row.type === 'expense' && row.date >= startDate && row.date <= endDate)
      .map((row) => {
        const category = lookups.categories.find((item) => item.id === row.categoryId);
        return {
          type: 'expense' as const,
          amount: row.amount,
          categoryId: row.categoryId,
          categoryName: category?.name ?? '',
          categoryIcon: category?.icon ?? '',
          categoryColor: category?.color ?? '',
        };
      })
      .filter((row) => row.categoryName);

    const weekMap: Record<string, number> = {};
    for (const row of docs) {
      if (row.isTransfer || row.type !== 'expense' || row.date < weekStart || row.date > weekEnd) continue;
      weekMap[row.date] = (weekMap[row.date] ?? 0) + row.amount;
    }

    const accountRows = hydrateAccounts(
      accounts,
      docs.map((row) => ({
        type: row.type as TransactionType,
        amount: row.amount,
        accountId: row.accountId || null,
        isTransfer: row.isTransfer,
        transferRole: (row.transferRole || null) as TransferRole | null,
        date: row.date,
      }))
    );

    return {
      balance: allTime.income - allTime.expenses,
      income: current.income,
      expenses: current.expenses,
      previousIncome: previous.income,
      previousExpenses: previous.expenses,
      recent,
      topCategories: getTopCategories(monthCategoryRows, 4),
      weekSeries: weekKeys.map((date) => ({ date, amount: weekMap[date] ?? 0 })),
      accounts: {
        bankBalance: accountRows.filter((item) => isBankHolding(item.type)).reduce((sum, item) => sum + item.currentBalance, 0),
        cashBalance: accountRows.filter((item) => isCashHolding(item.type)).reduce((sum, item) => sum + item.currentBalance, 0),
        creditOutstanding: accountRows.filter((item) => isLiabilityAccount(item.type)).reduce((sum, item) => sum + item.outstanding, 0),
        availableCredit: accountRows
          .filter((item) => isLiabilityAccount(item.type))
          .reduce((sum, item) => sum + (item.availableCredit ?? 0), 0),
        cards: accountRows.filter((item) => item.isActive),
      },
      investments: summarizeInvestments(investments),
      investmentCount: investments.length,
    };
  },

  async analytics(range: DateRange, accountId?: string) {
    const { startDate, endDate } = rangeToKeys(range);
    const [totals, categories, expenseDaily, incomeDaily, highest, transactions] = await Promise.all([
      transactionRepository.totals(startDate, endDate),
      transactionRepository.categoryTotals('expense', startDate, endDate),
      transactionRepository.dailyTotals('expense', startDate, endDate),
      transactionRepository.dailyTotals('income', startDate, endDate),
      transactionRepository.highestExpense(startDate, endDate),
      transactionRepository.listBetween(startDate, endDate),
    ]);

    const scoped = accountId ? transactions.filter((item) => item.accountId === accountId) : transactions;
    const operational = excludeTransfers(scoped);
    const income = accountId ? calculateTotalIncome(operational) : totals.income;
    const expenses = accountId ? calculateTotalExpenses(operational) : totals.expenses;
    const days = daysInRange(range);
    const expenseTotal = expenses;
    const categorySpend = (
      accountId
        ? getTopCategories(operational, 50)
        : categories.map((item) => ({
            categoryId: item.categoryId,
            categoryName: item.name,
            categoryIcon: item.icon,
            categoryColor: item.color,
            amount: item.amount,
            percent: expenseTotal > 0 ? Math.round((item.amount / expenseTotal) * 100) : 0,
          }))
    ).map((item) => ({
      ...item,
      percent: expenseTotal > 0 ? Math.round((item.amount / expenseTotal) * 100) : 0,
    }));

    const accountMap = new Map<string, { accountId: string; accountName: string; amount: number }>();
    for (const item of excludeTransfers(transactions)) {
      if (item.type !== 'expense') continue;
      const key = item.accountId ?? 'unassigned';
      const current = accountMap.get(key) ?? {
        accountId: key,
        accountName: item.accountName ?? 'No account',
        amount: 0,
      };
      current.amount += item.amount;
      accountMap.set(key, current);
    }

    return {
      income,
      expenses,
      net: income - expenses,
      savingsRate: calculateSavingsRate(income, expenses),
      averageDaily: calculateAverageDailySpending(expenses, days),
      categories: categorySpend,
      expenseTrend: accountId
        ? Object.entries(
            operational
              .filter((item) => item.type === 'expense')
              .reduce<Record<string, number>>((acc, item) => {
                acc[item.date] = (acc[item.date] ?? 0) + item.amount;
                return acc;
              }, {})
          ).map(([date, amount]) => ({ date, amount }))
        : expenseDaily,
      incomeTrend: incomeDaily,
      highest: accountId
        ? operational
            .filter((item) => item.type === 'expense')
            .sort((a, b) => b.amount - a.amount)[0] ?? null
        : highest,
      accountExpenses: [
        { accountId: 'all', accountName: 'All Accounts', amount: totals.expenses },
        ...[...accountMap.values()].sort((a, b) => b.amount - a.amount),
      ],
      hasData: scoped.length > 0,
    };
  },
};
