import { getRxDatabase } from '@/database';
import { DEFAULT_CURRENCY } from '@/constants/currencies';
import type { AppSettings, SettingsUpdate } from '@/types';
import { SETTINGS_ID } from '@/utils/constants';
import { DEFAULT_ACCENT_COLOR, DEFAULT_ACCENT_PRESET } from '@/utils/accent';
import { mapSettings } from './mappers';

const DEFAULT_SETTINGS: AppSettings = {
  id: SETTINGS_ID,
  currency: DEFAULT_CURRENCY.code,
  currencySymbol: DEFAULT_CURRENCY.symbol,
  theme: 'system',
  accentPreset: DEFAULT_ACCENT_PRESET,
  accentColor: DEFAULT_ACCENT_COLOR,
  firstDayOfWeek: 1,
  monthlyBudget: null,
  onboardingComplete: false,
  aiCloudEnabled: false,
  aiConsentPolicyVersion: 0,
  aiConsentAcceptedAt: null,
};

function toDoc(next: AppSettings) {
  return {
    id: next.id,
    currency: next.currency,
    currencySymbol: next.currencySymbol,
    theme: next.theme,
    accentPreset: next.accentPreset,
    accentColor: next.accentColor,
    firstDayOfWeek: next.firstDayOfWeek,
    monthlyBudget: next.monthlyBudget ?? 0,
    onboardingComplete: next.onboardingComplete,
    aiCloudEnabled: Boolean(next.aiCloudEnabled),
    aiConsentPolicyVersion: next.aiConsentPolicyVersion ?? 0,
    aiConsentAcceptedAt: next.aiConsentAcceptedAt ?? '',
  };
}

export const settingsRepository = {
  async get(): Promise<AppSettings> {
    const db = await getRxDatabase();
    const row = await db.settings.findOne(SETTINGS_ID).exec();
    if (!row) return DEFAULT_SETTINGS;
    const json = row.toMutableJSON();
    return mapSettings({
      ...json,
      monthlyBudget: json.monthlyBudget || null,
      aiCloudEnabled: Boolean(json.aiCloudEnabled),
      aiConsentPolicyVersion:
        typeof json.aiConsentPolicyVersion === 'number' ? json.aiConsentPolicyVersion : 0,
      aiConsentAcceptedAt: json.aiConsentAcceptedAt || null,
    });
  },

  async update(update: SettingsUpdate): Promise<AppSettings> {
    const current = await this.get();
    const next: AppSettings = { ...current, ...update };
    const db = await getRxDatabase();
    await db.settings.upsert(toDoc(next));
    return next;
  },

  async replace(settings: AppSettings): Promise<void> {
    await this.update(settings);
  },
};
