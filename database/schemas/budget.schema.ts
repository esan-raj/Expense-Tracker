import type { RxJsonSchema } from 'rxdb';
import { isoDate, stringId } from './common';
import type { BudgetDoc } from '@/database/types';

export const budgetSchema: RxJsonSchema<BudgetDoc> = {
  title: 'budgets',
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: stringId,
    userId: stringId,
    categoryId: stringId,
    amount: { type: 'integer', minimum: 1, maximum: 9007199254740991, multipleOf: 1 },
    month: { type: 'integer', minimum: 1, maximum: 12, multipleOf: 1 },
    year: { type: 'integer', minimum: 2000, maximum: 2100, multipleOf: 1 },
    createdAt: isoDate,
    updatedAt: isoDate,
    deletedAt: isoDate,
  },
  required: ['id', 'userId', 'categoryId', 'amount', 'month', 'year', 'createdAt', 'updatedAt', 'deletedAt'],
  indexes: ['userId', 'deletedAt', 'year', 'month', 'categoryId'],
};
