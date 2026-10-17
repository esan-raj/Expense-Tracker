import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { format, parseISO } from 'date-fns';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/store/useSettingsStore';
import { formatMoney } from '@/utils/currency';
import { radius, spacing } from '@/constants/theme';

interface Point {
  date: string;
  amount: number;
  label?: string;
}

export function BarChart({
  data,
  height = 140,
  showValues = true,
}: {
  data: Point[];
  height?: number;
  /** When true, hover/press reveals the day's amount. */
  showValues?: boolean;
}) {
  const { colors } = useTheme();
  const currency = useSettingsStore((state) => state.settings.currency);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const max = Math.max(...data.map((item) => item.amount), 1);
  const active = showValues && activeDate ? data.find((item) => item.date === activeDate) : null;

  const showValue = (date: string) => {
    if (showValues) setActiveDate(date);
  };
  const hideValue = () => setActiveDate(null);

  return (
    <View style={styles.wrap}>
      {showValues ? (
        <View style={styles.tooltipSlot}>
          {active ? (
            <View
              accessibilityLiveRegion="polite"
              style={[styles.tooltip, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}
            >
              <Text style={[styles.tooltipDate, { color: colors.textSecondary }]}>
                {format(parseISO(active.date), 'EEE, d MMM')}
              </Text>
              <Text style={[styles.tooltipAmount, { color: colors.textPrimary }]}>
                {formatMoney(active.amount, currency)}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={[styles.row, { height }]}>
        {data.map((item) => {
          const selected = activeDate === item.date;
          return (
            <Pressable
              key={item.date}
              accessibilityRole="button"
              accessibilityLabel={`${format(parseISO(item.date), 'EEEE')}: ${formatMoney(item.amount, currency)}`}
              disabled={!showValues}
              onHoverIn={() => showValue(item.date)}
              onHoverOut={hideValue}
              onPressIn={() => showValue(item.date)}
              onPressOut={hideValue}
              style={styles.col}
            >
              <View style={[styles.track, { backgroundColor: colors.progressTrack }]}>
                <View
                  style={[
                    styles.bar,
                    {
                      height: `${Math.max(6, (item.amount / max) * 100)}%`,
                      backgroundColor: colors.primary,
                      opacity: activeDate && !selected ? 0.45 : 1,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.label, { color: selected ? colors.textPrimary : colors.textSecondary }]}>
                {item.label ?? format(parseISO(item.date), 'EEEEE')}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  tooltipSlot: { minHeight: 48, justifyContent: 'flex-end' },
  tooltip: {
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 2,
  },
  tooltipDate: { fontSize: 12, fontWeight: '600' },
  tooltipAmount: { fontSize: 16, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  col: { flex: 1, alignItems: 'center', height: '100%' },
  track: { flex: 1, width: '70%', borderRadius: 8, justifyContent: 'flex-end', overflow: 'hidden' },
  bar: { width: '100%', borderRadius: 8 },
  label: { fontSize: 11, marginTop: 6, fontWeight: '600' },
});
