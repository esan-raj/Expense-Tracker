import type { RxJsonSchema } from 'rxdb';
import { isoDate, stringId } from './common';
import type { SyncStateDoc } from '@/database/types';

export const syncStateSchema: RxJsonSchema<SyncStateDoc> = {
  title: 'sync_state',
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: stringId,
    userId: stringId,
    lastSyncedAt: isoDate,
    status: { type: 'string', maxLength: 40 },
    lastError: { type: 'string', maxLength: 1000 },
  },
  required: ['id', 'userId', 'lastSyncedAt', 'status', 'lastError'],
};
