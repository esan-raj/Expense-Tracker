import { Stack } from 'expo-router';
import { useTheme } from '@/hooks/useTheme';

export default function TransactionLayout() {
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
      <Stack.Screen name="add" options={{ title: 'Add Transaction', presentation: 'modal' }} />
      <Stack.Screen name="[id]" options={{ title: 'Transaction' }} />
      <Stack.Screen name="edit" options={{ title: 'Edit Transaction' }} />
    </Stack>
  );
}
