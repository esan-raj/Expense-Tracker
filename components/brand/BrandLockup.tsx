import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { SpendWiseLogo } from '@/components/brand/SpendWiseLogo';
import { walletSThemeFills } from '@/components/brand/walletSMark';
import { APP_NAME } from '@/utils/constants';

export function BrandLockup({
  size = 48,
  stacked = false,
  notchColor,
  style,
}: {
  size?: number;
  stacked?: boolean;
  notchColor?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, isDark } = useTheme();
  const { lower } = walletSThemeFills(colors.primary, isDark);

  return (
    <View style={[stacked ? styles.stack : styles.row, style]}>
      <SpendWiseLogo size={size} notchColor={notchColor ?? colors.background} />
      <Text
        style={[
          stacked ? styles.wordmarkStack : styles.wordmarkRow,
          { color: isDark ? colors.textPrimary : lower, fontSize: stacked ? Math.round(size * 0.28) : Math.round(size * 0.46) },
        ]}
      >
        {APP_NAME}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { alignItems: 'flex-start', gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  wordmarkStack: { fontWeight: '800', letterSpacing: -0.4 },
  wordmarkRow: { fontWeight: '800', letterSpacing: -0.5 },
});
