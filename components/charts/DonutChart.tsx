import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/store/useSettingsStore';
import { formatMoney } from '@/utils/currency';

interface Slice {
  label: string;
  amount: number;
  color: string;
  percent: number;
}

export function DonutChart({ slices, size = 180 }: { slices: Slice[]; size?: number }) {
  const { colors } = useTheme();
  const currency = useSettingsStore((state) => state.settings.currency);
  const stroke = 22;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const total = slices.reduce((sum, item) => sum + item.amount, 0);

  return (
    <View style={styles.wrap}>
      <View style={{ width: size, height: size }}>
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
            {slices.map((slice) => {
              const length = (slice.percent / 100) * circumference;
              const circle = (
                <Circle
                  key={slice.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  stroke={slice.color}
                  strokeWidth={stroke}
                  fill="none"
                  strokeDasharray={`${length} ${circumference - length}`}
                  strokeDashoffset={-offset}
                  strokeLinecap="round"
                />
              );
              offset += length;
              return circle;
            })}
          </G>
        </Svg>
        <View style={styles.center}>
          <Text style={[styles.centerLabel, { color: colors.textSecondary }]}>Spent</Text>
          <Text style={[styles.centerValue, { color: colors.textPrimary }]}>{formatMoney(total, currency)}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  centerLabel: { fontSize: 12, fontWeight: '600' },
  centerValue: { fontSize: 16, fontWeight: '800' },
});
