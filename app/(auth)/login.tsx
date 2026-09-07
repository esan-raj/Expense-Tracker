import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
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
      <View style={styles.hero}>
        <Text style={[styles.brand, { color: colors.primary }]}>SpendWise</Text>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Welcome back</Text>
        <Text style={[styles.copy, { color: colors.textSecondary }]}>Sign in to sync your finances.</Text>
      </View>
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
        title={syncing ? 'Downloading your data...' : 'Sign in'}
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
      <Pressable onPress={() => router.push('/(auth)/signup')}>
        <Text style={[styles.switch, { color: colors.textSecondary }]}>
          New here? <Text style={{ color: colors.primary, fontWeight: '700' }}>Create account</Text>
        </Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { marginBottom: 20, gap: 6 },
  brand: { fontSize: 13, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  copy: { fontSize: 15, lineHeight: 22 },
  link: { fontWeight: '700', marginVertical: 8 },
  switch: { textAlign: 'center', marginTop: 16 },
});
