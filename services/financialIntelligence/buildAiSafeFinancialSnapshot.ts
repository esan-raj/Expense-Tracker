import { amountBucket } from './amountBuckets';
import { FinancialSnapshotValidationError } from './integerSafety';
import type {
  AiSafeAnomalySignal,
  AiSafeFinancialSnapshot,
  AiSafeRecurringPattern,
  AiSafeTruncation,
  LocalFinancialSnapshot,
} from './types';
import { AI_SAFE_MAX_UTF8_BYTES } from './types';

const utf8 = new TextEncoder();

export function utf8ByteLength(value: string): number {
  return utf8.encode(value).length;
}

function mapRecurring(local: LocalFinancialSnapshot['recurringPatterns']): AiSafeRecurringPattern[] {
  const byKey = new Map<string, AiSafeRecurringPattern>();

  for (const pattern of local) {
    const key = `${pattern.categoryId ?? 'null'}|${pattern.markedRecurring ? '1' : '0'}|${amountBucket(pattern.averageAmountMinor)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        categoryId: pattern.categoryId,
        categoryName: pattern.categoryName,
        occurrenceCount: pattern.occurrenceCount,
        averageAmountBucket: amountBucket(pattern.averageAmountMinor),
        markedRecurring: pattern.markedRecurring,
      });
    } else {
      existing.occurrenceCount += pattern.occurrenceCount;
    }
  }

  return [...byKey.values()].sort(
    (a, b) =>
      b.occurrenceCount - a.occurrenceCount ||
      (a.categoryId ?? '').localeCompare(b.categoryId ?? '') ||
      Number(b.markedRecurring) - Number(a.markedRecurring) ||
      a.averageAmountBucket.localeCompare(b.averageAmountBucket)
  );
}

function mapAnomalies(local: LocalFinancialSnapshot['anomalies']): AiSafeAnomalySignal[] {
  const byKey = new Map<string, AiSafeAnomalySignal>();

  for (const anomaly of local) {
    const key = [
      anomaly.categoryId,
      amountBucket(anomaly.amountMinor),
      amountBucket(anomaly.baselineAverageMinor),
      anomaly.multipleOfBaseline,
    ].join('|');
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        categoryId: anomaly.categoryId,
        categoryName: anomaly.categoryName,
        amountBucket: amountBucket(anomaly.amountMinor),
        baselineAverageBucket: amountBucket(anomaly.baselineAverageMinor),
        multipleOfBaseline: anomaly.multipleOfBaseline,
        periodAnomalyCount: 1,
      });
    } else {
      existing.periodAnomalyCount += 1;
    }
  }

  return [...byKey.values()].sort(
    (a, b) =>
      b.multipleOfBaseline - a.multipleOfBaseline ||
      b.periodAnomalyCount - a.periodAnomalyCount ||
      a.categoryId.localeCompare(b.categoryId) ||
      a.amountBucket.localeCompare(b.amountBucket)
  );
}

function withMeasuredTruncation(
  body: Omit<AiSafeFinancialSnapshot, 'truncation'>,
  dropped: AiSafeTruncation['dropped']
): AiSafeFinancialSnapshot {
  const truncated = Object.keys(dropped).length > 0;
  const provisional: AiSafeFinancialSnapshot = {
    ...body,
    truncation: {
      truncated,
      utf8Bytes: 0,
      maxUtf8Bytes: AI_SAFE_MAX_UTF8_BYTES,
      dropped: { ...dropped },
      exceededLimit: false,
      reason: null,
    },
  };
  provisional.truncation.utf8Bytes = utf8ByteLength(JSON.stringify(provisional));
  // Second pass: digit width of utf8Bytes may change the size by a few bytes.
  provisional.truncation.utf8Bytes = utf8ByteLength(JSON.stringify(provisional));
  return provisional;
}

/**
 * Maps a local snapshot to an AI-safe envelope.
 * Excludes titles, title keys, sample merchants, IDs of people/accounts, raw rows, SMS.
 * Enforces the documented 8 KiB UTF-8 request limit with deterministic truncation.
 * Fail-closed: throws if the payload still exceeds the limit after maximum truncation.
 */
export function buildAiSafeFinancialSnapshot(local: LocalFinancialSnapshot): AiSafeFinancialSnapshot {
  if (local.kind !== 'local') {
    throw new FinancialSnapshotValidationError('buildAiSafeFinancialSnapshot requires kind: local');
  }

  const dropped: AiSafeTruncation['dropped'] = {};

  let topCategories = [...local.topCategories];
  let budgets = [...local.budgets];
  let trends = [...local.trends];
  let recurringPatterns = mapRecurring(local.recurringPatterns);
  let anomalies = mapAnomalies(local.anomalies);
  let baselineCategories = [...local.budgetBaseline.categories];

  const buildBody = (): Omit<AiSafeFinancialSnapshot, 'truncation'> => ({
    schemaVersion: 1,
    kind: 'ai_safe',
    snapshotId: local.snapshotId,
    snapshotComputedAt: local.snapshotComputedAt,
    financeRevision: local.financeRevision,
    contentRevision: local.contentRevision,
    currency: local.currency,
    period: local.period,
    periodStatus: local.periodStatus,
    overallBudget: local.overallBudget,
    totals: local.totals,
    previousPeriod: local.previousPeriod,
    topCategories,
    budgets,
    trends,
    recurringPatterns,
    anomalies,
    budgetBaseline: {
      ...local.budgetBaseline,
      categories: baselineCategories,
    },
    flags: local.flags,
    dataQuality: local.dataQuality,
  });

  const shrinkSteps: Array<() => boolean> = [
    () => {
      if (baselineCategories.length === 0) return false;
      baselineCategories = baselineCategories.slice(0, -1);
      dropped.baselineCategories = (dropped.baselineCategories ?? 0) + 1;
      return true;
    },
    () => {
      if (anomalies.length === 0) return false;
      anomalies = anomalies.slice(0, -1);
      dropped.anomalies = (dropped.anomalies ?? 0) + 1;
      return true;
    },
    () => {
      if (recurringPatterns.length === 0) return false;
      recurringPatterns = recurringPatterns.slice(0, -1);
      dropped.recurringPatterns = (dropped.recurringPatterns ?? 0) + 1;
      return true;
    },
    () => {
      if (trends.length <= 3) return false;
      trends = trends.slice(0, -1);
      dropped.trends = (dropped.trends ?? 0) + 1;
      return true;
    },
    () => {
      if (budgets.length <= 1) return false;
      budgets = budgets.slice(0, -1);
      dropped.budgets = (dropped.budgets ?? 0) + 1;
      return true;
    },
    () => {
      if (topCategories.length === 0) return false;
      topCategories = topCategories.slice(0, -1);
      dropped.topCategories = (dropped.topCategories ?? 0) + 1;
      return true;
    },
  ];

  let result = withMeasuredTruncation(buildBody(), dropped);
  let guard = 0;
  while (result.truncation.utf8Bytes > AI_SAFE_MAX_UTF8_BYTES && guard < 500) {
    guard += 1;
    let progressed = false;
    for (const step of shrinkSteps) {
      if (step()) {
        progressed = true;
        break;
      }
    }
    if (!progressed) break;
    result = withMeasuredTruncation(buildBody(), dropped);
  }

  if (result.truncation.utf8Bytes > AI_SAFE_MAX_UTF8_BYTES) {
    result.truncation.exceededLimit = true;
    result.truncation.reason =
      'AI-safe snapshot exceeds 8 KiB after maximum deterministic truncation';
    throw new FinancialSnapshotValidationError(result.truncation.reason);
  }

  return result;
}

/** Keys that must never appear in an AI-safe JSON tree. */
export const AI_SAFE_PROHIBITED_KEYS = [
  'title',
  'titles',
  'titleKey',
  'sampleTitle',
  'sampleMerchant',
  'merchant',
  'merchantName',
  'description',
  'notes',
  'note',
  'email',
  'userId',
  'userEmail',
  'accountId',
  'accountName',
  'transactionId',
  'transferGroupId',
  'recurringId',
  'sms',
  'notification',
  'upi',
  'cardNumber',
  'bankAccount',
  'iban',
  'phone',
] as const;

export function collectProhibitedPaths(value: unknown, path = '$'): string[] {
  const hits: string[] = [];
  const prohibited = new Set(AI_SAFE_PROHIBITED_KEYS.map((key) => key.toLowerCase()));

  const walk = (node: unknown, current: string) => {
    if (node == null) return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${current}[${index}]`));
      return;
    }
    if (typeof node === 'object') {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        if (prohibited.has(key.toLowerCase())) {
          hits.push(`${current}.${key}`);
        }
        walk(child, `${current}.${key}`);
      }
    }
  };

  walk(value, path);
  return hits;
}
