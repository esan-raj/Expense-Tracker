import { Link, Stack } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/hooks/useTheme';

export default function NotFoundScreen() {
  const { colors } = useTheme();
  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <Screen>
        <Text style={[styles.title, { color: colors.textPrimary }]}>This screen does not exist.</Text>
        <Link href="/(tabs)" style={{ color: colors.primary, marginTop: 12, fontWeight: '700' }}>
          Go home
        </Link>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '800' },
});
