export type ThemePreference = 'system' | 'light' | 'dark';

export type CurrencyCode = 'INR' | 'USD' | 'EUR' | 'GBP' | 'JPY';

export interface AppSettings {
  id: string;
  currency: CurrencyCode;
  currencySymbol: string;
  theme: ThemePreference;
  firstDayOfWeek: number;
  monthlyBudget: number | null;
  onboardingComplete: boolean;
}

export interface SettingsUpdate {
  currency?: CurrencyCode;
  currencySymbol?: string;
  theme?: ThemePreference;
  firstDayOfWeek?: number;
  monthlyBudget?: number | null;
  onboardingComplete?: boolean;
}
