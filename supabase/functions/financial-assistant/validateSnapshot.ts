import { FUTURE_TIMESTAMP_SKEW_MS } from './constants.ts';
import { FinancialAssistantError } from './errors.ts';
import {
  assertArray,
  assertBoolean,
  assertExactKeys,
  assertNonNegativeSafeInteger,
  assertNullOr,
  assertObject,
  assertSafeInteger,
  assertString,
} from './schema.ts';
import type {
  AiSafeAnomalyWire,
  AiSafeRecurringWire,
  AiSafeSnapshotWire,
  AmountBucket,
  BudgetBaselineWire,
  BudgetUsageWire,
  CategorySpendWire,
  DataQualityWire,
  PeriodTotalsWire,
  TrendWire,
  TruncationWire,
} from './types.ts';

const CURRENCY_RE = /^[A-Z]{3}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SNAP_ID_RE = /^snap_[0-9a-f]+_\d+$/i;
const AMOUNT_BUCKETS = new Set<AmountBucket>(['b0_500', 'b500_2k', 'b2k_10k', 'b10k_plus']);

const SNAPSHOT_KEYS = [
  'schemaVersion',
  'kind',
  'snapshotId',
  'snapshotComputedAt',
  'financeRevision',
  'contentRevision',
  'currency',
  'period',
  'periodStatus',
  'overallBudget',
  'totals',
  'previousPeriod',
  'topCategories',
  'budgets',
  'trends',
  'recurringPatterns',
  'anomalies',
  'budgetBaseline',
  'flags',
  'dataQuality',
  'truncation',
] as const;

function assertCurrency(value: unknown, label: string): string {
  const text = assertString(value, label, 3);
  if (!CURRENCY_RE.test(text)) {
    throw new FinancialAssistantError('invalid_request', `${label} must be a 3-letter ISO code`, 400);
  }
  return text;
}

function assertSnapshotId(value: unknown, label: string): string {
  const text = assertString(value, label, 80);
  if (UUID_RE.test(text) || SNAP_ID_RE.test(text)) return text;
  throw new FinancialAssistantError('invalid_request', `${label} must be a uuid or snap_* id`, 400);
}

function assertIsoNotFuture(value: unknown, label: string, nowMs: number): string {
  const text = assertString(value, label, 64);
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) {
    throw new FinancialAssistantError('invalid_request', `${label} must be ISO-8601`, 400);
  }
  if (ms > nowMs + FUTURE_TIMESTAMP_SKEW_MS) {
    throw new FinancialAssistantError('invalid_request', `${label} must not be in the future`, 400);
  }
  return text;
}

function assertAmountBucket(value: unknown, label: string): AmountBucket {
  if (typeof value !== 'string' || !AMOUNT_BUCKETS.has(value as AmountBucket)) {
    throw new FinancialAssistantError('invalid_request', `${label} invalid`, 400);
  }
  return value as AmountBucket;
}

function parsePeriodTotals(raw: unknown, label: string): PeriodTotalsWire {
  const obj = assertObject(raw, label);
  assertExactKeys(
    obj,
    [
      'incomeMinor',
      'expenseMinor',
      'netMinor',
      'savingsRatePercent',
      'averageDailyExpenseMinor',
      'averageDailyMethod',
      'projectedMonthEndExpenseMinor',
      'projectedMonthEndMethod',
      'expenseDayCount',
      'divisorDays',
    ],
    label
  );

  const averageDailyMethod = obj.averageDailyMethod;
  if (
    averageDailyMethod !== 'elapsed_days' &&
    averageDailyMethod !== 'full_month' &&
    averageDailyMethod !== 'unavailable'
  ) {
    throw new FinancialAssistantError('invalid_request', `${label}.averageDailyMethod invalid`, 400);
  }
  const projectedMonthEndMethod = obj.projectedMonthEndMethod;
  if (projectedMonthEndMethod !== 'linear_elapsed' && projectedMonthEndMethod !== 'unavailable') {
    throw new FinancialAssistantError('invalid_request', `${label}.projectedMonthEndMethod invalid`, 400);
  }

  return {
    incomeMinor: assertNonNegativeSafeInteger(obj.incomeMinor, `${label}.incomeMinor`),
    expenseMinor: assertNonNegativeSafeInteger(obj.expenseMinor, `${label}.expenseMinor`),
    netMinor: assertSafeInteger(obj.netMinor, `${label}.netMinor`),
    savingsRatePercent: assertSafeInteger(obj.savingsRatePercent, `${label}.savingsRatePercent`),
    averageDailyExpenseMinor: assertNullOr(obj.averageDailyExpenseMinor, `${label}.averageDailyExpenseMinor`, (v, l) =>
      assertNonNegativeSafeInteger(v, l)
    ),
    averageDailyMethod,
    projectedMonthEndExpenseMinor: assertNullOr(
      obj.projectedMonthEndExpenseMinor,
      `${label}.projectedMonthEndExpenseMinor`,
      (v, l) => assertNonNegativeSafeInteger(v, l)
    ),
    projectedMonthEndMethod,
    expenseDayCount: assertNonNegativeSafeInteger(obj.expenseDayCount, `${label}.expenseDayCount`),
    divisorDays: assertNullOr(obj.divisorDays, `${label}.divisorDays`, (v, l) =>
      assertNonNegativeSafeInteger(v, l)
    ),
  };
}

function parseCategorySpend(raw: unknown, label: string): CategorySpendWire {
  const obj = assertObject(raw, label);
  assertExactKeys(obj, ['categoryId', 'categoryName', 'amountMinor', 'percent', 'transactionCount'], label);
  return {
    categoryId: assertString(obj.categoryId, `${label}.categoryId`, 128),
    categoryName: assertString(obj.categoryName, `${label}.categoryName`, 80),
    amountMinor: assertNonNegativeSafeInteger(obj.amountMinor, `${label}.amountMinor`),
    percent: assertNonNegativeSafeInteger(obj.percent, `${label}.percent`),
    transactionCount: assertNonNegativeSafeInteger(obj.transactionCount, `${label}.transactionCount`),
  };
}

function parseBudgetUsage(raw: unknown, label: string): BudgetUsageWire {
  const obj = assertObject(raw, label);
  assertExactKeys(
    obj,
    ['categoryId', 'label', 'budgetMinor', 'spentMinor', 'percent', 'warningLevel', 'source'],
    label
  );
  const categoryId =
    obj.categoryId === null ? null : assertString(obj.categoryId, `${label}.categoryId`, 128);
  const warningLevel = obj.warningLevel;
  if (
    warningLevel !== null &&
    warningLevel !== 50 &&
    warningLevel !== 75 &&
    warningLevel !== 90 &&
    warningLevel !== 100
  ) {
    throw new FinancialAssistantError('invalid_request', `${label}.warningLevel invalid`, 400);
  }
  const source = obj.source;
  if (
    source !== 'budget_row' &&
    source !== 'settings_fallback' &&
    source !== 'none' &&
    source !== 'category_row'
  ) {
    throw new FinancialAssistantError('invalid_request', `${label}.source invalid`, 400);
  }
  return {
    categoryId,
    label: assertString(obj.label, `${label}.label`, 80),
    budgetMinor: assertNonNegativeSafeInteger(obj.budgetMinor, `${label}.budgetMinor`),
    spentMinor: assertNonNegativeSafeInteger(obj.spentMinor, `${label}.spentMinor`),
    percent: assertNonNegativeSafeInteger(obj.percent, `${label}.percent`),
    warningLevel,
    source,
  };
}

function parseTrend(raw: unknown, label: string): TrendWire {
  const obj = assertObject(raw, label);
  const kind = obj.kind;
  if (
    kind !== 'expense_change' &&
    kind !== 'income_change' &&
    kind !== 'net_change' &&
    kind !== 'category_change'
  ) {
    throw new FinancialAssistantError('invalid_request', `${label}.kind invalid`, 400);
  }
  const allowed = new Set([
    'kind',
    'label',
    'currentMinor',
    'previousMinor',
    'percentChange',
    'categoryId',
  ]);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new FinancialAssistantError('invalid_request', `${label} has unknown fields: ${key}`, 400);
    }
  }
  for (const key of ['kind', 'label', 'currentMinor', 'previousMinor', 'percentChange'] as const) {
    if (!(key in obj)) {
      throw new FinancialAssistantError('invalid_request', `${label}.${key} is required`, 400);
    }
  }

  const percentChange =
    obj.percentChange === null
      ? null
      : assertSafeInteger(obj.percentChange, `${label}.percentChange`);

  return {
    kind,
    label: assertString(obj.label, `${label}.label`, 120),
    currentMinor: assertSafeInteger(obj.currentMinor, `${label}.currentMinor`),
    previousMinor: assertSafeInteger(obj.previousMinor, `${label}.previousMinor`),
    percentChange,
    categoryId:
      obj.categoryId === undefined
        ? undefined
        : assertString(obj.categoryId, `${label}.categoryId`, 128),
  };
}

function parseRecurring(raw: unknown, label: string): AiSafeRecurringWire {
  const obj = assertObject(raw, label);
  assertExactKeys(
    obj,
    ['categoryId', 'categoryName', 'occurrenceCount', 'averageAmountBucket', 'markedRecurring'],
    label
  );
  return {
    categoryId: obj.categoryId === null ? null : assertString(obj.categoryId, `${label}.categoryId`, 128),
    categoryName:
      obj.categoryName === null ? null : assertString(obj.categoryName, `${label}.categoryName`, 80),
    occurrenceCount: assertNonNegativeSafeInteger(obj.occurrenceCount, `${label}.occurrenceCount`),
    averageAmountBucket: assertAmountBucket(obj.averageAmountBucket, `${label}.averageAmountBucket`),
    markedRecurring: assertBoolean(obj.markedRecurring, `${label}.markedRecurring`),
  };
}

function parseAnomaly(raw: unknown, label: string): AiSafeAnomalyWire {
  const obj = assertObject(raw, label);
  assertExactKeys(
    obj,
    [
      'categoryId',
      'categoryName',
      'amountBucket',
      'baselineAverageBucket',
      'multipleOfBaseline',
      'periodAnomalyCount',
    ],
    label
  );
  if (typeof obj.multipleOfBaseline !== 'number' || !Number.isFinite(obj.multipleOfBaseline)) {
    throw new FinancialAssistantError('invalid_request', `${label}.multipleOfBaseline invalid`, 400);
  }
  return {
    categoryId: assertString(obj.categoryId, `${label}.categoryId`, 128),
    categoryName: assertString(obj.categoryName, `${label}.categoryName`, 80),
    amountBucket: assertAmountBucket(obj.amountBucket, `${label}.amountBucket`),
    baselineAverageBucket: assertAmountBucket(
      obj.baselineAverageBucket,
      `${label}.baselineAverageBucket`
    ),
    multipleOfBaseline: obj.multipleOfBaseline,
    periodAnomalyCount: assertNonNegativeSafeInteger(
      obj.periodAnomalyCount,
      `${label}.periodAnomalyCount`
    ),
  };
}

function parseBudgetBaseline(raw: unknown, label: string): BudgetBaselineWire {
  const obj = assertObject(raw, label);
  assertExactKeys(obj, ['lookbackMonths', 'overall', 'categories'], label);
  const overall = assertObject(obj.overall, `${label}.overall`);
  assertExactKeys(
    overall,
    ['currentBudgetMinor', 'averageSpendMinor', 'medianSpendMinor', 'source'],
    `${label}.overall`
  );
  const source = overall.source;
  if (source !== 'budget_row' && source !== 'settings_fallback' && source !== 'none') {
    throw new FinancialAssistantError('invalid_request', `${label}.overall.source invalid`, 400);
  }

  const categories = assertArray(obj.categories, `${label}.categories`, 30).map((item, i) => {
    const row = assertObject(item, `${label}.categories[${i}]`);
    assertExactKeys(
      row,
      [
        'categoryId',
        'categoryName',
        'averageSpendMinor',
        'medianSpendMinor',
        'currentBudgetMinor',
        'volatility',
        'monthsWithSpend',
      ],
      `${label}.categories[${i}]`
    );
    const volatilityRaw = row.volatility;
    if (volatilityRaw !== 'low' && volatilityRaw !== 'medium' && volatilityRaw !== 'high') {
      throw new FinancialAssistantError(
        'invalid_request',
        `${label}.categories[${i}].volatility invalid`,
        400
      );
    }
    const volatility: 'low' | 'medium' | 'high' = volatilityRaw;
    return {
      categoryId: assertString(row.categoryId, `${label}.categories[${i}].categoryId`, 128),
      categoryName: assertString(row.categoryName, `${label}.categories[${i}].categoryName`, 80),
      averageSpendMinor: assertNonNegativeSafeInteger(
        row.averageSpendMinor,
        `${label}.categories[${i}].averageSpendMinor`
      ),
      medianSpendMinor: assertNonNegativeSafeInteger(
        row.medianSpendMinor,
        `${label}.categories[${i}].medianSpendMinor`
      ),
      currentBudgetMinor: assertNullOr(
        row.currentBudgetMinor,
        `${label}.categories[${i}].currentBudgetMinor`,
        (v, l) => assertNonNegativeSafeInteger(v, l)
      ),
      volatility,
      monthsWithSpend: assertNonNegativeSafeInteger(
        row.monthsWithSpend,
        `${label}.categories[${i}].monthsWithSpend`
      ),
    };
  });

  return {
    lookbackMonths: assertNonNegativeSafeInteger(obj.lookbackMonths, `${label}.lookbackMonths`),
    overall: {
      currentBudgetMinor: assertNullOr(
        overall.currentBudgetMinor,
        `${label}.overall.currentBudgetMinor`,
        (v, l) => assertNonNegativeSafeInteger(v, l)
      ),
      averageSpendMinor: assertNonNegativeSafeInteger(
        overall.averageSpendMinor,
        `${label}.overall.averageSpendMinor`
      ),
      medianSpendMinor: assertNonNegativeSafeInteger(
        overall.medianSpendMinor,
        `${label}.overall.medianSpendMinor`
      ),
      source,
    },
    categories,
  };
}

function parseDataQuality(raw: unknown, label: string): DataQualityWire {
  const obj = assertObject(raw, label);
  assertExactKeys(
    obj,
    [
      'skippedDeletedTransactions',
      'skippedInvalidTransactions',
      'skippedDeletedBudgets',
      'skippedInvalidBudgets',
      'skippedDeletedCategories',
      'unknownCategoryBuckets',
      'assumedSingleCurrency',
      'assumedUserScopedInputs',
    ],
    label
  );
  if (obj.assumedSingleCurrency !== true || obj.assumedUserScopedInputs !== true) {
    throw new FinancialAssistantError('invalid_request', `${label} assumption flags invalid`, 400);
  }
  return {
    skippedDeletedTransactions: assertNonNegativeSafeInteger(
      obj.skippedDeletedTransactions,
      `${label}.skippedDeletedTransactions`
    ),
    skippedInvalidTransactions: assertNonNegativeSafeInteger(
      obj.skippedInvalidTransactions,
      `${label}.skippedInvalidTransactions`
    ),
    skippedDeletedBudgets: assertNonNegativeSafeInteger(
      obj.skippedDeletedBudgets,
      `${label}.skippedDeletedBudgets`
    ),
    skippedInvalidBudgets: assertNonNegativeSafeInteger(
      obj.skippedInvalidBudgets,
      `${label}.skippedInvalidBudgets`
    ),
    skippedDeletedCategories: assertNonNegativeSafeInteger(
      obj.skippedDeletedCategories,
      `${label}.skippedDeletedCategories`
    ),
    unknownCategoryBuckets: assertNonNegativeSafeInteger(
      obj.unknownCategoryBuckets,
      `${label}.unknownCategoryBuckets`
    ),
    assumedSingleCurrency: true,
    assumedUserScopedInputs: true,
  };
}

function parseTruncation(raw: unknown, label: string): TruncationWire {
  const obj = assertObject(raw, label);
  assertExactKeys(
    obj,
    ['truncated', 'utf8Bytes', 'maxUtf8Bytes', 'dropped', 'exceededLimit', 'reason'],
    label
  );
  const dropped = assertObject(obj.dropped, `${label}.dropped`);
  const droppedAllowed = new Set([
    'topCategories',
    'budgets',
    'trends',
    'recurringPatterns',
    'anomalies',
    'baselineCategories',
  ]);
  for (const key of Object.keys(dropped)) {
    if (!droppedAllowed.has(key)) {
      throw new FinancialAssistantError('invalid_request', `${label}.dropped unknown key ${key}`, 400);
    }
    assertNonNegativeSafeInteger(dropped[key], `${label}.dropped.${key}`);
  }
  return {
    truncated: assertBoolean(obj.truncated, `${label}.truncated`),
    utf8Bytes: assertNonNegativeSafeInteger(obj.utf8Bytes, `${label}.utf8Bytes`),
    maxUtf8Bytes: assertNonNegativeSafeInteger(obj.maxUtf8Bytes, `${label}.maxUtf8Bytes`),
    dropped: dropped as TruncationWire['dropped'],
    exceededLimit: assertBoolean(obj.exceededLimit, `${label}.exceededLimit`),
    reason: obj.reason === null ? null : assertString(obj.reason, `${label}.reason`, 200),
  };
}

/**
 * Strict allowlisted validation of AiSafeFinancialSnapshot.
 * No object spread of untrusted input — only explicitly parsed fields are returned.
 */
export function validateAiSafeSnapshot(raw: unknown, nowMs: number): AiSafeSnapshotWire {
  const snap = assertObject(raw, 'snapshot');
  assertExactKeys(snap, SNAPSHOT_KEYS, 'snapshot');

  if (snap.kind === 'local') {
    throw new FinancialAssistantError(
      'invalid_request',
      'LocalFinancialSnapshot is not permitted on the wire',
      400
    );
  }
  if (snap.kind !== 'ai_safe') {
    throw new FinancialAssistantError('invalid_request', 'snapshot.kind must be ai_safe', 400);
  }
  if (snap.schemaVersion !== 1) {
    throw new FinancialAssistantError('invalid_request', 'snapshot.schemaVersion must be 1', 400);
  }

  const period = assertObject(snap.period, 'snapshot.period');
  assertExactKeys(period, ['month', 'year'], 'snapshot.period');
  const month = assertSafeInteger(period.month, 'snapshot.period.month');
  const year = assertSafeInteger(period.year, 'snapshot.period.year');
  if (month < 1 || month > 12) {
    throw new FinancialAssistantError('invalid_request', 'snapshot.period.month invalid', 400);
  }
  if (year < 1970 || year > 2100) {
    throw new FinancialAssistantError('invalid_request', 'snapshot.period.year invalid', 400);
  }

  const periodStatus = snap.periodStatus;
  if (periodStatus !== 'active' && periodStatus !== 'completed' && periodStatus !== 'future') {
    throw new FinancialAssistantError('invalid_request', 'snapshot.periodStatus invalid', 400);
  }

  const overallBudget = assertObject(snap.overallBudget, 'snapshot.overallBudget');
  assertExactKeys(overallBudget, ['amountMinor', 'source'], 'snapshot.overallBudget');
  const overallSource = overallBudget.source;
  if (overallSource !== 'budget_row' && overallSource !== 'settings_fallback' && overallSource !== 'none') {
    throw new FinancialAssistantError('invalid_request', 'snapshot.overallBudget.source invalid', 400);
  }

  const flags = assertObject(snap.flags, 'snapshot.flags');
  assertExactKeys(flags, ['hasIncome', 'hasExpenses', 'transferExcluded', 'insufficientData'], 'snapshot.flags');
  if (flags.transferExcluded !== true) {
    throw new FinancialAssistantError(
      'invalid_request',
      'snapshot.flags.transferExcluded must be true',
      400
    );
  }

  return {
    schemaVersion: 1,
    kind: 'ai_safe',
    snapshotId: assertSnapshotId(snap.snapshotId, 'snapshot.snapshotId'),
    snapshotComputedAt: assertIsoNotFuture(snap.snapshotComputedAt, 'snapshot.snapshotComputedAt', nowMs),
    financeRevision: assertSafeInteger(snap.financeRevision, 'snapshot.financeRevision'),
    contentRevision: assertString(snap.contentRevision, 'snapshot.contentRevision', 64),
    currency: assertCurrency(snap.currency, 'snapshot.currency'),
    period: { month, year },
    periodStatus,
    overallBudget: {
      amountMinor: assertNullOr(overallBudget.amountMinor, 'snapshot.overallBudget.amountMinor', (v, l) =>
        assertNonNegativeSafeInteger(v, l)
      ),
      source: overallSource,
    },
    totals: parsePeriodTotals(snap.totals, 'snapshot.totals'),
    previousPeriod: assertNullOr(snap.previousPeriod, 'snapshot.previousPeriod', parsePeriodTotals),
    topCategories: assertArray(snap.topCategories, 'snapshot.topCategories', 8).map((item, i) =>
      parseCategorySpend(item, `snapshot.topCategories[${i}]`)
    ),
    budgets: assertArray(snap.budgets, 'snapshot.budgets', 20).map((item, i) =>
      parseBudgetUsage(item, `snapshot.budgets[${i}]`)
    ),
    trends: assertArray(snap.trends, 'snapshot.trends', 12).map((item, i) =>
      parseTrend(item, `snapshot.trends[${i}]`)
    ),
    recurringPatterns: assertArray(snap.recurringPatterns, 'snapshot.recurringPatterns', 15).map(
      (item, i) => parseRecurring(item, `snapshot.recurringPatterns[${i}]`)
    ),
    anomalies: assertArray(snap.anomalies, 'snapshot.anomalies', 10).map((item, i) =>
      parseAnomaly(item, `snapshot.anomalies[${i}]`)
    ),
    budgetBaseline: parseBudgetBaseline(snap.budgetBaseline, 'snapshot.budgetBaseline'),
    flags: {
      hasIncome: assertBoolean(flags.hasIncome, 'snapshot.flags.hasIncome'),
      hasExpenses: assertBoolean(flags.hasExpenses, 'snapshot.flags.hasExpenses'),
      transferExcluded: true,
      insufficientData: assertBoolean(flags.insufficientData, 'snapshot.flags.insufficientData'),
    },
    dataQuality: parseDataQuality(snap.dataQuality, 'snapshot.dataQuality'),
    truncation: parseTruncation(snap.truncation, 'snapshot.truncation'),
  };
}

export function knownCategoryIds(snapshot: AiSafeSnapshotWire): Set<string> {
  const ids = new Set<string>();
  for (const row of snapshot.topCategories) ids.add(row.categoryId);
  for (const row of snapshot.budgets) {
    if (row.categoryId) ids.add(row.categoryId);
  }
  for (const row of snapshot.budgetBaseline.categories) ids.add(row.categoryId);
  for (const row of snapshot.trends) {
    if (row.categoryId) ids.add(row.categoryId);
  }
  for (const row of snapshot.recurringPatterns) {
    if (row.categoryId) ids.add(row.categoryId);
  }
  for (const row of snapshot.anomalies) ids.add(row.categoryId);
  return ids;
}
