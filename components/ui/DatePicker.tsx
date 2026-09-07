import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { addMonths, eachDayOfInterval, endOfMonth, format, startOfMonth, startOfWeek } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { radius, spacing } from '@/constants/theme';
import { formatDisplayDate, fromDateKey, toDateKey } from '@/utils/dates';
import { useSettingsStore } from '@/store/useSettingsStore';

interface DatePickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

export function DatePicker({ label, value, onChange, error }: DatePickerProps) {
  const { colors } = useTheme();
  const firstDayOfWeek = useSettingsStore((state) => state.settings.firstDayOfWeek);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(fromDateKey(value));
  const selected = fromDateKey(value);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: firstDayOfWeek as 0 | 1 });
    const end = endOfMonth(cursor);
    return eachDayOfInterval({ start, end });
  }, [cursor, firstDayOfWeek]);

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <Pressable
        onPress={() => {
          setCursor(selected);
          setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${formatDisplayDate(value)}`}
        style={[styles.field, { backgroundColor: colors.surface, borderColor: error ? colors.danger : colors.border }]}
      >
        <Text style={{ color: colors.textPrimary, fontSize: 16 }}>{formatDisplayDate(value)}</Text>
        <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
      </Pressable>
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={[styles.overlay, { backgroundColor: colors.overlay }]} onPress={() => setOpen(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.surfaceElevated }]} onPress={() => undefined}>
            <View style={styles.header}>
              <Pressable onPress={() => setCursor(addMonths(cursor, -1))} accessibilityLabel="Previous month">
                <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
              </Pressable>
              <Text style={[styles.month, { color: colors.textPrimary }]}>{format(cursor, 'MMMM yyyy')}</Text>
              <Pressable onPress={() => setCursor(addMonths(cursor, 1))} accessibilityLabel="Next month">
                <Ionicons name="chevron-forward" size={22} color={colors.textPrimary} />
              </Pressable>
            </View>
            <View style={styles.grid}>
              {days.map((day) => {
                const key = toDateKey(day);
                const isSelected = key === value;
                const outside = day.getMonth() !== cursor.getMonth();
                return (
                  <Pressable
                    key={key + day.toISOString()}
                    onPress={() => {
                      onChange(key);
                      setOpen(false);
                    }}
                    style={[
                      styles.day,
                      isSelected && { backgroundColor: colors.primary },
                    ]}
                  >
                    <Text
                      style={{
                        color: isSelected ? '#fff' : outside ? colors.textTertiary : colors.textPrimary,
                        fontWeight: isSelected ? '700' : '500',
                      }}
                    >
                      {format(day, 'd')}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  label: { fontSize: 13, fontWeight: '600' },
  field: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  overlay: { flex: 1, justifyContent: 'center', padding: 20 },
  sheet: { borderRadius: 24, padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  month: { fontSize: 18, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  day: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
});
