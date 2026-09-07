import { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { spacing } from '@/constants/theme';

interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Screen({ children, scroll = false, padded = true, style }: ScreenProps) {
  const { colors } = useTheme();
  const { isDesktop } = useBreakpoint();
  const content = (
    <View style={[styles.body, padded && styles.padded, isDesktop && styles.desktop, style]}>{children}</View>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {scroll ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
          >
            {content}
          </ScrollView>
        ) : (
          content
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1, minHeight: 0 },
  body: { flex: 1, minHeight: 0 },
  padded: { paddingHorizontal: spacing.lg },
  desktop: { paddingHorizontal: 28, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  scroll: { flexGrow: 1, paddingBottom: 40 },
});
