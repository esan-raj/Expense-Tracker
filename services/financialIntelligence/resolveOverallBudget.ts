import type { OverallBudgetSource, Period, SnapshotBudget } from './types';

export type OverallBudgetResolution = {
  amountMinor: number | null;
  source: OverallBudgetSource;
};

/**
 * Canonical overall budget for analytics snapshots.
 *
 * Evidence (Phase 2 decision):
 * - Budgets UI (`app/(tabs)/budgets.tsx`) and `budgetService` treat `categoryId === null`
 *   rows for the target month/year as the overall budget users create/edit.
 * - `findOverallBudget` in `utils/calculations.ts` already selects that row.
 * - Home prefers the null-category warning amount, then falls back to `settings.monthlyBudget`.
 * - `settings.monthlyBudget` is set by onboarding and Currency settings and synced on the
 *   profile — it is month-agnostic, so it is fallback only, not canonical.
 *
 * No writes, migrations, or deletes. Read-path resolution only.
 */
export function resolveOverallBudgetMinor(args: {
  period: Period;
  budgets: Array<Pick<SnapshotBudget, 'categoryId' | 'amount' | 'month' | 'year'>>;
  settingsMonthlyBudget: number | null | undefined;
}): OverallBudgetResolution {
  const row = args.budgets.find(
    (item) => item.month === args.period.month && item.year === args.period.year && item.categoryId == null
  );
  if (row && row.amount > 0) {
    return { amountMinor: row.amount, source: 'budget_row' };
  }

  const fallback = args.settingsMonthlyBudget ?? null;
  if (fallback != null && fallback > 0) {
    return { amountMinor: fallback, source: 'settings_fallback' };
  }

  return { amountMinor: null, source: 'none' };
}
