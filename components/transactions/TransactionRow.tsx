import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CategoryIcon } from '@/components/categories/CategoryIcon';
import { Amount } from '@/components/ui/Amount';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/store/useSettingsStore';
import { formatMoney } from '@/utils/currency';
import { formatShortDate } from '@/utils/dates';
import type { TransactionWithCategory } from '@/types';

interface TransactionRowProps {
  item: TransactionWithCategory;
  onPress: (item: TransactionWithCategory) => void;
}

function TransactionRowComponent({ item, onPress }: TransactionRowProps) {
  const { colors } = useTheme();
  const currency = useSettingsStore((state) => state.settings.currency);
  const transfer = item.isTransfer;
  const type = transfer ? 'transfer' : item.type;
  const amountLabel = transfer
    ? formatMoney(item.amount, currency)
    : formatMoney(item.amount, currency, { type: item.type });

  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${transfer ? 'transfer' : item.type} ${amountLabel}`}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.72 : 1 }]}
    >
      <CategoryIcon
        icon={transfer ? 'swap-horizontal' : item.categoryIcon}
        color={transfer ? colors.transfer : item.categoryColor}
      />
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
          {transfer ? 'Transfer' : item.categoryName}
          {item.accountName ? ` · ${item.accountName}` : ''}
        </Text>
      </View>
      <View style={styles.right}>
        <Amount
          minor={item.amount}
          currency={currency}
          type={type}
          size="sm"
          style={styles.amount}
        />
        <Text style={[styles.date, { color: colors.textTertiary }]}>{formatShortDate(item.date)}</Text>
      </View>
    </Pressable>
  );
}

export const TransactionRow = memo(TransactionRowComponent);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 10 },
  body: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 13, marginTop: 2 },
  right: { alignItems: 'flex-end' },
  amount: { fontSize: 16 },
  date: { fontSize: 12, marginTop: 2, fontWeight: '600' },
});
