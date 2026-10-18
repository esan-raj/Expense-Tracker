import { getFinanceRevision } from '@/services/financeRevision';
import type { FinancialSnapshotInput } from './types';

/** Stable non-cryptographic fingerprint of the financial content used in a snapshot. */
export function computeContentRevision(input: Omit<FinancialSnapshotInput, 'snapshotId' | 'now'>): string {
  const operational = input.transactions.filter((row) => !row.isTransfer);
  const parts = [
    `${input.period.year}-${input.period.month}`,
    input.currency,
    String(input.settingsMonthlyBudget ?? ''),
    `tx:${operational.length}`,
    `sum:${operational.reduce((acc, row) => acc + row.amount * (row.type === 'expense' ? -1 : 1), 0)}`,
    `budgets:${input.budgets
      .map((budget) => `${budget.categoryId ?? 'overall'}:${budget.month}:${budget.year}:${budget.amount}`)
      .sort()
      .join(',')}`,
    `cats:${input.categories.map((category) => category.id).sort().join(',')}`,
    `lookback:${input.lookbackMonths ?? 3}`,
  ];
  return fnv1a(parts.join('|'));
}

export function resolveFinanceRevision(explicit?: number): number {
  return explicit ?? getFinanceRevision();
}

export function buildSnapshotId(contentRevision: string, financeRevision: number, explicit?: string): string {
  if (explicit) return explicit;
  return `snap_${contentRevision}_${financeRevision}`;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
