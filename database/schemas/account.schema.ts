import type { RxJsonSchema } from 'rxdb';
import { isoDate, optionalString, stringId } from './common';
import type { AccountDoc } from '@/database/types';

export const accountSchema: RxJsonSchema<AccountDoc> = {
  title: 'accounts',
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: stringId,
    userId: stringId,
    name: { type: 'string', maxLength: 120 },
    type: { type: 'string', maxLength: 40 },
    institutionName: optionalString,
    currency: { type: 'string', maxLength: 10 },
    openingBalance: { type: 'integer', minimum: -9007199254740991, maximum: 9007199254740991, multipleOf: 1 },
    creditLimit: { type: 'integer', minimum: 0, maximum: 9007199254740991, multipleOf: 1 },
    isActive: { type: 'boolean' },
    createdAt: isoDate,
    updatedAt: isoDate,
    deletedAt: isoDate,
  },
  required: [
    'id',
    'userId',
    'name',
    'type',
    'institutionName',
    'currency',
    'openingBalance',
    'creditLimit',
    'isActive',
    'createdAt',
    'updatedAt',
    'deletedAt',
  ],
  indexes: ['userId', 'deletedAt', 'type'],
};
