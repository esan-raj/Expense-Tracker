import type { CurrencyCode } from '@/types';

export interface CurrencyDefinition {
  code: CurrencyCode;
  name: string;
  symbol: string;
  decimals: number;
}

export const CURRENCIES: CurrencyDefinition[] = [
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', decimals: 2 },
  { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2 },
  { code: 'GBP', name: 'British Pound', symbol: '£', decimals: 2 },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', decimals: 0 },
];

export function getCurrency(code: CurrencyCode): CurrencyDefinition {
  return CURRENCIES.find((item) => item.code === code) ?? CURRENCIES[0];
}

export const DEFAULT_CURRENCY = CURRENCIES[0];
