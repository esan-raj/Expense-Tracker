import { Stack } from 'expo-router';
import { useTheme } from '@/hooks/useTheme';

export default function BudgetsLayout() {
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
      <Stack.Screen name="add" options={{ title: 'Create budget' }} />
      <Stack.Screen name="[id]" options={{ title: 'Budget' }} />
      <Stack.Screen name="edit" options={{ title: 'Edit budget' }} />
    </Stack>
  );
}
