/**
 * Typed adapter from repository/domain records into FinancialSnapshotInput.
 *
 * Repository contract (see database/query.ts `scopeSelector`):
 * - Soft-deleted rows are excluded via `deletedAt: ''` at query time.
 * - When a user is scoped, selector includes `userId: { $in: [scoped, ''] }` so
 *   unassigned (guest) rows with empty userId may still appear alongside owned rows.
 * - Currency is application-global (`settings.currency`), not per-transaction.
 *
 * Adapter policy (reject vs skip — not mixed):
 * - Structural invalidity (period, currency, lookback type, settings shape) → throw.
 * - Per-row invalid / soft-deleted transactions, budgets, categories → skip + dataQuality.
 * - Investments are never accepted (caller must not pass them).
 * - Recurring *templates* live in a separate RxDB collection; do not pass them here.
 *   Ledger rows with `isRecurring: true` are realised transactions and are kept.
 * - Refunds/reversals: schema uses positive amounts with income/expense type only.
 */

import type { Budget } from '@/types/budget';
import type { Category } from '@/types/category';
import type { Transaction } from '@/types/transaction';
import { FinancialSnapshotValidationError, assertSafeInteger } from './integerSafety';
import type {
  DataQualityFlags,
  FinancialSnapshotInput,
  Period,
  SnapshotBudget,
  SnapshotCategory,
  SnapshotTransaction,
} from './types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const LOOKBACK_MIN = 1;
const LOOKBACK_MAX = 24;
const YEAR_MIN = 1970;
const YEAR_MAX = 2100;

export type RawFinancialSnapshotSource = {
  period: Period;
  currency: string;
  transactions: ReadonlyArray<Transaction | SnapshotTransaction | Record<string, unknown>>;
  budgets: ReadonlyArray<Budget | SnapshotBudget | Record<string, unknown>>;
  categories: ReadonlyArray<Category | SnapshotCategory | Record<string, unknown>>;
  settingsMonthlyBudget: number | null | undefined;
  lookbackMonths?: number;
  now?: Date;
  accountScopeId?: string | null;
  snapshotId?: string;
  financeRevision?: number;
};

function isValidCalendarDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const [ys, ms, ds] = date.split('-');
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function emptyQuality(): DataQualityFlags {
  return {
    skippedDeletedTransactions: 0,
    skippedInvalidTransactions: 0,
    skippedDeletedBudgets: 0,
    skippedInvalidBudgets: 0,
    skippedDeletedCategories: 0,
    unknownCategoryBuckets: 0,
    assumedSingleCurrency: true,
    assumedUserScopedInputs: true,
  };
}

function adaptTransaction(
  raw: Record<string, unknown>,
  quality: DataQualityFlags
): SnapshotTransaction | null {
  if (typeof raw.deletedAt === 'string' && raw.deletedAt !== '') {
    quality.skippedDeletedTransactions += 1;
    return null;
  }

  const type = raw.type;
  const amount = raw.amount;
  const date = raw.date;
  const categoryId = raw.categoryId;
  const title = typeof raw.title === 'string' ? raw.title : '';

  if (
    (type !== 'income' && type !== 'expense') ||
    typeof amount !== 'number' ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    typeof date !== 'string' ||
    !isValidCalendarDate(date) ||
    typeof categoryId !== 'string' ||
    categoryId.length === 0
  ) {
    quality.skippedInvalidTransactions += 1;
    return null;
  }

  return {
    type,
    amount,
    date,
    categoryId,
    title,
    isTransfer: Boolean(raw.isTransfer),
    isRecurring: Boolean(raw.isRecurring),
    paymentMethod: typeof raw.paymentMethod === 'string' ? raw.paymentMethod : undefined,
  };
}

function adaptBudget(raw: Record<string, unknown>, quality: DataQualityFlags): SnapshotBudget | null {
  if (typeof raw.deletedAt === 'string' && raw.deletedAt !== '') {
    quality.skippedDeletedBudgets += 1;
    return null;
  }
  const id = typeof raw.id === 'string' ? raw.id : null;
  const month = raw.month;
  const year = raw.year;
  const amount = raw.amount;
  const categoryId = raw.categoryId;

  if (
    !id ||
    typeof month !== 'number' ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    typeof year !== 'number' ||
    !Number.isInteger(year) ||
    year < YEAR_MIN ||
    year > YEAR_MAX ||
    typeof amount !== 'number' ||
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    (categoryId !== null && typeof categoryId !== 'string')
  ) {
    quality.skippedInvalidBudgets += 1;
    return null;
  }

  return { id, month, year, amount, categoryId: categoryId as string | null };
}

function adaptCategory(
  raw: Record<string, unknown>,
  quality: DataQualityFlags
): SnapshotCategory | null {
  if (typeof raw.deletedAt === 'string' && raw.deletedAt !== '') {
    quality.skippedDeletedCategories += 1;
    return null;
  }
  const id = typeof raw.id === 'string' ? raw.id : null;
  const name = typeof raw.name === 'string' ? raw.name : null;
  const type = raw.type;
  if (!id || !name || (type !== 'income' && type !== 'expense' && type !== 'both')) {
    return null;
  }
  return { id, name, type };
}

/**
 * Validates structural inputs and adapts rows.
 * Throws FinancialSnapshotValidationError on structural failure.
 * Skips invalid rows and returns dataQuality flags.
 */
export function adaptFinancialSnapshotInput(source: RawFinancialSnapshotSource): {
  input: FinancialSnapshotInput;
  dataQuality: DataQualityFlags;
} {
  const quality = emptyQuality();
  const { period } = source;

  if (
    !period ||
    typeof period.month !== 'number' ||
    !Number.isInteger(period.month) ||
    period.month < 1 ||
    period.month > 12 ||
    typeof period.year !== 'number' ||
    !Number.isInteger(period.year) ||
    period.year < YEAR_MIN ||
    period.year > YEAR_MAX
  ) {
    throw new FinancialSnapshotValidationError('Invalid period month/year');
  }

  if (typeof source.currency !== 'string' || !CURRENCY_RE.test(source.currency)) {
    throw new FinancialSnapshotValidationError('Currency must be a 3-letter ISO code');
  }

  let lookbackMonths = source.lookbackMonths ?? 3;
  if (typeof lookbackMonths !== 'number' || !Number.isInteger(lookbackMonths)) {
    throw new FinancialSnapshotValidationError('lookbackMonths must be an integer');
  }
  if (lookbackMonths < LOOKBACK_MIN) lookbackMonths = LOOKBACK_MIN;
  if (lookbackMonths > LOOKBACK_MAX) lookbackMonths = LOOKBACK_MAX;

  const settingsMonthlyBudget = source.settingsMonthlyBudget ?? null;
  if (settingsMonthlyBudget != null) {
    assertSafeInteger(settingsMonthlyBudget, 'settingsMonthlyBudget');
    if (settingsMonthlyBudget < 0) {
      throw new FinancialSnapshotValidationError('settingsMonthlyBudget must be non-negative');
    }
  }

  const transactions: SnapshotTransaction[] = [];
  for (const row of source.transactions) {
    const adapted = adaptTransaction(row as Record<string, unknown>, quality);
    if (adapted) transactions.push(adapted);
  }

  const budgets: SnapshotBudget[] = [];
  for (const row of source.budgets) {
    const adapted = adaptBudget(row as Record<string, unknown>, quality);
    if (adapted) budgets.push(adapted);
  }

  const categories: SnapshotCategory[] = [];
  for (const row of source.categories) {
    const adapted = adaptCategory(row as Record<string, unknown>, quality);
    if (adapted) categories.push(adapted);
  }

  return {
    input: {
      period,
      currency: source.currency,
      transactions,
      budgets,
      categories,
      settingsMonthlyBudget,
      lookbackMonths,
      now: source.now ?? new Date(),
      accountScopeId: source.accountScopeId,
      snapshotId: source.snapshotId,
      financeRevision: source.financeRevision,
    },
    dataQuality: quality,
  };
}
