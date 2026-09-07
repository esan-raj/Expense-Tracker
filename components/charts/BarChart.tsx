import { StyleSheet, Text, View } from 'react-native';
import { format, parseISO } from 'date-fns';
import { useTheme } from '@/hooks/useTheme';

interface Point {
  date: string;
  amount: number;
}

export function BarChart({ data }: { data: Point[] }) {
  const { colors } = useTheme();
  const max = Math.max(...data.map((item) => item.amount), 1);

  return (
    <View style={styles.row}>
      {data.map((item) => (
        <View key={item.date} style={styles.col}>
          <View style={[styles.track, { backgroundColor: colors.progressTrack }]}>
            <View
              style={[
                styles.bar,
                {
                  height: `${Math.max(6, (item.amount / max) * 100)}%`,
                  backgroundColor: colors.primary,
                },
              ]}
            />
          </View>
          <Text style={[styles.label, { color: colors.textSecondary }]}>{format(parseISO(item.date), 'EEEEE')}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 140 },
  col: { flex: 1, alignItems: 'center', height: '100%' },
  track: { flex: 1, width: '70%', borderRadius: 8, justifyContent: 'flex-end', overflow: 'hidden' },
  bar: { width: '100%', borderRadius: 8 },
  label: { fontSize: 11, marginTop: 6, fontWeight: '600' },
});
