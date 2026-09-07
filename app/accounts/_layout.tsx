import { Stack } from 'expo-router';
import { useTheme } from '@/hooks/useTheme';

export default function AccountsLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Accounts' }} />
      <Stack.Screen name="add" options={{ title: 'Add account' }} />
      <Stack.Screen name="[id]" options={{ title: 'Account' }} />
    </Stack>
  );
}
