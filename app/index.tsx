import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useAuthStore } from '@/store/useAuthStore';
import { LoadingState } from '@/components/ui/LoadingState';

const ROUTE_DECISION_TIMEOUT_MS = 6_000;

export default function Index() {
  const complete = useSettingsStore((state) => state.settings.onboardingComplete);
  const settingsLoaded = useSettingsStore((state) => state.loaded);
  const authHydrated = useAuthStore((state) => state.hydrated);
  const session = useAuthStore((state) => state.session);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), ROUTE_DECISION_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  // Startup can open the app before local settings/session finish loading;
  // redirecting on defaults would send onboarded users to welcome/onboarding.
  if (!timedOut && (!settingsLoaded || !authHydrated)) {
    return <LoadingState message="Preparing your finances…" />;
  }

  if (!session && !complete) {
    return <Redirect href="/(auth)/welcome" />;
  }
  if (session && !complete) {
    return <Redirect href="/onboarding" />;
  }
  return <Redirect href="/(tabs)" />;
}
