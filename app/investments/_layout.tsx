import { Stack } from 'expo-router';
import { useTheme } from '@/hooks/useTheme';

export default function InvestmentsLayout() {
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
      <Stack.Screen name="index" options={{ title: 'Investments' }} />
      <Stack.Screen name="add" options={{ title: 'Add investment' }} />
      <Stack.Screen name="[id]" options={{ title: 'Investment' }} />
    </Stack>
  );
}
