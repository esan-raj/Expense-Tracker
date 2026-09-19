import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { getRxDatabase } from '@/database';
import { recurringService } from '@/services/recurringService';
import { syncService } from '@/services/syncService';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useCategoryStore } from '@/store/useCategoryStore';
import { useAccountStore } from '@/store/useAccountStore';
import { useInvestmentStore } from '@/store/useInvestmentStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useSyncStore } from '@/store/useSyncStore';
import { useTheme } from '@/hooks/useTheme';
import { bumpFinanceRevision } from '@/services/financeRevision';
import { LoadingState } from '@/components/ui/LoadingState';
import { DesktopSidebar } from '@/components/layout/DesktopSidebar';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { ErrorState } from '@/components/ui/ErrorState';
import { UpdateReadyBar } from '@/components/updates/UpdateReadyBar';
import { appUpdateController } from '@/services/appUpdate';
import { toUserMessage } from '@/utils/errors';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadSettings = useSettingsStore((state) => state.load);
  const loadCategories = useCategoryStore((state) => state.load);
  const loadAccounts = useAccountStore((state) => state.load);
  const loadInvestments = useInvestmentStore((state) => state.load);
  const hydrateAuth = useAuthStore((state) => state.hydrate);
  const hydrateSync = useSyncStore((state) => state.hydrate);
  const user = useAuthStore((state) => state.user);
  const syncNow = useSyncStore((state) => state.syncNow);
  const seenUserIdRef = useRef<string | null | undefined>(undefined);
  const splashHiddenRef = useRef(false);

  const hideSplash = () => {
    if (splashHiddenRef.current) return;
    splashHiddenRef.current = true;
    void SplashScreen.hideAsync().catch(() => undefined);
  };

  const bootstrap = async () => {
    setError(null);
    try {
      await getRxDatabase();
      await hydrateAuth();
      await Promise.all([loadSettings(), loadCategories(), loadAccounts(), loadInvestments(), hydrateSync()]);
      await recurringService.processDue();
      setReady(true);
      const currentUser = useAuthStore.getState().user;
      if (currentUser) {
        void syncService.startRealtime(currentUser.id, () => {
          bumpFinanceRevision();
          void loadCategories();
          void loadAccounts();
          void loadInvestments();
        });
        void syncNow();
      }
    } catch (err) {
      setError(toUserMessage(err, 'SpendWise could not start. Please try again.'));
    }
  };

  useEffect(() => {
    void bootstrap();
    return () => {
      syncService.stopRealtime();
    };
  }, []);

  useEffect(() => {
    if (ready || error) hideSplash();
  }, [ready, error]);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      syncService.stopRealtime();
      if (seenUserIdRef.current) {
        void loadCategories();
        void loadAccounts();
        void loadInvestments();
      }
      seenUserIdRef.current = null;
      return;
    }
    void syncService.startRealtime(user.id, () => {
      bumpFinanceRevision();
      void loadCategories();
      void loadAccounts();
      void loadInvestments();
    });
    if (seenUserIdRef.current !== undefined && seenUserIdRef.current !== user.id) {
      void loadCategories();
      void loadAccounts();
      void loadInvestments();
    }
    seenUserIdRef.current = user.id;
  }, [ready, user, loadCategories, loadAccounts, loadInvestments]);

  if (error) {
    return <ErrorState message={error} onRetry={() => void bootstrap()} />;
  }

  if (!ready) {
    return <LoadingState message="Preparing your finances…" onReady={hideSplash} />;
  }

  return <RootNavigation />;
}

function RootNavigation() {
  const { colors, isDark } = useTheme();
  const { isDesktop } = useBreakpoint();
  const pathname = usePathname();

  useEffect(() => {
    void appUpdateController.check('launch');
  }, []);
  const hideSidebar =
    ['/welcome', '/login', '/signup', '/forgot-password', '/onboarding', '/reset-password'].some(
      (path) => pathname === path || pathname.startsWith(`${path}/`)
    );
  const showSidebar = Platform.OS === 'web' && isDesktop && !hideSidebar;

  const stack = (
      <Stack
        screenOptions={{
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="transaction" options={{ headerShown: false }} />
        <Stack.Screen name="categories" options={{ headerShown: false }} />
        <Stack.Screen name="budgets" options={{ headerShown: false }} />
        <Stack.Screen name="recurring" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
        <Stack.Screen name="accounts" options={{ headerShown: false }} />
        <Stack.Screen name="investments" options={{ headerShown: false }} />
        <Stack.Screen name="reset-password" options={{ title: 'Reset password' }} />
      </Stack>
  );

  return (
    <SafeAreaProvider style={styles.root}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <UpdateReadyBar />
      {showSidebar ? (
        <View style={[styles.shell, { backgroundColor: colors.background }]}>
          <DesktopSidebar />
          <View style={styles.main}>{stack}</View>
        </View>
      ) : (
        stack
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, height: '100%' },
  shell: { flex: 1, flexDirection: 'row', height: '100%', minHeight: 0 },
  main: { flex: 1, minWidth: 0, minHeight: 0, height: '100%' },
});
