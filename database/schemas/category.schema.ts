import type { RxJsonSchema } from 'rxdb';
import { isoDate, stringId } from './common';
import type { CategoryDoc } from '@/database/types';

export const categorySchema: RxJsonSchema<CategoryDoc> = {
  title: 'categories',
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: stringId,
    userId: stringId,
    name: { type: 'string', maxLength: 120 },
    icon: { type: 'string', maxLength: 80 },
    color: { type: 'string', maxLength: 20 },
    type: { type: 'string', maxLength: 20 },
    isDefault: { type: 'boolean' },
    createdAt: isoDate,
    updatedAt: isoDate,
    deletedAt: isoDate,
  },
  required: ['id', 'userId', 'name', 'icon', 'color', 'type', 'isDefault', 'createdAt', 'updatedAt', 'deletedAt'],
  indexes: ['userId', 'deletedAt', 'type'],
};
