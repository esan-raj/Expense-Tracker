import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '@/hooks/useTheme';
import { useSyncStore } from '@/store/useSyncStore';
import { useAuthStore } from '@/store/useAuthStore';
import { formatLastSynced } from '@/utils/syncLogic';
import { radius, spacing } from '@/constants/theme';

export function SyncStatusBar() {
  const { colors } = useTheme();
  const user = useAuthStore((state) => state.user);
  const status = useSyncStore((state) => state.status);
  const lastSyncedAt = useSyncStore((state) => state.lastSyncedAt);
  const isOnline = useSyncStore((state) => state.isOnline);

  const compact = !user
    ? '• Offline'
    : !isOnline
      ? '• Offline'
      : status === 'syncing'
        ? '↻ Syncing'
        : status === 'error'
          ? '! Sync issue'
          : '✓ Synced';

  const detail = !user
    ? 'Saved on this device. Sign in to sync across devices.'
    : !isOnline
      ? 'Changes stay on this device until you are back online.'
      : status === 'syncing'
        ? 'Uploading and downloading your latest records.'
        : status === 'error'
          ? 'Could not sync. Local data is still safe.'
          : lastSyncedAt
            ? `Last synced ${formatLastSynced(lastSyncedAt)}`
            : 'All changes are up to date.';

  return (
    <Pressable
      onPress={() => router.push('/settings/account')}
      accessibilityRole="button"
      accessibilityLabel={`${compact}. ${detail}`}
      style={[styles.pill, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
    >
      <View style={[styles.dot, { backgroundColor: status === 'error' ? colors.warning : colors.primary }]} />
      <Text style={[styles.text, { color: colors.textSecondary }]}>{compact}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  text: { fontSize: 12, fontWeight: '700' },
});
