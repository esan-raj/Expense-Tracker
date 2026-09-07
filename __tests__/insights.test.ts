import { buildDashboardInsights } from '@/utils/insights';

describe('dashboard insights', () => {
  it('does not invent insights without enough data', () => {
    expect(buildDashboardInsights({ expenses: 0, previousExpenses: 0, accounts: [] })).toEqual([]);
  });

  it('reports a real spending change and healthy utilization', () => {
    const insights = buildDashboardInsights({
      expenses: 432201,
      previousExpenses: 745000,
      topCategoryName: 'Shopping',
      accounts: [
        {
          id: 'card',
          type: 'credit_card',
          name: 'Pixel Play',
          utilizationPercent: 6.17,
        } as never,
      ],
    });
    expect(insights[0]?.title).toContain('less this month');
    expect(insights.some((item) => item.title.includes('Shopping'))).toBe(true);
    expect(insights.some((item) => item.title.includes('healthy'))).toBe(true);
  });
});
