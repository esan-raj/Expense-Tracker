import Svg, { G, Path, Rect } from 'react-native-svg';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import {
  WALLET_S_BRAND,
  WALLET_S_LOWER_D,
  WALLET_S_MARK_TRANSFORM,
  WALLET_S_NOTCH,
  WALLET_S_UPPER_D,
  WALLET_S_VIEWBOX,
  walletSThemeFills,
} from '@/components/brand/walletSMark';

export type SpendWiseLogoVariant = 'theme' | 'brand';

export function SpendWiseLogo({
  size = 48,
  variant = 'theme',
  notchColor,
  style,
}: {
  size?: number;
  variant?: SpendWiseLogoVariant;
  notchColor?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, isDark } = useTheme();
  const themed = walletSThemeFills(colors.primary, isDark);
  const upper = variant === 'brand' ? WALLET_S_BRAND.emerald : themed.upper;
  const lower = variant === 'brand' ? WALLET_S_BRAND.teal : themed.lower;
  const cut = notchColor ?? colors.background;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="SpendWise"
      style={[{ width: size, height: size }, style]}
    >
      <Svg width={size} height={size} viewBox={WALLET_S_VIEWBOX}>
        <G transform={WALLET_S_MARK_TRANSFORM}>
          <Path d={WALLET_S_UPPER_D} fill={upper} />
          <Path d={WALLET_S_LOWER_D} fill={lower} />
          <Rect
            x={WALLET_S_NOTCH.x}
            y={WALLET_S_NOTCH.y}
            width={WALLET_S_NOTCH.width}
            height={WALLET_S_NOTCH.height}
            rx={WALLET_S_NOTCH.rx}
            fill={cut}
          />
        </G>
      </Svg>
    </View>
  );
}
