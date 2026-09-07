import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Screen } from '@/components/ui/Screen';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { authService } from '@/services/authService';
import { useTheme } from '@/hooks/useTheme';
import { forgotPasswordSchema } from '@/utils/validation';
import { toUserMessage } from '@/utils/errors';
import { z } from 'zod';

type Values = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordScreen() {
  const { colors } = useTheme();
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  return (
    <Screen scroll>
      <View style={styles.hero}>
        <Text style={[styles.brand, { color: colors.primary }]}>SpendWise</Text>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Reset password</Text>
        <Text style={[styles.copy, { color: colors.textSecondary }]}>
          Enter your email and we will send a reset link. You can keep using SpendWise offline in the meantime.
        </Text>
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
      <Button
        title="Send reset link"
        loading={submitting}
        onPress={form.handleSubmit(async (values) => {
          setSubmitting(true);
          try {
            await authService.resetPassword(values.email.trim());
            Alert.alert('Email sent', 'Check your inbox for a password reset link.');
          } catch (error) {
            Alert.alert('Could not send email', toUserMessage(error, 'Please try again.'));
          } finally {
            setSubmitting(false);
          }
        })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { marginBottom: 20, gap: 6 },
  brand: { fontSize: 13, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  copy: { fontSize: 15, lineHeight: 22 },
});
