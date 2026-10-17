import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { BrandLockup } from '@/components/brand/BrandLockup';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/store/useSettingsStore';

export default function WelcomeAuthScreen() {
  const { colors } = useTheme();
  const onboardingComplete = useSettingsStore((state) => state.settings.onboardingComplete);

  return (
    <Screen>
      <View style={styles.content}>
        <BrandLockup size={64} />
        <Text style={[styles.title, { color: colors.textPrimary }]}>Your money, clearly understood.</Text>
        <Text style={[styles.copy, { color: colors.textSecondary }]}>
          Sign in to sync across devices. Everything still works on this phone when you are offline.
        </Text>
        <Button title="Create account" onPress={() => router.push('/(auth)/signup')} />
        <Button title="Sign in" variant="secondary" onPress={() => router.push('/(auth)/login')} />
        {onboardingComplete ? (
          <Button title="Continue offline" variant="ghost" onPress={() => router.replace('/(tabs)')} />
        ) : (
          <Button title="Continue offline" variant="ghost" onPress={() => router.replace('/onboarding')} />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: 'center', gap: 16 },
  title: { fontSize: 34, fontWeight: '800', letterSpacing: -0.8, lineHeight: 40 },
  copy: { fontSize: 16, lineHeight: 24, marginBottom: 8 },
});
