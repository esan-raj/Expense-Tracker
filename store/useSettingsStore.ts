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
  /** Device-local cloud AI consent — never queued to Supabase profiles. */
  setCloudAiConsent: (enabled: boolean) => Promise<void>;
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
  aiCloudEnabled: false,
  aiConsentPolicyVersion: 0,
  aiConsentAcceptedAt: null,
};

/** Profile outbox payload — excludes device-local AI consent fields. */
function toSyncableProfile(settings: AppSettings): Omit<
  AppSettings,
  'aiCloudEnabled' | 'aiConsentPolicyVersion' | 'aiConsentAcceptedAt'
> {
  const { aiCloudEnabled: _a, aiConsentPolicyVersion: _b, aiConsentAcceptedAt: _c, ...syncable } = settings;
  return syncable;
}

async function persistAndMaybeQueue(update: SettingsUpdate): Promise<AppSettings> {
  const settings = await settingsRepository.update(update);
  const userId = getCurrentUserId();
  if (userId) {
    await queueChange('profile', userId, 'update', toSyncableProfile(settings));
  }
  return settings;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: fallback,
  loaded: false,
  load: async () => {
    const settings = await settingsRepository.get();
    set({ settings, loaded: true });
  },
  update: async (update) => {
    const settings = await persistAndMaybeQueue(update);
    set({ settings, loaded: true });
  },
  setCurrency: async (code) => {
    const currency = getCurrency(code);
    const settings = await persistAndMaybeQueue({
      currency: currency.code,
      currencySymbol: currency.symbol,
    });
    set({ settings });
  },
  setTheme: async (theme) => {
    const settings = await persistAndMaybeQueue({ theme });
    set({ settings });
  },
  setAccent: async (preset, customHex) => {
    const resolved =
      preset === 'custom'
        ? normalizeHex(customHex ?? '') ?? DEFAULT_ACCENT_COLOR
        : (ACCENT_PRESETS.find((item) => item.id === preset)?.light ?? DEFAULT_ACCENT_COLOR);
    const settings = await persistAndMaybeQueue({ accentPreset: preset, accentColor: resolved });
    set({ settings });
  },
  setCloudAiConsent: async (enabled) => {
    const settings = await settingsRepository.update(
      enabled
        ? {
            aiCloudEnabled: true,
            aiConsentPolicyVersion: 1,
            aiConsentAcceptedAt: new Date().toISOString(),
          }
        : {
            aiCloudEnabled: false,
            aiConsentPolicyVersion: 0,
            aiConsentAcceptedAt: null,
          }
    );
    // Intentionally no queueChange — consent is device-local.
    set({ settings, loaded: true });
  },
}));
