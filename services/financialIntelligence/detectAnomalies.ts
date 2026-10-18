import { filterPeriodTransactions } from './aggregateSpending';
import type { AnomalySignal, Period, SnapshotCategory, SnapshotTransaction } from './types';

const MULTIPLE_THRESHOLD = 2.5;
const MIN_CATEGORY_SAMPLES = 3;

/**
 * Flags period expenses that are unusually large vs the category's average
 * in the same period (excluding the candidate itself when enough samples exist).
 */
export function detectAnomalies(
  transactions: SnapshotTransaction[],
  period: Period,
  categories: SnapshotCategory[]
): AnomalySignal[] {
  const names = new Map(categories.map((category) => [category.id, category.name]));
  const expenses = filterPeriodTransactions(transactions, period).filter((row) => row.type === 'expense');
  const byCategory = new Map<string, SnapshotTransaction[]>();
  for (const row of expenses) {
    const list = byCategory.get(row.categoryId) ?? [];
    list.push(row);
    byCategory.set(row.categoryId, list);
  }

  const anomalies: AnomalySignal[] = [];
  for (const [categoryId, rows] of byCategory) {
    if (rows.length < MIN_CATEGORY_SAMPLES) continue;
    const total = rows.reduce((sum, row) => sum + row.amount, 0);
    for (const row of rows) {
      const baselineAverageMinor = Math.round((total - row.amount) / (rows.length - 1));
      if (baselineAverageMinor <= 0) continue;
      const multiple = row.amount / baselineAverageMinor;
      if (multiple < MULTIPLE_THRESHOLD) continue;
      anomalies.push({
        title: row.title,
        date: row.date,
        amountMinor: row.amount,
        categoryId,
        categoryName: names.get(categoryId) ?? 'Unknown',
        baselineAverageMinor,
        multipleOfBaseline: Math.round(multiple * 10) / 10,
      });
    }
  }

  return anomalies.sort((a, b) => b.multipleOfBaseline - a.multipleOfBaseline).slice(0, 10);
}
