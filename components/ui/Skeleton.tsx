import { StyleSheet, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { radius, spacing } from '@/constants/theme';

export function Skeleton({ height = 16, width = '100%', style }: { height?: number; width?: number | `${number}%`; style?: ViewStyle }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityLabel="Loading"
      style={[
        styles.block,
        { height, width, backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
        style,
      ]}
    />
  );
}

export function ScreenSkeleton({ variant = 'list' }: { variant?: 'dashboard' | 'list' | 'detail' }) {
  if (variant === 'dashboard') {
    return (
      <View style={styles.stack} accessibilityLabel="Loading dashboard">
        <Skeleton height={28} width="55%" />
        <Skeleton height={16} width="40%" />
        <Skeleton height={148} />
        <View style={styles.row}>
          <Skeleton height={132} style={styles.flex} />
          <Skeleton height={132} style={styles.flex} />
        </View>
        <Skeleton height={180} />
        <Skeleton height={220} />
      </View>
    );
  }

  if (variant === 'detail') {
    return (
      <View style={styles.stack} accessibilityLabel="Loading details">
        <Skeleton height={120} />
        <Skeleton height={220} />
        <Skeleton height={48} />
      </View>
    );
  }

  return (
    <View style={styles.stack} accessibilityLabel="Loading list">
      <Skeleton height={28} width="45%" />
      <Skeleton height={48} />
      <Skeleton height={72} />
      <Skeleton height={72} />
      <Skeleton height={72} />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md, padding: spacing.lg },
  row: { flexDirection: 'row', gap: spacing.md },
  flex: { flex: 1 },
  block: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
});
