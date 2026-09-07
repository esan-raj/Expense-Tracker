import { Stack } from 'expo-router';
import { useTheme } from '@/hooks/useTheme';

export default function CategoriesLayout() {
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
      <Stack.Screen name="index" options={{ title: 'Categories' }} />
      <Stack.Screen name="add" options={{ title: 'Add category' }} />
      <Stack.Screen name="edit" options={{ title: 'Edit category' }} />
    </Stack>
  );
}
