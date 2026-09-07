import { isLiabilityAccount } from '@/utils/accountLogic';
import { percentChange } from '@/utils/calculations';
import type { AccountWithBalances } from '@/types';

export interface DashboardInsight {
  id: string;
  title: string;
  detail: string;
}

export function buildDashboardInsights(input: {
  expenses: number;
  previousExpenses: number;
  topCategoryName?: string;
  accounts: AccountWithBalances[];
}): DashboardInsight[] {
  const insights: DashboardInsight[] = [];
  const spendChange = percentChange(input.expenses, input.previousExpenses);

  if (spendChange !== null && input.previousExpenses > 0) {
    const direction = spendChange < 0 ? 'less' : 'more';
    insights.push({
      id: 'spend-change',
      title: spendChange === 0 ? 'Spending is unchanged' : `You spent ${Math.abs(spendChange)}% ${direction} this month`,
      detail: 'Compared with last month, excluding transfers.',
    });
  }

  if (input.topCategoryName && input.expenses > 0) {
    insights.push({
      id: 'top-category',
      title: `${input.topCategoryName} is your largest expense`,
      detail: 'Based on this month’s categorized spending.',
    });
  }

  const card = input.accounts.find((item) => isLiabilityAccount(item.type) && item.utilizationPercent != null);
  if (card?.utilizationPercent != null) {
    const healthy = card.utilizationPercent < 30;
    insights.push({
      id: 'utilization',
      title: healthy
        ? `${card.name} utilization is healthy`
        : `${card.name} utilization is ${card.utilizationPercent.toFixed(2)}%`,
      detail: healthy
        ? `${card.utilizationPercent.toFixed(2)}% of the credit limit is in use.`
        : 'Keeping utilization lower usually helps available credit.',
    });
  }

  return insights.slice(0, 3);
}
