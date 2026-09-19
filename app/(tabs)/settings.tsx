import { StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { PageScroll } from '@/components/ui/PageScroll';
import { PageHeader } from '@/components/ui/PageHeader';
import { SettingsGroup, SettingsRow } from '@/components/ui/SettingsGroup';
import { SyncStatusBar } from '@/components/ui/SyncStatusBar';
import { useTheme } from '@/hooks/useTheme';
import { spacing } from '@/constants/theme';
import { APP_VERSION } from '@/utils/constants';
import { useAppUpdateStore } from '@/services/appUpdate';

export default function SettingsScreen() {
  const { colors } = useTheme();
  const updateStatus = useAppUpdateStore((state) => state.status);
  const updateSubtitle =
    updateStatus === 'ready'
      ? 'Update ready to restart'
      : updateStatus === 'checking' || updateStatus === 'downloading'
        ? 'Checking for a compatible update'
        : `Version ${APP_VERSION}`;
  return (
    <Screen padded={false}>
      <PageScroll style={styles.scroller} contentContainerStyle={styles.content}>
        <PageHeader title="Settings" subtitle="Profile, appearance, and data" />
        <SyncStatusBar />

        <SettingsGroup title="Account">
          <SettingsRow icon="person-circle-outline" title="Profile" subtitle="Email, sync, and log out" onPress={() => router.push('/settings/account')} last />
        </SettingsGroup>

        <SettingsGroup title="Preferences">
          <SettingsRow icon="moon-outline" title="Appearance" subtitle="Theme, accent, and dark mode" onPress={() => router.push('/settings/appearance')} />
          <SettingsRow icon="cash-outline" title="Currency" subtitle="INR, USD, EUR, and more" onPress={() => router.push('/settings/currency')} last />
        </SettingsGroup>

        <SettingsGroup title="Data">
          <SettingsRow icon="download-outline" title="Export & import" subtitle="CSV transactions" onPress={() => router.push('/settings/export')} />
          <SettingsRow icon="cloud-upload-outline" title="Backup & restore" subtitle="Local JSON backup" onPress={() => router.push('/settings/backup')} last />
        </SettingsGroup>

        <SettingsGroup title="About">
          <SettingsRow icon="cloud-download-outline" title="App updates" subtitle={updateSubtitle} onPress={() => router.push('/settings/updates' as never)} />
          <SettingsRow icon="information-circle-outline" title="About" subtitle={`Version ${APP_VERSION}`} onPress={() => router.push('/settings/about')} />
          <SettingsRow icon="shield-checkmark-outline" title="Privacy" subtitle="Your data stays on this device" onPress={() => router.push('/settings/privacy')} last />
        </SettingsGroup>

        <Text style={[styles.footer, { color: colors.textTertiary }]}>SpendWise — your money, clearly understood.</Text>
      </PageScroll>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroller: { flex: 1, minHeight: 0 },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 40 },
  footer: { textAlign: 'center', opacity: 0.6, fontSize: 13 },
});
