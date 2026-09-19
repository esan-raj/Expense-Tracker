import type { ReloadDecision, UpdateCheckSource, UpdateEnvironment } from './types';

const NETWORK_HINT = /network|offline|internet|failed to fetch|timeout|timed out|unreachable|econnreset|enotfound/i;

export function resolveUpdateEnvironment(input: {
  os: string;
  isDev: boolean;
  appOwnership: string | null | undefined;
  updatesEnabled: boolean;
}): UpdateEnvironment {
  if (input.os === 'web') return 'web';
  if (input.appOwnership === 'expo') return 'expo-go';
  if (input.isDev) return 'development';
  if (!input.updatesEnabled) return 'disabled';
  return 'standalone';
}

export function shouldAutoCheck(environment: UpdateEnvironment): boolean {
  return environment === 'standalone';
}

export function unsupportedMessage(environment: UpdateEnvironment): string {
  switch (environment) {
    case 'web':
      return 'Over-the-air updates are for installed Android APKs, not the web app.';
    case 'expo-go':
      return 'Expo Go cannot receive SpendWise APK updates. Install a preview or production APK.';
    case 'development':
      return 'Development sessions load from Metro. Use a release APK to check EAS Update.';
    case 'disabled':
      return 'Updates are disabled in this build.';
    default:
      return 'This environment does not support over-the-air updates.';
  }
}

export function isNetworkFailure(error: unknown): boolean {
  if (!error) return false;
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return NETWORK_HINT.test(text);
}

export function checkFailureMessage(error: unknown, source: UpdateCheckSource): string {
  if (isNetworkFailure(error)) {
    return source === 'manual'
      ? 'Could not reach the update service. You can keep using SpendWise offline.'
      : 'Update check skipped because the device is offline.';
  }
  const detail = error instanceof Error && error.message ? error.message : 'Please try again.';
  return source === 'manual'
    ? `Could not check for updates. ${detail}`
    : 'Could not check for updates in the background.';
}

export function decideReload(input: {
  criticalWork: boolean;
  flushSucceeded: boolean;
}): ReloadDecision {
  if (input.criticalWork) {
    return {
      ok: false,
      reason: 'critical-work',
      message: 'Finish the current edit, import, or restore before restarting.',
    };
  }
  if (!input.flushSucceeded) {
    return {
      ok: false,
      reason: 'flush-failed',
      message: 'SpendWise could not finish saving local data. Stay in the app and retry.',
    };
  }
  return { ok: true };
}

export function createUpdateCheckGate() {
  let inFlight: Promise<unknown> | null = null;

  return {
    isRunning(): boolean {
      return inFlight !== null;
    },
    run<T>(execute: () => Promise<T>): Promise<T> {
      if (inFlight) return inFlight as Promise<T>;
      const pending = execute().finally(() => {
        if (inFlight === pending) inFlight = null;
      });
      inFlight = pending;
      return pending;
    },
    reset() {
      inFlight = null;
    },
  };
}
