import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { useSyncStore } from '@/store/useSyncStore';
import { useAuthStore } from '@/store/useAuthStore';
import { formatLastSynced } from '@/utils/syncLogic';

export function SyncStatusBar() {
  const { colors } = useTheme();
  const user = useAuthStore((state) => state.user);
  const { status, lastSyncedAt, isOnline } = useSyncStore();

  if (!user) {
    return (
      <Text style={[styles.text, { color: colors.textTertiary }]}>
        Offline on this device. Sign in to sync across devices.
      </Text>
    );
  }

  const label = !isOnline
    ? 'Offline · Your transactions are saved on this device'
    : status === 'syncing'
      ? '↻ Syncing...'
      : status === 'error'
        ? 'Could not sync. Local data is safe.'
        : lastSyncedAt
          ? `✓ Synced ${formatLastSynced(lastSyncedAt)}`
          : '✓ All changes synced';

  return (
    <View accessibilityRole="text" accessibilityLabel={label}>
      <Text style={[styles.text, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: 13, fontWeight: '600' },
});
