import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { PageScroll } from '@/components/ui/PageScroll';
import { Card } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { ErrorState } from '@/components/ui/ErrorState';
import { ScreenSkeleton } from '@/components/ui/Skeleton';
import { Fab } from '@/components/ui/Fab';
import { Amount } from '@/components/ui/Amount';
import { SyncStatusBar } from '@/components/ui/SyncStatusBar';
import { BalanceHero } from '@/components/cards/BalanceCard';
import { AccountCard } from '@/components/cards/AccountOverviewCard';
import { InvestmentsOverviewCard } from '@/components/cards/InvestmentsOverviewCard';
import { QuickActions } from '@/components/dashboard/QuickActions';
import { ThemeCustomizer } from '@/components/theme/ThemeCustomizer';
import { BarChart } from '@/components/charts/BarChart';
import { CategoryIcon } from '@/components/categories/CategoryIcon';
import { TransactionRow } from '@/components/transactions/TransactionRow';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useBudgetStore } from '@/store/useBudgetStore';
import { useAuthStore } from '@/store/useAuthStore';
import { reportService } from '@/services/reportService';
import { formatMoney } from '@/utils/currency';
import { currentMonthYear, formatMonthYear, greetingForNow } from '@/utils/dates';
import { calculateBudgetUsage, percentChange } from '@/utils/calculations';
import { buildDashboardInsights } from '@/utils/insights';
import { displayFirstName } from '@/utils/displayName';
import { isLiabilityAccount } from '@/utils/accountLogic';
import { toUserMessage } from '@/utils/errors';
import { spacing } from '@/constants/theme';
import { useSyncStore } from '@/store/useSyncStore';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import type { AccountWithBalances } from '@/types';
import type { SeriesPoint } from '@/utils/accountSeries';

function mergeCashSeries(accounts: AccountWithBalances[]): SeriesPoint[] {
  const asset = accounts.filter((item) => !isLiabilityAccount(item.type));
  const template = asset[0]?.balanceSeries;
  if (!template?.length) return [];
  return template.map((point, index) => ({
    date: point.date,
    value: asset.reduce((sum, account) => sum + (account.balanceSeries?.[index]?.value ?? 0), 0),
  }));
}

export default function HomeScreen() {
  const { colors } = useTheme();
  const { isDesktop } = useBreakpoint();
  const settings = useSettingsStore((state) => state.settings);
  const warnings = useBudgetStore((state) => state.warnings);
  const loadBudgets = useBudgetStore((state) => state.load);
  const syncNow = useSyncStore((state) => state.syncNow);
  const user = useAuthStore((state) => state.user);
  const [data, setData] = useState<Awaited<ReturnType<typeof reportService.dashboard>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [range, setRange] = useState<'14d' | '30d'>('14d');
  const period = currentMonthYear();
  const firstName = displayFirstName(user);

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

  useFocusEffect(
    useCallback(() => {
      void loadLocal();
    }, [loadLocal])
  );

  const cashSeries = useMemo(() => {
    if (!data) return [];
    const merged = mergeCashSeries(data.accounts.cards);
    return range === '14d' ? merged.slice(-14) : merged;
  }, [data, range]);

  if (loading && !data) return <ScreenSkeleton variant="dashboard" />;
  if (error && !data) return <ErrorState message={error} onRetry={() => void loadLocal()} />;
  if (!data) return null;

  const overallBudget = warnings.find((item) => item.categoryId === null)?.amount ?? settings.monthlyBudget ?? 0;
  const usage = calculateBudgetUsage(data.expenses, overallBudget || 1);
  const expenseChange = percentChange(data.expenses, data.previousExpenses);
  const netChange = percentChange(data.income - data.expenses, data.previousIncome - data.previousExpenses);
  const insights = buildDashboardInsights({
    expenses: data.expenses,
    previousExpenses: data.previousExpenses,
    topCategoryName: data.topCategories[0]?.categoryName,
    accounts: data.accounts.cards,
  });

  const accountsSection = (
    <View>
      <SectionHeader title="Your accounts" actionLabel="Manage" onAction={() => router.push('/accounts' as never)} />
      {data.accounts.cards.length === 0 ? (
        <Card>
          <Text style={{ color: colors.textSecondary }}>Add a bank account or credit card to see balances here.</Text>
        </Card>
      ) : isDesktop ? (
        <View style={styles.accountGrid}>
          {data.accounts.cards.map((account) => (
            <AccountCard key={account.id} account={account} currency={settings.currency} />
          ))}
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel}>
          {data.accounts.cards.map((account) => (
            <AccountCard key={account.id} account={account} currency={settings.currency} compact />
          ))}
        </ScrollView>
      )}
    </View>
  );

  const spendingSection = (
    <Card>
      <SectionHeader title="Spending overview" />
      <Text style={[styles.kicker, { color: colors.textSecondary }]}>{formatMonthYear(period.month, period.year)}</Text>
      <Amount minor={data.expenses} currency={settings.currency} size="lg" />
      <Text style={[styles.change, { color: expenseChange != null && expenseChange < 0 ? colors.income : colors.textSecondary }]}>
        {expenseChange == null
          ? 'No last-month comparison yet'
          : `${expenseChange > 0 ? '↗' : expenseChange < 0 ? '↘' : '→'} ${Math.abs(expenseChange)}% vs last month`}
      </Text>
      {overallBudget > 0 ? (
        <View style={{ marginTop: 12 }}>
          <ProgressBar progress={data.expenses / overallBudget} tone={usage.overBudget ? 'danger' : usage.percent >= 75 ? 'warning' : 'success'} />
          <Text style={{ color: colors.textSecondary, marginTop: 8, fontSize: 13 }}>
            {formatMoney(data.expenses, settings.currency)} of {formatMoney(overallBudget, settings.currency)}
          </Text>
        </View>
      ) : null}
      <View style={{ marginTop: 16 }}>
        <BarChart data={data.weekSeries} height={88} />
      </View>
      {data.topCategories.length > 0 ? (
        <View style={{ marginTop: 16, gap: 10 }}>
          {data.topCategories.map((item) => (
            <View key={item.categoryId} style={styles.catRow}>
              <CategoryIcon icon={item.categoryIcon} color={item.categoryColor} size={32} />
              <Text style={{ flex: 1, color: colors.textPrimary, fontWeight: '600' }}>{item.categoryName}</Text>
              <Text style={{ color: colors.textSecondary, fontVariant: ['tabular-nums'] }}>{formatMoney(item.amount, settings.currency)}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={{ color: colors.textTertiary, marginTop: 12 }}>No categorized spending this month.</Text>
      )}
    </Card>
  );

  const recentSection = (
    <Card>
      <SectionHeader title="Recent transactions" actionLabel="View all →" onAction={() => router.push('/(tabs)/transactions')} />
      {data.recent.length === 0 ? (
        <Text style={{ color: colors.textSecondary }}>Your recent transactions will appear here.</Text>
      ) : (
        data.recent.map((item) => (
          <TransactionRow key={item.id} item={item} onPress={() => router.push(`/transaction/${item.id}`)} />
        ))
      )}
    </Card>
  );

  const insightsSection =
    insights.length > 0 ? (
      <Card>
        <SectionHeader title="Financial insights" />
        {insights.map((item) => (
          <View key={item.id} style={styles.insight}>
            <Text style={[styles.insightTitle, { color: colors.textPrimary }]}>{item.title}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{item.detail}</Text>
          </View>
        ))}
      </Card>
    ) : null;

  return (
    <Screen padded={false}>
      <PageScroll
        style={styles.scroller}
        contentContainerStyle={[styles.content, { paddingBottom: isDesktop ? 96 : 112 }]}
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
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={[styles.hello, { color: colors.textPrimary }]}>
              {greetingForNow()}{firstName ? `, ${firstName}` : ''}
            </Text>
            <Text style={[styles.sub, { color: colors.textSecondary }]}>
              Financial overview for {formatMonthYear(period.month, period.year)}
            </Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => setThemeOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Customize theme"
              style={[styles.themeBtn, { backgroundColor: colors.primaryMuted, borderColor: colors.border }]}
            >
              <Ionicons name="color-palette-outline" size={16} color={colors.primary} />
              <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>Customize theme</Text>
            </Pressable>
            <SyncStatusBar />
            <Pressable
              onPress={() => router.push('/settings/account')}
              accessibilityRole="button"
              accessibilityLabel="Profile"
              style={[styles.avatar, { backgroundColor: colors.primaryMuted }]}
            >
              <Ionicons name="person" size={18} color={colors.primary} />
            </Pressable>
          </View>
        </View>

        <BalanceHero
          value={data.accounts.bankBalance}
          currency={settings.currency}
          hidden={hidden}
          onToggleHidden={() => setHidden((value) => !value)}
          changePercent={netChange}
          series={cashSeries}
          range={range}
          onRangeChange={setRange}
        />

        <QuickActions />
        {accountsSection}

        {isDesktop ? (
          <View style={styles.desktopGrid}>
            <View style={styles.desktopCol}>{spendingSection}</View>
            <View style={styles.desktopCol}>
              <InvestmentsOverviewCard
                summary={data.investments}
                currency={settings.currency}
                count={data.investmentCount}
              />
            </View>
            <View style={styles.desktopCol}>{insightsSection}</View>
            <View style={styles.desktopCol}>{recentSection}</View>
          </View>
        ) : (
          <>
            {spendingSection}
            {recentSection}
            <InvestmentsOverviewCard
              summary={data.investments}
              currency={settings.currency}
              count={data.investmentCount}
            />
            {insightsSection}
          </>
        )}
      </PageScroll>

      <Fab label="Add transaction" onPress={() => router.push('/transaction/add')} />
      <ThemeCustomizer visible={themeOpen} onClose={() => setThemeOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroller: { flex: 1, minHeight: 0 },
  content: { paddingHorizontal: spacing.lg, paddingTop: 8, gap: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' },
  headerText: { flex: 1, minWidth: 180 },
  headerActions: { alignItems: 'flex-end', gap: 8 },
  hello: { fontSize: 26, fontWeight: '800', letterSpacing: -0.6 },
  sub: { fontSize: 14, marginTop: 4, lineHeight: 20 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  themeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
  },
  kicker: { fontSize: 13, fontWeight: '600', marginBottom: 4 },
  change: { marginTop: 6, fontSize: 13, fontWeight: '600' },
  accountGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  carousel: { gap: 12, paddingRight: 8 },
  desktopGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  desktopCol: { flexGrow: 1, flexBasis: 420, minWidth: 320, gap: 16 },
  insight: { marginBottom: 12 },
  insightTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
