import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { useAppUpdate } from '@/hooks/useAppUpdate';
import { radius, spacing } from '@/constants/theme';

export function UpdateReadyModal() {
  const { colors } = useTheme();
  const { promptVisible, status, apply, dismissPrompt } = useAppUpdate();

  if (!promptVisible || status !== 'ready') return null;

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
    <Modal transparent animationType="fade" visible accessibilityViewIsModal>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Update ready</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            Restart SpendWise to apply the latest compatible update. Your local data stays on this device.
          </Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Later"
              onPress={dismissPrompt}
              style={[styles.button, { borderColor: colors.border }]}
            >
              <Text style={{ color: colors.textSecondary, fontWeight: '700' }}>Later</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Restart now"
              onPress={() => void restart()}
              style={[styles.button, styles.primary, { backgroundColor: colors.primary }]}
            >
              <Text style={{ color: colors.onPrimary, fontWeight: '700' }}>Restart now</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: 12,
  },
  title: { fontSize: 18, fontWeight: '800' },
  body: { fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  button: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { borderWidth: 0 },
});
