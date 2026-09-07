import { transactionRepository } from '@/database/repositories/transactionRepository';
import { accountService } from '@/services/accountService';
import { investmentService, summarizeInvestments } from '@/services/investmentService';
import { excludeTransfers, isLiabilityAccount } from '@/utils/accountLogic';
import {
  calculateAverageDailySpending,
  calculateSavingsRate,
  calculateTotalExpenses,
  calculateTotalIncome,
  getTopCategories,
} from '@/utils/calculations';
import { daysInRange, lastNDaysKeys, rangeToKeys, type DateRange } from '@/utils/dates';

export const reportService = {
  async dashboard(month: number, year: number) {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const prev = month === 1 ? { month: 12, year: year - 1 } : { month: month - 1, year };
    const prevStart = `${prev.year}-${String(prev.month).padStart(2, '0')}-01`;
    const prevLast = new Date(prev.year, prev.month, 0).getDate();
    const prevEnd = `${prev.year}-${String(prev.month).padStart(2, '0')}-${String(prevLast).padStart(2, '0')}`;

    const [allTime, current, previous, recent, categories, weekKeys, accountRows, investments] = await Promise.all([
      transactionRepository.totals(),
      transactionRepository.totals(startDate, endDate),
      transactionRepository.totals(prevStart, prevEnd),
      transactionRepository.recent(5),
      transactionRepository.categoryTotals('expense', startDate, endDate),
      Promise.resolve(lastNDaysKeys(7)),
      accountService.list(true),
      investmentService.list(),
    ]);

    const weekStart = weekKeys[0];
    const weekEnd = weekKeys[weekKeys.length - 1];
    const weekDaily = await transactionRepository.dailyTotals('expense', weekStart, weekEnd);
    const weekMap = Object.fromEntries(weekDaily.map((item) => [item.date, item.amount]));
    const monthSeries = await Promise.all(
      Array.from({ length: 6 }, (_, index) => {
        const cursor = new Date(year, month - 6 + index, 1);
        const seriesMonth = cursor.getMonth() + 1;
        const seriesYear = cursor.getFullYear();
        const seriesStart = `${seriesYear}-${String(seriesMonth).padStart(2, '0')}-01`;
        const seriesEnd = `${seriesYear}-${String(seriesMonth).padStart(2, '0')}-${String(new Date(seriesYear, seriesMonth, 0).getDate()).padStart(2, '0')}`;
        return transactionRepository.totals(seriesStart, seriesEnd).then((totals) => ({
          date: seriesStart,
          amount: totals.expenses,
          label: cursor.toLocaleString('en-IN', { month: 'short' }),
        }));
      })
    );

    return {
      balance: allTime.income - allTime.expenses,
      income: current.income,
      expenses: current.expenses,
      previousIncome: previous.income,
      previousExpenses: previous.expenses,
      recent,
      topCategories: getTopCategories(
        categories.map((item) => ({
          type: 'expense' as const,
          amount: item.amount,
          categoryId: item.categoryId,
          categoryName: item.name,
          categoryIcon: item.icon,
          categoryColor: item.color,
        })),
        4
      ),
      weekSeries: weekKeys.map((date) => ({ date, amount: weekMap[date] ?? 0 })),
      monthSeries,
      accounts: {
        bankBalance: accountRows.filter((item) => !isLiabilityAccount(item.type)).reduce((sum, item) => sum + item.currentBalance, 0),
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
