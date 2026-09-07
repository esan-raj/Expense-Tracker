import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { IconButton } from '@/components/ui/IconButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ScreenSkeleton } from '@/components/ui/Skeleton';
import { Amount } from '@/components/ui/Amount';
import { DonutChart } from '@/components/charts/DonutChart';
import { useInvestmentStore } from '@/store/useInvestmentStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useTheme } from '@/hooks/useTheme';
import { formatMoney } from '@/utils/currency';
import { investmentTypeLabel } from '@/types';
import { summarizeInvestments } from '@/services/investmentService';
import { spacing } from '@/constants/theme';

const TYPE_COLORS = ['#0E7C66', '#3D6B8A', '#C4841D', '#6B5B95', '#4ABA7A', '#8A9691'];

export default function InvestmentsScreen() {
  const { colors } = useTheme();
  const currency = useSettingsStore((state) => state.settings.currency);
  const investments = useInvestmentStore((state) => state.investments);
  const loading = useInvestmentStore((state) => state.loading);
  const load = useInvestmentStore((state) => state.load);
  const summary = summarizeInvestments(investments);
  const positive = summary.returns >= 0;

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && investments.length === 0) return <ScreenSkeleton variant="list" />;

  return (
    <Screen scroll>
      <PageHeader
        title="Investments"
        action={<IconButton name="add" accessibilityLabel="Add investment" onPress={() => router.push('/investments/add' as never)} />}
      />
      {investments.length === 0 ? (
        <EmptyState
          icon="trending-up-outline"
          title="Start building your portfolio"
          message="Track your investments, returns, and allocation in one place."
          actionLabel="+ Add your first investment"
          onAction={() => router.push('/investments/add' as never)}
        />
      ) : (
        <>
          <Card style={[styles.hero, { backgroundColor: colors.primary, borderColor: 'transparent' }]}>
            <Text style={{ color: colors.onPrimary, opacity: 0.86, fontWeight: '600' }}>Portfolio value</Text>
            <Amount minor={summary.currentValue} currency={currency} size="hero" style={{ color: colors.onPrimary }} />
            {summary.returnPercent != null ? (
              <Text style={{ color: colors.onPrimary, marginTop: 8, fontWeight: '600' }}>
                {positive ? '↑' : '↓'} {Math.abs(summary.returnPercent)}% return
              </Text>
            ) : null}
          </Card>
          <View style={styles.stats}>
            <Card elevated={false} style={styles.stat}>
              <Text style={{ color: colors.textSecondary }}>Invested</Text>
              <Amount minor={summary.totalInvested} currency={currency} size="sm" />
            </Card>
            <Card elevated={false} style={styles.stat}>
              <Text style={{ color: colors.textSecondary }}>Returns</Text>
              <Text style={{ color: positive ? colors.income : colors.expense, fontWeight: '700' }}>
                {positive ? '+' : '−'}
                {formatMoney(Math.abs(summary.returns), currency)}
              </Text>
            </Card>
          </View>
          {summary.byType.length > 1 ? (
            <Card>
              <Text style={[styles.section, { color: colors.textPrimary }]}>Asset allocation</Text>
              <DonutChart
                centerLabel="Portfolio"
                centerValue={summary.currentValue}
                slices={summary.byType.map((item, index) => ({
                  label: investmentTypeLabel(item.type),
                  amount: item.currentValue,
                  color: TYPE_COLORS[index % TYPE_COLORS.length],
                }))}
              />
              {summary.byType.map((item, index) => {
                const percent = summary.currentValue > 0 ? Math.round((item.currentValue / summary.currentValue) * 100) : 0;
                return (
                  <View key={item.type} style={styles.alloc}>
                    <View style={[styles.dot, { backgroundColor: TYPE_COLORS[index % TYPE_COLORS.length] }]} />
                    <Text style={[styles.flex, { color: colors.textPrimary }]}>{investmentTypeLabel(item.type)}</Text>
                    <Text style={{ color: colors.textSecondary }}>{percent}%</Text>
                  </View>
                );
              })}
            </Card>
          ) : null}
          {investments.map((item) => {
            const gain = item.currentValue - item.investedAmount;
            const gainPct = item.investedAmount > 0 ? Math.round((gain / item.investedAmount) * 10000) / 100 : null;
            const up = gain >= 0;
            return (
              <Pressable key={item.id} onPress={() => router.push(`/investments/${item.id}` as never)}>
                <Card>
                  <Text style={[styles.name, { color: colors.textPrimary }]}>{item.name}</Text>
                  <Text style={{ color: colors.textSecondary }}>{investmentTypeLabel(item.type)}</Text>
                  <View style={styles.row}>
                    <Amount minor={item.currentValue} currency={currency} size="md" />
                    {gainPct != null ? (
                      <Text style={{ color: up ? colors.income : colors.expense, fontWeight: '700' }}>
                        {up ? '+' : ''}
                        {gainPct}%
                      </Text>
                    ) : null}
                  </View>
                  <Text style={{ color: colors.textTertiary, marginTop: 4 }}>
                    Invested {formatMoney(item.investedAmount, currency)}
                  </Text>
                </Card>
              </Pressable>
            );
          })}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { marginTop: spacing.sm },
  stats: { flexDirection: 'row', gap: 12 },
  stat: { flex: 1 },
  section: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  name: { fontSize: 16, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  alloc: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  flex: { flex: 1 },
});
