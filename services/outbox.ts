import { syncQueueRepository } from '@/database/repositories/syncQueueRepository';
import { getCurrentUserId } from '@/database/session';
import { bumpFinanceRevision } from '@/services/financeRevision';
import { syncGate } from '@/services/syncSingleFlight';
import type { SyncEntityType, SyncOperation } from '@/types/sync';

/** Batches bursts of writes (transfer legs, bulk edits) into one push. */
export const LOCAL_CHANGE_PUSH_DELAY_MS = 1000;

let localChangeHandler: (() => void) | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

export function setLocalChangeHandler(handler: (() => void) | null): void {
  localChangeHandler = handler;
  if (!handler && pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
}

function schedulePush(): void {
  if (syncGate.isRunning()) {
    syncGate.requestFollowUp('full');
    return;
  }
  if (!localChangeHandler) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    localChangeHandler?.();
  }, LOCAL_CHANGE_PUSH_DELAY_MS);
}

export async function queueChange(
  entityType: SyncEntityType,
  entityId: string,
  operation: SyncOperation,
  payload: unknown
): Promise<void> {
  bumpFinanceRevision();
  if (!getCurrentUserId()) {
    return;
  }
  await syncQueueRepository.enqueue(entityType, entityId, operation, payload);
  schedulePush();
}
