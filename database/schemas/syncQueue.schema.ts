import type { RxJsonSchema } from 'rxdb';
import { isoDate, stringId } from './common';
import type { SyncQueueDoc } from '@/database/types';

export const syncQueueSchema: RxJsonSchema<SyncQueueDoc> = {
  title: 'sync_queue',
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: stringId,
    userId: stringId,
    entityType: { type: 'string', maxLength: 40 },
    entityId: stringId,
    operation: { type: 'string', maxLength: 20 },
    payload: { type: 'string', maxLength: 20000 },
    createdAt: isoDate,
    retryCount: { type: 'integer', minimum: 0, maximum: 100, multipleOf: 1 },
    lastError: { type: 'string', maxLength: 1000 },
  },
  required: ['id', 'userId', 'entityType', 'entityId', 'operation', 'payload', 'createdAt', 'retryCount', 'lastError'],
  indexes: ['userId', 'createdAt', 'entityType', 'entityId', ['userId', 'createdAt']],
};
