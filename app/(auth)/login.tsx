import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Screen } from '@/components/ui/Screen';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/store/useAuthStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useCategoryStore } from '@/store/useCategoryStore';
import { useAccountStore } from '@/store/useAccountStore';
import { useSyncStore } from '@/store/useSyncStore';
import { useTheme } from '@/hooks/useTheme';
import { authEmailSchema, type AuthEmailValues } from '@/utils/validation';
import { toUserMessage } from '@/utils/errors';

export default function LoginScreen() {
  const { colors } = useTheme();
  const signIn = useAuthStore((state) => state.signIn);
  const onboardingComplete = useSettingsStore((state) => state.settings.onboardingComplete);
  const loadSettings = useSettingsStore((state) => state.load);
  const loadCategories = useCategoryStore((state) => state.load);
  const loadAccounts = useAccountStore((state) => state.load);
  const syncNow = useSyncStore((state) => state.syncNow);
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const form = useForm<AuthEmailValues>({
    resolver: zodResolver(authEmailSchema),
    defaultValues: { email: '', password: '' },
  });

  return (
    <Screen scroll>
      <Controller
        control={form.control}
        name="email"
        render={({ field, fieldState }) => (
          <Input
            label="Email"
            autoCapitalize="none"
            keyboardType="email-address"
            value={field.value}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="password"
        render={({ field, fieldState }) => (
          <Input
            label="Password"
            secureTextEntry
            value={field.value}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <Pressable onPress={() => router.push('/(auth)/forgot-password')}>
        <Text style={[styles.link, { color: colors.primary }]}>Forgot password?</Text>
      </Pressable>
      <Button
        title={syncing ? 'Downloading your data...' : 'Log In'}
        loading={submitting}
        onPress={form.handleSubmit(async (values) => {
          setSubmitting(true);
          try {
            await signIn(values.email.trim(), values.password);
            setSyncing(true);
            await syncNow();
            await Promise.all([loadSettings(), loadCategories(), loadAccounts()]);
            router.replace(useSettingsStore.getState().settings.onboardingComplete || onboardingComplete ? '/(tabs)' : '/onboarding');
          } catch (error) {
            Alert.alert('Could not log in', toUserMessage(error, 'Incorrect email or password.'));
          } finally {
            setSubmitting(false);
            setSyncing(false);
          }
        })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  link: { fontWeight: '700', marginVertical: 8 },
});
