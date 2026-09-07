import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { useAuthStore } from '@/store/useAuthStore';
import { displayFirstName } from '@/utils/displayName';
import { radius } from '@/constants/theme';

const PRIMARY = [
  { href: '/(tabs)', match: ['/', '/(tabs)', '/(tabs)/index'], icon: 'home-outline' as const, activeIcon: 'home' as const, label: 'Home' },
  { href: '/accounts', match: ['/accounts'], icon: 'card-outline' as const, activeIcon: 'card' as const, label: 'Accounts' },
  { href: '/(tabs)/transactions', match: ['/transactions', '/(tabs)/transactions'], icon: 'list-outline' as const, activeIcon: 'list' as const, label: 'Transactions' },
  { href: '/(tabs)/budgets', match: ['/budgets', '/(tabs)/budgets'], icon: 'pie-chart-outline' as const, activeIcon: 'pie-chart' as const, label: 'Budgets' },
  { href: '/categories', match: ['/categories'], icon: 'pricetags-outline' as const, activeIcon: 'pricetags' as const, label: 'Categories' },
  { href: '/investments', match: ['/investments', '/portfolio', '/(tabs)/portfolio'], icon: 'trending-up-outline' as const, activeIcon: 'trending-up' as const, label: 'Investments' },
  { href: '/(tabs)/reports', match: ['/reports', '/(tabs)/reports'], icon: 'stats-chart-outline' as const, activeIcon: 'stats-chart' as const, label: 'Reports' },
  { href: '/recurring', match: ['/recurring'], icon: 'repeat-outline' as const, activeIcon: 'repeat' as const, label: 'Recurring' },
];

export function DesktopSidebar() {
  const { colors } = useTheme();
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const name = displayFirstName(user);

  return (
    <View style={[styles.rail, { backgroundColor: colors.surface, borderRightColor: colors.border }]}>
      <Text style={[styles.brand, { color: colors.primary }]}>SpendWise</Text>
      <View style={styles.nav}>
        {PRIMARY.map((item) => {
          const active = item.match.some((entry) => pathname === entry || pathname.startsWith(`${entry}/`));
          return (
            <Pressable
              key={item.label}
              onPress={() => router.push(item.href as never)}
              accessibilityRole="link"
              accessibilityState={{ selected: active }}
              accessibilityLabel={item.label}
              style={[styles.item, active && { backgroundColor: colors.primaryMuted }]}
            >
              <Ionicons name={active ? item.activeIcon : item.icon} size={18} color={active ? colors.primary : colors.textSecondary} />
              <Text style={[styles.label, { color: active ? colors.textPrimary : colors.textSecondary }]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <Pressable
          onPress={() => router.push('/(tabs)/settings' as never)}
          accessibilityRole="link"
          accessibilityLabel="Settings"
          style={styles.item}
        >
          <Ionicons name="settings-outline" size={18} color={colors.textSecondary} />
          <Text style={[styles.label, { color: colors.textSecondary }]}>Settings</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push('/settings/account' as never)}
          accessibilityRole="link"
          accessibilityLabel="Profile"
          style={styles.item}
        >
          <Ionicons name="person-circle-outline" size={18} color={colors.textSecondary} />
          <Text style={[styles.label, { color: colors.textSecondary }]} numberOfLines={1}>
            {name || user?.email || 'Profile'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { width: 220, height: '100%', paddingTop: 22, paddingHorizontal: 10, borderRightWidth: 1 },
  brand: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3, paddingHorizontal: 12, marginBottom: 18 },
  nav: { flex: 1, gap: 2 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 10, gap: 2 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, borderRadius: radius.md, paddingHorizontal: 12 },
  label: { fontSize: 14, fontWeight: '600' },
});
