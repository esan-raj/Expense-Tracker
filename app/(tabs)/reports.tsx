import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { PageScroll } from '@/components/ui/PageScroll';
import { Card } from '@/components/ui/Card';
import { StatCard } from '@/components/cards/StatCard';
import { DonutChart } from '@/components/charts/DonutChart';
import { BarChart } from '@/components/charts/BarChart';
import { ComparisonChart } from '@/components/charts/ComparisonChart';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { ScreenSkeleton } from '@/components/ui/Skeleton';
import { DatePicker } from '@/components/ui/DatePicker';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { ChipRow } from '@/components/ui/Chip';
import { PageHeader } from '@/components/ui/PageHeader';
import { useTheme } from '@/hooks/useTheme';
import { useReports } from '@/hooks/useReports';
import { useAccountStore } from '@/store/useAccountStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { formatMoney } from '@/utils/currency';
import { accountTypeLabel, isBankHolding, isCashHolding, isLiabilityAccount } from '@/utils/accountLogic';
import { formatDisplayDate, toDateKey } from '@/utils/dates';
import { spacing } from '@/constants/theme';
import type { DateRangePreset } from '@/utils/dates';

const PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_3_months', label: '3 months' },
  { value: 'this_year', label: 'This year' },
  { value: 'custom', label: 'Custom' },
];

type ReportTab = 'overview' | 'categories' | 'accounts';

export default function ReportsScreen() {
  const { colors } = useTheme();
  const currency = useSettingsStore((state) => state.settings.currency);
  const { preset, setPreset, custom, setCustom, accountId, setAccountId, data, loading, error, reload } = useReports();
  const accounts = useAccountStore((state) => state.accounts);
  const loadAccounts = useAccountStore((state) => state.load);
  const [tab, setTab] = useState<ReportTab>('overview');

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  return (
    <Screen padded={false}>
      <PageScroll style={styles.scroller} contentContainerStyle={styles.page}>
        <View style={styles.header}>
          <PageHeader title="Reports" subtitle="Spending, income, and cash flow" />
          <ChipRow value={preset} onChange={setPreset} options={PRESETS} />
          <ChipRow
            value={tab}
            onChange={setTab}
            options={[
              { value: 'overview', label: 'Overview' },
              { value: 'categories', label: 'Categories' },
              { value: 'accounts', label: 'Accounts' },
            ]}
          />
          <SearchableSelect
            label="Account"
            value={accountId ?? 'all'}
            options={[
              { value: 'all', label: 'All accounts' },
              ...accounts.map((item) => ({
                value: item.id,
                label: `${item.name} · ${accountTypeLabel(item.type)}`,
              })),
            ]}
            onChange={(value) => setAccountId(value === 'all' ? undefined : value)}
          />
          {preset === 'custom' ? (
            <View style={styles.custom}>
              <View style={styles.flex}>
                <DatePicker
                  label="From"
                  value={custom ? toDateKey(custom.start) : toDateKey(new Date())}
                  onChange={(value) =>
                    setCustom({
                      start: new Date(value),
                      end: custom?.end ?? new Date(),
                    })
                  }
                />
              </View>
              <View style={styles.flex}>
                <DatePicker
                  label="To"
                  value={custom ? toDateKey(custom.end) : toDateKey(new Date())}
                  onChange={(value) =>
                    setCustom({
                      start: custom?.start ?? new Date(),
                      end: new Date(value),
                    })
                  }
                />
              </View>
            </View>
          ) : null}
        </View>
        {loading ? <ScreenSkeleton variant="list" /> : null}
        {error ? <ErrorState message={error} onRetry={() => void reload()} /> : null}
        {!loading && data && !data.hasData ? (
          <EmptyState
            icon="stats-chart-outline"
            title="Not enough data"
            message="Add a few transactions to see spending analytics."
          />
        ) : null}
        {!loading && data?.hasData ? (
          <View style={styles.content}>
            {tab === 'overview' ? (
              <>
                <View style={styles.row}>
                  <StatCard label="Income" value={formatMoney(data.income, currency)} tone="income" />
                  <StatCard label="Expenses" value={formatMoney(data.expenses, currency)} tone="expense" />
                </View>
                <StatCard
                  label="Net savings"
                  value={formatMoney(data.net, currency)}
                  hint={`${data.savingsRate}% savings rate`}
                  tone={data.net >= 0 ? 'income' : 'expense'}
                />
                <Card>
                  <Text style={[styles.section, { color: colors.textPrimary }]}>Spending trend</Text>
                  <BarChart data={data.expenseTrend.slice(-7)} />
                </Card>
                <Card>
                  <Text style={[styles.section, { color: colors.textPrimary }]}>Income vs expenses</Text>
                  <ComparisonChart income={data.income} expenses={data.expenses} />
                </Card>
                <Card>
                  <Text style={[styles.section, { color: colors.textPrimary }]}>Average daily spending</Text>
                  <Text style={[styles.big, { color: colors.textPrimary }]}>{formatMoney(data.averageDaily, currency)}</Text>
                </Card>
                {data.highest ? (
                  <Card>
                    <Text style={[styles.section, { color: colors.textPrimary }]}>Highest expense</Text>
                    <Text style={[styles.big, { color: colors.expense }]}>{formatMoney(data.highest.amount, currency)}</Text>
                    <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>{data.highest.title}</Text>
                    <Text style={{ color: colors.textSecondary }}>
                      {data.highest.categoryName} · {formatDisplayDate(data.highest.date)}
                    </Text>
                  </Card>
                ) : null}
              </>
            ) : null}
            {tab === 'categories' ? (
              <Card>
                <Text style={[styles.section, { color: colors.textPrimary }]}>Expense by category</Text>
                <DonutChart
                  slices={data.categories.map((item) => ({
                    id: item.categoryId,
                    label: item.categoryName,
                    amount: item.amount,
                    color: item.categoryColor,
                    percent: item.percent,
                  }))}
                />
                {data.categories.map((item) => (
                  <View key={item.categoryId} style={styles.legend}>
                    <View style={[styles.dot, { backgroundColor: item.categoryColor }]} />
                    <Text style={[styles.flex, { color: colors.textPrimary }]}>{item.categoryName}</Text>
                    <Text style={{ color: colors.textSecondary }}>{item.percent}%</Text>
                  </View>
                ))}
              </Card>
            ) : null}
            {tab === 'accounts' ? (
              <>
                <Card>
                  <Text style={[styles.section, { color: colors.textPrimary }]}>Holdings</Text>
                  <View style={styles.legend}>
                    <Text style={[styles.flex, { color: colors.textPrimary }]}>Bank</Text>
                    <Text style={{ color: colors.textSecondary }}>
                      {formatMoney(
                        accounts.filter((item) => isBankHolding(item.type)).reduce((sum, item) => sum + item.currentBalance, 0),
                        currency
                      )}
                    </Text>
                  </View>
                  <View style={styles.legend}>
                    <Text style={[styles.flex, { color: colors.textPrimary }]}>Cash</Text>
                    <Text style={{ color: colors.textSecondary }}>
                      {formatMoney(
                        accounts.filter((item) => isCashHolding(item.type)).reduce((sum, item) => sum + item.currentBalance, 0),
                        currency
                      )}
                    </Text>
                  </View>
                  <View style={styles.legend}>
                    <Text style={[styles.flex, { color: colors.textPrimary }]}>Credit available</Text>
                    <Text style={{ color: colors.textSecondary }}>
                      {formatMoney(
                        accounts
                          .filter((item) => isLiabilityAccount(item.type))
                          .reduce((sum, item) => sum + (item.availableCredit ?? 0), 0),
                        currency
                      )}
                    </Text>
                  </View>
                </Card>
                <Card>
                  <Text style={[styles.section, { color: colors.textPrimary }]}>Expenses by account</Text>
                  {data.accountExpenses.length === 0 ? (
                    <Text style={{ color: colors.textSecondary }}>No account-level spending in this range.</Text>
                  ) : (
                    data.accountExpenses.map((item) => (
                      <View key={item.accountId} style={styles.legend}>
                        <Text style={[styles.flex, { color: colors.textPrimary }]}>{item.accountName}</Text>
                        <Text style={{ color: colors.textSecondary }}>{formatMoney(item.amount, currency)}</Text>
                      </View>
                    ))
                  )}
                  <Text style={{ color: colors.textSecondary, marginTop: 8 }}>
                    Transfers between accounts are not counted as spending.
                  </Text>
                </Card>
              </>
            ) : null}
          </View>
        ) : null}
      </PageScroll>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroller: { flex: 1, minHeight: 0 },
  page: { flexGrow: 1, paddingBottom: 40 },
  header: { paddingHorizontal: spacing.lg, paddingTop: 8, gap: 12 },
  custom: { flexDirection: 'row', gap: 12 },
  content: { padding: spacing.lg, gap: 14 },
  row: { flexDirection: 'row', gap: 12 },
  section: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  flex: { flex: 1 },
  big: { fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
