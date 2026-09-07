import { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { contentMaxWidth, spacing } from '@/constants/theme';

interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Screen({ children, scroll = false, padded = true, style }: ScreenProps) {
  const { colors } = useTheme();
  const { isDesktop } = useBreakpoint();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      <View
        style={[
          styles.host,
          // Native CSS overflow — RN ScrollView preventDefault on wheel when the
          // scroll box grows with its content, which traps scrolling on web.
          { overflow: scroll ? 'scroll' : 'hidden' },
        ]}
      >
        <View
          style={[
            scroll ? styles.scrollBody : styles.body,
            padded && styles.padded,
            isDesktop && styles.desktop,
            style,
          ]}
        >
          {children}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, height: '100%', maxHeight: '100%' },
  host: { flex: 1, minHeight: 0, height: '100%' },
  body: { flex: 1, minHeight: 0 },
  scrollBody: { flexGrow: 1 },
  padded: { paddingHorizontal: spacing.lg },
  desktop: { paddingHorizontal: 28, maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' },
});
