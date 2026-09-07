import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { radius, spacing } from '@/constants/theme';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
}

export function Input({ label, error, ...props }: InputProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      {label ? <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.textTertiary}
        accessibilityLabel={label ?? props.placeholder}
        {...props}
        style={[
          styles.input,
          {
            backgroundColor: colors.surfaceSecondary,
            color: colors.textPrimary,
            borderColor: error ? colors.danger : colors.border,
            outlineColor: colors.primary,
          },
          props.multiline && styles.multiline,
          props.style,
        ]}
      />
      {error ? (
        <Text style={[styles.error, { color: colors.danger }]} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  label: { fontSize: 13, fontWeight: '600' },
  input: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    fontSize: 16,
  },
  multiline: { minHeight: 96, paddingTop: 14, textAlignVertical: 'top' },
  error: { fontSize: 13, fontWeight: '500' },
});
