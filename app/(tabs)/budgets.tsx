import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { PageScroll } from '@/components/ui/PageScroll';
import { Card } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { BudgetCard } from '@/components/cards/BudgetCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ScreenSkeleton } from '@/components/ui/Skeleton';
import { PageHeader } from '@/components/ui/PageHeader';
import { IconButton } from '@/components/ui/IconButton';
import { Amount } from '@/components/ui/Amount';
import { useTheme } from '@/hooks/useTheme';
import { useBudgetStore } from '@/store/useBudgetStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { formatMoney } from '@/utils/currency';
import { formatMonthYear } from '@/utils/dates';
import { spacing } from '@/constants/theme';

export default function BudgetsScreen() {
  const { colors } = useTheme();
  const items = useBudgetStore((state) => state.items);
  const loading = useBudgetStore((state) => state.loading);
  const error = useBudgetStore((state) => state.error);
  const load = useBudgetStore((state) => state.load);
  const month = useBudgetStore((state) => state.month);
  const year = useBudgetStore((state) => state.year);
  const currency = useSettingsStore((state) => state.settings.currency);

  useEffect(() => {
    void load();
  }, []);

  const overall = items.find((item) => item.categoryId === null);
  const categoryBudgets = items.filter((item) => item.categoryId);
  const tone = overall ? (overall.percent >= 100 ? 'danger' : overall.percent >= 75 ? 'warning' : 'success') : 'success';
  const status = overall
    ? overall.percent >= 100
      ? 'Over budget'
      : overall.percent >= 75
        ? 'Approaching your limit'
        : "You're on track"
    : '';

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <PageHeader
          title="Budgets"
          subtitle={formatMonthYear(month, year)}
          action={<IconButton name="add" accessibilityLabel="Create budget" onPress={() => router.push('/budgets/add')} />}
        />
      </View>
      {loading && items.length === 0 ? <ScreenSkeleton variant="list" /> : null}
      {error && items.length === 0 ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      <PageScroll style={styles.scroller} contentContainerStyle={styles.content}>
        {overall ? (
          <Card>
            <Amount minor={overall.spent} currency={currency} size="hero" />
            <Text style={{ color: colors.textSecondary, marginTop: 4 }}>
              of {formatMoney(overall.amount, currency)} budget
            </Text>
            <Text style={[styles.percent, { color: colors.textPrimary }]}>{overall.percent}%</Text>
            <ProgressBar progress={overall.percent / 100} tone={tone} />
            <Text style={{ color: overall.percent >= 100 ? colors.danger : colors.textSecondary, marginTop: 10, fontWeight: '600' }}>
              {status}
            </Text>
          </Card>
        ) : null}
        {items.length === 0 && !loading ? (
          <EmptyState
            title="No budgets yet"
            message="Create an overall monthly budget or set limits for specific categories."
            actionLabel="Create budget"
            onAction={() => router.push('/budgets/add')}
          />
        ) : (
          categoryBudgets.map((item) => (
            <Card key={item.id} elevated={false}>
              <BudgetCard item={item} onPress={() => router.push(`/budgets/${item.id}`)} />
            </Card>
          ))
        )}
      </PageScroll>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroller: { flex: 1, minHeight: 0 },
  header: { paddingHorizontal: spacing.lg, paddingTop: 8, paddingBottom: 8 },
  content: { paddingHorizontal: spacing.lg, gap: 12, paddingBottom: 32 },
  percent: { fontSize: 18, fontWeight: '800', marginVertical: 10 },
});
