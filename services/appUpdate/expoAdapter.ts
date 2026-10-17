import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { APP_VERSION } from '@/utils/constants';
import { resolveUpdateEnvironment } from './logic';
import type { AppUpdateInfo, UpdatesAdapter } from './types';

function readOwnership(): string | null {
  const constants = Constants as typeof Constants & { appOwnership?: string | null };
  return constants.appOwnership ?? null;
}

function readInfo(): AppUpdateInfo {
  const expoConfig = Constants.expoConfig;
  return {
    appVersion: expoConfig?.version ?? APP_VERSION,
    nativeApplicationVersion: Constants.nativeApplicationVersion ?? expoConfig?.version ?? APP_VERSION,
    nativeBuildVersion: Constants.nativeBuildVersion ?? null,
    channel: Updates.channel ?? null,
    runtimeVersion: Updates.runtimeVersion ?? null,
    updateId: Updates.updateId ?? null,
    createdAt: Updates.createdAt ? Updates.createdAt.toISOString() : null,
    isEmbeddedLaunch: Boolean(Updates.isEmbeddedLaunch),
    isEmergencyLaunch: Boolean(Updates.isEmergencyLaunch),
  };
}

export function createExpoUpdatesAdapter(): UpdatesAdapter {
  const environment = resolveUpdateEnvironment({
    os: Platform.OS,
    isDev: typeof __DEV__ !== 'undefined' && Boolean(__DEV__),
    appOwnership: readOwnership(),
    updatesEnabled: Boolean(Updates.isEnabled),
  });

  return {
    isEnabled: Boolean(Updates.isEnabled),
    environment,
    getInfo: readInfo,
    checkForUpdate: async () => {
      const result = await Updates.checkForUpdateAsync();
      return {
        isAvailable: Boolean(result.isAvailable),
        isRollBackToEmbedded: Boolean(result.isRollBackToEmbedded),
      };
    },
    fetchUpdate: async () => {
      const result = await Updates.fetchUpdateAsync();
      return {
        isNew: Boolean(result.isNew),
        isRollBackToEmbedded: Boolean(result.isRollBackToEmbedded),
      };
    },
    reload: () => Updates.reloadAsync(),
  };
}
