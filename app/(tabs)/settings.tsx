import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/ui/Screen';
import { PageScroll } from '@/components/ui/PageScroll';
import { Card } from '@/components/ui/Card';
import { useTheme } from '@/hooks/useTheme';
import { APP_VERSION } from '@/utils/constants';

const rows = [
  { href: '/settings/account', icon: 'person-circle-outline' as const, title: 'Account', subtitle: 'Email, sync, and log out' },
  { href: '/settings/appearance', icon: 'moon-outline' as const, title: 'Theme', subtitle: 'System, light, or dark' },
  { href: '/settings/currency', icon: 'cash-outline' as const, title: 'Currency', subtitle: 'INR, USD, EUR, and more' },
  { href: '/accounts', icon: 'card-outline' as const, title: 'Accounts', subtitle: 'Banks and credit cards' },
  { href: '/categories', icon: 'pricetags-outline' as const, title: 'Categories', subtitle: 'Manage custom categories' },
  { href: '/recurring', icon: 'repeat-outline' as const, title: 'Recurring', subtitle: 'Subscriptions and repeats' },
  { href: '/settings/export', icon: 'download-outline' as const, title: 'Export & import', subtitle: 'CSV transactions' },
  { href: '/settings/backup', icon: 'cloud-upload-outline' as const, title: 'Backup & restore', subtitle: 'Local JSON backup' },
  { href: '/settings/about', icon: 'information-circle-outline' as const, title: 'About', subtitle: `Version ${APP_VERSION}` },
  { href: '/settings/privacy', icon: 'shield-checkmark-outline' as const, title: 'Privacy', subtitle: 'Your data stays on this device' },
];

export default function SettingsScreen() {
  const { colors } = useTheme();

  return (
    <Screen padded={false}>
      <PageScroll style={styles.scroller} contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Settings</Text>
        <Card>
          {rows.map((row, index) => (
            <Pressable
              key={row.href}
              onPress={() => router.push(row.href as never)}
              accessibilityRole="button"
              accessibilityLabel={row.title}
              style={[styles.row, index < rows.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
            >
              <Ionicons name={row.icon} size={22} color={colors.primary} />
              <View style={styles.body}>
                <Text style={[styles.label, { color: colors.textPrimary }]}>{row.title}</Text>
                <Text style={{ color: colors.textSecondary }}>{row.subtitle}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </Pressable>
          ))}
        </Card>
        <Text
          style={{ color: colors.textTertiary, textAlign: 'center' }}
          onPress={() => Alert.alert('SpendWise', 'A private, offline-first expense tracker.')}
        >
          First day of week and sample data are in Currency and Backup.
        </Text>
      </PageScroll>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroller: { flex: 1, minHeight: 0 },
  title: { fontSize: 28, fontWeight: '800', paddingTop: 8 },
  content: { padding: 16, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  body: { flex: 1 },
  label: { fontSize: 16, fontWeight: '700' },
});
