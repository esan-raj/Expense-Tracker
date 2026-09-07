import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  differenceInCalendarDays,
  endOfDay,
  endOfMonth,
  endOfYear,
  format,
  isSameDay,
  isValid,
  isYesterday,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfYear,
  subMonths,
} from 'date-fns';
import type { RecurringFrequency } from '@/types';

export type DateRangePreset = 'this_month' | 'last_month' | 'last_3_months' | 'this_year' | 'custom';

export interface DateRange {
  start: Date;
  end: Date;
}

export function toDateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

export function fromDateKey(key: string): Date {
  const parsed = parseISO(key);
  if (!isValid(parsed)) {
    throw new Error('Invalid date key');
  }
  return startOfDay(parsed);
}

export function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && isValid(parseISO(value));
}

export function todayKey(): string {
  return toDateKey(new Date());
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function greetingForNow(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function formatDisplayDate(key: string): string {
  return format(fromDateKey(key), 'd MMM yyyy');
}

export function formatShortDate(key: string): string {
  return format(fromDateKey(key), 'd MMM');
}

export function formatMonthYear(month: number, year: number): string {
  return format(new Date(year, month - 1, 1), 'MMMM yyyy');
}

export function getGroupLabel(dateKey: string): string {
  const date = fromDateKey(dateKey);
  if (isSameDay(date, new Date())) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'EEEE, d MMM');
}

export function currentMonthYear(date = new Date()): { month: number; year: number } {
  return { month: date.getMonth() + 1, year: date.getFullYear() };
}

export function previousMonthYear(date = new Date()): { month: number; year: number } {
  const previous = subMonths(date, 1);
  return { month: previous.getMonth() + 1, year: previous.getFullYear() };
}

export function getDateRange(preset: DateRangePreset, custom?: DateRange): DateRange {
  const now = new Date();
  switch (preset) {
    case 'this_month':
      return { start: startOfMonth(now), end: endOfDay(now) };
    case 'last_month': {
      const last = subMonths(now, 1);
      return { start: startOfMonth(last), end: endOfMonth(last) };
    }
    case 'last_3_months':
      return { start: startOfMonth(subMonths(now, 2)), end: endOfDay(now) };
    case 'this_year':
      return { start: startOfYear(now), end: endOfDay(now) };
    case 'custom':
      if (!custom) {
        return { start: startOfMonth(now), end: endOfDay(now) };
      }
      return { start: startOfDay(custom.start), end: endOfDay(custom.end) };
    default:
      return { start: startOfMonth(now), end: endOfDay(now) };
  }
}

export function rangeToKeys(range: DateRange): { startDate: string; endDate: string } {
  return {
    startDate: toDateKey(range.start),
    endDate: toDateKey(range.end),
  };
}

export function daysInRange(range: DateRange): number {
  return Math.max(1, differenceInCalendarDays(range.end, range.start) + 1);
}

export function addFrequency(date: Date, frequency: RecurringFrequency): Date {
  switch (frequency) {
    case 'daily':
      return addDays(date, 1);
    case 'weekly':
      return addWeeks(date, 1);
    case 'monthly':
      return addMonths(date, 1);
    case 'yearly':
      return addYears(date, 1);
    default:
      return addMonths(date, 1);
  }
}

export function nextOccurrenceOnOrAfter(
  start: Date,
  frequency: RecurringFrequency,
  after: Date
): Date {
  let current = startOfDay(start);
  const limit = startOfDay(after);
  let guard = 0;
  while (current < limit && guard < 4000) {
    current = addFrequency(current, frequency);
    guard += 1;
  }
  return current;
}

export function dueOccurrences(
  nextDate: Date,
  frequency: RecurringFrequency,
  until: Date
): Date[] {
  const dates: Date[] = [];
  let current = startOfDay(nextDate);
  const end = startOfDay(until);
  let guard = 0;
  while (current <= end && guard < 4000) {
    dates.push(current);
    current = addFrequency(current, frequency);
    guard += 1;
  }
  return dates;
}

export function lastNDaysKeys(days: number, from = new Date()): string[] {
  return Array.from({ length: days }, (_, index) => toDateKey(addDays(from, -(days - 1 - index))));
}

export function monthDayKeys(month: number, year: number): string[] {
  const start = new Date(year, month - 1, 1);
  const end = endOfMonth(start);
  const keys: string[] = [];
  let current = start;
  while (current <= end) {
    keys.push(toDateKey(current));
    current = addDays(current, 1);
  }
  return keys;
}
