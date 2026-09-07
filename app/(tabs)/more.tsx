import { StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { PageScroll } from '@/components/ui/PageScroll';
import { PageHeader } from '@/components/ui/PageHeader';
import { SettingsGroup, SettingsRow } from '@/components/ui/SettingsGroup';
import { SyncStatusBar } from '@/components/ui/SyncStatusBar';
import { useTheme } from '@/hooks/useTheme';
import { useAuthStore } from '@/store/useAuthStore';
import { displayFirstName } from '@/utils/displayName';
import { spacing } from '@/constants/theme';
import { APP_VERSION } from '@/utils/constants';

export default function MoreScreen() {
  const { colors } = useTheme();
  const user = useAuthStore((state) => state.user);
  const firstName = displayFirstName(user);

  return (
    <Screen padded={false}>
      <PageScroll style={styles.scroller} contentContainerStyle={styles.content}>
        <PageHeader title="More" subtitle={firstName ? `Signed in as ${firstName}` : 'Accounts, reports, and settings'} />
        <SyncStatusBar />

        <SettingsGroup title="Money">
          <SettingsRow icon="card-outline" title="Accounts" subtitle="Banks and credit cards" onPress={() => router.push('/accounts')} />
          <SettingsRow icon="pricetags-outline" title="Categories" subtitle="Spending groups" onPress={() => router.push('/categories')} />
          <SettingsRow icon="stats-chart-outline" title="Reports" subtitle="Spending and cash flow" onPress={() => router.push('/(tabs)/reports')} />
          <SettingsRow icon="repeat-outline" title="Recurring" subtitle="Bills and repeats" onPress={() => router.push('/recurring')} last />
        </SettingsGroup>

        <SettingsGroup title="Data">
          <SettingsRow icon="download-outline" title="Export & import" subtitle="CSV transactions" onPress={() => router.push('/settings/export')} />
          <SettingsRow icon="cloud-upload-outline" title="Backup & restore" subtitle="Local JSON backup" onPress={() => router.push('/settings/backup')} last />
        </SettingsGroup>

        <SettingsGroup title="Preferences">
          <SettingsRow icon="person-circle-outline" title="Profile" subtitle="Email, sync, and log out" onPress={() => router.push('/settings/account')} />
          <SettingsRow icon="moon-outline" title="Appearance" subtitle="Light, dark, or system" onPress={() => router.push('/settings/appearance')} />
          <SettingsRow icon="cash-outline" title="Currency" subtitle="Display currency and budget" onPress={() => router.push('/settings/currency')} />
          <SettingsRow icon="information-circle-outline" title="About" subtitle={`SpendWise ${APP_VERSION}`} onPress={() => router.push('/settings/about')} />
          <SettingsRow icon="shield-checkmark-outline" title="Privacy" subtitle="How your data is stored" onPress={() => router.push('/settings/privacy')} last />
        </SettingsGroup>

        <Text style={{ color: colors.textTertiary, textAlign: 'center' }}>Your money, clearly understood.</Text>
      </PageScroll>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroller: { flex: 1, minHeight: 0 },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 40 },
});
