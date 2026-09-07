/// <reference types="jest" />
import { addMinor, formatMoney, fromMinorUnits, parseAmountInput, subtractMinor, toMinorUnits } from '@/utils/currency';

describe('currency helpers', () => {
  it('converts major units without floating-point drift', () => {
    expect(toMinorUnits(12.15, 2)).toBe(1215);
    expect(toMinorUnits(0.1 + 0.2, 2)).toBe(30);
    expect(fromMinorUnits(1215, 2)).toBe(12.15);
  });

  it('adds and subtracts integer minor units', () => {
    expect(addMinor(5500000, 800000)).toBe(6300000);
    expect(subtractMinor(5500000, 121500)).toBe(5378500);
  });

  it('formats signed money and parses user input', () => {
    expect(formatMoney(45000, { code: 'INR', name: 'Indian Rupee', symbol: '₹', decimals: 2 }, { type: 'expense' })).toContain('450.00');
    expect(parseAmountInput('₹ 1,250.50')).toBe(1250.5);
    expect(parseAmountInput('abc')).toBeNull();
  });
});
