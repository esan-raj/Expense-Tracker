export type SyncEntityType =
  | 'transaction'
  | 'category'
  | 'budget'
  | 'recurring'
  | 'profile'
  | 'account';

export type SyncOperation = 'create' | 'update' | 'delete';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

export interface SyncQueueItem {
  id: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  payload: string;
  createdAt: string;
  retryCount: number;
  lastError: string | null;
}

export interface SyncState {
  userId: string | null;
  lastSyncedAt: string | null;
  status: SyncStatus;
  lastError: string | null;
  pendingCount: number;
}

export interface ConflictInput {
  localUpdatedAt: string;
  remoteUpdatedAt: string;
  localDeletedAt?: string | null;
  remoteDeletedAt?: string | null;
}

export type ConflictWinner = 'local' | 'remote' | 'equal';
