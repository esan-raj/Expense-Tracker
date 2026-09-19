import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { minTouchTarget, radius, spacing } from '@/constants/theme';
import { TABLET_BREAKPOINT } from '@/utils/breakpoints';
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
  const { width } = useWindowDimensions();
  const compact = width < TABLET_BREAKPOINT;

  return (
    <View style={styles.row}>
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
              compact && styles.chipCompact,
              {
                backgroundColor: selected ? colors.primary : colors.surface,
                borderColor: selected ? colors.primary : colors.border,
              },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[styles.label, { color: selected ? colors.onPrimary : colors.textPrimary }]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    alignSelf: 'stretch',
    width: '100%',
    maxWidth: '100%',
    gap: spacing.sm,
    flexGrow: 0,
    flexShrink: 0,
  },
  chip: {
    height: minTouchTarget,
    maxHeight: minTouchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    flexGrow: 0,
    flexShrink: 0,
  },
  chipCompact: {
    paddingHorizontal: spacing.md,
  },
  label: { fontSize: 14, fontWeight: '700' },
});
