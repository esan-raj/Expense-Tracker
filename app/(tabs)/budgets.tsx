import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { PageScroll } from '@/components/ui/PageScroll';
import { Card } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { BudgetCard } from '@/components/cards/BudgetCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useTheme } from '@/hooks/useTheme';
import { useBudgetStore } from '@/store/useBudgetStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { formatMoney } from '@/utils/currency';
import { formatMonthYear } from '@/utils/dates';

export default function BudgetsScreen() {
  const { colors } = useTheme();
  const { items, loading, error, load, month, year } = useBudgetStore();
  const currency = useSettingsStore((state) => state.settings.currency);

  useEffect(() => {
    void load();
  }, []);

  const overall = items.find((item) => item.categoryId === null);
  const categoryBudgets = items.filter((item) => item.categoryId);

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Budgets</Text>
          <Text style={{ color: colors.textSecondary }}>{formatMonthYear(month, year)}</Text>
        </View>
        <Pressable
          onPress={() => router.push('/budgets/add')}
          accessibilityRole="button"
          accessibilityLabel="Create budget"
          style={[styles.add, { backgroundColor: colors.primaryMuted }]}
        >
          <Ionicons name="add" size={22} color={colors.primary} />
        </Pressable>
      </View>
      {loading && items.length === 0 ? <LoadingState /> : null}
      {error && items.length === 0 ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      <PageScroll style={styles.scroller} contentContainerStyle={styles.content}>
        {overall ? (
          <Card>
            <Text style={{ color: colors.textSecondary }}>Total Budget</Text>
            <Text style={[styles.big, { color: colors.textPrimary }]}>{formatMoney(overall.amount, currency)}</Text>
            <View style={styles.stats}>
              <Text style={{ color: colors.expense, fontWeight: '700' }}>Spent {formatMoney(overall.spent, currency)}</Text>
              <Text style={{ color: colors.income, fontWeight: '700' }}>Remaining {formatMoney(Math.max(overall.remaining, 0), currency)}</Text>
            </View>
            <ProgressBar progress={overall.percent / 100} tone={overall.percent >= 100 ? 'danger' : overall.percent >= 75 ? 'warning' : 'primary'} />
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
            <BudgetCard key={item.id} item={item} onPress={() => router.push(`/budgets/${item.id}`)} />
          ))
        )}
        {overall ? <BudgetCard item={overall} onPress={() => router.push(`/budgets/${overall.id}`)} /> : null}
      </PageScroll>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroller: { flex: 1, minHeight: 0 },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 28, fontWeight: '800' },
  add: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 16, gap: 12, paddingBottom: 32 },
  big: { fontSize: 32, fontWeight: '800', marginVertical: 8 },
  stats: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
});
