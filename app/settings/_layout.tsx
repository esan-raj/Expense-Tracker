import { Stack } from 'expo-router';
import { useTheme } from '@/hooks/useTheme';

export default function SettingsLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="account" options={{ title: 'Account' }} />
      <Stack.Screen name="appearance" options={{ title: 'Appearance' }} />
      <Stack.Screen name="currency" options={{ title: 'Currency' }} />
      <Stack.Screen name="export" options={{ title: 'Export & import' }} />
      <Stack.Screen name="backup" options={{ title: 'Backup & restore' }} />
      <Stack.Screen name="updates" options={{ title: 'App updates' }} />
      <Stack.Screen name="about" options={{ title: 'About' }} />
      <Stack.Screen name="privacy" options={{ title: 'Privacy' }} />
    </Stack>
  );
}
