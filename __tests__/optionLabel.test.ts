/// <reference types="jest" />
import {
  displayOptionLabel,
  filterOptions,
  findOptionByLabel,
  isCreatableOptionLabel,
  normalizeOptionLabel,
  optionLabelsMatch,
} from '@/utils/optionLabel';
import { categoryIdentityKey } from '@/utils/categoryDedupe';

describe('searchable option labels', () => {
  it('normalizes whitespace and case while preserving the display label', () => {
    expect(normalizeOptionLabel('  Coffee   Shop ')).toBe('coffee shop');
    expect(displayOptionLabel('  Coffee   Shop ')).toBe('Coffee Shop');
    expect(optionLabelsMatch('Coffee Shop', 'coffee   shop')).toBe(true);
  });

  it('rejects empty, whitespace-only, and oversized labels', () => {
    expect(isCreatableOptionLabel('')).toBe(false);
    expect(isCreatableOptionLabel('   ')).toBe(false);
    expect(isCreatableOptionLabel('Tea')).toBe(true);
    expect(isCreatableOptionLabel('a'.repeat(41))).toBe(false);
    expect(isCreatableOptionLabel('a'.repeat(40))).toBe(true);
  });

  it('finds an exact normalized match and filters by substring', () => {
    const options = [
      { id: '1', label: 'Groceries' },
      { id: '2', label: 'Salary' },
    ];
    expect(findOptionByLabel(options, ' groceries ')).toEqual(options[0]);
    expect(findOptionByLabel(options, 'Rent')).toBeUndefined();
    expect(filterOptions(options, 'sal').map((item) => item.id)).toEqual(['2']);
    expect(filterOptions(options, '')).toHaveLength(2);
  });

  it('treats category identity as user-owned name plus type', () => {
    expect(categoryIdentityKey('  Food  Out ', 'expense')).toBe(categoryIdentityKey('food out', 'expense'));
    expect(categoryIdentityKey('Salary', 'income')).not.toBe(categoryIdentityKey('Salary', 'expense'));
  });
});
