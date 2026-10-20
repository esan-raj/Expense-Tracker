export type {
  AiSafeAnomalySignal,
  AiSafeFinancialSnapshot,
  AiSafeRecurringPattern,
  AiSafeTruncation,
  AmountBucket,
  AnomalySignal,
  AverageDailyMethod,
  BudgetBaseline,
  BudgetBaselineCategory,
  BudgetUsageRow,
  CategorySpendRow,
  DataQualityFlags,
  FinancialSnapshot,
  FinancialSnapshotInput,
  LocalAnomalySignal,
  LocalFinancialSnapshot,
  LocalRecurringPattern,
  OverallBudgetSource,
  Period,
  PeriodStatus,
  PeriodTotals,
  ProjectionMethod,
  RecurringPattern,
  SnapshotBudget,
  SnapshotCategory,
  SnapshotTransaction,
  TrendSignal,
  Volatility,
} from './types';

export { AI_SAFE_MAX_UTF8_BYTES } from './types';

export { buildFinancialSnapshot } from './buildFinancialSnapshot';
export {
  buildAiSafeFinancialSnapshot,
  collectProhibitedPaths,
  AI_SAFE_PROHIBITED_KEYS,
  utf8ByteLength,
} from './buildAiSafeFinancialSnapshot';
export {
  adaptFinancialSnapshotInput,
  type RawFinancialSnapshotSource,
} from './adaptFinancialSnapshotInput';
export {
  aggregateCategorySpend,
  aggregatePeriodTotals,
  filterPeriodTransactions,
  spentForBudget,
} from './aggregateSpending';
export { detectTrends } from './detectTrends';
export { detectRecurringPatterns } from './detectRecurringPatterns';
export { detectAnomalies } from './detectAnomalies';
export { generateBudgetBaseline } from './generateBudgetBaseline';
export { resolveOverallBudgetMinor } from './resolveOverallBudget';
export type { OverallBudgetResolution } from './resolveOverallBudget';
export {
  buildSnapshotId,
  computeContentRevision,
  resolveFinanceRevision,
} from './snapshotRevision';
export {
  averageDivisorDays,
  classifyPeriod,
  lookbackPeriods,
  periodBounds,
  periodPrefix,
  previousPeriod,
} from './periodBounds';
export { amountBucket } from './amountBuckets';
export {
  FinancialSnapshotValidationError,
  assertSafeInteger,
  safeAdd,
  safeMultiply,
} from './integerSafety';
