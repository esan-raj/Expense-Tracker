import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { minTouchTarget, radius, spacing } from '@/constants/theme';
import { hapticLight } from '@/utils/haptics';

interface ChipOption<T extends string> {
  value: T;
  label: string;
}

export function ChipRow<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: ChipOption<T>[];
  onChange: (value: T) => void;
}) {
  const { colors } = useTheme();

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => {
              void hapticLight();
              onChange(option.value);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            style={[
              styles.chip,
              {
                backgroundColor: selected ? colors.primary : colors.surface,
                borderColor: selected ? colors.primary : colors.border,
              },
            ]}
          >
            <Text style={[styles.label, { color: selected ? colors.onPrimary : colors.textPrimary }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm, paddingRight: spacing.lg },
  chip: {
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 14, fontWeight: '700' },
});
