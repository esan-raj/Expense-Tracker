import { Alert, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/hooks/useTheme';
import { useAppUpdate } from '@/hooks/useAppUpdate';
import { previewUpdateVerificationLabel } from '@/utils/previewUpdateMarker';

function formatTimestamp(value: string | null): string {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function statusLabel(status: string): string {
  switch (status) {
    case 'checking':
      return 'Checking for updates…';
    case 'available':
      return 'Update available';
    case 'downloading':
      return 'Downloading';
    case 'ready':
      return 'Update ready';
    case 'unavailable':
      return 'You’re up to date';
    case 'error':
      return 'Check failed';
    case 'unsupported':
      return 'Not available here';
    default:
      return 'Idle';
  }
}

export default function AppUpdatesScreen() {
  const { colors } = useTheme();
  const update = useAppUpdate();
  const checking = update.status === 'checking' || update.status === 'downloading';
  const previewMarker = previewUpdateVerificationLabel(update.info.channel);

  const restart = async () => {
    try {
      const result = await update.apply();
      if (!result.ok) {
        Alert.alert(result.reason === 'critical-work' ? 'Wait to restart' : 'Could not restart yet', result.message);
      }
    } catch (error) {
      Alert.alert('Could not restart yet', error instanceof Error ? error.message : 'Stay in the app and retry.');
    }
  };

  return (
    <Screen scroll>
      <Card elevated={false}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>App updates</Text>
        <Text style={[styles.copy, { color: colors.textSecondary }]}>
          Compatible JavaScript updates download in the background. SpendWise does not wait for cloud sync, and it will not
          restart while you are editing or restoring data.
        </Text>
        <Text style={[styles.status, { color: colors.textPrimary }]}>{statusLabel(update.status)}</Text>
        <Text style={[styles.copy, { color: colors.textSecondary }]}>{update.message}</Text>
        {update.lastError ? <Text style={[styles.copy, { color: colors.warning }]}>{update.lastError}</Text> : null}
        <View style={styles.actions}>
          <Button
            title={checking ? statusLabel(update.status) : 'Check for updates'}
            loading={checking}
            disabled={checking || update.status === 'unsupported'}
            onPress={() => void update.check('manual')}
          />
          {update.status === 'available' ? (
            <Button title="Download update" onPress={() => void update.download()} />
          ) : null}
          {update.status === 'ready' ? (
            <Button title="Restart now" variant="secondary" onPress={() => void restart()} />
          ) : null}
        </View>
      </Card>
      <Card elevated={false}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>This installation</Text>
        <InfoRow label="App version" value={update.info.appVersion} colors={colors} />
        <InfoRow label="Native version" value={update.info.nativeApplicationVersion ?? 'Unknown'} colors={colors} />
        <InfoRow label="Native build" value={update.info.nativeBuildVersion ?? 'Assigned by EAS'} colors={colors} />
        <InfoRow label="Update channel" value={update.info.channel ?? 'Not in a release APK'} colors={colors} />
        <InfoRow label="Runtime" value={update.info.runtimeVersion ?? 'Not in a release APK'} colors={colors} />
        <InfoRow label="Update id" value={update.info.updateId ?? 'Embedded binary'} colors={colors} />
        <InfoRow label="Last successful check" value={formatTimestamp(update.lastCheckedAt)} colors={colors} />
        <InfoRow label="Published" value={formatTimestamp(update.info.createdAt)} colors={colors} />
        <InfoRow
          label="Launch source"
          value={
            update.info.isEmergencyLaunch
              ? 'Emergency fallback to embedded update'
              : update.info.isEmbeddedLaunch
                ? 'Embedded APK bundle'
                : 'Downloaded compatible update'
          }
          colors={colors}
        />
        {previewMarker ? (
          <InfoRow label="Preview marker" value={previewMarker} colors={colors} />
        ) : null}
        <Text style={[styles.footnote, { color: colors.textTertiary }]}>
          Preview APKs only receive preview-channel updates. Production APKs only receive production-channel updates.
          These details never include tokens, keys, or account secrets.
        </Text>
      </Card>
    </Screen>
  );
}

function InfoRow({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: { textPrimary: string; textSecondary: string };
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <Text selectable style={[styles.value, { color: colors.textPrimary }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  copy: { lineHeight: 22, marginBottom: 12 },
  status: { fontSize: 16, fontWeight: '700', marginBottom: 6 },
  actions: { gap: 10 },
  row: { marginBottom: 12, gap: 2 },
  label: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  value: { fontSize: 14, lineHeight: 20 },
  footnote: { fontSize: 12, lineHeight: 18, marginTop: 8 },
});
