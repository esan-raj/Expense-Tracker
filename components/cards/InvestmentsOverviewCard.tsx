import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Card } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Amount } from '@/components/ui/Amount';
import { Button } from '@/components/ui/Button';
import { Sparkline } from '@/components/charts/Sparkline';
import { useTheme } from '@/hooks/useTheme';
import { formatMoney } from '@/utils/currency';
import type { CurrencyCode, InvestmentSummary } from '@/types';

export function InvestmentsOverviewCard({
  summary,
  currency,
  count,
}: {
  summary: InvestmentSummary;
  currency: CurrencyCode;
  count: number;
}) {
  const { colors } = useTheme();
  const positive = summary.returns >= 0;
  const series =
    count > 0 && summary.totalInvested !== summary.currentValue
      ? [
          { date: 'invested', value: summary.totalInvested },
          { date: 'now', value: summary.currentValue },
        ]
      : [];

  return (
    <Card>
      <SectionHeader title="Investments" actionLabel="View" onAction={() => router.push('/investments' as never)} />
      {count === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>Start investing</Text>
          <Text style={{ color: colors.textSecondary, lineHeight: 20 }}>Track your investments in one place.</Text>
          <Button title="+ Add Investment" onPress={() => router.push('/investments/add' as never)} />
        </View>
      ) : (
        <Pressable onPress={() => router.push('/investments' as never)} accessibilityRole="button" accessibilityLabel="Open investments">
          <Text style={{ color: colors.textSecondary }}>Portfolio value</Text>
          <Amount minor={summary.currentValue} currency={currency} size="lg" />
          <View style={styles.row}>
            <Text style={{ color: colors.textSecondary }}>Invested</Text>
            <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>{formatMoney(summary.totalInvested, currency)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={{ color: colors.textSecondary }}>Returns</Text>
            <Text style={{ color: positive ? colors.income : colors.expense, fontWeight: '700' }}>
              {positive ? '+' : '−'}
              {formatMoney(Math.abs(summary.returns), currency)}
              {summary.returnPercent == null ? '' : ` (${positive ? '+' : ''}${summary.returnPercent}%)`}
            </Text>
          </View>
          {series.length ? <View style={{ marginTop: 12 }}><Sparkline series={series} width={220} height={36} /></View> : null}
        </Pressable>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  empty: { gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
});
