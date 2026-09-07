import { StyleSheet, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { useTheme } from '@/hooks/useTheme';
import type { SeriesPoint } from '@/utils/accountSeries';
import { isMeaningfulSeries } from '@/utils/accountSeries';

export function Sparkline({
  series,
  width = 132,
  height = 40,
}: {
  series: SeriesPoint[];
  width?: number;
  height?: number;
}) {
  const { colors } = useTheme();
  if (!isMeaningfulSeries(series)) {
    return <View style={[styles.empty, { width, height, backgroundColor: colors.surfaceSecondary }]} />;
  }

  const values = series.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const step = series.length > 1 ? width / (series.length - 1) : width;
  const points = series
    .map((point, index) => {
      const x = index * step;
      const y = height - ((point.value - min) / span) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <View accessibilityLabel="Account activity trend" style={{ width, height }}>
      <Svg width={width} height={height}>
        <Polyline points={points} fill="none" stroke={colors.primary} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { borderRadius: 8, opacity: 0.7 },
});
