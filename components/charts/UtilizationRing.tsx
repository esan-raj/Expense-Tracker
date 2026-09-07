import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { useTheme } from '@/hooks/useTheme';

export function UtilizationRing({
  percent,
  size = 72,
}: {
  percent: number;
  size?: number;
}) {
  const { colors } = useTheme();
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const used = Math.max(0, Math.min(100, percent));
  const length = (used / 100) * circumference;

  return (
    <View style={{ width: size, height: size }} accessibilityLabel={`Utilization ${used.toFixed(2)} percent`}>
      <Svg width={size} height={size}>
        <G transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={colors.progressTrack}
            strokeWidth={stroke}
            fill="none"
          />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={colors.primary}
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={`${length} ${Math.max(0, circumference - length)}`}
            strokeLinecap="round"
          />
        </G>
      </Svg>
      <View style={styles.center}>
        <Text style={[styles.value, { color: colors.textPrimary }]}>{used.toFixed(used < 10 ? 2 : 1)}%</Text>
        <Text style={[styles.label, { color: colors.textSecondary }]}>used</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  value: { fontSize: 12, fontWeight: '800' },
  label: { fontSize: 10, fontWeight: '600' },
});
