import type { RxJsonSchema } from 'rxdb';
import { isoDate, optionalString, stringId } from './common';
import type { InvestmentDoc } from '@/database/types';

export const investmentSchema: RxJsonSchema<InvestmentDoc> = {
  title: 'investments',
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: stringId,
    userId: stringId,
    name: { type: 'string', maxLength: 120 },
    type: { type: 'string', maxLength: 40 },
    investedAmount: { type: 'integer', minimum: 1, maximum: 9007199254740991, multipleOf: 1 },
    currentValue: { type: 'integer', minimum: 0, maximum: 9007199254740991, multipleOf: 1 },
    investmentDate: { type: 'string', maxLength: 20 },
    accountId: stringId,
    notes: optionalString,
    createdAt: isoDate,
    updatedAt: isoDate,
    deletedAt: isoDate,
  },
  required: [
    'id',
    'userId',
    'name',
    'type',
    'investedAmount',
    'currentValue',
    'investmentDate',
    'accountId',
    'notes',
    'createdAt',
    'updatedAt',
    'deletedAt',
  ],
  indexes: ['userId', 'deletedAt', 'type', 'investmentDate'],
};
