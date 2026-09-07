import { useState } from 'react';
import { Alert, Text } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/services/supabase';
import { useTheme } from '@/hooks/useTheme';
import { toUserMessage } from '@/utils/errors';

export default function ResetPasswordScreen() {
  const { colors } = useTheme();
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  return (
    <Screen scroll>
      <Text style={{ color: colors.textPrimary, fontSize: 28, fontWeight: '800', marginBottom: 8 }}>Set a new password</Text>
      <Text style={{ color: colors.textSecondary, marginBottom: 16, lineHeight: 22 }}>
        Enter a new password for your SpendWise account.
      </Text>
      <Input
        label="New password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        autoComplete="new-password"
      />
      <Button
        title="Update password"
        loading={submitting}
        onPress={async () => {
          if (password.length < 8) {
            Alert.alert('Password too short', 'Use at least 8 characters.');
            return;
          }
          setSubmitting(true);
          try {
            const { error } = await supabase.auth.updateUser({ password });
            if (error) throw error;
            Alert.alert('Password updated', 'You can now use your new password.');
            router.replace('/(tabs)');
          } catch (error) {
            Alert.alert('Could not update password', toUserMessage(error, 'Please try the reset link again.'));
          } finally {
            setSubmitting(false);
          }
        }}
      />
    </Screen>
  );
}
