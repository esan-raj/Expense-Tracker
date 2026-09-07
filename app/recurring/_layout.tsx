import { Stack } from 'expo-router';
import { useTheme } from '@/hooks/useTheme';

export default function RecurringLayout() {
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
      <Stack.Screen name="index" options={{ title: 'Recurring' }} />
      <Stack.Screen name="add" options={{ title: 'Add recurring' }} />
      <Stack.Screen name="[id]" options={{ title: 'Recurring' }} />
    </Stack>
  );
}
