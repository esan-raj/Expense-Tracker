import { getFinanceRevision } from '@/services/financeRevision';
import type { FinancialSnapshotInput } from './types';

/**
 * Cache/staleness fingerprint of analytics-relevant inputs.
 *
 * This is NOT a security hash, integrity MAC, or privacy guarantee. It only detects
 * whether recomputation is needed when inputs change. Collisions are theoretically
 * possible (FNV-1a 32-bit) but acceptable for local cache invalidation.
 *
 * `now` and `snapshotComputedAt` must never be included — only content that affects
 * analytics results (plus explicit scope identifiers).
 */
export function computeContentRevision(
  input: Omit<FinancialSnapshotInput, 'snapshotId' | 'now'>
): string {
  const txLines = input.transactions
    .map(
      (row) =>
        [
          row.date,
          row.type,
          row.amount,
          row.categoryId,
          row.isTransfer ? '1' : '0',
          row.isRecurring ? '1' : '0',
          normalizeTitleKey(row.title),
          row.paymentMethod ?? '',
        ].join(':')
    )
    .sort();

  const budgetLines = input.budgets
    .map(
      (budget) =>
        [
          budget.year,
          String(budget.month).padStart(2, '0'),
          budget.categoryId ?? 'overall',
          budget.amount,
          budget.id,
        ].join(':')
    )
    .sort();

  const categoryLines = input.categories
    .map((category) => [category.id, category.type, category.name].join(':'))
    .sort();

  const parts = [
    `period:${input.period.year}-${String(input.period.month).padStart(2, '0')}`,
    `currency:${input.currency}`,
    `settingsBudget:${input.settingsMonthlyBudget ?? ''}`,
    `lookback:${input.lookbackMonths ?? 3}`,
    `scope:${input.accountScopeId ?? ''}`,
    `tx:${txLines.join('|')}`,
    `budgets:${budgetLines.join('|')}`,
    `cats:${categoryLines.join('|')}`,
  ];

  return fnv1a(parts.join('\n'));
}

export function resolveFinanceRevision(explicit?: number): number {
  return explicit ?? getFinanceRevision();
}

export function buildSnapshotId(contentRevision: string, financeRevision: number, explicit?: string): string {
  if (explicit) return explicit;
  return `snap_${contentRevision}_${financeRevision}`;
}

function normalizeTitleKey(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
