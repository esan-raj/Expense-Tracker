import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';

const ITEMS = [
  { href: '/(tabs)', match: ['/', '/(tabs)', '/(tabs)/index'], icon: 'home-outline' as const, activeIcon: 'home' as const, label: 'Dashboard' },
  { href: '/accounts', match: ['/accounts'], icon: 'card-outline' as const, activeIcon: 'card' as const, label: 'Accounts' },
  { href: '/(tabs)/transactions', match: ['/transactions', '/(tabs)/transactions'], icon: 'list-outline' as const, activeIcon: 'list' as const, label: 'Transactions' },
  { href: '/(tabs)/budgets', match: ['/budgets', '/(tabs)/budgets'], icon: 'pie-chart-outline' as const, activeIcon: 'pie-chart' as const, label: 'Budgets' },
  { href: '/(tabs)/reports', match: ['/reports', '/(tabs)/reports'], icon: 'stats-chart-outline' as const, activeIcon: 'stats-chart' as const, label: 'Reports' },
  { href: '/recurring', match: ['/recurring'], icon: 'repeat-outline' as const, activeIcon: 'repeat' as const, label: 'Recurring' },
  { href: '/categories', match: ['/categories'], icon: 'pricetags-outline' as const, activeIcon: 'pricetags' as const, label: 'Categories' },
  { href: '/(tabs)/settings', match: ['/settings', '/(tabs)/settings'], icon: 'settings-outline' as const, activeIcon: 'settings' as const, label: 'Settings' },
];

export function DesktopSidebar() {
  const { colors } = useTheme();
  const pathname = usePathname();

  return (
    <View style={[styles.rail, { backgroundColor: colors.surface, borderRightColor: colors.border }]}>
      <Text style={[styles.brand, { color: colors.primary }]}>SpendWise</Text>
      {ITEMS.map((item) => {
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
            <Ionicons name={active ? item.activeIcon : item.icon} size={20} color={active ? colors.primary : colors.textSecondary} />
            <Text style={[styles.label, { color: active ? colors.textPrimary : colors.textSecondary }]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { width: 232, height: '100%', paddingTop: 20, paddingHorizontal: 12, borderRightWidth: 1, gap: 4 },
  brand: { fontSize: 20, fontWeight: '800', paddingHorizontal: 12, marginBottom: 16 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, borderRadius: 12, paddingHorizontal: 12 },
  label: { fontSize: 15, fontWeight: '700' },
});
