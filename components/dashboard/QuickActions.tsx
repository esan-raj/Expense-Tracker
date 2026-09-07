import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { radius, spacing } from '@/constants/theme';

const ACTIONS = [
  { href: '/transaction/add', icon: 'add-circle-outline' as const, label: 'Add transaction' },
  { href: '/budgets/add', icon: 'pie-chart-outline' as const, label: 'Add budget' },
  { href: '/investments/add', icon: 'trending-up-outline' as const, label: 'Add investment' },
];

export function QuickActions() {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      {ACTIONS.map((item) => (
        <Pressable
          key={item.label}
          onPress={() => router.push(item.href as never)}
          accessibilityRole="button"
          accessibilityLabel={item.label}
          style={[styles.item, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Ionicons name={item.icon} size={18} color={colors.primary} />
          <Text style={[styles.label, { color: colors.textPrimary }]}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  item: {
    flexGrow: 1,
    minHeight: 44,
    minWidth: 140,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: { fontSize: 13, fontWeight: '700' },
});
