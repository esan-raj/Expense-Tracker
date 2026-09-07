/// <reference types="jest" />
import { mixHex, normalizeHex, contrastForeground, resolveAccentHex } from '@/utils/accent';
import { accountBalanceSeries, isMeaningfulSeries, seriesTrendPercent } from '@/utils/accountSeries';

describe('accent colors', () => {
  it('normalizes hex values and rejects invalid input', () => {
    expect(normalizeHex('#0e7c66')).toBe('#0E7C66');
    expect(normalizeHex('3F4F9C')).toBe('#3F4F9C');
    expect(normalizeHex('red')).toBeNull();
  });

  it('picks readable foreground and dark-mode variants', () => {
    expect(contrastForeground('#0E7C66')).toBe('#FFFFFF');
    expect(contrastForeground('#F3E7B8')).toBe('#10211C');
    expect(resolveAccentHex('emerald', '#0E7C66', false)).toBe('#0E7C66');
    expect(resolveAccentHex('emerald', '#0E7C66', true)).toBe('#3DBAA0');
    expect(mixHex('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });
});

describe('account balance series', () => {
  const bank = {
    type: 'bank' as const,
    openingBalance: 100000,
    creditLimit: null,
  };

  it('reconstructs daily balances from real ledger entries', () => {
    const series = accountBalanceSeries(
      bank,
      [
        { type: 'expense', amount: 20000, date: '2026-09-06', isTransfer: false },
        { type: 'income', amount: 5000, date: '2026-09-06', isTransfer: false },
      ],
      3,
      new Date(2026, 8, 7)
    );
    expect(series).toHaveLength(3);
    expect(series[series.length - 1]?.value).toBe(85000);
    expect(isMeaningfulSeries(series)).toBe(true);
    expect(seriesTrendPercent(series)).not.toBeNull();
  });

  it('does not treat a flat opening-balance line as a meaningful chart', () => {
    const series = accountBalanceSeries(bank, [], 5, new Date(2026, 8, 7));
    expect(series.every((point) => point.value === 100000)).toBe(true);
    expect(isMeaningfulSeries(series)).toBe(false);
    expect(seriesTrendPercent(series)).toBeNull();
  });
});
