import { syncQueueRepository } from '@/database/repositories/syncQueueRepository';
import { getCurrentUserId } from '@/database/session';
import { bumpFinanceRevision } from '@/services/financeRevision';
import { syncGate } from '@/services/syncSingleFlight';
import type { SyncEntityType, SyncOperation } from '@/types/sync';

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
  syncGate.requestFollowUp('full');
}
