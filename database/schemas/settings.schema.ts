import type { RxJsonSchema } from 'rxdb';
import { stringId } from './common';
import type { SettingsDoc } from '@/database/types';

export const settingsSchema: RxJsonSchema<SettingsDoc> = {
  title: 'settings',
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: stringId,
    currency: { type: 'string', maxLength: 10 },
    currencySymbol: { type: 'string', maxLength: 8 },
    theme: { type: 'string', maxLength: 20 },
    firstDayOfWeek: { type: 'integer', minimum: 0, maximum: 6, multipleOf: 1 },
    monthlyBudget: { type: 'integer', minimum: 0, maximum: 9007199254740991, multipleOf: 1 },
    onboardingComplete: { type: 'boolean' },
  },
  required: ['id', 'currency', 'currencySymbol', 'theme', 'firstDayOfWeek', 'monthlyBudget', 'onboardingComplete'],
};
