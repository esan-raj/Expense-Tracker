import { APP_VERSION } from '@/utils/constants';
import {
  checkFailureMessage,
  createAutoCheckCooldown,
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
    promptVisible: false,
    lastError: null,
    lastCheckedAt: null,
    info: adapter?.getInfo() ?? EMPTY_INFO,
    environment,
  };
}

export function createAppUpdateController(deps: AppUpdateControllerDeps) {
  const gate = createUpdateCheckGate();
  const cooldown = createAutoCheckCooldown();
  let reloadInFlight = false;
  let promptSuppressedThisSession = false;

  function syncInfo(partial: Partial<AppUpdateState> = {}) {
    deps.setState({
      environment: deps.adapter.environment,
      info: deps.adapter.getInfo(),
      ...partial,
    });
  }

  async function performDownload(): Promise<AppUpdateState> {
    const previous = deps.getState();
    syncInfo({
      status: 'downloading',
      message: 'Downloading update…',
      lastError: null,
    });
    try {
      const fetched = await deps.adapter.fetchUpdate();
      if (!fetched.isNew && !fetched.isRollBackToEmbedded) {
        syncInfo({
          status: previous.status === 'ready' ? 'ready' : 'unavailable',
          message:
            previous.status === 'ready'
              ? 'An update is already downloaded. Restart when you are ready.'
              : 'No compatible update could be downloaded for this runtime.',
          bannerVisible: previous.status === 'ready' ? previous.bannerVisible : false,
          promptVisible: previous.status === 'ready' ? previous.promptVisible : false,
          lastError:
            previous.status === 'ready' ? null : 'No compatible update could be downloaded for this runtime.',
        });
        return deps.getState();
      }
      const showPrompt = !promptSuppressedThisSession;
      syncInfo({
        status: 'ready',
        message: 'Update ready. Restart to apply it. Unsynced changes stay queued on this device.',
        bannerVisible: true,
        promptVisible: showPrompt,
        lastError: null,
      });
      return deps.getState();
    } catch (error) {
      const message = checkFailureMessage(error, 'manual');
      const keepReady = previous.status === 'ready';
      syncInfo({
        status: keepReady ? 'ready' : 'error',
        message: keepReady ? previous.message : message,
        lastError: message,
        bannerVisible: keepReady ? previous.bannerVisible : false,
        promptVisible: keepReady ? previous.promptVisible : false,
      });
      return deps.getState();
    }
  }

  async function performCheck(source: UpdateCheckSource): Promise<AppUpdateState> {
    const environment = deps.adapter.environment;
    if (!shouldAutoCheck(environment)) {
      syncInfo({
        status: 'unsupported',
        message: unsupportedMessage(environment),
        lastError: null,
        bannerVisible: false,
        promptVisible: false,
      });
      return deps.getState();
    }

    if (!cooldown.allow(source)) {
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
      const checkedAt = new Date().toISOString();
      const alreadyReady = previous.status === 'ready';

      if (!result.isAvailable && !result.isRollBackToEmbedded) {
        syncInfo({
          status: alreadyReady ? 'ready' : 'unavailable',
          message: alreadyReady
            ? 'An update is already downloaded. Restart when you are ready.'
            : 'You are on the latest compatible update.',
          bannerVisible: alreadyReady ? previous.bannerVisible : false,
          promptVisible: alreadyReady ? previous.promptVisible : false,
          lastError: null,
          lastCheckedAt: checkedAt,
        });
        return deps.getState();
      }

      // Launch/foreground: download in the background. Manual: wait for explicit download.
      if (source === 'manual') {
        syncInfo({
          status: 'available',
          message: 'Update available. Download when you are ready.',
          lastError: null,
          lastCheckedAt: checkedAt,
          bannerVisible: false,
          promptVisible: false,
        });
        return deps.getState();
      }

      syncInfo({ lastCheckedAt: checkedAt });
      return performDownload();
    } catch (error) {
      const message = checkFailureMessage(error, source);
      const keepReady = previous.status === 'ready';
      syncInfo({
        status: keepReady ? 'ready' : source === 'manual' ? 'error' : 'idle',
        message: keepReady ? previous.message : message,
        lastError: message,
        bannerVisible: keepReady ? previous.bannerVisible : false,
        promptVisible: keepReady ? previous.promptVisible : false,
        lastCheckedAt: source === 'manual' ? new Date().toISOString() : previous.lastCheckedAt,
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
    async download(): Promise<AppUpdateState> {
      return gate.run(() => performDownload());
    },
    dismissBanner() {
      promptSuppressedThisSession = true;
      deps.setState({ bannerVisible: false, promptVisible: false });
    },
    dismissPrompt() {
      promptSuppressedThisSession = true;
      deps.setState({ promptVisible: false });
    },
    async apply(): Promise<ReloadDecision> {
      if (reloadInFlight) {
        return {
          ok: false,
          reason: 'critical-work',
          message: 'A restart is already in progress.',
        };
      }

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
      reloadInFlight = true;
      try {
        await deps.adapter.reload();
        return decision;
      } catch (error) {
        reloadInFlight = false;
        throw error;
      }
    },
    reset() {
      gate.reset();
      cooldown.reset();
      reloadInFlight = false;
      promptSuppressedThisSession = false;
      deps.setState(createInitialAppUpdateState(deps.adapter));
    },
  };
}
