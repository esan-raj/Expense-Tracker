import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { Amount } from '@/components/ui/Amount';
import { Sparkline } from '@/components/charts/Sparkline';
import { UtilizationRing } from '@/components/charts/UtilizationRing';
import { useTheme } from '@/hooks/useTheme';
import { formatMoney } from '@/utils/currency';
import { accountIcon, accountTypeLabel, isCashHolding, isLiabilityAccount } from '@/utils/accountLogic';
import { isMeaningfulSeries, seriesTrendPercent, visualizationForAccount } from '@/utils/accountSeries';
import { radius, spacing } from '@/constants/theme';
import type { AccountWithBalances, CurrencyCode } from '@/types';

export function AccountCard({
  account,
  currency,
  compact = false,
}: {
  account: AccountWithBalances;
  currency: CurrencyCode;
  compact?: boolean;
}) {
  const { colors } = useTheme();
  const visualization = visualizationForAccount(account.type);
  const liability = isLiabilityAccount(account.type);
  const headline = liability ? account.outstanding : account.currentBalance;
  const headlineLabel = liability ? 'Outstanding' : isCashHolding(account.type) ? 'Cash on hand' : 'Bank balance';
  const series = account.balanceSeries ?? [];
  const trend = !liability ? seriesTrendPercent(series) : null;
  const showSpark = visualization === 'balance-trend' && isMeaningfulSeries(series);

  return (
    <Pressable
      onPress={() => router.push(`/accounts/${account.id}` as never)}
      accessibilityRole="button"
      accessibilityLabel={`${account.name} ${headlineLabel} ${formatMoney(headline, currency)}`}
      style={({ pressed }) => [styles.press, compact && styles.compactPress, { opacity: pressed ? 0.88 : 1 }]}
    >
      <Card style={styles.card}>
        <View style={styles.head}>
          <View style={[styles.icon, { backgroundColor: colors.primaryMuted }]}>
            <Ionicons name={accountIcon(account.type)} size={18} color={colors.primary} />
          </View>
          <View style={styles.meta}>
            <Text style={[styles.name, { color: colors.textPrimary }]} numberOfLines={1}>
              {account.name}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{accountTypeLabel(account.type)}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        </View>
        <Text style={[styles.kicker, { color: colors.textSecondary }]}>{headlineLabel}</Text>
        <Amount minor={headline} currency={currency} size="lg" />
        {visualization === 'credit-utilization' ? (
          <View style={styles.credit}>
            <UtilizationRing percent={account.utilizationPercent ?? 0} size={compact ? 68 : 76} />
            <View style={styles.creditMeta}>
              {account.availableCredit != null ? (
                <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                  Available {formatMoney(account.availableCredit, currency)}
                </Text>
              ) : null}
              {account.creditLimit != null ? (
                <Text style={{ color: colors.textTertiary, fontSize: 12 }}>
                  Limit {formatMoney(account.creditLimit, currency)}
                </Text>
              ) : null}
            </View>
          </View>
        ) : (
          <View style={styles.trend}>
            {showSpark ? <Sparkline series={series} width={compact ? 148 : 168} /> : (
              <Text style={{ color: colors.textTertiary, fontSize: 12 }}>Not enough activity to chart yet</Text>
            )}
            {trend != null ? (
              <Text style={{ color: trend >= 0 ? colors.income : colors.expense, fontSize: 12, fontWeight: '700' }}>
                {trend >= 0 ? '↗' : '↘'} {Math.abs(trend)}% vs last {series.length} days
              </Text>
            ) : null}
          </View>
        )}
      </Card>
    </Pressable>
  );
}

export const AccountOverviewCard = AccountCard;

const styles = StyleSheet.create({
  press: { flexGrow: 1, flexBasis: 250, minWidth: 230, maxWidth: 380 },
  compactPress: { flexGrow: 0, width: 260, maxWidth: 260 },
  card: { minHeight: 188, gap: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  icon: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  meta: { flex: 1, minWidth: 0 },
  name: { fontSize: 16, fontWeight: '700' },
  kicker: { fontSize: 12, fontWeight: '600', marginBottom: 2 },
  credit: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: spacing.md },
  creditMeta: { flex: 1, gap: 4 },
  trend: { marginTop: spacing.md, gap: 8 },
});
