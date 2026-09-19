import { APP_VERSION } from '@/utils/constants';
import {
  checkFailureMessage,
  createUpdateCheckGate,
  decideReload,
  shouldAutoCheck,
  unsupportedMessage,
} from './logic';
import type {
  AppUpdateInfo,
  AppUpdateState,
  ReloadDecision,
  UpdateCheckSource,
  UpdatesAdapter,
} from './types';

export interface AppUpdateControllerDeps {
  adapter: UpdatesAdapter;
  flush: () => Promise<void>;
  isCriticalWork: () => boolean;
  setState: (partial: Partial<AppUpdateState>) => void;
  getState: () => AppUpdateState;
}

const EMPTY_INFO: AppUpdateInfo = {
  appVersion: APP_VERSION,
  nativeApplicationVersion: null,
  nativeBuildVersion: null,
  channel: null,
  runtimeVersion: null,
  updateId: null,
  createdAt: null,
  isEmbeddedLaunch: true,
  isEmergencyLaunch: false,
};

export function createInitialAppUpdateState(adapter?: UpdatesAdapter): AppUpdateState {
  const environment = adapter?.environment ?? 'disabled';
  return {
    status: shouldAutoCheck(environment) ? 'idle' : 'unsupported',
    message: shouldAutoCheck(environment) ? 'No update check has run yet.' : unsupportedMessage(environment),
    bannerVisible: false,
    lastError: null,
    info: adapter?.getInfo() ?? EMPTY_INFO,
    environment,
  };
}

export function createAppUpdateController(deps: AppUpdateControllerDeps) {
  const gate = createUpdateCheckGate();

  function syncInfo(partial: Partial<AppUpdateState> = {}) {
    deps.setState({
      environment: deps.adapter.environment,
      info: deps.adapter.getInfo(),
      ...partial,
    });
  }

  async function performCheck(source: UpdateCheckSource): Promise<AppUpdateState> {
    const environment = deps.adapter.environment;
    if (!shouldAutoCheck(environment)) {
      syncInfo({
        status: 'unsupported',
        message: unsupportedMessage(environment),
        lastError: null,
        bannerVisible: false,
      });
      return deps.getState();
    }

    const previous = deps.getState();
    syncInfo({
      status: 'checking',
      message: 'Checking for updates…',
      lastError: source === 'manual' ? null : previous.lastError,
    });

    try {
      const result = await deps.adapter.checkForUpdate();
      const alreadyReady = previous.status === 'ready';
      if (!result.isAvailable && !result.isRollBackToEmbedded) {
        syncInfo({
          status: alreadyReady ? 'ready' : 'unavailable',
          message: alreadyReady
            ? 'An update is already downloaded. Restart when you are ready.'
            : 'You are on the latest compatible update.',
          bannerVisible: alreadyReady ? previous.bannerVisible : false,
          lastError: null,
        });
        return deps.getState();
      }

      syncInfo({
        status: 'downloading',
        message: 'Downloading update…',
        lastError: null,
      });
      const fetched = await deps.adapter.fetchUpdate();
      if (!fetched.isNew && !fetched.isRollBackToEmbedded) {
        syncInfo({
          status: alreadyReady ? 'ready' : 'unavailable',
          message: alreadyReady
            ? 'An update is already downloaded. Restart when you are ready.'
            : 'No compatible update could be downloaded for this runtime.',
          bannerVisible: alreadyReady ? previous.bannerVisible : false,
          lastError: alreadyReady ? null : 'No compatible update could be downloaded for this runtime.',
        });
        return deps.getState();
      }
      syncInfo({
        status: 'ready',
        message: 'Update ready. Restart to apply it. Unsynced changes stay queued on this device.',
        bannerVisible: true,
        lastError: null,
      });
      return deps.getState();
    } catch (error) {
      const message = checkFailureMessage(error, source);
      const keepReady = previous.status === 'ready';
      syncInfo({
        status: keepReady ? 'ready' : source === 'manual' ? 'error' : 'idle',
        message: keepReady ? previous.message : message,
        lastError: message,
        bannerVisible: keepReady ? previous.bannerVisible : false,
      });
      return deps.getState();
    }
  }

  return {
    isChecking(): boolean {
      return gate.isRunning();
    },
    async check(source: UpdateCheckSource = 'manual'): Promise<AppUpdateState> {
      return gate.run(() => performCheck(source));
    },
    dismissBanner() {
      deps.setState({ bannerVisible: false });
    },
    async apply(): Promise<ReloadDecision> {
      if (deps.isCriticalWork()) {
        const decision = decideReload({ criticalWork: true, flushSucceeded: true });
        if (!decision.ok) deps.setState({ lastError: decision.message });
        return decision;
      }

      try {
        await deps.flush();
      } catch {
        const decision = decideReload({ criticalWork: false, flushSucceeded: false });
        if (!decision.ok) deps.setState({ lastError: decision.message, message: decision.message });
        return decision;
      }

      const decision = decideReload({ criticalWork: false, flushSucceeded: true });
      await deps.adapter.reload();
      return decision;
    },
    reset() {
      gate.reset();
      deps.setState(createInitialAppUpdateState(deps.adapter));
    },
  };
}
