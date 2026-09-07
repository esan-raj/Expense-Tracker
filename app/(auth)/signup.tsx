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
import { signUpSchema, type SignUpValues } from '@/utils/validation';
import { toUserMessage } from '@/utils/errors';

export default function SignUpScreen() {
  const { colors } = useTheme();
  const signUp = useAuthStore((state) => state.signUp);
  const session = useAuthStore((state) => state.session);
  const onboardingComplete = useSettingsStore((state) => state.settings.onboardingComplete);
  const loadSettings = useSettingsStore((state) => state.load);
  const loadCategories = useCategoryStore((state) => state.load);
  const loadAccounts = useAccountStore((state) => state.load);
  const syncNow = useSyncStore((state) => state.syncNow);
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const form = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { email: '', password: '', confirmPassword: '' },
  });

  return (
    <Screen scroll>
      <View style={styles.hero}>
        <Text style={[styles.brand, { color: colors.primary }]}>SpendWise</Text>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Create account</Text>
        <Text style={[styles.copy, { color: colors.textSecondary }]}>Sync stays optional. Your data starts on this device.</Text>
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
      <Controller
        control={form.control}
        name="confirmPassword"
        render={({ field, fieldState }) => (
          <Input
            label="Confirm password"
            secureTextEntry
            value={field.value}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
      <Button
        title={syncing ? 'Downloading your data...' : 'Create account'}
        loading={submitting}
        onPress={form.handleSubmit(async (values) => {
          setSubmitting(true);
          try {
            await signUp(values.email.trim(), values.password);
            if (useAuthStore.getState().session ?? session) {
              setSyncing(true);
              await syncNow();
              await Promise.all([loadSettings(), loadCategories(), loadAccounts()]);
              router.replace(useSettingsStore.getState().settings.onboardingComplete || onboardingComplete ? '/(tabs)' : '/onboarding');
              return;
            }
            Alert.alert('Check your email', 'Confirm your address, then log in to start syncing.');
            router.replace('/(auth)/login');
          } catch (error) {
            Alert.alert('Could not create account', toUserMessage(error, 'Please try again.'));
          } finally {
            setSubmitting(false);
            setSyncing(false);
          }
        })}
      />
      <Pressable onPress={() => router.push('/(auth)/login')}>
        <Text style={[styles.switch, { color: colors.textSecondary }]}>
          Already have an account? <Text style={{ color: colors.primary, fontWeight: '700' }}>Sign in</Text>
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
  switch: { textAlign: 'center', marginTop: 16 },
});
