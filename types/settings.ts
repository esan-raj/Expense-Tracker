export type ThemePreference = 'system' | 'light' | 'dark';
export type AccentPreset = 'emerald' | 'ocean' | 'indigo' | 'violet' | 'amber' | 'rose' | 'custom';

export type CurrencyCode = 'INR' | 'USD' | 'EUR' | 'GBP' | 'JPY';

export interface AppSettings {
  id: string;
  currency: CurrencyCode;
  currencySymbol: string;
  theme: ThemePreference;
  accentPreset: AccentPreset;
  accentColor: string;
  firstDayOfWeek: number;
  monthlyBudget: number | null;
  onboardingComplete: boolean;
}

export interface SettingsUpdate {
  currency?: CurrencyCode;
  currencySymbol?: string;
  theme?: ThemePreference;
  accentPreset?: AccentPreset;
  accentColor?: string;
  firstDayOfWeek?: number;
  monthlyBudget?: number | null;
  onboardingComplete?: boolean;
}
