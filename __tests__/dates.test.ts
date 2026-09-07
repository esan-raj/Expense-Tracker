/// <reference types="jest" />
import {
  addFrequency,
  daysInRange,
  dueOccurrences,
  fromDateKey,
  getDateRange,
  isDateKey,
  nextOccurrenceOnOrAfter,
  rangeToKeys,
  toDateKey,
} from '@/utils/dates';

describe('date helpers', () => {
  it('round-trips ISO date keys', () => {
    expect(toDateKey(fromDateKey('2026-09-05'))).toBe('2026-09-05');
    expect(isDateKey('2026-09-05')).toBe(true);
    expect(isDateKey('05/09/2026')).toBe(false);
  });

  it('builds preset ranges with comparable keys', () => {
    const range = getDateRange('this_month');
    const keys = rangeToKeys(range);
    expect(keys.startDate <= keys.endDate).toBe(true);
    expect(daysInRange(range)).toBeGreaterThan(0);
  });

  it('advances recurring dates without duplicates', () => {
    const start = fromDateKey('2026-09-01');
    expect(toDateKey(addFrequency(start, 'daily'))).toBe('2026-09-02');
    expect(toDateKey(addFrequency(start, 'weekly'))).toBe('2026-09-08');
    expect(toDateKey(addFrequency(start, 'monthly'))).toBe('2026-10-01');
    expect(toDateKey(addFrequency(start, 'yearly'))).toBe('2027-09-01');
  });

  it('lists due occurrences up to today and skips already-advanced dates', () => {
    const due = dueOccurrences(fromDateKey('2026-09-01'), 'daily', fromDateKey('2026-09-03'));
    expect(due.map(toDateKey)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    const next = nextOccurrenceOnOrAfter(fromDateKey('2026-08-01'), 'monthly', fromDateKey('2026-09-05'));
    expect(toDateKey(next)).toBe('2026-10-01');
  });
});
