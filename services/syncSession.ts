import { getCurrentUserId, getSessionGeneration } from '@/database/session';

/**
 * The session a sync pipeline started for. Every user-scoped write checks it is still current:
 * the same account and the same sign-in, so signing out and back in also invalidates it.
 */
export interface SyncContext {
  readonly userId: string;
  readonly generation: number;
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
  return userId ? { userId, generation: getSessionGeneration() } : null;
}

export function isSyncSessionActive(context: SyncContext): boolean {
  return getCurrentUserId() === context.userId && getSessionGeneration() === context.generation;
}

export function assertSyncSession(context: SyncContext): void {
  if (!isSyncSessionActive(context)) throw new SyncSessionChangedError();
}
