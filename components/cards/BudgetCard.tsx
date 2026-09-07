import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { CategoryIcon } from '@/components/categories/CategoryIcon';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/store/useSettingsStore';
import { formatMoney } from '@/utils/currency';
import { getBudgetWarningLevel } from '@/utils/calculations';
import type { BudgetWithUsage } from '@/types';

interface BudgetCardProps {
  item: BudgetWithUsage;
  onPress: () => void;
}

export function BudgetCard({ item, onPress }: BudgetCardProps) {
  const { colors } = useTheme();
  const currency = useSettingsStore((state) => state.settings.currency);
  const level = getBudgetWarningLevel(item.percent);
  const tone = item.percent >= 100 ? 'danger' : item.percent >= 75 ? 'warning' : 'primary';
  const status =
    item.percent >= 100 ? 'Over budget' : item.percent >= 90 ? 'Almost used up' : item.percent >= 75 ? 'Getting close' : 'On track';

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${item.categoryName ?? 'Overall budget'}, ${status}`}>
      <Card>
        <View style={styles.header}>
          {item.categoryIcon && item.categoryColor ? (
            <CategoryIcon icon={item.categoryIcon} color={item.categoryColor} size={40} />
          ) : null}
          <View style={styles.body}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>{item.categoryName ?? 'Overall budget'}</Text>
            <Text style={{ color: colors.textSecondary }}>
              {formatMoney(item.spent, currency)} / {formatMoney(item.amount, currency)}
            </Text>
          </View>
          <Text style={{ color: item.percent >= 100 ? colors.danger : colors.textPrimary, fontWeight: '700' }}>
            {item.percent}%
          </Text>
        </View>
        <View style={{ marginTop: 12 }}>
          <ProgressBar progress={item.percent / 100} tone={tone} />
        </View>
        <Text style={[styles.status, { color: item.percent >= 100 ? colors.danger : colors.textSecondary }]}>
          {status}
          {level ? ` · ${level}% threshold` : ''}
        </Text>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  body: { flex: 1 },
  title: { fontSize: 16, fontWeight: '700' },
  status: { marginTop: 8, fontSize: 13, fontWeight: '600' },
});
