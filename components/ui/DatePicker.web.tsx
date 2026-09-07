import { createElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { radius, spacing } from '@/constants/theme';

interface DatePickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

export function DatePicker({ label, value, onChange, error }: DatePickerProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      {createElement('input', {
        type: 'date',
        value,
        'aria-label': label,
        onChange: (event: { target: { value: string } }) => onChange(event.target.value),
        style: {
          minHeight: 52,
          borderRadius: radius.md,
          border: `1px solid ${error ? colors.danger : colors.border}`,
          background: colors.surface,
          color: colors.textPrimary,
          paddingLeft: spacing.lg,
          paddingRight: spacing.lg,
          fontSize: 16,
          width: '100%',
          outlineColor: colors.primary,
        },
      })}
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  label: { fontSize: 13, fontWeight: '600' },
});
