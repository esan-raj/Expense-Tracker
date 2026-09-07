import { StyleSheet, Text } from 'react-native';
import { Card } from '@/components/ui/Card';
import { useTheme } from '@/hooks/useTheme';

interface BalanceCardProps {
  value: string;
}

export function BalanceCard({ value }: BalanceCardProps) {
  const { colors } = useTheme();
  return (
    <Card style={[styles.card, { backgroundColor: colors.primary }]}>
      <Text style={styles.label}>Total bank balance</Text>
      <Text style={styles.value} accessibilityRole="text" accessibilityLabel={`Total bank balance ${value}`}>
        {value}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 0 },
  label: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '600' },
  value: { color: '#FFFFFF', fontSize: 36, fontWeight: '800', marginTop: 8, letterSpacing: -0.8 },
});
