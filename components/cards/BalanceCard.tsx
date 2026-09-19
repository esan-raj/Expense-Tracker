import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { Amount } from '@/components/ui/Amount';
import { formatMoney } from '@/utils/currency';
import { Sparkline } from '@/components/charts/Sparkline';
import { useTheme } from '@/hooks/useTheme';
import { radius } from '@/constants/theme';
import { isMeaningfulSeries } from '@/utils/accountSeries';
import type { CurrencyCode } from '@/types';
import type { SeriesPoint } from '@/utils/accountSeries';

export function BalanceHero({
  value,
  currency,
  hidden,
  onToggleHidden,
  changePercent,
  series,
  range,
  onRangeChange,
  bankValue,
  cashValue,
  creditAvailable,
}: {
  value: number;
  currency: CurrencyCode;
  hidden?: boolean;
  onToggleHidden?: () => void;
  changePercent?: number | null;
  series: SeriesPoint[];
  range: '14d' | '30d';
  onRangeChange: (range: '14d' | '30d') => void;
  bankValue?: number;
  cashValue?: number;
  creditAvailable?: number;
}) {
  const { colors } = useTheme();
  const hasChange = changePercent !== null && changePercent !== undefined;
  const up = (changePercent ?? 0) > 0;

  return (
    <Card style={styles.card}>
      <View style={styles.top}>
        <View>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Available funds</Text>
          <Amount minor={value} currency={currency} hidden={hidden} size="hero" />
        </View>
        <View style={styles.actions}>
          {onToggleHidden ? (
            <Pressable
              onPress={onToggleHidden}
              accessibilityRole="button"
              accessibilityLabel={hidden ? 'Show balance' : 'Hide balance'}
              style={[styles.eye, { backgroundColor: colors.surfaceSecondary }]}
            >
              <Ionicons name={hidden ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.textPrimary} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <View style={styles.meta}>
        {hasChange ? (
          <Text style={{ color: up ? colors.income : colors.expense, fontWeight: '700', fontSize: 13 }}>
            {up ? '↗' : '↘'} {Math.abs(changePercent ?? 0)}% vs last month
          </Text>
        ) : (
          <Text style={{ color: colors.textTertiary, fontSize: 13 }}>Comparison appears after two months of data</Text>
        )}
        <View style={styles.range}>
          {(['14d', '30d'] as const).map((item) => (
            <Pressable
              key={item}
              onPress={() => onRangeChange(item)}
              style={[
                styles.rangeBtn,
                { backgroundColor: range === item ? colors.primaryMuted : colors.surfaceSecondary, borderColor: range === item ? colors.primary : colors.border },
              ]}
            >
              <Text style={{ color: colors.textPrimary, fontWeight: '700', fontSize: 12 }}>{item}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {bankValue != null || cashValue != null || creditAvailable != null ? (
        <View style={styles.breakdown}>
          {bankValue != null ? (
            <View style={styles.breakItem}>
              <Text style={[styles.breakLabel, { color: colors.textSecondary }]}>Bank</Text>
              <Text style={[styles.breakValue, { color: colors.textPrimary }]}>
                {hidden ? '••••' : formatMoney(bankValue, currency)}
              </Text>
            </View>
          ) : null}
          {cashValue != null ? (
            <View style={styles.breakItem}>
              <Text style={[styles.breakLabel, { color: colors.textSecondary }]}>Cash</Text>
              <Text style={[styles.breakValue, { color: colors.textPrimary }]}>
                {hidden ? '••••' : formatMoney(cashValue, currency)}
              </Text>
            </View>
          ) : null}
          {creditAvailable != null ? (
            <View style={styles.breakItem}>
              <Text style={[styles.breakLabel, { color: colors.textSecondary }]}>Credit available</Text>
              <Text style={[styles.breakValue, { color: colors.textPrimary }]}>
                {hidden ? '••••' : formatMoney(creditAvailable, currency)}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {isMeaningfulSeries(series) ? (
        <Sparkline series={series} width={280} height={48} />
      ) : (
        <Text style={{ color: colors.textTertiary, fontSize: 12 }}>Not enough movement to chart yet</Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 4 },
  actions: { flexDirection: 'row', gap: 8 },
  eye: { width: 40, height: 40, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  range: { flexDirection: 'row', gap: 6 },
  rangeBtn: { minHeight: 32, paddingHorizontal: 10, borderRadius: radius.full, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  breakdown: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  breakItem: { flexGrow: 1, minWidth: 92 },
  breakLabel: { fontSize: 12, fontWeight: '600', marginBottom: 2 },
  breakValue: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
