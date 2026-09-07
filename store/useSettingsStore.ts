import { create } from 'zustand';
import { settingsRepository } from '@/database/repositories/settingsRepository';
import { queueChange } from '@/services/outbox';
import { getCurrentUserId } from '@/database/session';
import { getCurrency } from '@/constants/currencies';
import type { AppSettings, AccentPreset, CurrencyCode, SettingsUpdate, ThemePreference } from '@/types';
import { DEFAULT_CURRENCY } from '@/constants/currencies';
import { ACCENT_PRESETS, DEFAULT_ACCENT_COLOR, DEFAULT_ACCENT_PRESET, normalizeHex } from '@/utils/accent';

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (update: SettingsUpdate) => Promise<void>;
  setCurrency: (code: CurrencyCode) => Promise<void>;
  setTheme: (theme: ThemePreference) => Promise<void>;
  setAccent: (preset: AccentPreset, customHex?: string) => Promise<void>;
}

const fallback: AppSettings = {
  id: 'default',
  currency: DEFAULT_CURRENCY.code,
  currencySymbol: DEFAULT_CURRENCY.symbol,
  theme: 'system',
  accentPreset: DEFAULT_ACCENT_PRESET,
  accentColor: DEFAULT_ACCENT_COLOR,
  firstDayOfWeek: 1,
  monthlyBudget: null,
  onboardingComplete: false,
};

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: fallback,
  loaded: false,
  load: async () => {
    const settings = await settingsRepository.get();
    set({ settings, loaded: true });
  },
  update: async (update) => {
    const settings = await settingsRepository.update(update);
    const userId = getCurrentUserId();
    if (userId) {
      await queueChange('profile', userId, 'update', settings);
    }
    set({ settings, loaded: true });
  },
  setCurrency: async (code) => {
    const currency = getCurrency(code);
    const settings = await settingsRepository.update({
      currency: currency.code,
      currencySymbol: currency.symbol,
    });
    const userId = getCurrentUserId();
    if (userId) await queueChange('profile', userId, 'update', settings);
    set({ settings });
  },
  setTheme: async (theme) => {
    const settings = await settingsRepository.update({ theme });
    const userId = getCurrentUserId();
    if (userId) await queueChange('profile', userId, 'update', settings);
    set({ settings });
  },
  setAccent: async (preset, customHex) => {
    const resolved =
      preset === 'custom'
        ? normalizeHex(customHex ?? '') ?? DEFAULT_ACCENT_COLOR
        : (ACCENT_PRESETS.find((item) => item.id === preset)?.light ?? DEFAULT_ACCENT_COLOR);
    const settings = await settingsRepository.update({ accentPreset: preset, accentColor: resolved });
    const userId = getCurrentUserId();
    if (userId) await queueChange('profile', userId, 'update', settings);
    set({ settings });
  },
}));
