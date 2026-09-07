import type { CurrencyDefinition } from '@/constants/currencies';
import { getCurrency } from '@/constants/currencies';
import type { CurrencyCode } from '@/types';

export function toMinorUnits(major: number, decimals: number): number {
  if (!Number.isFinite(major)) {
    return 0;
  }
  const factor = 10 ** decimals;
  return Math.round(major * factor);
}

export function fromMinorUnits(minor: number, decimals: number): number {
  if (!Number.isFinite(minor)) {
    return 0;
  }
  const factor = 10 ** decimals;
  return minor / factor;
}

export function addMinor(a: number, b: number): number {
  return Math.round(a) + Math.round(b);
}

export function subtractMinor(a: number, b: number): number {
  return Math.round(a) - Math.round(b);
}

export function formatMajorNumber(value: number, decimals: number): string {
  const absolute = Math.abs(value);
  return absolute.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatMoney(
  minor: number,
  currency: CurrencyDefinition | CurrencyCode,
  options?: { signed?: boolean; type?: 'expense' | 'income' }
): string {
  const definition = typeof currency === 'string' ? getCurrency(currency) : currency;
  const major = fromMinorUnits(Math.round(minor), definition.decimals);
  const formatted = `${definition.symbol}${formatMajorNumber(major, definition.decimals)}`;

  if (options?.signed || options?.type) {
    const isExpense = options.type === 'expense' || (options.signed && minor < 0);
    if (options.type === 'income' || (!options.type && options.signed && minor > 0)) {
      return `+ ${formatted}`;
    }
    if (isExpense || (options.signed && minor < 0)) {
      return `− ${formatted}`;
    }
  }

  return formatted;
}

export function parseAmountInput(value: string): number | null {
  const cleaned = value.replace(/[^\d.]/g, '');
  if (!cleaned) {
    return null;
  }
  const parts = cleaned.split('.');
  const normalized = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : cleaned;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
