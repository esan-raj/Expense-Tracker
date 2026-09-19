export type UpdateEnvironment = 'standalone' | 'expo-go' | 'development' | 'web' | 'disabled';

export type UpdateCheckStatus =
  | 'idle'
  | 'unsupported'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'unavailable'
  | 'error';

export type UpdateCheckSource = 'launch' | 'manual';

export interface AppUpdateInfo {
  appVersion: string;
  nativeApplicationVersion: string | null;
  nativeBuildVersion: string | null;
  channel: string | null;
  runtimeVersion: string | null;
  updateId: string | null;
  createdAt: string | null;
  isEmbeddedLaunch: boolean;
  isEmergencyLaunch: boolean;
}

export interface UpdateCheckRequest {
  isAvailable: boolean;
  isRollBackToEmbedded: boolean;
}

export interface UpdateFetchResult {
  isNew: boolean;
  isRollBackToEmbedded: boolean;
}

export interface UpdatesAdapter {
  isEnabled: boolean;
  environment: UpdateEnvironment;
  getInfo: () => AppUpdateInfo;
  checkForUpdate: () => Promise<UpdateCheckRequest>;
  fetchUpdate: () => Promise<UpdateFetchResult>;
  reload: () => Promise<void>;
}

export interface AppUpdateState {
  status: UpdateCheckStatus;
  message: string;
  bannerVisible: boolean;
  lastError: string | null;
  info: AppUpdateInfo;
  environment: UpdateEnvironment;
}

export type ReloadBlockReason = 'critical-work' | 'flush-failed';

export type ReloadDecision =
  | { ok: true }
  | { ok: false; reason: ReloadBlockReason; message: string };
