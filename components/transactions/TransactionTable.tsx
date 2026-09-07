import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/store/useSettingsStore';
import { formatMoney } from '@/utils/currency';
import { formatDisplayDate } from '@/utils/dates';
import type { TransactionWithCategory } from '@/types';

interface TransactionTableProps {
  items: TransactionWithCategory[];
  onPress: (id: string) => void;
}

export function TransactionTable({ items, onPress }: TransactionTableProps) {
  const { colors } = useTheme();
  const currency = useSettingsStore((state) => state.settings.currency);

  return (
    <View>
      <View style={[styles.row, styles.head, { borderBottomColor: colors.border }]}>
        <Text style={[styles.cell, styles.date, styles.headText, { color: colors.textSecondary }]}>Date</Text>
        <Text style={[styles.cell, styles.flex, styles.headText, { color: colors.textSecondary }]}>Description</Text>
        <Text style={[styles.cell, styles.mid, styles.headText, { color: colors.textSecondary }]}>Account</Text>
        <Text style={[styles.cell, styles.mid, styles.headText, { color: colors.textSecondary }]}>Category</Text>
        <Text style={[styles.cell, styles.type, styles.headText, { color: colors.textSecondary }]}>Type</Text>
        <Text style={[styles.cell, styles.amount, styles.headText, { color: colors.textSecondary }]}>Amount</Text>
      </View>
      {items.map((item) => (
        <Pressable
          key={item.id}
          onPress={() => onPress(item.id)}
          accessibilityRole="button"
          accessibilityLabel={`${item.title} ${formatMoney(item.amount, currency)}`}
          style={[styles.row, { borderBottomColor: colors.border }]}
        >
          <Text style={[styles.cell, styles.date, { color: colors.textSecondary }]}>{formatDisplayDate(item.date)}</Text>
          <Text style={[styles.cell, styles.flex, { color: colors.textPrimary, fontWeight: '600' }]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={[styles.cell, styles.mid, { color: colors.textSecondary }]} numberOfLines={1}>
            {item.accountName ?? 'No account'}
          </Text>
          <Text style={[styles.cell, styles.mid, { color: colors.textSecondary }]} numberOfLines={1}>
            {item.isTransfer ? 'Transfer' : item.categoryName}
          </Text>
          <Text style={[styles.cell, styles.type, { color: colors.textSecondary }]}>
            {item.isTransfer ? 'Transfer' : item.type === 'income' ? 'Income' : 'Expense'}
          </Text>
          <Text
            style={[
              styles.cell,
              styles.amount,
              { color: item.type === 'income' ? colors.income : colors.expense, fontWeight: '700' },
            ]}
          >
            {formatMoney(item.amount, currency, { type: item.isTransfer ? undefined : item.type })}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  head: { minHeight: 40 },
  headText: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  cell: { fontSize: 14 },
  date: { width: 110 },
  mid: { width: 140 },
  type: { width: 90 },
  amount: { width: 120, textAlign: 'right' },
  flex: { flex: 1 },
});
