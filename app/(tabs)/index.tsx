import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { PageScroll } from '@/components/ui/PageScroll';
import { Card } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { BalanceCard } from '@/components/cards/BalanceCard';
import { StatCard } from '@/components/cards/StatCard';
import { BarChart } from '@/components/charts/BarChart';
import { TransactionRow } from '@/components/transactions/TransactionRow';
import { CategoryIcon } from '@/components/categories/CategoryIcon';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useBudgetStore } from '@/store/useBudgetStore';
import { reportService } from '@/services/reportService';
import { formatMoney } from '@/utils/currency';
import { currentMonthYear, formatMonthYear, greetingForNow } from '@/utils/dates';
import { calculateBudgetUsage, percentChange } from '@/utils/calculations';
import { toUserMessage } from '@/utils/errors';
import { spacing } from '@/constants/theme';
import { SyncStatusBar } from '@/components/ui/SyncStatusBar';
import { useSyncStore } from '@/store/useSyncStore';
import { useBreakpoint } from '@/hooks/useBreakpoint';

export default function HomeScreen() {
  const { colors } = useTheme();
  const { isDesktop } = useBreakpoint();
  const settings = useSettingsStore((state) => state.settings);
  const warnings = useBudgetStore((state) => state.warnings);
  const loadBudgets = useBudgetStore((state) => state.load);
  const syncNow = useSyncStore((state) => state.syncNow);
  const [data, setData] = useState<Awaited<ReturnType<typeof reportService.dashboard>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const period = currentMonthYear();

  const loadLocal = useCallback(async () => {
    try {
      setError(null);
      const [dashboard] = await Promise.all([
        reportService.dashboard(period.month, period.year),
        loadBudgets(),
      ]);
      setData(dashboard);
    } catch (err) {
      setError(toUserMessage(err, 'We could not load your dashboard.'));
    } finally {
      setLoading(false);
    }
  }, [loadBudgets, period.month, period.year]);

  useEffect(() => {
    void loadLocal().then(() => {
      void syncNow();
    });
  }, [loadLocal, syncNow]);

  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState message={error} onRetry={() => void loadLocal()} />;
  if (!data) return null;

  const overallBudget = warnings.find((item) => item.categoryId === null)?.amount ?? settings.monthlyBudget ?? 0;
  const usage = calculateBudgetUsage(data.expenses, overallBudget || 1);
  const incomeChange = percentChange(data.income, data.previousIncome);
  const expenseChange = percentChange(data.expenses, data.previousExpenses);
  const warning = warnings.find((item) => item.level >= 75);

  return (
    <Screen padded={false}>
      <PageScroll
        style={styles.scroller}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => {
              void (async () => {
                setLoading(true);
                await syncNow();
                await loadLocal();
              })();
            }}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.hello, { color: colors.textPrimary }]}>{greetingForNow()} 👋</Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>Your finances</Text>
        <SyncStatusBar />

        <BalanceCard value={formatMoney(data.accounts.bankBalance, settings.currency)} />
        <Card>
          <SectionHeader title="Accounts" actionLabel="Manage" onAction={() => router.push('/accounts' as never)} />
          <View style={styles.accountStats}>
            <View style={styles.flex}>
              <Text style={{ color: colors.textSecondary }}>Bank</Text>
              <Text style={[styles.accountValue, { color: colors.textPrimary }]}>
                {formatMoney(data.accounts.bankBalance, settings.currency)}
              </Text>
            </View>
            <View style={styles.flex}>
              <Text style={{ color: colors.textSecondary }}>Outstanding</Text>
              <Text style={[styles.accountValue, { color: colors.textPrimary }]}>
                {formatMoney(data.accounts.creditOutstanding, settings.currency)}
              </Text>
            </View>
            <View style={styles.flex}>
              <Text style={{ color: colors.textSecondary }}>Available credit</Text>
              <Text style={[styles.accountValue, { color: colors.textPrimary }]}>
                {formatMoney(data.accounts.availableCredit, settings.currency)}
              </Text>
            </View>
          </View>
        </Card>

        <View style={[styles.row, isDesktop && styles.desktopRow]}>
          <StatCard
            label="Income"
            value={formatMoney(data.income, settings.currency)}
            hint={incomeChange === null ? 'No last-month data' : `${incomeChange > 0 ? '+' : ''}${incomeChange}% vs last month`}
            tone="income"
          />
          <StatCard
            label="Expenses"
            value={formatMoney(data.expenses, settings.currency)}
            hint={expenseChange === null ? 'No last-month data' : `${expenseChange > 0 ? '+' : ''}${expenseChange}% vs last month`}
            tone="expense"
          />
        </View>

        {overallBudget > 0 ? (
          <Card>
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{formatMonthYear(period.month, period.year)} spending</Text>
            <Text style={[styles.spend, { color: colors.textPrimary }]}>
              {formatMoney(data.expenses, settings.currency)} / {formatMoney(overallBudget, settings.currency)}
            </Text>
            <ProgressBar progress={data.expenses / overallBudget} tone={usage.overBudget ? 'danger' : usage.percent >= 75 ? 'warning' : 'primary'} />
          </Card>
        ) : null}

        {warning ? (
          <Card style={{ backgroundColor: colors.primaryMuted, borderColor: 'transparent' }}>
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
              ⚠️ You're {warning.level >= 100 ? 'over' : 'close to'} your {warning.categoryName ?? 'monthly'} budget
            </Text>
            <Text style={{ color: colors.textSecondary, marginTop: 6 }}>
              You've spent {formatMoney(warning.spent, settings.currency)} of {formatMoney(warning.amount, settings.currency)}.
            </Text>
          </Card>
        ) : null}

        <Card>
          <SectionHeader title="Last 7 days" />
          <BarChart data={data.weekSeries} />
        </Card>

        <Card>
          <SectionHeader title="Top categories" actionLabel="See all" onAction={() => router.push('/(tabs)/reports')} />
          {data.topCategories.length === 0 ? (
            <Text style={{ color: colors.textSecondary }}>No spending this month yet.</Text>
          ) : (
            data.topCategories.map((item) => (
              <View key={item.categoryId} style={styles.catRow}>
                <CategoryIcon icon={item.categoryIcon} color={item.categoryColor} size={36} />
                <Text style={[styles.flex, { color: colors.textPrimary, fontWeight: '600' }]}>{item.categoryName}</Text>
                <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>{formatMoney(item.amount, settings.currency)}</Text>
              </View>
            ))
          )}
        </Card>

        <Card>
          <SectionHeader title="Recent transactions" actionLabel="View all" onAction={() => router.push('/(tabs)/transactions')} />
          {data.recent.length === 0 ? (
            <Text style={{ color: colors.textSecondary }}>Start tracking your spending by adding your first transaction.</Text>
          ) : (
            data.recent.map((item) => (
              <TransactionRow key={item.id} item={item} onPress={() => router.push(`/transaction/${item.id}`)} />
            ))
          )}
        </Card>
        <View style={{ height: 88 }} />
      </PageScroll>

      <Pressable
        onPress={() => router.push('/transaction/add')}
        accessibilityRole="button"
        accessibilityLabel="Add transaction"
        style={[styles.fab, { backgroundColor: colors.primary }]}
      >
        <Ionicons name="add" size={22} color="#fff" />
        <Text style={styles.fabText}>Add Transaction</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroller: { flex: 1, minHeight: 0 },
  content: { paddingHorizontal: spacing.lg, paddingTop: 8, gap: 16, paddingBottom: 24 },
  hello: { fontSize: 28, fontWeight: '800', letterSpacing: -0.6 },
  sub: { fontSize: 16, marginTop: -10 },
  row: { flexDirection: 'row', gap: 12 },
  desktopRow: { flexWrap: 'wrap' },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  spend: { fontSize: 20, fontWeight: '800', marginBottom: 12 },
  accountStats: { flexDirection: 'row', gap: 12 },
  accountValue: { fontSize: 16, fontWeight: '800', marginTop: 4 },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  flex: { flex: 1 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    height: 52,
    borderRadius: 26,
  },
  fabText: { color: '#fff', fontWeight: '800' },
});
