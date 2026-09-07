import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CategoryIcon } from '@/components/categories/CategoryIcon';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/store/useSettingsStore';
import { formatMoney } from '@/utils/currency';
import { formatShortDate } from '@/utils/dates';
import { paymentMethodLabel } from '@/utils/constants';
import type { TransactionWithCategory } from '@/types';

interface TransactionRowProps {
  item: TransactionWithCategory;
  onPress: () => void;
}

function TransactionRowComponent({ item, onPress }: TransactionRowProps) {
  const { colors } = useTheme();
  const currency = useSettingsStore((state) => state.settings.currency);
  const amountColor = item.type === 'income' ? colors.income : colors.expense;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${item.type} ${formatMoney(item.amount, currency, { type: item.type })}`}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.72 : 1 }]}
    >
      <CategoryIcon
        icon={item.isTransfer ? 'swap-horizontal' : item.categoryIcon}
        color={item.isTransfer ? '#64748B' : item.categoryColor}
      />
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
          {item.isTransfer ? 'Transfer' : item.categoryName}
          {item.accountName ? ` · ${item.accountName}` : item.accountId ? '' : ' · No account'}
          {item.isTransfer ? '' : ` · ${paymentMethodLabel(item.paymentMethod)}`}
          {` · ${formatShortDate(item.date)}`}
        </Text>
      </View>
      <Text style={[styles.amount, { color: amountColor }]}>
        {formatMoney(item.amount, currency, { type: item.type })}
      </Text>
    </Pressable>
  );
}

export const TransactionRow = memo(TransactionRowComponent);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  body: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 13, marginTop: 2 },
  amount: { fontSize: 16, fontWeight: '700' },
});
