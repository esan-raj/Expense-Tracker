import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { useAppUpdate } from '@/hooks/useAppUpdate';
import { radius, spacing } from '@/constants/theme';

export function UpdateReadyBar() {
  const { colors } = useTheme();
  const { bannerVisible, status, apply, dismiss } = useAppUpdate();

  if (!bannerVisible || status !== 'ready') return null;

  const restart = async () => {
    try {
      const result = await apply();
      if (!result.ok) {
        Alert.alert(result.reason === 'critical-work' ? 'Wait to restart' : 'Could not restart yet', result.message);
      }
    } catch (error) {
      Alert.alert('Could not restart yet', error instanceof Error ? error.message : 'Stay in the app and retry.');
    }
  };

  return (
    <View
      accessibilityRole="summary"
      style={[styles.bar, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Update ready</Text>
        <Text style={[styles.detail, { color: colors.textSecondary }]}>Restart now or keep working. Local data stays on this device.</Text>
      </View>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Restart now" onPress={() => void restart()} style={styles.action}>
          <Text style={[styles.actionText, { color: colors.primary }]}>Restart now</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Later" onPress={dismiss} style={styles.action}>
          <Text style={[styles.actionText, { color: colors.textSecondary }]}>Later</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  copy: { gap: 2 },
  title: { fontSize: 14, fontWeight: '700' },
  detail: { fontSize: 12, lineHeight: 16 },
  actions: { flexDirection: 'row', gap: 16 },
  action: { minHeight: 32, justifyContent: 'center' },
  actionText: { fontSize: 13, fontWeight: '700' },
});
