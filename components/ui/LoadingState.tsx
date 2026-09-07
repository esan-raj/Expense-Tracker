import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';

export function LoadingState({ message = 'Loading your finances…' }: { message?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap} accessibilityLabel={message}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={{ color: colors.textSecondary, marginTop: 12 }}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
