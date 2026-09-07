import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/store/useSettingsStore';
import { formatMoney } from '@/utils/currency';

export function ComparisonChart({ income, expenses }: { income: number; expenses: number }) {
  const { colors } = useTheme();
  const currency = useSettingsStore((state) => state.settings.currency);
  const max = Math.max(income, expenses, 1);

  return (
    <View style={styles.wrap}>
      <Row label="Income" value={formatMoney(income, currency)} width={income / max} color={colors.income} text={colors.textSecondary} />
      <Row label="Expenses" value={formatMoney(expenses, currency)} width={expenses / max} color={colors.expense} text={colors.textSecondary} />
    </View>
  );
}

function Row({
  label,
  value,
  width,
  color,
  text,
}: {
  label: string;
  value: string;
  width: number;
  color: string;
  text: string;
}) {
  return (
    <View style={styles.item}>
      <View style={styles.header}>
        <Text style={{ color: text, fontWeight: '600' }}>{label}</Text>
        <Text style={{ color, fontWeight: '700' }}>{value}</Text>
      </View>
      <View style={[styles.track, { backgroundColor: `${color}22` }]}>
        <View style={[styles.fill, { width: `${Math.max(width * 100, 4)}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  item: { gap: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between' },
  track: { height: 10, borderRadius: 999, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999 },
});
