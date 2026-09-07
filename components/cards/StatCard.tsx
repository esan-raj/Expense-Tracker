import { StyleSheet, Text } from 'react-native';
import { Card } from '@/components/ui/Card';
import { useTheme } from '@/hooks/useTheme';

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'income' | 'expense';
}

export function StatCard({ label, value, hint, tone = 'default' }: StatCardProps) {
  const { colors } = useTheme();
  const valueColor = tone === 'income' ? colors.income : tone === 'expense' ? colors.expense : colors.textPrimary;
  return (
    <Card style={styles.card}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.value, { color: valueColor }]} numberOfLines={1}>
        {value}
      </Text>
      {hint ? <Text style={[styles.hint, { color: colors.textSecondary }]}>{hint}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1 },
  label: { fontSize: 13, fontWeight: '600' },
  value: { fontSize: 22, fontWeight: '700', marginTop: 8 },
  hint: { fontSize: 12, marginTop: 6 },
});
