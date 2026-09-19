import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
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
import { useBudgetStore } from '@/store/useBudgetStore';
import { useTheme } from '@/hooks/useTheme';
import { bumpFinanceRevision } from '@/services/financeRevision';
import { DesktopSidebar } from '@/components/layout/DesktopSidebar';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { ErrorState } from '@/components/ui/ErrorState';
import { StartupScreen } from '@/components/startup/StartupScreen';
import { UpdateReadyBar } from '@/components/updates/UpdateReadyBar';
import { UpdateReadyModal } from '@/components/updates/UpdateReadyModal';
import { appUpdateController } from '@/services/appUpdate';
import {
  createAppStartupController,
  createInitialStartupState,
  type StartupState,
} from '@/services/appStartup';
import { dashboardUserKey, loadHomeDashboardSnapshot } from '@/services/dashboardSnapshot';
import { clearDashboardSeed, setDashboardSeed } from '@/services/dashboardSeed';
import { currentMonthYear } from '@/utils/dates';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

const LAUNCH_UPDATE_SETTLE_MS = 1_200;

export default function RootLayout() {
  const [startup, setStartup] = useState<StartupState>(createInitialStartupState);
  const user = useAuthStore((state) => state.user);
  const seenUserIdRef = useRef<string | null | undefined>(undefined);
  const splashHiddenRef = useRef(false);
  const startupRef = useRef(startup);
  startupRef.current = startup;

  const hideSplash = () => {
    if (splashHiddenRef.current) return;
    splashHiddenRef.current = true;
    void SplashScreen.hideAsync().catch(() => undefined);
  };

  const controllerRef = useRef<ReturnType<typeof createAppStartupController> | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createAppStartupController({
      getState: () => startupRef.current,
      setState: (partial) => setStartup((prev) => ({ ...prev, ...partial })),
      steps: {
        openLocalDatabase: async () => {
          await getRxDatabase();
        },
        restoreSession: async () => {
          await useAuthStore.getState().hydrate();
        },
        loadLocalStores: async () => {
          const settings = useSettingsStore.getState().load;
          const categories = useCategoryStore.getState().load;
          const accounts = useAccountStore.getState().load;
          const investments = useInvestmentStore.getState().load;
          const sync = useSyncStore.getState().hydrate;
          await Promise.all([settings(), categories(), accounts(), investments(), sync()]);
          await recurringService.processDue();
        },
        prepareDashboard: async () => {
          const generation = startupRef.current.generation;
          const authUser = useAuthStore.getState().user;
          const userKey = dashboardUserKey(authUser?.id ?? null);
          const period = currentMonthYear();
          const snapshot = await loadHomeDashboardSnapshot({
            userKey,
            month: period.month,
            year: period.year,
            loadBudgets: () => useBudgetStore.getState().load(),
          });
          if (startupRef.current.generation !== generation) return;
          setDashboardSeed(snapshot);
        },
        afterReady: () => {
          const currentUser = useAuthStore.getState().user;
          if (!currentUser) return;
          const loadCategories = useCategoryStore.getState().load;
          const loadAccounts = useAccountStore.getState().load;
          const loadInvestments = useInvestmentStore.getState().load;
          void syncService.startRealtime(currentUser.id, () => {
            bumpFinanceRevision();
            void loadCategories();
            void loadAccounts();
            void loadInvestments();
          });
          void useSyncStore.getState().syncNow();
        },
      },
    });
  }
  const controller = controllerRef.current;

  useEffect(() => {
    void controller.start();
    return () => {
      syncService.stopRealtime();
      clearDashboardSeed();
    };
  }, [controller]);

  useEffect(() => {
    if (startup.phase === 'ready' || startup.phase === 'recoverable-error') hideSplash();
  }, [startup.phase]);

  useEffect(() => {
    if (startup.phase !== 'ready') return;
    const loadCategories = useCategoryStore.getState().load;
    const loadAccounts = useAccountStore.getState().load;
    const loadInvestments = useInvestmentStore.getState().load;
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
      clearDashboardSeed();
      void loadCategories();
      void loadAccounts();
      void loadInvestments();
    }
    seenUserIdRef.current = user.id;
  }, [startup.phase, user]);

  if (startup.phase === 'recoverable-error') {
    return (
      <ErrorState
        message={startup.error ?? 'SpendWise could not start. Please try again.'}
        onRetry={() => void controller.retry()}
      />
    );
  }

  if (startup.phase !== 'ready') {
    return (
      <StartupScreen phase={startup.phase} message={startup.message} onReady={hideSplash} />
    );
  }

  return <RootNavigation />;
}

function RootNavigation() {
  const { colors, isDark } = useTheme();
  const { isDesktop } = useBreakpoint();
  const pathname = usePathname();

  useEffect(() => {
    const timer = setTimeout(() => {
      void appUpdateController.check('launch');
    }, LAUNCH_UPDATE_SETTLE_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void appUpdateController.check('foreground');
      }
    });
    return () => sub.remove();
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
      <UpdateReadyModal />
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
