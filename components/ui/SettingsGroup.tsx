import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { Card } from '@/components/ui/Card';
import { minTouchTarget, spacing } from '@/constants/theme';

export function SettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.group}>
      {title ? <Text style={[styles.heading, { color: colors.textSecondary }]}>{title}</Text> : null}
      <Card elevated={false} style={styles.card}>
        {children}
      </Card>
    </View>
  );
}

export function SettingsRow({
  icon,
  title,
  subtitle,
  onPress,
  last,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  onPress: () => void;
  last?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: colors.border, opacity: pressed ? 0.72 : 1 },
        last && styles.last,
      ]}
    >
      <View style={[styles.icon, { backgroundColor: colors.primaryMuted }]}>
        <Ionicons name={icon} size={18} color={colors.primary} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  heading: { fontSize: 12, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase', paddingHorizontal: 4 },
  card: { paddingVertical: 4, paddingHorizontal: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: minTouchTarget + 8,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  last: { borderBottomWidth: 0 },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '600' },
  subtitle: { fontSize: 13, marginTop: 2 },
});
