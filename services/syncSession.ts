import { getCurrentUserId } from '@/database/session';

/** The account a sync pipeline started for. Every user-scoped write checks it is still current. */
export interface SyncContext {
  readonly userId: string;
}

/** Thrown when the signed-in account changed (or signed out) while a pipeline was running. */
export class SyncSessionChangedError extends Error {
  constructor() {
    super('The signed-in account changed during sync.');
    this.name = 'SyncSessionChangedError';
  }
}

export function captureSyncContext(): SyncContext | null {
  const userId = getCurrentUserId();
  return userId ? { userId } : null;
}

export function isSyncSessionActive(context: SyncContext): boolean {
  return getCurrentUserId() === context.userId;
}

export function assertSyncSession(context: SyncContext): void {
  if (!isSyncSessionActive(context)) throw new SyncSessionChangedError();
}
