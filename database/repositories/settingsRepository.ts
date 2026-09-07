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
};

export const settingsRepository = {
  async get(): Promise<AppSettings> {
    const db = await getRxDatabase();
    const row = await db.settings.findOne(SETTINGS_ID).exec();
    if (!row) return DEFAULT_SETTINGS;
    const json = row.toMutableJSON();
    return mapSettings({
      ...json,
      monthlyBudget: json.monthlyBudget || null,
    });
  },

  async update(update: SettingsUpdate): Promise<AppSettings> {
    const current = await this.get();
    const next: AppSettings = { ...current, ...update };
    const db = await getRxDatabase();
    await db.settings.upsert({
      id: next.id,
      currency: next.currency,
      currencySymbol: next.currencySymbol,
      theme: next.theme,
      accentPreset: next.accentPreset,
      accentColor: next.accentColor,
      firstDayOfWeek: next.firstDayOfWeek,
      monthlyBudget: next.monthlyBudget ?? 0,
      onboardingComplete: next.onboardingComplete,
    });
    return next;
  },

  async replace(settings: AppSettings): Promise<void> {
    await this.update(settings);
  },
};
