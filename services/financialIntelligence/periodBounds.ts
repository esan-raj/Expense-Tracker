import type { Period, PeriodStatus } from './types';

export function periodPrefix(period: Period): string {
  return `${period.year}-${String(period.month).padStart(2, '0')}`;
}

export function periodBounds(period: Period): { startDate: string; endDate: string; dayCount: number } {
  const lastDay = new Date(period.year, period.month, 0).getDate();
  const startDate = `${periodPrefix(period)}-01`;
  const endDate = `${periodPrefix(period)}-${String(lastDay).padStart(2, '0')}`;
  return { startDate, endDate, dayCount: lastDay };
}

export function previousPeriod(period: Period): Period {
  if (period.month === 1) return { month: 12, year: period.year - 1 };
  return { month: period.month - 1, year: period.year };
}

/** Periods strictly before `period`, newest first, length `count`. */
export function lookbackPeriods(period: Period, count: number): Period[] {
  const result: Period[] = [];
  let cursor = previousPeriod(period);
  for (let i = 0; i < count; i += 1) {
    result.push(cursor);
    cursor = previousPeriod(cursor);
  }
  return result;
}

export function inPeriod(date: string, period: Period): boolean {
  return date.startsWith(periodPrefix(period));
}

/** Local calendar components from `now` — matches YYYY-MM-DD key semantics (no UTC shift). */
export function localYearMonthDay(now: Date): { year: number; month: number; day: number } {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

export function classifyPeriod(period: Period, now: Date): PeriodStatus {
  const { year, month } = localYearMonthDay(now);
  if (period.year > year || (period.year === year && period.month > month)) return 'future';
  if (period.year === year && period.month === month) return 'active';
  return 'completed';
}

/**
 * Divisor for average daily expense.
 * - active: elapsed calendar days in month so far (1..dayCount)
 * - completed: full month length
 * - future: null (unavailable)
 */
export function averageDivisorDays(period: Period, now: Date): number | null {
  const status = classifyPeriod(period, now);
  const { dayCount } = periodBounds(period);
  if (status === 'future') return null;
  if (status === 'completed') return dayCount;
  const { day } = localYearMonthDay(now);
  return Math.min(Math.max(1, day), dayCount);
}
