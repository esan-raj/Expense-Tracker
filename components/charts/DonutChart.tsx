import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/store/useSettingsStore';
import { formatMoney } from '@/utils/currency';

interface Slice {
  id?: string;
  label: string;
  amount: number;
  color: string;
  percent?: number;
}

export function DonutChart({
  slices,
  size = 180,
  centerLabel = 'Spent',
  centerValue,
}: {
  slices: Slice[];
  size?: number;
  centerLabel?: string;
  centerValue?: number;
}) {
  const { colors } = useTheme();
  const currency = useSettingsStore((state) => state.settings.currency);
  const stroke = size < 140 ? 14 : 22;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const safeSlices = slices
    .map((slice) => ({ ...slice, amount: Number.isFinite(slice.amount) ? Math.max(0, slice.amount) : 0 }))
    .filter((slice) => slice.amount > 0);
  const total = safeSlices.reduce((sum, item) => sum + item.amount, 0);
  const displayValue = centerValue != null && Number.isFinite(centerValue) ? Math.max(0, centerValue) : total;
  let offset = 0;

  return (
    <View style={styles.wrap} accessibilityLabel={`${centerLabel} ${formatMoney(displayValue, currency)}`}>
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
            {safeSlices.map((slice, index) => {
              const percent = total > 0 ? (slice.amount / total) * 100 : 0;
              const length = (percent / 100) * circumference;
              const circle = (
                <Circle
                  key={slice.id ?? `${slice.label}-${index}`}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  stroke={slice.color}
                  strokeWidth={stroke}
                  fill="none"
                  strokeDasharray={`${length} ${Math.max(0, circumference - length)}`}
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
          <Text style={[styles.centerLabel, { color: colors.textSecondary, fontSize: size < 140 ? 11 : 12 }]}>{centerLabel}</Text>
          <Text style={[styles.centerValue, { color: colors.textPrimary, fontSize: size < 140 ? 13 : 16 }]}>
            {formatMoney(displayValue, currency)}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  centerLabel: { fontWeight: '600' },
  centerValue: { fontWeight: '800' },
});
