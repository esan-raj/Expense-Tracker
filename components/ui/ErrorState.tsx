import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { Button } from './Button';

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>Something went wrong</Text>
      <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>{message}</Text>
      {onRetry ? <Button title="Try again" onPress={onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: '700' },
});
