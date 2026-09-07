import { Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { radius, spacing } from '@/constants/theme';
import { hapticLight } from '@/utils/haptics';

export function Fab({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  const { isDesktop } = useBreakpoint();
  const insets = useSafeAreaInsets();
  const bottom = isDesktop ? 24 : Math.max(12, insets.bottom);

  return (
    <Pressable
      onPress={() => {
        void hapticLight();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.fab,
        { backgroundColor: colors.primary, opacity: pressed ? 0.88 : 1, bottom, right: spacing.lg },
      ]}
    >
      <Ionicons name="add" size={22} color={colors.onPrimary} />
      <Text style={[styles.label, { color: colors.onPrimary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    height: 52,
    borderRadius: radius.full,
    zIndex: 20,
  },
  label: { fontWeight: '800', fontSize: 15 },
});
