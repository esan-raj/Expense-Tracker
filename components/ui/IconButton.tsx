import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { minTouchTarget } from '@/constants/theme';
import { hapticLight } from '@/utils/haptics';

interface IconButtonProps {
  name: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
  color?: string;
  size?: number;
}

export function IconButton({ name, onPress, accessibilityLabel, color, size = 22 }: IconButtonProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => {
        void hapticLight();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={({ pressed }) => [styles.button, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Ionicons name={name} size={size} color={color ?? colors.textPrimary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: minTouchTarget,
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
