import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { minTouchTarget, radius, spacing } from '@/constants/theme';
import { hapticLight } from '@/utils/haptics';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  accessibilityLabel?: string;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  icon,
  accessibilityLabel,
}: ButtonProps) {
  const { colors } = useTheme();
  const background = {
    primary: colors.primary,
    secondary: colors.primaryMuted,
    danger: colors.danger,
    ghost: 'transparent',
  }[variant];
  const textColor = {
    primary: '#FFFFFF',
    secondary: colors.primary,
    danger: '#FFFFFF',
    ghost: colors.primary,
  }[variant];

  return (
    <Pressable
      onPress={() => {
        void hapticLight();
        onPress();
      }}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background, opacity: disabled ? 0.5 : pressed ? 0.86 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <View style={styles.row}>
          {icon}
          <Text style={[styles.label, { color: textColor }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: minTouchTarget,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontSize: 16, fontWeight: '700' },
});
