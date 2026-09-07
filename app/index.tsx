import { Redirect } from 'expo-router';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useAuthStore } from '@/store/useAuthStore';

export default function Index() {
  const complete = useSettingsStore((state) => state.settings.onboardingComplete);
  const session = useAuthStore((state) => state.session);

  if (!session && !complete) {
    return <Redirect href="/(auth)/welcome" />;
  }
  if (session && !complete) {
    return <Redirect href="/onboarding" />;
  }
  return <Redirect href="/(tabs)" />;
}
