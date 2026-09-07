import { createElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { radius, spacing } from '@/constants/theme';

interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface SelectProps<T extends string> {
  label: string;
  value?: T;
  placeholder?: string;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  error?: string;
}

export function Select<T extends string>({
  label,
  value,
  placeholder = 'Select',
  options,
  onChange,
  error,
}: SelectProps<T>) {
  const { colors } = useTheme();
  const hasEmptyOption = options.some((option) => option.value === '');
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    const seen = new Set<string>();
    const duplicates = options.filter((option) => {
      if (seen.has(option.value)) return true;
      seen.add(option.value);
      return false;
    });
    if (duplicates.length) {
      console.warn('[Select] Duplicate option values detected', {
        field: label,
        values: duplicates.map((option) => option.value),
        options: options.map((option) => `${option.label}=${option.value}`),
      });
    }
  }
  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      {createElement(
        'select',
        {
          value: value ?? '',
          'aria-label': label,
          onChange: (event: { target: { value: string } }) => onChange(event.target.value as T),
          style: {
            minHeight: 52,
            borderRadius: radius.md,
            border: `1px solid ${error ? colors.danger : colors.border}`,
            background: colors.surface,
            color: value ? colors.textPrimary : colors.textTertiary,
            paddingLeft: spacing.lg,
            paddingRight: spacing.lg,
            fontSize: 16,
            width: '100%',
            outlineColor: colors.primary,
          },
        },
        [
          ...(hasEmptyOption ? [] : [createElement('option', { key: '__placeholder', value: '' }, placeholder)]),
          ...options.map((option) => createElement('option', { key: option.value, value: option.value }, option.label)),
        ]
      )}
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  label: { fontSize: 13, fontWeight: '600' },
});
