import { lookbackPeriods, periodBounds } from './periodBounds';
import type { Period, RecurringPattern, SnapshotTransaction } from './types';

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Local-only pattern detection from titles / isRecurring flags.
 * Does not call AI and does not leave the device.
 */
export function detectRecurringPatterns(
  transactions: SnapshotTransaction[],
  period: Period,
  lookbackMonths = 3
): RecurringPattern[] {
  const periods = [period, ...lookbackPeriods(period, lookbackMonths)];
  const start = periodBounds(periods[periods.length - 1]).startDate;
  const end = periodBounds(period).endDate;

  const expenses = transactions.filter(
    (row) =>
      !row.isTransfer &&
      row.type === 'expense' &&
      row.date >= start &&
      row.date <= end &&
      row.title.trim().length > 0
  );

  const groups = new Map<
    string,
    { sampleTitle: string; amounts: number[]; categoryIds: string[]; markedRecurring: boolean }
  >();

  for (const row of expenses) {
    const key = normalizeTitle(row.title);
    const group = groups.get(key) ?? {
      sampleTitle: row.title.trim(),
      amounts: [],
      categoryIds: [],
      markedRecurring: false,
    };
    group.amounts.push(row.amount);
    group.categoryIds.push(row.categoryId);
    if (row.isRecurring) group.markedRecurring = true;
    groups.set(key, group);
  }

  return [...groups.entries()]
    .filter(([, group]) => group.markedRecurring || group.amounts.length >= 2)
    .map(([titleKey, group]) => {
      const sum = group.amounts.reduce((acc, value) => acc + value, 0);
      const categoryVotes = new Map<string, number>();
      for (const id of group.categoryIds) {
        categoryVotes.set(id, (categoryVotes.get(id) ?? 0) + 1);
      }
      const categoryId =
        [...categoryVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      return {
        titleKey,
        sampleTitle: group.sampleTitle,
        occurrenceCount: group.amounts.length,
        averageAmountMinor: Math.round(sum / group.amounts.length),
        categoryId,
        markedRecurring: group.markedRecurring,
      };
    })
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount || b.averageAmountMinor - a.averageAmountMinor)
    .slice(0, 15);
}
