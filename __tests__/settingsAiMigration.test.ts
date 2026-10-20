/// <reference types="jest" />

let mockIdCounter = 0;
jest.mock('@/utils/id', () => ({ createId: () => `id-${(mockIdCounter += 1)}` }));

import { migrateSettingsToV2 } from '@/database/migrations/settingsMigrations';
import { settingsRepository } from '@/database/repositories/settingsRepository';
import { resetDatabaseConnection } from '@/database/database';
import { getRxDatabase } from '@/database';
import { SETTINGS_ID } from '@/utils/constants';
import { BACKUP_VERSION } from '@/utils/constants';
import { safeValidateBackup } from '@/utils/validation';

describe('settings AI consent migration (v2)', () => {
  it('defaults existing users to disabled and never auto-enables', () => {
    const migrated = migrateSettingsToV2({
      id: 'default',
      currency: 'INR',
      currencySymbol: '₹',
      theme: 'system',
      accentPreset: 'emerald',
      accentColor: '#0E7C66',
      firstDayOfWeek: 1,
      monthlyBudget: 0,
      onboardingComplete: true,
      aiCloudEnabled: true,
      aiConsentPolicyVersion: 99,
      aiConsentAcceptedAt: '2020-01-01T00:00:00.000Z',
    });
    expect(migrated.aiCloudEnabled).toBe(false);
    expect(migrated.aiConsentPolicyVersion).toBe(0);
    expect(migrated.aiConsentAcceptedAt).toBe('');
  });

  it('preserves unrelated settings fields', () => {
    const migrated = migrateSettingsToV2({
      id: 'default',
      currency: 'USD',
      currencySymbol: '$',
      theme: 'dark',
      accentPreset: 'ocean',
      accentColor: '#123456',
      firstDayOfWeek: 0,
      monthlyBudget: 100,
      onboardingComplete: true,
    });
    expect(migrated.currency).toBe('USD');
    expect(migrated.theme).toBe('dark');
    expect(migrated.onboardingComplete).toBe(true);
    expect(migrated.aiCloudEnabled).toBe(false);
  });
});

describe('settings repository AI consent defaults', () => {
  beforeEach(async () => {
    mockIdCounter = 0;
    await resetDatabaseConnection();
  });
  afterEach(async () => {
    await resetDatabaseConnection();
  });

  it('defaults to disabled when reading seeded settings', async () => {
    const settings = await settingsRepository.get();
    expect(settings.aiCloudEnabled).toBe(false);
    expect(settings.aiConsentPolicyVersion).toBe(0);
    expect(settings.aiConsentAcceptedAt).toBeNull();
  });

  it('seed insert stores disabled AI consent', async () => {
    const db = await getRxDatabase();
    const row = await db.settings.findOne(SETTINGS_ID).exec();
    expect(row).toBeTruthy();
    const json = row!.toMutableJSON();
    expect(json.aiCloudEnabled).toBe(false);
    expect(json.aiConsentPolicyVersion).toBe(0);
  });
});

describe('backup restore never silently enables AI', () => {
  it('defaults missing AI fields to disabled', () => {
    const parsed = safeValidateBackup({
      version: BACKUP_VERSION,
      exportedAt: '2026-10-18T00:00:00.000Z',
      transactions: [],
      categories: [
        {
          id: 'c1',
          name: 'Food',
          icon: 'fast-food',
          color: '#000',
          type: 'expense',
          isDefault: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      budgets: [],
      recurringTransactions: [],
      settings: {
        id: 'default',
        currency: 'INR',
        currencySymbol: '₹',
        theme: 'system',
        firstDayOfWeek: 1,
        monthlyBudget: null,
        onboardingComplete: true,
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.settings.aiCloudEnabled).toBe(false);
      expect(parsed.data.settings.aiConsentPolicyVersion).toBe(0);
    }
  });
});
