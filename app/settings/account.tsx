import { Alert, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/hooks/useTheme';
import { useAuthStore } from '@/store/useAuthStore';
import { useSyncStore } from '@/store/useSyncStore';
import { formatLastSynced } from '@/utils/syncLogic';
import { toUserMessage } from '@/utils/errors';

export default function AccountScreen() {
  const { colors } = useTheme();
  const user = useAuthStore((state) => state.user);
  const signOut = useAuthStore((state) => state.signOut);
  const { status, lastSyncedAt, isOnline, pendingCount, syncNow } = useSyncStore();

  const syncLabel = !user
    ? 'Not signed in'
    : !isOnline
      ? 'Offline'
      : status === 'syncing'
        ? 'Syncing...'
        : lastSyncedAt
          ? `✓ Synced ${formatLastSynced(lastSyncedAt)}`
          : '✓ Synced just now';

  return (
    <Screen scroll>
      <Card elevated={false}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>Email</Text>
        <Text style={[styles.value, { color: colors.textPrimary }]}>{user?.email ?? 'Using this device offline'}</Text>
        <Text style={[styles.label, { color: colors.textSecondary }]}>Sync status</Text>
        <Text style={[styles.value, { color: colors.textPrimary }]}>{syncLabel}</Text>
        <Text style={{ color: colors.textSecondary, lineHeight: 22 }}>
          {isOnline
            ? pendingCount > 0
              ? `${pendingCount} change(s) waiting to upload.`
              : 'All changes synced'
            : "You're offline. We'll sync automatically when you're connected."}
        </Text>
        {lastSyncedAt ? (
          <Text style={{ color: colors.textTertiary, marginTop: 8 }}>Last synced {formatLastSynced(lastSyncedAt)}</Text>
        ) : null}
      </Card>
      {user ? (
        <View style={{ gap: 12 }}>
          <Button
            title={status === 'syncing' ? 'Syncing...' : 'Sync now'}
            onPress={async () => {
              if (!isOnline) {
                Alert.alert("You're offline.", "We'll sync automatically when you're connected.");
                return;
              }
              try {
                await syncNow();
              } catch (error) {
                Alert.alert('Sync failed', toUserMessage(error, 'Local data is still safe on this device.'));
              }
            }}
          />
          <Button
            title="Log out"
            variant="secondary"
            onPress={async () => {
              await signOut();
              router.replace('/(auth)/welcome');
            }}
          />
        </View>
      ) : (
        <Button title="Sign in to sync" onPress={() => router.push('/(auth)/welcome')} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600', marginTop: 12 },
  value: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
});
